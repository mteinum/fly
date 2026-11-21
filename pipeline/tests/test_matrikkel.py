"""Bygningspunkter fra Matrikkelen: høyde etter type, og hva som ender i 10 m-flisene."""

import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pytest
from shapely.geometry import Point

from flypipe import matrikkel
from flypipe.grid import GridSpec

TILES = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


def test_nominell_hoyde_folger_bygningstypen():
    # enebolig, rekkehus, boligblokk, fritidsbolig, lager, kontor, ukjent kode
    h = matrikkel.nominal_height(np.array([111, 131, 142, 161, 231, 311, 999]))
    assert list(h) == [7.0, 8.0, 14.0, 5.0, 9.0, 12.0, matrikkel.HEIGHT_DEFAULT]
    assert h[2] > h[0] > h[3]


def test_hoyderaster_y_oker_mot_sor_og_hoyeste_bygg_vinner():
    grid = GridSpec(west=1000.0, north=5000.0, cell=10.0, width=20, height=10)
    b = gpd.GeoDataFrame(
        {"height": [7.0, 14.0, 5.0]},
        # to bygg i samme celle helt i nordvest, ett i sørøst
        geometry=[Point(1003, 4997), Point(1008, 4992), Point(1195, 4905)], crs=25833,
    )
    r = matrikkel.height_raster(b, grid)
    assert r[0, 0] == 14.0 and r[9, 19] == 5.0
    assert np.isnan(r).sum() == r.size - 2


@pytest.mark.parametrize("area", ["kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10"])
def test_flisene_har_alle_bygg_ogsaa_i_tettbebyggelse(area):
    if not (TILES / area / "metadata.json").exists():
        pytest.skip(f"{area} er ikke bygget")
    meta = json.loads((TILES / area / "metadata.json").read_text(encoding="utf-8"))
    assert meta["features"]["buildingSource"].startswith("Matrikkelen")
    assert "Matrikkelen" in meta["attribution"][0]
    items = json.loads((TILES / area / "structures.json").read_text(encoding="utf-8"))["items"]
    lc = np.fromfile(TILES / area / "landcover.bin", dtype=np.uint8).reshape(meta["height"], meta["width"])
    code = {c["name"]: c["code"] for c in meta["landcover"]["classes"]}
    buildings = np.array([(it[1], it[0], it[4] - it[3]) for it in items if it[2] == 1])
    cls = lc[buildings[:, 0].astype(int), buildings[:, 1].astype(int)]
    # N50 hadde ingen enkelthus i tettbebyggelse: nå står en stor del av byggene der
    assert (cls == code["Tettbebyggelse"]).mean() > 0.25
    # ingen bygg i sjøen (punktet kan ligge på kaikanten: noen få tåles)
    assert (cls == code["Havflate"]).mean() < 0.01
    # høydene er rimelige: nominelle 5-14 m for småhus, opptil 80 m målt for store bygg
    assert 3.9 <= buildings[:, 2].min() and buildings[:, 2].max() <= 80.5
    assert 5 < np.median(buildings[:, 2]) < 10
