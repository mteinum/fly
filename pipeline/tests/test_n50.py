import geopandas as gpd
import numpy as np
import pytest
from shapely.geometry import LineString, Point, box

from flypipe import n50, terrain
from flypipe.grid import GridSpec

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


def test_colormap_bakes_roads_but_not_structures():
    hgt = np.zeros((2, 4), dtype=np.float32)
    lc = np.full((2, 4), 1, dtype=np.uint8)  # Havflate
    feats = np.array([[n50.NONE, n50.BRIDGE, n50.BUILDING, n50.ROAD]] * 2, dtype=np.uint8)
    rgb = terrain.colormap(hgt, 50.0, np.ones((2, 4)), lc, feats)
    for c in range(3):
        assert tuple(rgb[0, c]) == terrain.SEA  # bakken under bru og bygning er uendret
    assert tuple(rgb[0, 3]) == terrain.ROAD


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
