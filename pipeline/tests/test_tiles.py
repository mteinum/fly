"""Kontroll av de ferdige flisene - det spillet faktisk laster."""

import numpy as np
import pytest
from PIL import Image

from flypipe import dtm, terrain
from flypipe.areas import AREAS
from flypipe.build import RAW
from flypipe.crs import wgs84_to_utm33

from conftest import TILES, sample_bilinear


def test_metadata_is_consistent(any_tiles):
    meta, hgt, grid = any_tiles
    b = meta["bbox"]
    assert meta["crs"] == "EPSG:25833"
    assert b["east"] - b["west"] == meta["width"] * meta["cellSize"]
    assert b["north"] - b["south"] == meta["height"] * meta["cellSize"]
    assert meta["maxHeight"] == pytest.approx(float(hgt.max()), abs=0.01)
    assert (TILES.parent / meta["id"] / meta["heightmap"]["file"]).stat().st_size == meta["width"] * meta["height"] * 4


def test_game_height_matches_kartverket_points(any_tiles, reference):
    """Høyden spillet bruker (bilineært i 50 m-rutenettet) mot Kartverkets punkt-API (DTM 1 m)."""
    _, hgt, grid = any_tiles
    tol = reference["heights"]["toleranceM"]
    for p in reference["heights"]["points"]:
        x, y = grid.utm_to_grid(p["east"], p["north"])
        assert abs(sample_bilinear(hgt, x, y) - p["z"]) <= tol, p["name"]


def test_heightmap_equals_block_mean_of_source(any_tiles):
    """Hele flisen mot rådata: fanger feil i mosaikk, radrekkefølge og byte-rekkefølge."""
    _, hgt, grid = any_tiles
    area = AREAS[any_tiles[0]["id"]]
    if not (RAW / area.raw_id).exists():
        pytest.skip("rådata-cache mangler")
    src = dtm.load_source_dtm(grid, area.source_res, RAW / area.raw_id)
    assert np.abs(hgt - terrain.block_mean(src, int(area.cell / area.source_res))).max() < 1e-3


def test_summit_is_where_the_map_says(any_tiles, reference):
    """Akseretning: Moseidvarden (315 m) skal være en topp i rutenettet, ikke speilvendt."""
    _, hgt, grid = any_tiles
    p = next(p for p in reference["transform"]["points"] if p["name"] == "Moseidvarden")
    x, y = grid.utm_to_grid(*wgs84_to_utm33(p["lon"], p["lat"]))
    col, row = int(x), int(y)
    k = int(500 / grid.cell)  # høyeste punkt innen 500 m skal ligge innen 75 m av navnepunktet
    around = hgt[row - k : row + k + 1, col - k : col + k + 1]
    r, c = np.unravel_index(np.argmax(around), around.shape)
    assert np.hypot(r - k, c - k) * grid.cell <= 75
    assert hgt[row, col] > 300


def test_runway_is_painted_between_the_thresholds(any_tiles):
    meta, hgt, grid = any_tiles
    rgb = np.asarray(Image.open(TILES.parent / meta["id"] / meta["colormap"]["file"]).convert("RGB"))
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


def test_surface_overlays_road_and_runway_on_landcover(any_tiles):
    """surface.bin = arealdekke, med vei (16) og rullebane (17) lagt oppå. landcover.bin er urørt."""
    meta, hgt, _ = any_tiles
    d = TILES.parent / meta["id"]
    lc = np.fromfile(d / meta["landcover"]["file"], dtype=np.uint8).reshape(hgt.shape)
    surface = np.fromfile(d / meta["surface"]["file"], dtype=np.uint8).reshape(hgt.shape)
    codes = {c["name"]: c["code"] for c in meta["surface"]["classes"]}
    road, runway = codes["Vei"], codes["Rullebane (OurAirports)"]
    assert lc.max() < road  # ingen overflatekoder har lekket inn i arealdekket
    untouched = (surface != road) & (surface != runway)
    assert np.array_equal(surface[untouched], lc[untouched])
    assert 0 < (surface == road).sum() <= meta["features"]["roadCells"]  # rullebanen dekker noen veiceller
    le, he = meta["airports"][0]["runways"][0]["ends"]
    for t in (0.02, 0.5, 0.98):
        x, y = le["x"] + t * (he["x"] - le["x"]), le["y"] + t * (he["y"] - le["y"])
        assert surface[int(y), int(x)] == runway
    for c in meta["surface"]["classes"]:
        assert len(c["color"]) == 3 and all(0 <= v <= 255 for v in c["color"])


def test_tower_stands_on_the_terminal_building_beside_the_runway(any_tiles):
    """Tårnet plasseres på N50-bygningen av type 411 (terminal/kontrolltårn) ved flyplassen."""
    meta, hgt, grid = any_tiles
    tower = meta["airports"][0]["tower"]
    assert "411" in tower["source"]
    assert grid.utm_to_grid(tower["east"], tower["north"]) == pytest.approx((tower["x"], tower["y"]), abs=1e-3)
    le, he = meta["airports"][0]["runways"][0]["ends"]
    # avstand fra banens senterlinje: tårnet står ved siden av banen, ikke på den
    ux, uy = he["east"] - le["east"], he["north"] - le["north"]
    cross = abs((tower["east"] - le["east"]) * uy - (tower["north"] - le["north"]) * ux) / np.hypot(ux, uy)
    assert 100 < cross < 700
    assert tower["groundM"] == pytest.approx(max(0, hgt[int(tower["y"]), int(tower["x"])]), abs=0.06)
    assert tower["eyeM"] - tower["groundM"] == 32.0  # antatt høyde, se airports.TOWER_EYE_HEIGHT
