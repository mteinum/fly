"""Bygg spillfliser for ett utsnitt: heightmap.f32 + colormap.png + metadata.json."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.features import rasterize
from shapely.geometry import LineString

from . import airports, dtm, landcover, n50, structures, terrain
from .areas import Area
from .crs import UTM33, grid_convergence_deg, scale_factor
from .grid import GridSpec

REPO = Path(__file__).resolve().parents[3]
RAW = REPO / "data" / "raw"
PROCESSED = REPO / "data" / "processed"
TILES = REPO / "web" / "public" / "data"

SUN_AZIMUTH_TRUE = 225.0
SUN_ELEVATION = 28.0


def runway_mask(airport: dict, grid: GridSpec) -> np.ndarray:
    """Rasteriser rullebanene (senterlinje bufret til full bredde) til rutenettet."""
    shapes = []
    for rw in airport["runways"]:
        le, he = rw["ends"]
        line = LineString([(le["east"], le["north"]), (he["east"], he["north"])])
        shapes.append(line.buffer(rw["widthM"] / 2, cap_style="flat"))
    # all_touched: banen er 45 m bred og ville ellers falle mellom 50 m-cellene
    return rasterize(shapes, out_shape=(grid.height, grid.width), transform=grid.transform, all_touched=True).astype(bool)


def _write_geotiff(path: Path, data: np.ndarray, grid: GridSpec) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bands = data[None] if data.ndim == 2 else np.moveaxis(data, -1, 0)
    with rasterio.open(
        path, "w", driver="GTiff", width=grid.width, height=grid.height, count=bands.shape[0],
        dtype=bands.dtype, crs=UTM33, transform=grid.transform, compress="deflate",
    ) as dst:
        dst.write(bands)


def build(area: Area) -> Path:
    raw = RAW / area.id
    print(f"[{area.id}] flyplass {area.icao} (OurAirports)")
    arp = airports.load_airport(area.icao, RAW)["arp"]
    grid = GridSpec.centered(arp["east"], arp["north"], area.cell, area.size)
    airport = airports.load_airport(area.icao, RAW, grid)

    print(f"[{area.id}] DTM {area.source_res:g} m fra WCS, bbox {grid.west:.0f},{grid.south:.0f},{grid.east:.0f},{grid.north:.0f}")
    src = dtm.load_source_dtm(grid, area.source_res, raw)
    factor = int(area.cell / area.source_res)
    hgt = terrain.block_mean(src, factor)

    cx, cy = grid.grid_to_utm(grid.width / 2, grid.height / 2)
    conv = grid_convergence_deg(cx, cy)
    sun_grid = (SUN_AZIMUTH_TRUE - conv) % 360
    shade = terrain.hillshade(hgt, area.cell, sun_grid, SUN_ELEVATION)
    features = lc = None
    items: list[list] = []
    if area.n50_county:
        print(f"[{area.id}] N50 {area.n50_county}: arealdekke, veier, bruer, bygninger")
        lc = landcover.load_landcover(n50.gdb_path(area.n50_county, RAW), grid)
        vectors = n50.load_features(area.n50_county, grid, RAW)
        print(f"[{area.id}] DOM 1 m rundt bruene (dekkhøyde)")
        items, features = structures.build_structures(vectors, n50.rasterize_features(vectors, grid), hgt, grid, raw)
    rgb = terrain.colormap(hgt, area.cell, shade, lc, features)
    rgb[runway_mask(airport, grid)] = terrain.RUNWAY

    out = TILES / area.id
    out.mkdir(parents=True, exist_ok=True)
    hgt.astype("<f4").tofile(out / "heightmap.f32")
    Image.fromarray(rgb, "RGB").save(out / "colormap.png", optimize=True)
    if lc is None:
        lc = np.where(hgt <= terrain.SEA_LEVEL_MAX, landcover.CLASSES[1].code, landcover.UNKNOWN).astype(np.uint8)
    lc.tofile(out / "landcover.bin")
    (out / "structures.json").write_text(
        json.dumps({"columns": ["col", "row", "kind", "base", "top", "r", "g", "b"], "kinds": structures.KINDS, "items": items}, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    n_bridge = sum(1 for it in items if it[2] == structures.BRIDGE)

    meta = {
        "id": area.id,
        "name": area.name,
        "crs": UTM33,
        "verticalDatum": "NN2000",
        "cellSize": area.cell,
        "width": grid.width,
        "height": grid.height,
        "bbox": {"west": grid.west, "south": grid.south, "east": grid.east, "north": grid.north},
        "gridOrigin": "nordvest: rad 0 = nord, kolonne 0 = vest, y øker mot sør",
        "minHeight": round(float(hgt.min()), 2),
        "maxHeight": round(float(hgt.max()), 2),
        "seaColor": list(terrain.SEA),
        "gridConvergenceDeg": round(conv, 4),
        "scaleFactor": round(scale_factor(cx, cy), 6),
        "heightmap": {"file": "heightmap.f32", "dtype": "float32", "byteOrder": "little", "unit": "m"},
        "colormap": {"file": "colormap.png"},
        "landcover": {
            "file": "landcover.bin",
            "dtype": "uint8",
            "source": "N50 Arealdekke" if area.n50_county else "kun DTM (hav der høyde <= 0,1 m)",
            "method": f"rasterisert til {landcover.SUBCELL:g} m, flertall per {area.cell:g} m-celle",
            "classes": [{"code": c.code, "name": c.name, "water": c.water} for c in landcover.CLASSES],
        },
        "structures": {
            "file": "structures.json",
            "bridgeCells": n_bridge,
            "buildingCells": len(items) - n_bridge,
            "bridgeHeights": "DOM 1 m (nhm_dom_topo_25833), median langs senterlinja per celle",
            "buildingHeights": f"nominell: {structures.HEIGHT_HOUSE:g} m (punkt), {structures.HEIGHT_LARGE:g} m (flate)",
        },
        "resampling": {
            "source": f"{dtm.COVERAGE} (1 m) via WCS, {dtm.INTERPOLATION} til {area.source_res:g} m",
            "method": f"blokkmiddel {factor}x{factor} til {area.cell:g} m",
        },
        "hillshade": {
            "sunAzimuthTrueDeg": SUN_AZIMUTH_TRUE,
            "sunAzimuthGridDeg": round(sun_grid, 2),
            "sunElevationDeg": SUN_ELEVATION,
        },
        "features": None if features is None else {
            "source": f"N50 Kartdata, {area.n50_county} (FGDB)",
            "roadCategories": list(n50.ROAD_CATEGORIES),
            "roadCells": int((features == n50.ROAD).sum()),
            "roadKm": round(float(vectors["roads"].length.sum()) / 1000, 1),
            "bridgeKm": round(float(vectors["bridges"].length.sum()) / 1000, 1),
            "buildings": int(len(vectors["buildingPoints"]) + len(vectors["buildingAreas"])),
        },
        "airports": [airport],
        "attribution": [
            "Høydedata (DTM, DOM) og N50 Kartdata: © Kartverket (CC BY 4.0)",
            "Flyplassdata: OurAirports (public domain)",
        ],
    }
    (out / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Georefererte kopier for kontroll i QGIS
    _write_geotiff(PROCESSED / area.id / f"dtm{area.cell:g}m.tif", hgt, grid)
    _write_geotiff(PROCESSED / area.id / "colormap.tif", rgb, grid)
    if features is not None:
        _write_geotiff(PROCESSED / area.id / "features.tif", features, grid)
    _write_geotiff(PROCESSED / area.id / "landcover.tif", lc, grid)
    print(f"[{area.id}] skrev {out.relative_to(REPO)} (høyde {meta['minHeight']}-{meta['maxHeight']} m, konvergens {conv:.2f}°)")
    return out
