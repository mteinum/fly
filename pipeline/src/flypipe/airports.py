"""Flyplasser og rullebaner fra OurAirports (public domain).

Rullebaneretning i spillet regnes fra de to baneendenes koordinater etter
transformasjon til UTM 33 - ikke fra le_heading_degT. Da følger
meridiankonvergensen med automatisk, og banen havner der den faktisk ligger.
"""

from __future__ import annotations

import csv
from pathlib import Path

import requests
from pyproj import Geod

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


# Baneender der OurAirports ligger feil, rettet til (lengde, bredde) fra OpenStreetMap (ODbL).
# ENKJ: begge endene i OurAirports ligger 185 m for langt vest, på jordene ved Nitelva. Asfalten i N50 og banen i
# OpenStreetMap (way 1148140505, 69721328 og 835588363, lest 2026-11-22) ligger på samme sted, og lengden (1641 m)
# stemmer med OurAirports (1622 m). Bare posisjonen rettes; høyde, forskjøvet terskel og bredde er fra OurAirports.
RUNWAY_END_OVERRIDES: dict[str, dict[str, tuple[float, float]]] = {
    "ENKJ": {"12": (11.0271413, 59.9734011), "30": (11.0518491, 59.9654378)},
}


def load_airport(icao: str, raw_dir: Path, grid: GridSpec | None = None) -> dict:
    """Flyplass med rullebaner. Punkter får UTM 33 og (hvis grid er gitt) rutenettkoordinater."""
    (ap,) = _rows(_download("airports.csv", raw_dir), "ident", icao)
    runways = []
    for rw in _rows(_download("runways.csv", raw_dir), "airport_ident", icao):
        if rw["closed"] == "1" or not rw["le_latitude_deg"] or not rw["he_latitude_deg"]:
            continue
        ends = []
        for side in ("le", "he"):
            fixed = RUNWAY_END_OVERRIDES.get(icao, {}).get(rw[f"{side}_ident"])
            end = _point(*(fixed or (float(rw[f"{side}_longitude_deg"]), float(rw[f"{side}_latitude_deg"]))), grid)
            if fixed:
                end["positionSource"] = "OpenStreetMap (ODbL): OurAirports ligger feil, se airports.RUNWAY_END_OVERRIDES"
            end["ident"] = rw[f"{side}_ident"]
            end["elevationM"] = round(float(rw[f"{side}_elevation_ft"]) * FT, 1)
            end["headingPublishedDeg"] = float(rw[f"{side}_heading_degT"])
            end["displacedThresholdM"] = round(float(rw[f"{side}_displaced_threshold_ft"] or 0) * FT, 1)
            ends.append(end)
        le, he = ends
        le["headingGridDeg"] = round(grid_bearing_deg(le["east"], le["north"], he["east"], he["north"]), 2)
        he["headingGridDeg"] = round((le["headingGridDeg"] + 180) % 360, 2)
        # Sann kurs regnes også fra endepunktene (geodetisk asimut), ikke fra kildens «heading_degT». For Mehamn
        # står banens magnetiske kurs (170°) i det feltet; sann kurs er 182,4°. Kildens tall beholdes som
        # headingPublishedDeg, så avviket kan ses.
        fwd, back, _ = Geod(ellps="GRS80").inv(le["lon"], le["lat"], he["lon"], he["lat"])
        le["headingTrueDeg"], he["headingTrueDeg"] = round(fwd % 360, 2), round(back % 360, 2)
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


# Matrikkelens bygningstype 411: ekspedisjonsbygning, flyterminal, kontrolltårn
TERMINAL_BUILDING_TYPE = 411
TOWER_EYE_HEIGHT = 32.0  # m over bakken. ANTATT: verken N50 eller OurAirports har tårnhøyde


def tower_position(airport: dict, building_areas, hgt, grid: GridSpec) -> dict:
    """Hvor kontrolltårnet står: N50-bygningen av type 411 nærmest flyplassens referansepunkt.

    Dataene sier bare at bygningen er terminal ELLER tårn. Hvor på bygningen tårnet står,
    og hvor høyt det er, vet vi ikke: punktet legges på den delen av bygningen som er
    nærmest rullebanen, og øyehøyden er antatt. Uten N50-bygning plasseres tårnet syntetisk
    250 m til side for banens midtpunkt.
    """
    from shapely.geometry import LineString, Point
    from shapely.ops import nearest_points

    arp = Point(airport["arp"]["east"], airport["arp"]["north"])
    le, he = airport["runways"][0]["ends"]
    runway = LineString([(le["east"], le["north"]), (he["east"], he["north"])])
    source = "syntetisk: 250 m til side for banens midtpunkt"
    mid = runway.interpolate(0.5, normalized=True)
    dx, dy = (he["east"] - le["east"]) / runway.length, (he["north"] - le["north"]) / runway.length
    point = Point(mid.x - dy * 250, mid.y + dx * 250)
    if building_areas is not None and len(building_areas):
        terminals = building_areas[building_areas["bygningstype"] == TERMINAL_BUILDING_TYPE]
        terminals = terminals[terminals.distance(arp) < 2000]
        if len(terminals):
            building = terminals.geometry.iloc[terminals.distance(arp).argmin()]
            point = nearest_points(building, runway)[0]
            source = f"N50 bygning type {TERMINAL_BUILDING_TYPE} nærmest referansepunktet; plassering på bygningen og høyde er antatt"
    x, y = grid.utm_to_grid(point.x, point.y)
    ground = max(0.0, float(hgt[int(y), int(x)]))
    return {
        "east": round(point.x, 2), "north": round(point.y, 2), "x": round(x, 4), "y": round(y, 4),
        "groundM": round(ground, 1), "eyeM": round(ground + TOWER_EYE_HEIGHT, 1), "source": source,
    }
