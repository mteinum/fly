"""N50 Kartdata (Kartverket): veier, bruer og bygninger.

Kilde: ferdig fylkesfil i FGDB-format, EPSG:25833, fra Geonorge:
  https://nedlasting.geonorge.no/geonorge/Basisdata/N50Kartdata/FGDB/
Fila caches i data/raw/n50/ (256 MB for Agder).

N50 er generalisert for målestokk 1:50 000. Bygninger er punkter (eller flater
for store bygg), veier er senterlinjer. Det passer til 50 m-celler: en celle
er enten «vei», «bygning» eller ingen av delene.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests
from rasterio.features import rasterize

from . import USER_AGENT
from .grid import GridSpec

BASE_URL = "https://nedlasting.geonorge.no/geonorge/Basisdata/N50Kartdata/FGDB"

# Klasser i feature-rasteret. Høyere tall vinner der flere treffer samme celle.
NONE, BUILDING, ROAD, BRIDGE = 0, 1, 2, 3

# Europa-, riks- og fylkesveier. Kommunale og private veier (1050 km i
# Kjevik-utsnittet) ville fylt nesten hver celle i tettbygde strøk.
ROAD_CATEGORIES = ("E", "R", "F")
# Bruer tas med for alle bilveier, også kommunale og private.
BRIDGE_CATEGORIES = ("E", "R", "F", "K", "P")
MAJOR_ROAD_HALF_WIDTH = 7.0  # m


def gdb_path(county: str, raw_dir: Path) -> Path:
    """Last ned og pakk ut fylkesfila hvis den ikke finnes. `county` f.eks. '42_Agder'."""
    name = f"Basisdata_{county}_25833_N50Kartdata_FGDB"
    target = raw_dir / "n50" / county
    gdb = target / f"{name}.gdb"
    if not gdb.exists():
        zip_path = raw_dir / "n50" / f"{name}.zip"
        if not zip_path.exists():
            print(f"  N50: laster ned {name}.zip")
            zip_path.parent.mkdir(parents=True, exist_ok=True)
            with requests.get(f"{BASE_URL}/{name}.zip", headers={"User-Agent": USER_AGENT}, stream=True, timeout=600) as r:
                r.raise_for_status()
                with zip_path.open("wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(target)
    return gdb


def _read(gdb: Path, layer: str, grid: GridSpec) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(gdb, layer=layer, bbox=(grid.west, grid.south, grid.east, grid.north), engine="pyogrio")
    assert gdf.crs is not None and gdf.crs.to_epsg() == 25833, gdf.crs
    return gdf


def load_features(
    county: str, grid: GridSpec, raw_dir: Path, road_categories: tuple[str, ...] = ROAD_CATEGORIES
) -> dict[str, gpd.GeoDataFrame]:
    """Veier, bruer og bygninger innenfor rutenettet, i UTM 33."""
    gdb = gdb_path(county, raw_dir)
    lines = _read(gdb, "N50_Samferdsel_senterlinje", grid)
    cars = lines[(lines["objtype"] == "Veglenke") & (lines["typeveg"] == "enkelBilveg")]
    # medium: T = på terrenget, L = i lufta (bru), U = under terrenget (tunnel, tegnes ikke)
    roads = cars[(cars["medium"] == "T") & cars["vegkategori"].isin(road_categories)]
    bridges = cars[(cars["medium"] == "L") & cars["vegkategori"].isin(BRIDGE_CATEGORIES)]
    points = _read(gdb, "N50_BygningerOgAnlegg_posisjon", grid)
    areas = _read(gdb, "N50_BygningerOgAnlegg_omrade", grid)
    return {
        "roads": roads,
        "bridges": bridges,
        "buildingPoints": points[points["objtype"] == "Bygning"],
        "buildingAreas": areas[areas["objtype"] == "Bygning"],
    }


def rasterize_large_buildings(features: dict[str, gpd.GeoDataFrame], grid: GridSpec) -> np.ndarray:
    """Celler med en bygning som er stor nok til å være flate i N50."""
    areas = features["buildingAreas"].geometry
    shapes = [g for geoms in (areas, areas.representative_point()) for g in geoms if g is not None and not g.is_empty]
    if not shapes:
        return np.zeros((grid.height, grid.width), dtype=bool)
    return rasterize(shapes, out_shape=(grid.height, grid.width), transform=grid.transform, dtype="uint8").astype(bool)


def rasterize_features(features: dict[str, gpd.GeoDataFrame], grid: GridSpec) -> np.ndarray:
    """Feature-raster (uint8) i spillrutenettet. Bru > vei > bygning."""
    areas = features["buildingAreas"].geometry
    roads = features["roads"]
    if grid.cell <= MAJOR_ROAD_HALF_WIDTH * 2 and len(roads):
        # fine celler: europa- og riksveier får bredde, resten er 1-celle-streker
        major = roads["vegkategori"].isin(("E", "R"))
        roads = gpd.GeoDataFrame(geometry=roads.geometry.where(~major, roads.geometry.buffer(MAJOR_ROAD_HALF_WIDTH, cap_style="flat")))
    order = [
        (features["buildingAreas"], BUILDING),
        # de fleste bygningsflater er mindre enn en celle og ville falt mellom cellesentrene
        (gpd.GeoDataFrame(geometry=areas.representative_point()), BUILDING),
        (features["buildingPoints"], BUILDING),
        (roads, ROAD),
        (features["bridges"], BRIDGE),
    ]
    shapes = [(geom, value) for gdf, value in order for geom in gdf.geometry if geom is not None and not geom.is_empty]
    if not shapes:
        return np.zeros((grid.height, grid.width), dtype=np.uint8)
    # Uten all_touched: linjer brennes som sammenhengende 1-celle-streker,
    # flater tar celler med sentrum innenfor. Senere former overskriver tidligere.
    return rasterize(shapes, out_shape=(grid.height, grid.width), transform=grid.transform, fill=NONE, dtype="uint8")
