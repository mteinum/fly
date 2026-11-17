"""Kontroll av de ferdige flisene - det spillet faktisk laster."""

import numpy as np
import pytest
from PIL import Image

from flypipe import dtm, terrain
from flypipe.areas import AREAS
from flypipe.build import RAW
from flypipe.crs import wgs84_to_utm33

from conftest import TILES, sample_bilinear


def test_metadata_is_consistent(tiles):
    meta, hgt, grid = tiles
    b = meta["bbox"]
    assert meta["crs"] == "EPSG:25833"
    assert b["east"] - b["west"] == meta["width"] * meta["cellSize"]
    assert b["north"] - b["south"] == meta["height"] * meta["cellSize"]
    assert meta["maxHeight"] == pytest.approx(float(hgt.max()), abs=0.01)
    assert (TILES / meta["heightmap"]["file"]).stat().st_size == meta["width"] * meta["height"] * 4


def test_game_height_matches_kartverket_points(tiles, reference):
    """Høyden spillet bruker (bilineært i 50 m-rutenettet) mot Kartverkets punkt-API (DTM 1 m)."""
    _, hgt, grid = tiles
    tol = reference["heights"]["toleranceM"]
    for p in reference["heights"]["points"]:
        x, y = grid.utm_to_grid(p["east"], p["north"])
        assert abs(sample_bilinear(hgt, x, y) - p["z"]) <= tol, p["name"]


def test_heightmap_equals_block_mean_of_source(tiles):
    """Hele flisen mot rådata: fanger feil i mosaikk, radrekkefølge og byte-rekkefølge."""
    _, hgt, grid = tiles
    area = AREAS["kjevik"]
    if not (RAW / area.id).exists():
        pytest.skip("rådata-cache mangler")
    src = dtm.load_source_dtm(grid, area.source_res, RAW / area.id)
    assert np.abs(hgt - terrain.block_mean(src, int(area.cell / area.source_res))).max() < 1e-3


def test_summit_is_where_the_map_says(tiles, reference):
    """Akseretning: Moseidvarden (315 m) skal være en topp i rutenettet, ikke speilvendt."""
    _, hgt, grid = tiles
    p = next(p for p in reference["transform"]["points"] if p["name"] == "Moseidvarden")
    x, y = grid.utm_to_grid(*wgs84_to_utm33(p["lon"], p["lat"]))
    col, row = int(x), int(y)
    around = hgt[row - 10 : row + 11, col - 10 : col + 11]
    r, c = np.unravel_index(np.argmax(around), around.shape)
    assert abs(r - 10) <= 1 and abs(c - 10) <= 1
    assert hgt[row, col] > 300


def test_runway_is_painted_between_the_thresholds(tiles):
    meta, hgt, grid = tiles
    rgb = np.asarray(Image.open(TILES / meta["colormap"]["file"]).convert("RGB"))
    (rw,) = meta["airports"][0]["runways"]
    le, he = rw["ends"]
    for t in (0.02, 0.25, 0.5, 0.75, 0.98):
        x, y = le["x"] + t * (he["x"] - le["x"]), le["y"] + t * (he["y"] - le["y"])
        assert tuple(rgb[int(y), int(x)]) == terrain.RUNWAY, t
    # 200 m forbi hver ende er det ikke bane
    for t in (-0.1, 1.1):
        x, y = le["x"] + t * (he["x"] - le["x"]), le["y"] + t * (he["y"] - le["y"])
        assert tuple(rgb[int(y), int(x)]) != terrain.RUNWAY, t
    # Bane 03 går mot nordøst: økende x, minkende y
    assert he["x"] > le["x"] and he["y"] < le["y"]
    assert le["ident"] == "03" and 40 < le["headingGridDeg"] < 42
    # DTM under banen stemmer med publisert banehøyde (OurAirports) innenfor 5 m
    for end, t in ((le, 0.05), (he, 0.95)):
        x, y = le["x"] + t * (he["x"] - le["x"]), le["y"] + t * (he["y"] - le["y"])
        assert abs(sample_bilinear(hgt, x, y) - end["elevationM"]) < 5
