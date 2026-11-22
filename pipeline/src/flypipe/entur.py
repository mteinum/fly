"""Bussholdeplasser fra Enturs nasjonale stoppestedsregister (NSR), lisens NLOD.

Hentes for hånd med `uv run flypipe stops <utsnitt>` til data/entur/<utsnitt>.stops.json (i git), så bygget ikke
avhenger av tjenesten. Kilde: Journey Planner v3 (GraphQL), spørringen `stopPlacesByBbox`. Entur krever hodet
ET-Client-Name. Ett stoppested er ett sted med ett navn; plattformene (én per kjøreretning) tas ikke med.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import requests

from .crs import utm33_to_wgs84, wgs84_to_utm33
from .grid import GridSpec

URL = "https://api.entur.io/journey-planner/v3/graphql"
CLIENT = "teinum-fly"
STORE = Path(__file__).resolve().parents[3] / "data" / "entur"
BUS_MODES = {"bus", "coach"}
TILES = 3  # utsnittet spørres i 3 x 3 ruter, så ingen enkelt spørring blir stor


def stops_path(area_id: str) -> Path:
    return STORE / f"{area_id}.stops.json"


def bus_stops(places: list[dict], grid: GridSpec) -> list[dict]:
    """Stoppestedene busser bruker, innenfor rutenettet, i UTM 33. Ett per id, sortert på id."""
    out: dict[str, dict] = {}
    for p in places:
        modes = set(p.get("transportMode") or [])
        if not modes & BUS_MODES or p.get("latitude") is None or p.get("longitude") is None:
            continue
        e, n = wgs84_to_utm33(p["longitude"], p["latitude"])
        e, n = round(float(e), 1), round(float(n), 1)
        if not (grid.west <= e < grid.east and grid.south < n <= grid.north):
            continue
        out[p["id"]] = {"id": p["id"], "name": str(p.get("name") or "").strip()[:60], "at": [e, n]}
    return [out[k] for k in sorted(out)]


def fetch_stops(area_id: str, grid: GridSpec, raw_dir: Path) -> Path:
    raw = raw_dir / "entur"
    raw.mkdir(parents=True, exist_ok=True)
    path = raw / f"{area_id}_stops.json"
    if not path.exists():
        corners = [utm33_to_wgs84(x, y) for x in (grid.west, grid.east) for y in (grid.south, grid.north)]
        lon0, lon1 = min(c[0] for c in corners), max(c[0] for c in corners)
        lat0, lat1 = min(c[1] for c in corners), max(c[1] for c in corners)
        places: list[dict] = []
        for i in range(TILES):
            for j in range(TILES):
                box = (lat0 + (lat1 - lat0) * j / TILES, lon0 + (lon1 - lon0) * i / TILES, lat0 + (lat1 - lat0) * (j + 1) / TILES, lon0 + (lon1 - lon0) * (i + 1) / TILES)
                q = ("{ stopPlacesByBbox(minimumLatitude:%.6f,minimumLongitude:%.6f,maximumLatitude:%.6f,maximumLongitude:%.6f)"
                     " { id name latitude longitude transportMode } }") % box
                r = requests.post(URL, json={"query": q}, headers={"ET-Client-Name": CLIENT}, timeout=60)
                r.raise_for_status()
                body = r.json()
                if body.get("errors"):
                    raise RuntimeError(f"Entur svarte med feil: {body['errors']}")
                places += body["data"]["stopPlacesByBbox"]
                time.sleep(0.5)  # ni spørringer per utsnitt: ingen grunn til å skynde seg
        print(f"  Entur: {len(places)} stoppesteder i {TILES * TILES} ruter -> {path.name}")
        path.write_text(json.dumps(places, ensure_ascii=False), encoding="utf-8")
    stops = bus_stops(json.loads(path.read_text(encoding="utf-8")), grid)
    doc = {
        "about": "Bussholdeplasser fra Enturs nasjonale stoppestedsregister (NLOD): id, navn og sted (øst, nord) i EPSG:25833. "
                 "Ett stoppested per navn; plattformene per kjøreretning er ikke med.",
        "fetched": time.strftime("%Y-%m-%d"),
        "stops": stops,
    }
    STORE.mkdir(parents=True, exist_ok=True)
    target = stops_path(area_id)
    target.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"  {len(stops)} bussholdeplasser -> {target.name} ({target.stat().st_size / 1e3:.0f} kB)")
    return target


def load_stops(area_id: str) -> dict | None:
    """Bussholdeplassene for utsnittet, eller None når de ikke er hentet (`flypipe stops <utsnitt>`)."""
    path = stops_path(area_id)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
