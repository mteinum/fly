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
import math
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
            if len(geom) < 4 or geom[0] != geom[-1]:  # ikke en lukket flate (halvferdig kartlegging)
                skipped["invalid"] += 1
                continue
            east, north = to_utm.transform([p["lon"] for p in geom], [p["lat"] for p in geom])
            poly = Polygon(np.c_[east, north])
            if not poly.is_valid or poly.area < MIN_AREA_M2:
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


# ---------- taksebaner, oppstillingsplasser og stands ----------

AEROWAY_WIDTH_M = {"taxiway": 23.0, "taxilane": 15.0}  # brukes når OSM ikke har bredden (vanlig)
MAX_AEROWAY_WIDTH_M = 60.0
STAND_LANE_M = 20.0  # samme som STAND_LANE_M i web/src/physics.ts


RAIL_KINDS = {"subway": "metro", "tram": "tram", "light_rail": "lightrail", "rail": "rail"}
# En holdeplass hører til sporet den ligger nærmest, innen så langt. Jernbanestasjoner er kartlagt som ett punkt
# midt på stasjonen, som kan ligge et stykke fra nærmeste spor.
STOP_SNAP_M = {"metro": 60.0, "tram": 60.0, "lightrail": 60.0, "rail": 150.0}


def rail_path(area_id: str) -> Path:
    return STORE / f"{area_id}.rail.json"


def rails_from_elements(elements: list[dict], grid: GridSpec) -> dict:
    """Jernbane, T-bane, trikk og bybane fra Overpass-elementer: spor (linjer) og holdeplasser (punkt), i UTM 33.

    Spor: way med railway=rail/subway/tram/light_rail. Sidespor og verksteder (service=*) tas ikke med. Et spor som går
    ut av utsnittet deles, så bare bitene innenfor blir med. `tunnel` er sann der OpenStreetMap sier tunnel.
    Holdeplasser: node med navn og railway=station/tram_stop/halt. Slaget (T-bane, trikk, bybane) er det samme som
    nærmeste spor; holdeplasser lenger enn STOP_SNAP_M fra nærmeste spor faller bort.
    """
    from shapely.geometry import LineString, Point
    from shapely.strtree import STRtree

    from .crs import wgs84_to_utm33

    def utm(points: list[dict]) -> list[tuple[float, float]]:
        east, north = wgs84_to_utm33([p["lon"] for p in points], [p["lat"] for p in points])
        return [(round(float(e), 1), round(float(n), 1)) for e, n in zip(east, north)]

    inside = lambda p: grid.west <= p[0] < grid.east and grid.south < p[1] <= grid.north  # noqa: E731
    tracks: list[dict] = []
    for el in sorted((e for e in elements if e["type"] == "way"), key=lambda e: e["id"]):
        tags = el.get("tags", {})
        kind = RAIL_KINDS.get(tags.get("railway", ""))
        if kind is None or "service" in tags or len(el.get("geometry", [])) < 2:
            continue
        tunnel = tags.get("tunnel", "no") not in ("no", "") or tags.get("covered") == "yes"
        run: list[tuple[float, float]] = []
        for p in [*utm(el["geometry"]), None]:
            if p is not None and inside(p):
                if not run or run[-1] != p:
                    run.append(p)
                continue
            if len(run) >= 2:
                tracks.append({"id": el["id"], "kind": kind, "tunnel": tunnel, "line": [list(q) for q in run]})
            run = []
    # I Oslo er trikkens forstadsbaner (Lilleakerbanen, Ekebergbanen) merket light_rail, i Bergen er museumstrikken
    # på Møhlenpris merket tram. Det slaget det er minst av, regnes som det andre: trikk i Oslo, bybane i Bergen.
    km = {k: sum(math.dist(a, b) for t in tracks if t["kind"] == k for a, b in zip(t["line"], t["line"][1:])) for k in ("tram", "lightrail")}
    if km["tram"] and km["lightrail"]:
        minor, major = ("lightrail", "tram") if km["tram"] >= km["lightrail"] else ("tram", "lightrail")
        for t in tracks:
            if t["kind"] == minor:
                t["kind"] = major
    stops: list[dict] = []
    if tracks:
        lines = [LineString(t["line"]) for t in tracks]
        tree = STRtree(lines)
        seen: set[tuple[str, str]] = set()
        for el in sorted((e for e in elements if e["type"] == "node"), key=lambda e: e["id"]):
            name = str(el.get("tags", {}).get("name", "")).strip()[:40]
            if not name:
                continue
            (at,) = utm([el])
            if not inside(at):
                continue
            i = int(tree.nearest(Point(at)))
            kind = tracks[i]["kind"]
            if lines[i].distance(Point(at)) > STOP_SNAP_M[kind]:
                continue
            if (kind, name) in seen:  # én per navn og slag: hver retning har sin egen node i OpenStreetMap
                continue
            seen.add((kind, name))
            stops.append({"id": el["id"], "kind": kind, "name": name, "at": list(at)})
    return {"tracks": tracks, "stops": stops}


def fetch_rails(area_id: str, grid: GridSpec, raw_dir: Path) -> Path | None:
    """Hent jernbane, T-bane, trikk og bybane fra Overpass og skriv data/osm/<utsnitt>.rail.json (i git, ODbL).

    Skriver ingen fil når utsnittet ikke har skinner (Mehamn, Tromsø og Ålesund).
    """
    from .crs import utm33_to_wgs84

    raw = raw_dir / "osm"
    raw.mkdir(parents=True, exist_ok=True)
    path = raw / f"{area_id}_rails.json"
    if not path.exists():
        corners = [utm33_to_wgs84(x, y) for x in (grid.west, grid.east) for y in (grid.south, grid.north)]
        box = f"{min(c[1] for c in corners):.6f},{min(c[0] for c in corners):.6f},{max(c[1] for c in corners):.6f},{max(c[0] for c in corners):.6f}"
        q = (f'[out:json][timeout:180];(way["railway"~"^(rail|subway|tram|light_rail)$"]({box});'
             f'node["railway"~"^(station|tram_stop|halt)$"]["name"]({box}););out geom;')
        print(f"  Overpass: {path.name}")
        for attempt, wait in enumerate((0, 20, 45, 90, 180, 300)):
            time.sleep(wait)
            r = requests.post(OVERPASS_URL, data={"data": q}, headers={"User-Agent": USER_AGENT}, timeout=300)
            if r.status_code == 200:
                break
            print(f"  Overpass svarte {r.status_code}, forsøk {attempt + 1}")
        else:
            raise RuntimeError("Overpass API svarer ikke. Prøv igjen senere; bygget bruker fila som alt ligger i data/osm/.")
        path.write_text(json.dumps(r.json()["elements"]), encoding="utf-8")
    out = rails_from_elements(json.loads(path.read_text(encoding="utf-8")), grid)
    if not out["tracks"]:
        print("  ingen skinner i utsnittet")
        return None
    doc = {
        "about": "Jernbane, T-bane, trikk og bybane fra OpenStreetMap: spor (kind rail/metro/tram/lightrail, tunnel ja/nei) og holdeplasser. "
                 "Koordinater er (øst, nord) i EPSG:25833. © OpenStreetMap contributors, ODbL 1.0.",
        "fetched": time.strftime("%Y-%m-%d"),
        **out,
    }
    STORE.mkdir(parents=True, exist_ok=True)
    target = rail_path(area_id)
    target.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    km = sum(math.dist(a, b) for t in out["tracks"] for a, b in zip(t["line"], t["line"][1:])) / 1000
    print(f"  {len(out['tracks'])} spor ({km:.0f} km), {len(out['stops'])} holdeplasser -> {target.name} ({target.stat().st_size / 1e3:.0f} kB)")
    return target


def load_rails(area_id: str) -> dict | None:
    """Skinnegående bytrafikk for utsnittet, eller None når utsnittet ikke har noen (`flypipe rails <utsnitt>`)."""
    path = rail_path(area_id)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def aeroway_path(area_id: str) -> Path:
    return STORE / f"{area_id}.aeroway.json"


def fetch_aeroways(area_id: str, grid: GridSpec, raw_dir: Path) -> Path:
    """Hent flyplassens bakkeanlegg fra Overpass og skriv data/osm/<utsnitt>.aeroway.json (i git, ODbL).

    Tas med: taksebaner og taksebaner mellom oppstillingsplasser (linjer med navn), oppstillingsflater
    (polygoner), stands (punkt, eller innkjøringslinje der den er kartlagt) og ventepunkter.
    Koordinatene transformeres til UTM 33 med crs.py og lagres i hele desimeter.
    """
    from .crs import utm33_to_wgs84, wgs84_to_utm33

    raw = raw_dir / "osm"
    raw.mkdir(parents=True, exist_ok=True)
    path = raw / f"{area_id}_aeroway.json"
    if not path.exists():
        # UTM-ruta er skjev i lengde/bredde: spør om boksen som omslutter den
        corners = [utm33_to_wgs84(x, y) for x in (grid.west, grid.east) for y in (grid.south, grid.north)]
        box = f"{min(c[1] for c in corners):.6f},{min(c[0] for c in corners):.6f},{max(c[1] for c in corners):.6f},{max(c[0] for c in corners):.6f}"
        q = (f'[out:json][timeout:120];(way["aeroway"~"^(taxiway|taxilane|apron|parking_position)$"]({box});'
             f'node["aeroway"~"^(parking_position|holding_position)$"]({box}););out geom;')
        print(f"  Overpass: {path.name}")
        for attempt, wait in enumerate((0, 20, 45, 90, 180, 300)):
            time.sleep(wait)
            r = requests.post(OVERPASS_URL, data={"data": q}, headers={"User-Agent": USER_AGENT}, timeout=300)
            if r.status_code == 200:
                break
            print(f"  Overpass svarte {r.status_code}, forsøk {attempt + 1}")
        else:
            raise RuntimeError("Overpass API svarer ikke. Prøv igjen senere; bygget bruker fila som alt ligger i data/osm/.")
        path.write_text(json.dumps(r.json()["elements"]), encoding="utf-8")

    def utm(points: list[dict]) -> list[list[float]]:
        east, north = wgs84_to_utm33([p["lon"] for p in points], [p["lat"] for p in points])
        return [[round(float(e), 1), round(float(n), 1)] for e, n in zip(east, north)]

    inside = lambda e, n: grid.west <= e < grid.east and grid.south < n <= grid.north  # noqa: E731
    out: dict = {"taxiways": [], "aprons": [], "stands": [], "holds": []}
    for el in sorted(json.loads(path.read_text(encoding="utf-8")), key=lambda e: (e["type"], e["id"])):
        tags, kind = el.get("tags", {}), el.get("tags", {}).get("aeroway")
        ref = str(tags.get("ref", "")).strip()[:8]
        if el["type"] == "node":
            (e, n), = utm([el])
            if not inside(e, n):
                continue
            if kind == "parking_position":
                out["stands"].append({"id": el["id"], "ref": ref, "at": [e, n], "line": None})
            elif kind == "holding_position":
                out["holds"].append({"id": el["id"], "at": [e, n]})
            continue
        pts = utm(el.get("geometry", []))
        if len(pts) < 2 or not all(inside(e, n) for e, n in pts):
            continue
        if kind in AEROWAY_WIDTH_M:
            w = str(tags.get("width", "")).replace(",", ".").removesuffix("m").strip()
            width = float(w) if w.replace(".", "", 1).isdigit() and 5 <= float(w) <= MAX_AEROWAY_WIDTH_M else None
            out["taxiways"].append({"id": el["id"], "ref": ref, "kind": kind, "width": width, "line": pts})
        elif kind == "apron" and len(pts) >= 4 and pts[0] == pts[-1]:
            out["aprons"].append({"id": el["id"], "ring": pts[:-1]})
        elif kind == "parking_position":
            # innkjøringslinja: flyet står i enden som ligger lengst fra nærmeste taksebane (avgjøres i spillet)
            out["stands"].append({"id": el["id"], "ref": ref, "at": pts[-1], "line": pts})
    doc = {
        "about": "Flyplassens bakkeanlegg fra OpenStreetMap: taksebaner, oppstillingsflater, stands og ventepunkter. "
                 "Koordinater er (øst, nord) i EPSG:25833. © OpenStreetMap contributors, ODbL 1.0.",
        "fetched": time.strftime("%Y-%m-%d"),
        **out,
    }
    STORE.mkdir(parents=True, exist_ok=True)
    target = aeroway_path(area_id)
    target.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"  {len(out['taxiways'])} taksebaner, {len(out['aprons'])} oppstillingsflater, {len(out['stands'])} stands, "
          f"{len(out['holds'])} ventepunkter -> {target.name} ({target.stat().st_size / 1e3:.0f} kB)")
    return target


def load_aeroways(area_id: str) -> dict | None:
    """Bakkeanlegget for utsnittet, eller None når det ikke er hentet (`flypipe aeroways <utsnitt>`)."""
    path = aeroway_path(area_id)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


AIRPORT_RADIUS_M = 3000.0  # bakkeanlegg lenger fra rullebanene enn dette hører til en annen flyplass eller helikopterplass
SYNTHETIC_STAND_MIN_M2 = 1500.0


def for_airport(aero: dict, runway_ends: list[tuple[float, float]]) -> dict:
    """Bakkeanlegget som hører til flyplassen, med stands.

    Utsnittet kan ha flere anlegg med aeroway-tagger (Kjeller-utsnittet rekker over en helikopterplass 21 km unna):
    bare det som ligger innen AIRPORT_RADIUS_M fra en baneende tas med.
    Der OpenStreetMap ikke har stands (Kjeller), legges det én SYNTETISK stand midt på hver oppstillingsflate
    over SYNTHETIC_STAND_MIN_M2, merket `synthetic`, så det finnes et sted å takse til.
    """
    from shapely.geometry import Polygon

    near = lambda p: any(math.hypot(p[0] - e, p[1] - n) <= AIRPORT_RADIUS_M for e, n in runway_ends)  # noqa: E731
    out = {
        **aero,
        "taxiways": [t for t in aero["taxiways"] if near(t["line"][0])],
        "aprons": [a for a in aero["aprons"] if near(a["ring"][0])],
        "stands": [s for s in aero["stands"] if near(s["at"])],
        "holds": [h for h in aero["holds"] if near(h["at"])],
    }
    if not out["stands"]:
        for a in out["aprons"]:
            poly = Polygon(a["ring"])
            if poly.is_valid and poly.area >= SYNTHETIC_STAND_MIN_M2:
                at = poly.representative_point()
                out["stands"].append({"ref": "", "at": [round(at.x, 1), round(at.y, 1)], "line": None, "synthetic": True})
    return out


def aeroway_shapes(aero: dict) -> list:
    """Flatene bakkeanlegget dekker: taksebanene bufret til full bredde, og oppstillingsflatene."""
    from shapely.geometry import LineString, Polygon

    shapes = [LineString(t["line"]).buffer((t["width"] or AEROWAY_WIDTH_M[t["kind"]]) / 2, cap_style="round") for t in aero["taxiways"]]
    for a in aero["aprons"]:
        poly = Polygon(a["ring"])
        if poly.is_valid and poly.area > 0:
            shapes.append(poly)
    # innkjøringslinja til en stand ligger på asfalt, også der flata rundt ikke er kartlagt (20 m bred, som i spillet)
    shapes += [LineString(st["line"]).buffer(STAND_LANE_M / 2, cap_style="round") for st in aero["stands"] if st["line"]]
    return shapes
