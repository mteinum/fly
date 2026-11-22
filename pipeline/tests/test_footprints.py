"""Høyden på bygg med omriss: målt i overflatemodellen, eller fra etasjene når modellen er eldre enn bygget."""

import numpy as np

from flypipe import footprints, osm
from flypipe.grid import GridSpec


def _one(levels: int, dom_height: float) -> dict:
    grid = GridSpec(west=0.0, north=1000.0, cell=10.0, width=100, height=100)
    ring = np.array([[200.0, 800.0], [260.0, 800.0], [260.0, 740.0], [200.0, 740.0]])  # 60 x 60 m, 36 celler
    fp = osm.Footprints(ring, np.array([0, 4]), np.array([0]), np.array([levels]), "2026-11-22")
    hgt = np.full((100, 100), 5.0, dtype=np.float32)
    built, used = footprints.build(fp, {}, hgt, np.full((100, 100), dom_height, dtype=np.float32), grid)
    assert used.all() and len(built) == 1
    return built[0]


def test_height_is_measured_in_the_surface_model():
    b = _one(levels=4, dom_height=20.0)
    assert b["height_source"] == "dom" and b["top"] - b["base"] == 20.0


def test_storeys_win_when_the_surface_model_has_no_building():
    # modellen viser flat mark, OpenStreetMap ti etasjer: bygget er nyere enn modellen
    b = _one(levels=10, dom_height=0.0)
    assert b["height_source"] == "levels" and b["top"] - b["base"] == 10 * footprints.STOREY_M + 1


def test_low_buildings_still_follow_the_surface_model():
    # to etasjer og 2 m i modellen kan like gjerne være et lavt bygg: da gjelder målingen
    assert _one(levels=2, dom_height=2.0)["height_source"] == "dom"
    # og uten etasjetall er det ingenting annet å gå etter
    assert _one(levels=0, dom_height=0.5)["height_source"] == "dom"
