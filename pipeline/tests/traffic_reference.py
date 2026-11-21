"""Uavhengig tolking av svar fra adsb.lol, i Python med pyproj, som fasit for PHP-koden i web/public/traffic."""

from __future__ import annotations

import json
import re
from pathlib import Path

from pyproj import Transformer

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
SAMPLE = FIXTURES / "adsb_sample.json"
EXPECTED = FIXTURES / "adsb_expected.json"
# Utsnittene slik pipeline skriver dem til web/public/traffic/areas.json
AREAS = {
    "ENGM": {"lat": 60.1939, "lon": 11.1004, "radiusNm": 10, "box": [271050.0, 6666590.0, 296650.0, 6692190.0], "geoidM": 38.26},
    "ENBR": {"lat": 60.2934, "lon": 5.2181, "radiusNm": 10, "box": [-52230.0, 6711430.0, -26630.0, 6737030.0], "geoidM": 44.84},
    "ENCN": {"lat": 58.173, "lon": 8.0914, "radiusNm": 10, "box": [81250.0, 6456000.0, 106850.0, 6481600.0], "geoidM": 40.7},
}
FT = 0.3048
_to_utm = Transformer.from_crs(4326, 25833, always_xy=True)


def parse(response: dict, area: dict) -> list[dict]:
    w, s, e, n = area["box"]
    rows = []
    for a in response.get("ac", []):
        hexid = str(a.get("hex", "")).lower()
        if not re.fullmatch(r"[0-9a-f]{6}", hexid) or not isinstance(a.get("lat"), (int, float)) or not isinstance(a.get("lon"), (int, float)):
            continue
        age = a.get("seen_pos", 999)
        if age > 60:
            continue
        east, north = _to_utm.transform(a["lon"], a["lat"])
        if not (w <= east < e and s < north <= n):
            continue
        ground = a.get("alt_baro") == "ground"
        if ground:
            alt, source = None, None
        elif isinstance(a.get("alt_geom"), (int, float)):
            alt, source = a["alt_geom"] * FT - area["geoidM"], "geom"
        elif isinstance(a.get("alt_baro"), (int, float)):
            alt, source = a["alt_baro"] * FT, "baro"
        else:
            continue
        rate = a.get("baro_rate", a.get("geom_rate"))
        rows.append({
            "id": hexid, "e": round(east, 1), "n": round(north, 1),
            "altM": None if alt is None else round(alt, 1), "alt": source, "ground": ground,
            "gs": a.get("gs"), "track": a.get("track"), "vr": rate, "age": round(age, 1),
            "flight": re.sub(r"[^A-Z0-9]", "", str(a.get("flight", "")).upper())[:8],
            "type": re.sub(r"[^A-Z0-9]", "", str(a.get("t") or "").upper())[:4],
            "cat": re.sub(r"[^A-D0-7]", "", str(a.get("category", "")).upper())[:2],
        })
    return sorted(rows, key=lambda r: r["id"])


def expected() -> dict:
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    return {"about": "Laget av pipeline/tests/traffic_reference.py fra adsb_sample.json (adsb.lol, ODbL).", "areas": AREAS,
            "aircraft": {icao: parse(sample["responses"][icao], AREAS[icao]) for icao in AREAS}}


if __name__ == "__main__":
    EXPECTED.write_text(json.dumps(expected(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print({k: [(r["flight"], r["altM"], r["ground"]) for r in v] for k, v in expected()["aircraft"].items()})
