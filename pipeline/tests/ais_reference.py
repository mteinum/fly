"""En uavhengig tolking av AIS-strømmen, skrevet i Python med pyproj, som fasit for PHP-koden på serveren.

PHP-koden (web/public/ais/lib.php) har sin egen bitlesing og sin egen UTM-formel. Denne fila gjør det samme
på en annen måte. Blir de to enige om et opptak av strømmen, er det lite sannsynlig at begge tar feil likt.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from pyproj import Transformer

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
SAMPLE = FIXTURES / "ais_sample.txt"
EXPECTED = FIXTURES / "ais_expected.json"
# Utsnittene for de fire kystflyplassene (vest, sør, øst, nord i EPSG:25833), som i flisenes metadata
AREAS = {
    "ENCN": [81250.0, 6456000.0, 106850.0, 6481600.0],
    "ENZV": [-51480.0, 6551330.0, -25880.0, 6576930.0],
    "ENBR": [-52230.0, 6711430.0, -26630.0, 6737030.0],
    "ENBO": [459830.0, 7448730.0, 485430.0, 7474330.0],
}
_to_utm = Transformer.from_crs(4326, 25833, always_xy=True)


def _value(payload: str) -> int:
    """Hele nyttelasten som ett stort heltall, og antall bit."""
    v = 0
    for ch in payload:
        c = ord(ch) - 48
        if c > 40:
            c -= 8
        v = (v << 6) | c
    return v


def _field(v: int, nbits: int, start: int, length: int, signed: bool = False) -> int:
    x = (v >> (nbits - start - length)) & ((1 << length) - 1)
    return x - (1 << length) if signed and x >> (length - 1) else x


def _text(v: int, nbits: int, start: int, chars: int) -> str:
    out = ""
    for i in range(chars):
        c = _field(v, nbits, start + 6 * i, 6)
        out += chr(c + 64 if c < 32 else c)
    return out.replace("@", " ").strip()


def _size(d: list[int]) -> dict:
    """Lengde, bredde og midtpunktets plass i forhold til antenna, fra avstandene til baug, hekk, babord, styrbord."""
    length, beam = d[0] + d[1], d[2] + d[3]
    return {"len": length or None, "beam": beam or None, "fwd": (d[0] - d[1]) / 2 if length else None, "stb": (d[3] - d[2]) / 2 if beam else None}


def _clean(s: str) -> str:
    return re.sub(r"[^A-Z0-9 .\-/&#>]", "", s.upper())[:20].strip()


def decode(lines: list[str]) -> tuple[dict[int, dict], dict[int, dict], int]:
    """(posisjoner, faste opplysninger, siste tidsstempel) fra strømmens linjer."""
    ships: dict[int, dict] = {}
    static: dict[int, dict] = {}
    parts: dict[str, str] = {}
    last = 0
    for line in lines:
        if "!" not in line:
            continue
        head, body = line.split("!", 1)
        f = body.split(",")
        if len(f) < 7 or not f[0].endswith("VDM"):
            continue
        m = re.search(r"c:(\d+)", head)
        t = int(m.group(1)) if m else None  # uten tidsstempel: regnes som mottatt nå
        last = max(last, t or 0)
        total, num, key, payload = int(f[1]), int(f[2]), f[3] + f[4], f[5]
        if total > 1:
            if num == 1:
                parts[key] = payload
                continue
            if key not in parts:
                continue
            payload = parts.pop(key) + payload
            if num < total:
                parts[key] = payload
                continue
        n = 6 * len(payload)
        if n < 40:
            continue
        v = _value(payload)
        kind, mmsi = _field(v, n, 0, 6), _field(v, n, 8, 30)
        if kind in (1, 2, 3, 18, 19):
            sog0, lon0, lat0, cog0, hdg0 = (50, 61, 89, 116, 128) if kind <= 3 else (46, 57, 85, 112, 124)
            if n < hdg0 + 9:
                continue
            lon, lat = _field(v, n, lon0, 28, True) / 600000, _field(v, n, lat0, 27, True) / 600000
            if abs(lon) > 180 or abs(lat) > 90:
                continue
            sog, cog, hdg = _field(v, n, sog0, 10), _field(v, n, cog0, 12), _field(v, n, hdg0, 9)
            e, north = _to_utm.transform(lon, lat)
            ships[mmsi] = {"e": e, "n": north, "sog": None if sog >= 1023 else sog / 10, "cog": None if cog >= 3600 else cog / 10, "hdg": None if hdg >= 360 else hdg, "t": t}
        elif kind == 5 and n >= 270:
            dims = [_field(v, n, s, w) for s, w in ((240, 9), (249, 9), (258, 6), (264, 6))]
            static[mmsi] = {"name": _text(v, n, 112, 20), "type": _field(v, n, 232, 8), "dest": _text(v, n, 302, 20) if n >= 422 else "", **_size(dims)}
        elif kind == 24 and n >= 160:
            s = static.setdefault(mmsi, {"name": "", "type": 0, "dest": "", **_size([0, 0, 0, 0])})
            if _field(v, n, 38, 2) == 0:
                s["name"] = _text(v, n, 40, 20)
            elif n >= 162:
                dims = [_field(v, n, a, w) for a, w in ((132, 9), (141, 9), (150, 6), (156, 6))]
                s.update(type=_field(v, n, 40, 8), **_size(dims))
    return ships, static, last


def expected() -> dict:
    """Det serveren skal svare for opptaket i tests/fixtures/ais_sample.txt."""
    ships, static, last = decode(SAMPLE.read_text(encoding="ascii").splitlines())
    now = last + 1
    out = {}
    for icao, (w, s, e, n) in AREAS.items():
        rows = []
        for mmsi, p in sorted(ships.items()):
            if not (w <= p["e"] < e and s < p["n"] <= n):
                continue
            st = static.get(mmsi, {})
            rows.append({"id": mmsi, "e": round(p["e"], 1), "n": round(p["n"], 1), "sog": p["sog"], "cog": p["cog"], "hdg": p["hdg"], "age": now - (p["t"] or now),
                         "name": _clean(st.get("name", "")), "dest": "" if sum(c.isdigit() for c in st.get("dest", "")) >= 6 else _clean(st.get("dest", "")), "type": st.get("type", 0),
                         "len": st.get("len"), "beam": st.get("beam"), "fwd": st.get("fwd"), "stb": st.get("stb")})
        out[icao] = rows
    return {"about": "Laget av pipeline/tests/ais_reference.py fra ais_sample.txt (Kystverkets åpne AIS-strøm, NLOD, opptak 2026-11-21).", "now": now, "areas": AREAS, "ships": out}


if __name__ == "__main__":
    EXPECTED.write_text(json.dumps(expected(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print({k: len(v) for k, v in expected()["ships"].items()})
