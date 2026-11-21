"""Fasiten for skipstrafikken (tests/fixtures/ais_expected.json) skal være den Python-tolkingen gir."""

import json

import ais_reference


def test_fasiten_er_laget_av_referansetolkingen():
    assert json.loads(ais_reference.EXPECTED.read_text(encoding="utf-8")) == json.loads(json.dumps(ais_reference.expected()))


def test_opptaket_har_skip_ved_kystflyplassene():
    ships = ais_reference.expected()["ships"]
    assert sum(len(v) for v in ships.values()) >= 10
    for rows in ships.values():
        for r in rows:
            assert r["sog"] is None or 0 <= r["sog"] < 60
            assert r["cog"] is None or 0 <= r["cog"] < 360
            assert 0 <= r["age"] < 60


def test_utsnittene_er_de_samme_som_i_flisene():
    """Rutene i fasiten er skrevet inn for hånd: de skal være lik det pipeline bygger."""
    from pathlib import Path

    tiles = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
    for area in ("kjevik10", "sola10", "flesland10", "bodo10"):  # mehamn10 kom etter opptaket og er ikke i fasiten
        meta_path = tiles / area / "metadata.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        b = meta["bbox"]
        assert ais_reference.AREAS[meta["airports"][0]["icao"]] == [b["west"], b["south"], b["east"], b["north"]]
