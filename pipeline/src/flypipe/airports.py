"""Flyplasser og rullebaner fra OurAirports (public domain).

Rullebaneretning i spillet regnes fra de to baneendenes koordinater etter
transformasjon til UTM 33 - ikke fra le_heading_degT. Da følger
meridiankonvergensen med automatisk, og banen havner der den faktisk ligger.
"""

from __future__ import annotations

import csv
from pathlib import Path

import requests

from . import USER_AGENT
from .crs import grid_bearing_deg, wgs84_to_utm33
from .grid import GridSpec

BASE_URL = "https://davidmegginson.github.io/ourairports-data"
FT = 0.3048


def _download(name: str, raw_dir: Path) -> Path:
    path = raw_dir / "ourairports" / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(f"{BASE_URL}/{name}", headers={"User-Agent": USER_AGENT}, timeout=120)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def _rows(path: Path, key: str, value: str) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return [row for row in csv.DictReader(f) if row[key] == value]


def _point(lon: float, lat: float, grid: GridSpec | None) -> dict:
    e, n = wgs84_to_utm33(lon, lat)
    p = {"lon": lon, "lat": lat, "east": round(e, 2), "north": round(n, 2)}
    if grid is not None:
        x, y = grid.utm_to_grid(e, n)
        p["x"], p["y"] = round(x, 4), round(y, 4)
    return p


def load_airport(icao: str, raw_dir: Path, grid: GridSpec | None = None) -> dict:
    """Flyplass med rullebaner. Punkter får UTM 33 og (hvis grid er gitt) rutenettkoordinater."""
    (ap,) = _rows(_download("airports.csv", raw_dir), "ident", icao)
    runways = []
    for rw in _rows(_download("runways.csv", raw_dir), "airport_ident", icao):
        if rw["closed"] == "1" or not rw["le_latitude_deg"] or not rw["he_latitude_deg"]:
            continue
        ends = []
        for side in ("le", "he"):
            end = _point(float(rw[f"{side}_longitude_deg"]), float(rw[f"{side}_latitude_deg"]), grid)
            end["ident"] = rw[f"{side}_ident"]
            end["elevationM"] = round(float(rw[f"{side}_elevation_ft"]) * FT, 1)
            end["headingTrueDeg"] = float(rw[f"{side}_heading_degT"])
            end["displacedThresholdM"] = round(float(rw[f"{side}_displaced_threshold_ft"] or 0) * FT, 1)
            ends.append(end)
        le, he = ends
        le["headingGridDeg"] = round(grid_bearing_deg(le["east"], le["north"], he["east"], he["north"]), 2)
        he["headingGridDeg"] = round((le["headingGridDeg"] + 180) % 360, 2)
        runways.append(
            {
                "ident": f"{le['ident']}/{he['ident']}",
                "lengthM": round(float(rw["length_ft"]) * FT, 1),
                "widthM": round(float(rw["width_ft"]) * FT, 1),
                "surface": rw["surface"],
                "ends": ends,
            }
        )
    return {
        "icao": icao,
        "name": ap["name"],
        "elevationM": round(float(ap["elevation_ft"]) * FT, 1),
        "arp": _point(float(ap["longitude_deg"]), float(ap["latitude_deg"]), grid),
        "runways": runways,
    }
