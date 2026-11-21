"""Bygg spillfliser for ett utsnitt: heightmap.f32 + colormap.png + metadata.json."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.features import rasterize
from shapely.geometry import LineString

from . import airports, analysis, dtm, landcover, lights, matrikkel, n50, structures, terrain
from .areas import AREAS, Area
from .crs import UTM33, grid_convergence_deg, scale_factor
from .grid import GridSpec

REPO = Path(__file__).resolve().parents[3]
RAW = REPO / "data" / "raw"
PROCESSED = REPO / "data" / "processed"
TILES = REPO / "web" / "public" / "data"
LANDMARKS = REPO / "data" / "landmarks.json"

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
    raw = RAW / area.raw_id
    print(f"[{area.id}] flyplass {area.icao} (OurAirports)")
    arp = airports.load_airport(area.icao, RAW)["arp"]
    grid = GridSpec.centered(arp["east"] + area.center_offset[0], arp["north"] + area.center_offset[1], area.cell, area.size)
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
    bridge_lines: list[dict] = []
    towers: list[list[float]] = []
    church = []
    profile_cells: dict[str, int] = {}
    if area.n50_county:
        print(f"[{area.id}] N50 {area.n50_county}: arealdekke, veier, bruer, bygninger")
        lc = landcover.load_landcover(n50.gdb_path(area.n50_county, RAW), grid)
        vectors = n50.load_features(area.n50_county, grid, RAW, area.road_categories)
        point_heights = None
        if area.matrikkel_buildings:
            # alle bygg fra Matrikkelen erstatter N50s utvalg av bygningspunkter. N50s flater (store bygg) beholdes:
            # de gir form, og høyde fra DOM
            print(f"[{area.id}] Matrikkelen {area.n50_county}: bygningspunkter")
            n50_points = len(vectors["buildingPoints"])
            vectors["buildingPoints"] = matrikkel.load_buildings(area.n50_county, grid, RAW)
            point_heights = matrikkel.height_raster(vectors["buildingPoints"], grid)
        ndsm = None
        if area.dom_building_heights:
            print(f"[{area.id}] DOM {area.source_res:g} m (bygningshøyder)")
            ndsm = terrain.block_mean(dtm.load_source_dom(grid, area.source_res, raw), factor) - hgt
        print(f"[{area.id}] DOM 1 m rundt bruene (dekkhøyde)")
        items, bridge_lines, features = structures.build_structures(
            vectors, n50.rasterize_features(vectors, grid), hgt, grid, raw, ndsm, point_heights=point_heights
        )
        if area.matrikkel_buildings:
            # Farge etter bygningstype (se matrikkel.PROFILE_*). Celler uten kjent type beholder fargen de har.
            types = matrikkel.type_raster(vectors["buildingPoints"], vectors["buildingAreas"], grid)
            for it in items:
                code = int(types[it[1], it[0]])
                if it[2] == structures.BUILDING and code:
                    name, colors = matrikkel.profile(code)
                    it[5:8] = colors[(it[0] * 7 + it[1] * 13) % 2]  # fast veksling, så naboer ikke blir helt like
                    profile_cells[name] = profile_cells.get(name, 0) + 1
            # Kirker med tårn der overflatemodellen viser et
            church = vectors["buildingPoints"][vectors["buildingPoints"]["bygningstype"] == matrikkel.CHURCH]
            print(f"[{area.id}] DOM 1 m rundt {len(church)} kirker (tårn)")
            towers = structures.church_towers(church, hgt, grid, raw)
    airport["tower"] = airports.tower_position(airport, vectors["buildingAreas"] if area.n50_county else None, hgt, grid)

    # Analyser: hva tårnet ser, klaringen under hver innflyging, og bygningsklynger (se analysis.py)
    print(f"[{area.id}] analyser: synlighet fra tårnet, klaring under innflygingene, bygningsklynger")
    tower = airport["tower"]
    need = analysis.required_altitude(hgt, area.cell, tower["x"], tower["y"], tower["eyeM"])
    top = analysis.surface_top(hgt, items)
    for rw in airport["runways"]:
        for end in rw["ends"]:
            end["approach"] = analysis.approach_facts(end, hgt, top, need, area.cell)
    above_ground = need - np.maximum(hgt, 0)
    viewshed = {
        "groundSeenShare": round(float((above_ground < 1).mean()), 3),
        "seenAt300mShare": round(float((above_ground <= 300).mean()), 3),
        "method": "siktlinjer fra tårnets øyepunkt over terrenget (DTM), med jordkrumning og standard brytning (k = 0,13)",
        "limits": "trær og bygninger sperrer ikke sikten her; tårnets plassering og øyehøyde er antatt",
    }
    building_xy = np.zeros((0, 2))
    clusters = np.zeros(0, dtype=int)
    if area.n50_county:
        # Matrikkelen har alle bygg som punkt. Med N50 må flatene (store bygg) tas med i tillegg til punktene.
        centres = [vectors["buildingPoints"].geometry] + ([] if area.matrikkel_buildings else [vectors["buildingAreas"].geometry.centroid])
        building_xy = np.array([(p.x, p.y) for series in centres for p in series], dtype=float).reshape(-1, 2)
        cluster_eps = analysis.CLUSTER_EPS_M if area.matrikkel_buildings else analysis.CLUSTER_EPS_GENERALISED_M
        clusters = analysis.building_clusters(building_xy, cluster_eps)
    # Stedsnavn: høyden er terrenget under navnet. Brunavn flyttes opp på brua, til nærmeste punkt på dekket.
    names: list[dict] = n50.load_names(area.n50_county, grid, RAW) if area.n50_county else []
    deck = [(px, py, pz) for b in bridge_lines for px, py, pz in b["points"]]
    def ground(n: dict) -> float:
        # Avrund FØR oppslaget: fila lagrer to desimaler, og 123,996 -> 124,00 er en annen celle
        n["x"], n["y"] = min(round(n["x"], 2), grid.width - 0.01), min(round(n["y"], 2), grid.height - 0.01)
        return max(0.0, float(hgt[int(n["y"]), int(n["x"])]))

    for n in names:
        n["z"] = ground(n)
        if n["type"] == "bru" and deck:
            px, py, pz = min(deck, key=lambda p: (p[0] - n["x"]) ** 2 + (p[1] - n["y"]) ** 2)
            if np.hypot(px - n["x"], py - n["y"]) * area.cell < 400:
                n["x"], n["y"] = px, py
                n["z"] = max(ground(n), pz)
    # Kjennemerker med logo (data/landmarks.json): de som ligger i utsnittet, med høyden på stedet
    landmarks = []
    for lm in json.loads(LANDMARKS.read_text(encoding="utf-8"))["landmarks"] if area.n50_county else []:
        lx, ly = grid.utm_to_grid(lm["east"], lm["north"])
        if 0 <= lx < grid.width and 0 <= ly < grid.height:
            roofs = [it[4] for it in items if it[2] == structures.BUILDING and abs(it[0] - lx) < 3 and abs(it[1] - ly) < 3]
            z = max([max(0.0, float(hgt[int(ly), int(lx)])), *roofs])  # over takene rundt, så skiltet ikke står inne i et bygg
            landmarks.append({"id": lm["id"], "name": lm["name"], "x": round(lx, 2), "y": round(ly, 2), "z": round(z, 1), "image": lm["image"]})
    flat_light = np.ones_like(shade)
    rgb = terrain.colormap(hgt, area.cell, shade if area.bake_hillshade else flat_light, lc, features, steep_slope=area.steep_slope)
    # Tunneler ses ikke fra lufta. Spillet tegner dem som stiplet linje oppå bakken og sjøen, slik et kart gjør.
    tunnels = n50.tunnel_lines(vectors, grid) if area.n50_county else []
    on_runway = runway_mask(airport, grid)
    rgb[on_runway] = terrain.RUNWAY

    out = TILES / area.id
    out.mkdir(parents=True, exist_ok=True)
    hgt.astype("<f4").tofile(out / "heightmap.f32")
    Image.fromarray(rgb, "RGB").save(out / "colormap.png", optimize=True)
    has_lights = area.night_lights and lc is not None and features is not None
    if has_lights:
        bx, by = (building_xy[:, 0] - grid.west) / area.cell, (grid.north - building_xy[:, 1]) / area.cell
        ok = (bx >= 0) & (bx < grid.width) & (by >= 0) & (by < grid.height)
        placed = (by[ok].astype(int), bx[ok].astype(int), clusters[ok] >= 0)
        glow = lights.night_lights(lc, features, n50.major_road_mask(vectors, grid), buildings=placed, cell=area.cell, every_house=area.matrikkel_buildings)
        Image.fromarray(glow, "RGB").save(out / "lights.png", optimize=True)
    if lc is None:
        lc = np.where(hgt <= terrain.SEA_LEVEL_MAX, landcover.CLASSES[1].code, landcover.UNKNOWN).astype(np.uint8)
    lc.tofile(out / "landcover.bin")
    surface = lc.copy()
    if features is not None:
        surface[features == n50.ROAD] = landcover.SURFACE_ROAD
    surface[on_runway] = landcover.SURFACE_RUNWAY
    surface.tofile(out / "surface.bin")
    (out / "structures.json").write_text(
        json.dumps({"columns": ["col", "row", "kind", "base", "top", "r", "g", "b"], "kinds": structures.KINDS, "items": items, "bridges": bridge_lines, "churchTowers": towers, "tunnels": tunnels}, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    n_bridge = sum(1 for it in items if it[2] == structures.BRIDGE)
    (out / "names.json").write_text(
        json.dumps({"columns": ["name", "x", "y", "z", "size", "type", "group"],
                    "items": [[n["name"], round(n["x"], 2), round(n["y"], 2), round(n["z"], 1), n["size"], n["type"], n["group"]] for n in names]},
                   separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

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
        "colormap": {"file": "colormap.png", "hillshadeBaked": area.bake_hillshade},
        "lights": {"file": "lights.png", "placement": "syntetisk: langs veier, i bebygde flater og ved bygningene; bygningsklynger avgjør hvor det er gatelys"} if has_lights else None,
        "landcover": {
            "unknownShare": round(float((lc == landcover.UNKNOWN).mean()), 5),
            "file": "landcover.bin",
            "dtype": "uint8",
            "source": "N50 Arealdekke" if area.n50_county else "kun DTM (hav der høyde <= 0,1 m)",
            "method": f"rasterisert til {landcover.SUBCELL:g} m, flertall per {area.cell:g} m-celle",
            "classes": [{"code": c.code, "name": c.name, "water": c.water} for c in landcover.CLASSES],
        },
        "surface": {
            "file": "surface.bin",
            "dtype": "uint8",
            "about": "arealdekke med vei og rullebane lagt oppå; styrer detaljmønster på bakken",
            "classes": landcover.surface_classes(terrain.ROAD, terrain.RUNWAY),
        },
        "names": {
            "file": "names.json",
            "count": len(names),
            "source": "N50 Kartdata, tekstlaget (stedsnavn fra Sentralt stedsnavnregister)",
            "about": "size er kartets skriftstørrelse i 1:50 000 og brukes som mål på hvor viktig navnet er",
        },
        "structures": {
            "file": "structures.json",
            "bridgeCells": n_bridge,
            "buildingCells": len(items) - n_bridge,
            "bridgeHeights": "DOM 1 m (nhm_dom_topo_25833), median langs senterlinja per celle",
            "bridgeLines": len(bridge_lines),
            "buildingColors": {
                "about": "farge etter bygningstype fra Matrikkelen; fargene er valgt, ikke observert",
                "cells": dict(sorted(profile_cells.items(), key=lambda kv: -kv[1])),
                # til forklaringen i spillet: navn og første farge, vanligste først
                "legend": [
                    [name, "#%02x%02x%02x" % colors[0]]
                    for name, colors in {n: c for n, c in [*matrikkel.PROFILE_BY_MAIN.values(), *matrikkel.PROFILE_BY_GROUP.values()]}.items()
                    if profile_cells.get(name)
                ],
            } if profile_cells else None,
            "churches": len(church),
            "churchTowers": len(towers),
            "churchTowerSource": "kirker fra Matrikkelen (type 671); tårnets plass og høyde målt i DOM 1 m, se structures.church_towers",
            "buildingHeights": (
                ("punkt: nominell etter bygningstype (Matrikkelen har ikke høyde); flate: " if area.matrikkel_buildings else f"punkt: nominell {structures.HEIGHT_HOUSE:g} m; flate: ")
                + ("median av DOM - DTM innenfor flaten" if area.dom_building_heights else f"nominell {structures.HEIGHT_LARGE:g} m")
            ),
        },
        "resampling": {
            "source": f"{dtm.COVERAGE} (1 m) via WCS, {dtm.INTERPOLATION} til {area.source_res:g} m",
            "method": f"blokkmiddel {factor}x{factor} til {area.cell:g} m" if factor > 1 else "ingen videre resampling (tjenestens rutenett brukes direkte)",
        },
        "hillshade": {
            "sunAzimuthTrueDeg": SUN_AZIMUTH_TRUE,
            "sunAzimuthGridDeg": round(sun_grid, 2),
            "sunElevationDeg": SUN_ELEVATION,
        },
        "features": None if features is None else {
            "source": f"N50 Kartdata, {area.n50_county} (FGDB)",
            "roadCategories": list(area.road_categories),
            "roadCells": int((features == n50.ROAD).sum()),
            "roadKm": round(float(vectors["roads"].length.sum()) / 1000, 1),
            "bridgeKm": round(float(vectors["bridges"].length.sum()) / 1000, 1),
            "tunnels": len(tunnels),
            "tunnelsAbout": "veier under terrenget (N50, medium = U), minst 150 m; i structures.json, tegnes stiplet av spillet",
            "buildings": int(len(vectors["buildingPoints"]) + (0 if area.matrikkel_buildings else len(vectors["buildingAreas"]))),
            "buildingSource": (
                f"Matrikkelen - Bygningspunkt, {area.n50_county}: bygg som står, uten garasjer, uthus og naust (N50 hadde {n50_points} punkter). "
                "Store bygg har i tillegg form fra N50"
                if area.matrikkel_buildings else "N50 Kartdata"
            ),
        },
        "analysis": {
            "towerViewshed": viewshed,
            "approach": {
                "about": "per baneende i airports[].runways[].ends[].approach",
                "glidePath": f"{analysis.GLIDE_ANGLE_DEG:g}° mot et punkt {analysis.AIM_POINT_M:g} m innenfor terskelen (syntetisk, ikke flyplassens ILS)",
                "clearance": f"laveste klaring fra glidebanen til terreng, bygninger og bruer i et belte på ±{analysis.CORRIDOR_HALF_WIDTH_M:g} m, "
                f"fra {analysis.CLEARANCE_FROM_M:g} til {analysis.APPROACH_DIST_M:g} m før baneenden",
            },
            "buildingClusters": analysis.cluster_summary(clusters, cluster_eps if area.n50_county else analysis.CLUSTER_EPS_M),
        },
        "landmarks": landmarks,
        "airports": [airport],
        "attribution": [
            "Elevation data (DTM, DOM), N50 map data and building points (Matrikkelen): © Kartverket (CC BY 4.0)"
            if area.matrikkel_buildings else "Elevation data (DTM, DOM) and N50 map data: © Kartverket (CC BY 4.0)",
            "Airport data: OurAirports (public domain)",
        ],
    }
    (out / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Indeks over utsnittene som finnes, så spillet kan tilby dem
    index_path = TILES / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"areas": []}
    entry = {"id": area.id, "name": area.name, "icao": area.icao, "cellSize": area.cell}
    index["areas"] = sorted([a for a in index["areas"] if a["id"] != area.id] + [entry], key=lambda a: list(AREAS).index(a["id"]))
    index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Georefererte kopier for kontroll i QGIS
    _write_geotiff(PROCESSED / area.id / f"dtm{area.cell:g}m.tif", hgt, grid)
    _write_geotiff(PROCESSED / area.id / "colormap.tif", rgb, grid)
    if features is not None:
        _write_geotiff(PROCESSED / area.id / "features.tif", features, grid)
    _write_geotiff(PROCESSED / area.id / "landcover.tif", lc, grid)
    # m over bakken et fly må ha for å ses fra tårnet (0 = bakken ses)
    _write_geotiff(PROCESSED / area.id / "tower_viewshed.tif", above_ground.astype(np.float32), grid)
    if len(building_xy):
        import geopandas as gpd

        gpd.GeoDataFrame({"cluster": clusters}, geometry=gpd.points_from_xy(building_xy[:, 0], building_xy[:, 1]), crs=UTM33).to_file(
            PROCESSED / area.id / "building_clusters.gpkg", driver="GPKG"
        )
    print(f"[{area.id}] skrev {out.relative_to(REPO)} (høyde {meta['minHeight']}-{meta['maxHeight']} m, konvergens {conv:.2f}°)")
    return out
