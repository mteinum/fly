import geopandas as gpd
import numpy as np
import pytest
from PIL import Image
from shapely.geometry import LineString, Point, box

from flypipe import n50, terrain
from flypipe.grid import GridSpec

from conftest import TILES

GRID = GridSpec(west=0, north=500, cell=50, width=10, height=10)


def _gdf(*geoms):
    return gpd.GeoDataFrame(geometry=list(geoms), crs="EPSG:25833")


def _features(**kw):
    empty = _gdf()
    return {k: kw.get(k, empty) for k in ("roads", "bridges", "buildingPoints", "buildingAreas")}


def test_rasterize_places_features_in_the_right_cells():
    f = n50.rasterize_features(
        _features(
            roads=_gdf(LineString([(25, 475), (475, 475)])),  # øst-vest langs nordkanten = rad 0
            buildingPoints=_gdf(Point(125, 25)),  # sørvest: kolonne 2, rad 9
            buildingAreas=_gdf(box(410, 110, 440, 140)),  # 30 x 30 m, dekker ikke noe cellesentrum
        ),
        GRID,
    )
    assert (f[0] == n50.ROAD).all()
    assert f[9, 2] == n50.BUILDING
    assert f[7, 8] == n50.BUILDING
    assert (f != n50.NONE).sum() == 12


def test_bridge_wins_over_road_and_road_over_building():
    f = n50.rasterize_features(
        _features(
            roads=_gdf(LineString([(25, 275), (475, 275)])),
            bridges=_gdf(LineString([(225, 275), (275, 275)])),
            buildingPoints=_gdf(Point(25, 275), Point(225, 275)),
        ),
        GRID,
    )
    assert f[4, 0] == n50.ROAD
    assert f[4, 4] == n50.BRIDGE and f[4, 5] == n50.BRIDGE


def test_colormap_draws_bridge_over_sea():
    hgt = np.zeros((2, 3), dtype=np.float32)
    feats = np.array([[n50.NONE, n50.BRIDGE, n50.BUILDING]] * 2, dtype=np.uint8)
    rgb = terrain.colormap(hgt, 50.0, np.ones((2, 3)), feats)
    assert tuple(rgb[0, 0]) == terrain.SEA
    assert tuple(rgb[0, 1]) == terrain.BRIDGE
    assert tuple(rgb[0, 2]) in terrain.ROOFS


def test_varoddbrua_crosses_the_fjord(tiles, reference):
    """Brua skal ligge der stedsnavnregisteret sier, og over sjø i DTM-en."""
    meta, hgt, grid = tiles
    if not meta.get("features"):
        pytest.skip("fliser bygget uten N50")
    rgb = np.asarray(Image.open(TILES / meta["colormap"]["file"]).convert("RGB"))
    p = next(p for p in reference["landmarks"]["points"] if p["name"] == "Varoddbrua")
    x, y = grid.utm_to_grid(p["east"], p["north"])
    col, row = int(x), int(y)
    is_bridge = (rgb == terrain.BRIDGE).all(axis=-1)
    near = is_bridge[row - 2 : row + 3, col - 2 : col + 3]
    assert near.any(), "ingen brucelle innen 100 m av Varoddbrua"
    # brua er minst 600 m (12 celler), og det meste av den ligger over sjø i DTM-en.
    # (Navnepunktet i SSR ligger ved landkaret, ikke midt på brua.)
    around = is_bridge[row - 10 : row + 11, col - 10 : col + 11]
    assert around.sum() >= 12
    over_sea = hgt[row - 10 : row + 11, col - 10 : col + 11][around] <= terrain.SEA_LEVEL_MAX
    assert over_sea.sum() >= 6


def test_feature_counts_are_plausible(tiles):
    meta, _, _ = tiles
    f = meta.get("features")
    if not f:
        pytest.skip("fliser bygget uten N50")
    assert 250 < f["roadKm"] < 400
    assert 5 < f["bridgeKm"] < 10
    assert f["buildings"] > 5000
    # en 1-celle-strek dekker minst lengde / (celle * sqrt 2)
    assert f["roadCells"] > f["roadKm"] * 1000 / (meta["cellSize"] * 1.5)
