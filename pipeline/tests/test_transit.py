"""Fasiten for kollektivtjenesten: koordinatene i entur_expected.json skal være de pyproj gir."""

import json
from datetime import datetime
from pathlib import Path

import pytest

from flypipe import crs

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


def test_fasiten_har_koordinater_fra_pyproj_og_bare_ferske_busser_og_tog_i_ruta():
    sample = json.loads((FIXTURES / "entur_sample.json").read_text(encoding="utf-8"))
    expected = json.loads((FIXTURES / "entur_expected.json").read_text(encoding="utf-8"))["vehicles"]
    by_id = {f"{v['codespace']['codespaceId']}:{v['vehicleId']}": v for v in sample["response"]["data"]["vehicles"]}
    west, south, east, north = sample["area"]["box"]
    assert len(expected) >= 4
    for row in expected:
        v = by_id[row["id"]]
        e, n = crs.wgs84_to_utm33(v["location"]["longitude"], v["location"]["latitude"])
        assert (row["e"], row["n"]) == pytest.approx((float(e), float(n)), abs=0.06)
        assert west <= row["e"] < east and south < row["n"] <= north
        assert row["mode"] in {"bus", "coach", "rail", "tram", "metro"}
        age = sample["now"] - datetime.fromisoformat(v["lastUpdated"].replace("Z", "+00:00")).timestamp()
        assert 0 <= age <= 120 and row["age"] == int(age)
    # utdraget har også det som skal bort: en ferge, en gammel posisjon, ett utenfor ruta og ett uten posisjon
    left_out = set(by_id) - {r["id"] for r in expected}
    assert len(left_out) >= 4
    assert any(by_id[i]["mode"] == "FERRY" for i in left_out)
