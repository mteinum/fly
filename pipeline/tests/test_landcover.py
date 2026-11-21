import json

import geopandas as gpd
import numpy as np
import pytest
from shapely.geometry import box

from flypipe import landcover, structures, terrain
from flypipe.grid import GridSpec

from conftest import TILES

GRID = GridSpec(west=0, north=200, cell=50, width=4, height=4)
CODE = {c.name: c.code for c in landcover.CLASSES}


def test_majority_picks_the_dominant_class():
    fine = np.zeros((10, 10), dtype=np.uint8)
    fine[:5, :5] = 4  # hele blokka skog
    fine[:5, 5:] = 4
    fine[:2, 5:] = 2  # 10 av 25 delceller innsjø: skog vinner
    fine[5:, :5] = 2
    fine[5:7, :5] = 4  # 15 av 25 innsjø: innsjø vinner
    assert landcover.majority(fine, 5).tolist() == [[4, 4], [2, 0]]


def test_rasterize_landcover_axes_and_overlap():
    polys = gpd.GeoDataFrame(
        {"objtype": ["Skog", "Havflate", "Lufthavn", "Rullebane", "NoeNytt"]},
        geometry=[box(0, 100, 200, 200), box(0, 0, 100, 100), box(100, 0, 200, 100), box(100, 0, 150, 100), box(0, 0, 1, 1)],
        crs="EPSG:25833",
    )
    lc = landcover.rasterize_landcover(polys, GRID)
    assert (lc[:2] == CODE["Skog"]).all()  # nord = rad 0-1
    assert (lc[2:, :2] == CODE["Havflate"]).all()  # sørvest
    assert (lc[2:, 2] == CODE["Rullebane og oppstilling"]).all()  # ligger oppå Lufthavn
    assert (lc[2:, 3] == CODE["Lufthavn"]).all()


def test_landcover_colors():
    hgt = np.full((2, 3), 50.0, dtype=np.float32)
    lc = np.array([[CODE["Skog"], CODE["Innsjø"], landcover.UNKNOWN]] * 2, dtype=np.uint8)
    rgb = terrain.colormap(hgt, 50.0, np.full((2, 3), 0.5), lc)
    forest = landcover.CLASSES[CODE["Skog"]].colors
    assert tuple(rgb[0, 0]) in [tuple(int(v * 0.5) for v in c) for c in forest]  # skygget
    assert tuple(rgb[0, 1]) == landcover.CLASSES[CODE["Innsjø"]].colors[0]  # vann skygges ikke
    assert tuple(rgb[0, 2]) != (0, 0, 0)  # Ukjent faller tilbake på høydebånd


def test_landcover_tile_matches_kartverket(tiles):
    """Arealdekket i flisen mot terrengtype fra Kartverkets punkt-API (hentet 2026-11-17)."""
    meta, hgt, grid = tiles
    if "N50" not in meta["landcover"]["source"]:
        pytest.skip("fliser bygget uten N50")
    lc = np.fromfile(TILES / meta["landcover"]["file"], dtype=np.uint8).reshape(hgt.shape)
    def at(e, n):
        x, y = grid.utm_to_grid(e, n)
        assert 0 <= x < grid.width and 0 <= y < grid.height, f"({e}, {n}) ligger utenfor utsnittet"  # negativ indeks ville ellers lest fra motsatt kant
        return int(lc[int(y), int(x)])

    assert at(92000, 6469000) == CODE["Havflate"]  # Topdalsfjorden
    assert at(99575, 6474475) == CODE["Innsjø"]  # innsjø, 59 moh.
    # Fasitpunktet i den regulerte innsjøen (88375, 6482025) falt utenfor da utsnittet ble flyttet 3,5 km sørover.
    assert at(88033.63, 6466411.58) == CODE["Åpent område"]  # domkirken/Torvet: punkt-API sier ÅpentOmråde
    assert at(84562.92, 6480430.72) in (CODE["Skog"], CODE["Åpent område"])  # Moseidvarden
    arp = meta["airports"][0]["arp"]
    assert at(arp["east"], arp["north"]) in (CODE["Lufthavn"], CODE["Rullebane og oppstilling"])
    assert (lc == landcover.UNKNOWN).mean() < 0.001


def test_varoddbrua_deck_comes_from_surface_model(tiles, reference):
    """Brua ligger der stedsnavnregisteret sier, med dekket 30-40 m over sjø (seilingshøyde 32 m)."""
    meta, hgt, grid = tiles
    items = json.loads((TILES / meta["structures"]["file"]).read_text())["items"]
    p = next(p for p in reference["landmarks"]["points"] if p["name"] == "Varoddbrua")
    x, y = grid.utm_to_grid(p["east"], p["north"])
    near = [it for it in items if it[2] == structures.BRIDGE and abs(it[0] - x) <= 15 and abs(it[1] - y) <= 15]
    assert len(near) >= 12  # minst 600 m bru
    assert min(np.hypot(it[0] + 0.5 - x, it[1] + 0.5 - y) for it in near) < 2
    over_sea = [it for it in near if hgt[it[1], it[0]] <= terrain.SEA_LEVEL_MAX]
    assert len(over_sea) >= 6
    assert 30 < max(it[4] for it in over_sea) < 40
    for it in near:
        assert it[4] - it[3] == pytest.approx(structures.BRIDGE_THICKNESS, abs=0.11)
        assert it[4] - max(0, hgt[it[1], it[0]]) >= structures.BRIDGE_MIN_CLEARANCE - 0.11


def test_buildings_stand_on_the_terrain(tiles):
    meta, hgt, _ = tiles
    items = json.loads((TILES / meta["structures"]["file"]).read_text())["items"]
    buildings = [it for it in items if it[2] == structures.BUILDING]
    assert len(buildings) == meta["structures"]["buildingCells"] > 5000
    for col, row, _, base, top, *_ in buildings[::50]:
        assert base == pytest.approx(max(0, hgt[row, col]), abs=0.06)
        assert round(top - base, 1) in (structures.HEIGHT_HOUSE, structures.HEIGHT_LARGE)
