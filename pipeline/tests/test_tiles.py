"""Kontroll av de ferdige flisene - det spillet faktisk laster."""

import numpy as np
import pytest
from PIL import Image

from flypipe import dtm, terrain
from flypipe.areas import AREAS
from flypipe.build import RAW
from flypipe.crs import wgs84_to_utm33

from conftest import TILES, area_key, sample_bilinear


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
    meta, hgt, grid = any_tiles
    tol = reference["heights"]["toleranceM"]
    points = reference["heights"]["areas"][area_key(meta)]
    assert len(points) >= 3
    for p in points:
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
    meta, hgt, grid = any_tiles
    if area_key(meta) != "kjevik":
        pytest.skip("navngitt topp er bare lagt inn for Kjevik")
    p = next(p for p in reference["transform"]["points"] if p["name"] == "Moseidvarden")
    x, y = grid.utm_to_grid(*wgs84_to_utm33(p["lon"], p["lat"]))
    col, row = int(x), int(y)
    k = int(500 / grid.cell)  # høyeste punkt innen 500 m skal ligge innen 75 m av navnepunktet
    around = hgt[row - k : row + k + 1, col - k : col + k + 1]
    r, c = np.unravel_index(np.argmax(around), around.shape)
    assert np.hypot(r - k, c - k) * grid.cell <= 75
    assert hgt[row, col] > 300


def test_runways_are_painted_between_the_thresholds(any_tiles):
    meta, hgt, grid = any_tiles
    rgb = np.asarray(Image.open(TILES.parent / meta["id"] / meta["colormap"]["file"]).convert("RGB"))
    runways = meta["airports"][0]["runways"]
    assert runways
    for rw in runways:
        le, he = rw["ends"]
        at = lambda t: (le["x"] + t * (he["x"] - le["x"]), le["y"] + t * (he["y"] - le["y"]))
        for t in (0.02, 0.25, 0.5, 0.75, 0.98):
            x, y = at(t)
            assert tuple(rgb[int(y), int(x)]) == terrain.RUNWAY, (rw["ident"], t)
        # 10 % av banelengden forbi hver ende er det ikke bane
        for t in (-0.1, 1.1):
            x, y = at(t)
            assert tuple(rgb[int(y), int(x)]) != terrain.RUNWAY, (rw["ident"], t)
        # rutenettretning = sann retning - meridiankonvergens (regel 5 i CLAUDE.md)
        for end in (le, he):
            diff = (end["headingGridDeg"] + meta["gridConvergenceDeg"] - end["headingTrueDeg"] + 180) % 360 - 180
            assert abs(diff) < 0.6, (end["ident"], diff)
            # Kildens sanne kurs (OurAirports) mot den vi regner fra baneendene. De er enige overalt unntatt på
            # Mehamn, der kilden har banens MAGNETISKE kurs (170°) i feltet for sann kurs: misvisningen der er 12°.
            off = abs((end["headingPublishedDeg"] - end["headingTrueDeg"] + 180) % 360 - 180)
            assert (12 < off < 13) if meta["airports"][0]["icao"] == "ENMH" else off < 0.6, (end["ident"], off)
        # DTM under banen stemmer med publisert banehøyde (OurAirports) innenfor 5 m
        for end, t in ((le, 0.05), (he, 0.95)):
            assert abs(sample_bilinear(hgt, *at(t)) - end["elevationM"]) < 5, end["ident"]


def test_kjevik_runway_03_points_north_east(tiles):
    meta, _, _ = tiles
    le, he = meta["airports"][0]["runways"][0]["ends"]
    assert le["ident"] == "03" and 40 < le["headingGridDeg"] < 42
    assert he["x"] > le["x"] and he["y"] < le["y"]  # økende x, minkende y


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
    # avstand til nærmeste senterlinje: tårnet står ved siden av en bane, ikke på den.
    # (På Gardermoen ligger terminalen midt mellom to baner som er 2,2 km fra hverandre.)
    def cross(rw):
        le, he = rw["ends"]
        ux, uy = he["east"] - le["east"], he["north"] - le["north"]
        return abs((tower["east"] - le["east"]) * uy - (tower["north"] - le["north"]) * ux) / np.hypot(ux, uy)

    assert 60 < min(cross(rw) for rw in meta["airports"][0]["runways"]) < 1300  # Mehamn: 88 m, en liten flyplass
    assert tower["groundM"] == pytest.approx(max(0, hgt[int(tower["y"]), int(tower["x"])]), abs=0.06)
    assert tower["eyeM"] - tower["groundM"] == pytest.approx(32.0)  # antatt høyde, se airports.TOWER_EYE_HEIGHT


def test_place_names_are_whole_names_inside_the_map(any_tiles):
    """names.json: hele navn (ikke kartets tekstbiter), innenfor utsnittet, med høyde fra terrenget."""
    import json

    meta, hgt, grid = any_tiles
    names = json.loads((TILES.parent / meta["id"] / meta["names"]["file"]).read_text(encoding="utf-8"))["items"]
    assert len(names) == meta["names"]["count"] > 200  # færrest ved Mehamn (286)
    assert not [n[0] for n in names if n[0].endswith("-") or not n[0].strip()]
    # tunnelnavn er med (tunnelene tegnes stiplet), og sier selv at de er tunneler
    assert all("tunnel" in n[0].lower() for n in names if n[5] == "tunnel")
    sizes = [n[4] for n in names]
    assert sizes == sorted(sizes, reverse=True)  # viktigste først
    for name, x, y, z, *_ in names:
        assert 0 <= x < grid.width and 0 <= y < grid.height, name
        assert z >= max(0, hgt[int(y), int(x)]) - 0.06, name  # aldri under bakken; brunavn ligger høyere
