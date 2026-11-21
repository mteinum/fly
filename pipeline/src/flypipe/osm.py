"""Bygningsomriss fra OpenStreetMap.

OSM er eneste åpne kilde til omrissene som vektordata. De er Kartverkets egne (importert fra «INSPIRE
Buildings Core2D» fra 2021, ifølge OSM-wikien), men Kartverket deler dem ikke lenger selv som vektor.
De fleste har matrikkelens bygningsnummer (`ref:bygningsnr`), så de kan kobles til bygningstypen.

LISENS: © OpenStreetMap contributors, Open Database License (ODbL) 1.0. Det som lages av disse dataene
(data/osm/ og buildings.bin i flisene) er en avledet database og deles under samme lisens.

To steg, som for lyden:
- `flypipe osm <utsnitt>` henter fra Overpass API og skriver data/osm/<utsnitt>.npz. Kjøres for hånd:
  Overpass svarer ofte 502/504 når den er travel, og bygget skal ikke avhenge av den.
- `flypipe build` leser fila i data/osm/, som ligger i git.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests
from pyproj import Transformer

from . import USER_AGENT
from .grid import GridSpec

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
STORE = Path(__file__).resolve().parents[3] / "data" / "osm"
DM = 10  # koordinater lagres som hele desimeter

# Bygg som ikke tegnes: små uthus som står inntil hus (samme valg som for Matrikkelen, type 181-183)
SKIP_TAGS = ("garage", "garages", "shed", "carport", "roof", "greenhouse", "hut", "boathouse", "construction", "ruins")
MIN_AREA_M2 = 30.0


@dataclass
class Footprints:
    """Omriss som én lang koordinatliste. Bygg i ligger i xy[start[i]:start[i+1]] (øst, nord i m, ikke lukket)."""

    xy: np.ndarray  # (n, 2) float64
    start: np.ndarray  # (bygg + 1,) int
    ref: np.ndarray  # matrikkelens bygningsnummer, 0 = mangler
    levels: np.ndarray  # etasjer over bakken fra building:levels, 0 = mangler
    fetched: str  # dato dataene ble hentet fra OSM

    def __len__(self) -> int:
        return len(self.ref)

    def ring(self, i: int) -> np.ndarray:
        return self.xy[self.start[i] : self.start[i + 1]]


def _query(south: float, west: float, north: float, east: float) -> list[dict]:
    q = f'[out:json][timeout:300];(way["building"]({south:.6f},{west:.6f},{north:.6f},{east:.6f});relation["building"]["type"="multipolygon"]({south:.6f},{west:.6f},{north:.6f},{east:.6f}););out geom;'
    for attempt, wait in enumerate((0, 20, 45, 90, 180, 300)):
        time.sleep(wait)
        r = requests.post(OVERPASS_URL, data={"data": q}, headers={"User-Agent": USER_AGENT}, timeout=600)
        if r.status_code == 200:
            return r.json()["elements"]
        print(f"  Overpass svarte {r.status_code}, forsøk {attempt + 1}")
    raise RuntimeError("Overpass API svarer ikke. Prøv igjen senere; bygget bruker fila som alt ligger i data/osm/.")


def _rings(el: dict) -> list[list[dict]]:
    """Ytre omriss for et OSM-element: selve veien, eller de lukkede ytre veiene i en relasjon. Hull tas ikke med."""
    if el["type"] == "way":
        return [el["geometry"]] if "geometry" in el else []
    return [m["geometry"] for m in el.get("members", []) if m.get("role") == "outer" and m.get("geometry") and m["geometry"][0] == m["geometry"][-1]]


def fetch(area_id: str, grid: GridSpec, raw_dir: Path) -> Path:
    """Hent bygningene i utsnittet fra Overpass (fire ruter, lagret i data/raw/) og skriv data/osm/<utsnitt>.npz."""
    from shapely.geometry import Polygon

    to_ll = Transformer.from_crs(25833, 4326, always_xy=True)
    to_utm = Transformer.from_crs(4326, 25833, always_xy=True)
    raw = raw_dir / "osm"
    raw.mkdir(parents=True, exist_ok=True)
    mid_e, mid_n = (grid.west + grid.east) / 2, (grid.south + grid.north) / 2
    elements: dict[tuple[str, int], dict] = {}
    for k, (w, s, e, n) in enumerate([(grid.west, mid_n, mid_e, grid.north), (mid_e, mid_n, grid.east, grid.north), (grid.west, grid.south, mid_e, mid_n), (mid_e, grid.south, grid.east, mid_n)]):
        path = raw / f"{area_id}_{k}.json"
        if not path.exists():
            # UTM-ruta er skjev i lengde/bredde: spør om boksen som omslutter den
            corners = [to_ll.transform(x, y) for x in (w, e) for y in (s, n)]
            print(f"  Overpass: {path.name}")
            els = _query(min(c[1] for c in corners), min(c[0] for c in corners), max(c[1] for c in corners), max(c[0] for c in corners))
            path.write_text(json.dumps(els), encoding="utf-8")
            time.sleep(5)  # vær snill mot en gratis tjeneste
        for el in json.loads(path.read_text(encoding="utf-8")):
            elements[(el["type"], el["id"])] = el  # bygg på grensa kommer fra to ruter

    xy: list[np.ndarray] = []
    start, ref, levels = [0], [], []
    skipped = {"tag": 0, "small": 0, "outside": 0, "invalid": 0}
    for (_, _), el in sorted(elements.items()):
        tags = el.get("tags", {})
        if tags.get("building") in SKIP_TAGS:
            skipped["tag"] += 1
            continue
        for geom in _rings(el):
            east, north = to_utm.transform([p["lon"] for p in geom], [p["lat"] for p in geom])
            poly = Polygon(np.c_[east, north])
            if len(geom) < 4 or not poly.is_valid or poly.area < MIN_AREA_M2:
                skipped["small" if poly.is_valid else "invalid"] += 1
                continue
            c = poly.representative_point()
            if not (grid.west <= c.x < grid.east and grid.south < c.y <= grid.north):
                skipped["outside"] += 1
                continue
            # forenkle: hjørner som flytter kanten mindre enn 0,6 m gir ingenting sett fra lufta
            simple = poly.simplify(0.6)
            ring = np.asarray(simple.exterior.coords)[:-1]
            if simple.exterior.is_ccw:
                ring = ring[::-1]  # fast omløpsretning: med klokka sett ovenfra (nord opp)
            xy.append(ring)
            start.append(start[-1] + len(ring))
            ref.append(int(tags["ref:bygningsnr"].split(";")[0]) if tags.get("ref:bygningsnr", "").split(";")[0].isdigit() else 0)
            lv = tags.get("building:levels", "")
            levels.append(min(int(float(lv)), 60) if lv.replace(".", "", 1).isdigit() else 0)
    STORE.mkdir(parents=True, exist_ok=True)
    out = STORE / f"{area_id}.npz"
    np.savez_compressed(
        out,
        xy_dm=np.rint(np.vstack(xy) * DM).astype(np.int32),
        start=np.asarray(start, dtype=np.int32),
        ref=np.asarray(ref, dtype=np.int64),
        levels=np.asarray(levels, dtype=np.int8),
        fetched=np.asarray(time.strftime("%Y-%m-%d")),
    )
    print(f"  {len(ref)} bygg, {start[-1]} hjørner -> {out.name} ({out.stat().st_size / 1e6:.1f} MB). Utelatt: {skipped}")
    return out


def load(area_id: str) -> Footprints:
    path = STORE / f"{area_id}.npz"
    if not path.exists():
        raise FileNotFoundError(f"{path} mangler. Kjør `uv run flypipe osm {area_id}` og sjekk fila inn.")
    with np.load(path) as z:
        return Footprints(z["xy_dm"].astype(np.float64) / DM, z["start"].astype(int), z["ref"], z["levels"].astype(int), str(z["fetched"]))
