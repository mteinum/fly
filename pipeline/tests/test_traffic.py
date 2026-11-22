"""Fasiten for flytrafikken, og geoidehøyden den bygger på."""

import json
from pathlib import Path

import pytest
import traffic_reference

from flypipe import crs


def test_fasiten_er_laget_av_referansetolkingen():
    assert json.loads(traffic_reference.EXPECTED.read_text(encoding="utf-8")) == json.loads(json.dumps(traffic_reference.expected()))


def test_utsnittene_er_de_samme_som_pipeline_skriver():
    built = Path(__file__).resolve().parents[2] / "web" / "public" / "traffic" / "areas.json"
    if not built.exists():
        pytest.skip("web/public/traffic/areas.json er ikke bygget")
    areas = json.loads(built.read_text(encoding="utf-8"))
    for icao, a in traffic_reference.AREAS.items():
        assert areas[icao] == a


def test_geoidehoyden_er_lagret_og_rimelig():
    """GPS-høyde minus geoidehøyde skal gi høyde over havet. I Norge er geoidehøyden 30-46 m, størst i vest."""
    store = json.loads(crs.GEOID_FILE.read_text(encoding="utf-8"))["points"]
    assert set(store) == {"kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10", "mehamn10", "tromso10", "alesund10", "kjeller10"}
    n = {k: v["separationM"] for k, v in store.items()}
    assert all(18 < v < 46 for v in n.values())  # lavest lengst nord og øst
    assert n["flesland10"] > n["gardermoen10"] > n["bodo10"]
    # lagret verdi brukes uten ny utregning (og uten nett)
    assert crs.geoid_separation("kjevik10", 0, 0) == n["kjevik10"]


def test_fly_paa_bakken_har_ingen_hoyde_og_fly_i_lufta_har_hoyde_over_havet():
    exp = traffic_reference.expected()["aircraft"]
    ground = {r["flight"]: r for r in exp["ENGM"]}
    assert ground["NOZ3BW"]["ground"] and ground["NOZ3BW"]["altM"] is None
    # et tredje fly i svaret (NOZ1793, på vei inn) lå innenfor 25 nautiske mil, men utenfor kartruta: ikke med
    assert "NOZ1793" not in ground
    (air,) = exp["ENCN"]
    # 34 900 fot over ellipsoiden = 10 637,5 m; minus geoidehøyden 40,7 m = 10 596,8 m over havet
    assert (air["flight"], air["alt"], air["altM"]) == ("NSZ5708", "geom", 10596.8)
    # trykkhøyden var 36 000 fot (flygenivå 360) = 10 972,8 m: 376 m unna. Det er lufttrykk og temperatur
    # den dagen, ikke en feil, og grunnen til at GPS-høyden brukes når den finnes
    assert 36000 * 0.3048 - air["altM"] > 300
