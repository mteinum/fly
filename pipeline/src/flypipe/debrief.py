"""Gjennomgang av en flylogg fra spillet: regner ut fakta som en KI-agent (eller et menneske) kan tolke.

Spillet skriver en logg per innflyging (web/src/flightlog.ts). Utviklingsserveren lagrer dem i
data/flights/, og L i spillet laster ned siste logg. Her leses loggene og regnes om til det en
gjennomgang trenger: avvik fra senterlinje og glidebane, fart mot grensene, når understell og klaffer
kom ut, og terrenget under flyet.

Tanken er at språkmodellen ikke skal regne og ikke huske: alle tall kommer herfra, modellen forklarer.
Loggens posisjoner er EUREF89 UTM 33 (øst, nord), høyder NN2000, kurs sann.

SYNTETISK: kriteriene for «stabilisert innflyging» under er valgt for spillet, med vanlige
flyselskapskriterier som forbilde. De er ikke hentet fra en operatørs håndbok.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[3]
FLIGHTS = REPO / "data" / "flights"
TILES = REPO / "web" / "public" / "data"

FT = 3.28084
GATES_FT = (1000, 500)  # høyde over terskelen der innflygingen vurderes
MAX_ROWS = 120


def list_flights(directory: Path = FLIGHTS) -> list[dict]:
    """Loggene i mappa, nyeste først."""
    out = []
    for f in sorted(directory.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            log = json.loads(f.read_text(encoding="utf-8"))
            out.append(
                {
                    "flight": f.name,
                    "startedUtc": log["startedUtc"],
                    "airport": log["icao"],
                    "runway": log["runway"],
                    "outcome": log["outcome"],
                    "stars": (log.get("grade") or {}).get("stars"),
                    "durationS": log["samples"][-1]["t"],
                    "autopilot": any(s["ap"] for s in log["samples"]),
                }
            )
        except (ValueError, KeyError, IndexError):
            continue  # ikke en flylogg
    return out


def load(flight: str = "latest", directory: Path = FLIGHTS) -> dict:
    """Les en logg. `flight` er et filnavn fra list_flights, eller «latest»."""
    if flight == "latest":
        files = sorted(directory.glob("*.json"), key=lambda p: p.stat().st_mtime)
        if not files:
            raise FileNotFoundError(f"Ingen flylogger i {directory}. Fly en innflyging i utviklingsmodus (npm run dev), eller last ned en med L og legg den der.")
        path = files[-1]
    else:
        # bare et filnavn i mappa: ingen stier utenfra
        if Path(flight).name != flight or not flight.endswith(".json"):
            raise ValueError("flight må være et filnavn fra list_flights")
        path = directory / flight
    log = json.loads(path.read_text(encoding="utf-8"))
    if log.get("version") != 1 or log.get("crs") != "EPSG:25833":
        raise ValueError(f"{path.name}: ukjent loggformat eller koordinatsystem")
    log["flight"] = path.name
    return log


def track(log: dict) -> list[dict]:
    """Målingene med avstand til terskelen (m, positiv = før terskelen) og til senterlinja (m, positiv = til høyre).

    Geometrien regnes i UTM-planet med rutenettkursen fra baneendene (headingGridDeg), ikke med publisert
    sann kurs minus konvergens: den sanne kursen er avrundet til hele grader, og det ga 6 m feil på 8 km.
    """
    th = log["threshold"]
    h = math.radians(th["headingGridDeg"])
    out = []
    for s in log["samples"]:
        de, dn = s["east"] - th["east"], s["north"] - th["north"]
        out.append(
            {
                **s,
                "toThresholdM": round(-(de * math.sin(h) + dn * math.cos(h))),
                "crossM": round(de * math.cos(h) - dn * math.sin(h), 1),
                "aboveThresholdFt": round((s["altM"] - th["elevationM"]) * FT),
            }
        )
    return out


def _gate(rows: list[dict], gate_ft: int) -> dict | None:
    """Tilstanden i det flyet passerer `gate_ft` over terskelen på vei ned, og om innflygingen var stabilisert der."""
    for prev, row in zip(rows, rows[1:]):
        if prev["aboveThresholdFt"] > gate_ft >= row["aboveThresholdFt"]:
            checks = {
                "gearDownAndLocked": row["gear"] >= 1,
                "landingFlaps": row["flaps"] >= 3,
                "onCentreline": row["courseDots"] is not None and abs(row["courseDots"]) <= 1,
                "onGlidePath": row["glideDots"] is not None and abs(row["glideDots"]) <= 1,
                "sinkRateBelow1000fpm": row["vsFpm"] >= -1000,
                "speedInRange": row["stallKt"] * 1.1 <= row["kt"] <= row["stallKt"] * 1.23 + 20,
                "wingsNearLevel": abs(row["rollDeg"]) <= 7,
            }
            return {
                "gateFt": gate_ft,
                "t": row["t"],
                "toThresholdM": row["toThresholdM"],
                **{k: row[k] for k in ("kt", "vsFpm", "courseDots", "glideDots", "gear", "flaps", "rollDeg", "stallKt")},
                "checks": checks,
                "stabilised": all(checks.values()),
            }
    return None


def _worst(rows: list[dict], key: str) -> dict | None:
    """Største avvik i merker, utenom de siste 500 m (der vinkelen løper løpsk nær senderen)."""
    usable = [r for r in rows if r[key] is not None and (r["toAimM"] or 0) > 500]
    if not usable:
        return None
    w = max(usable, key=lambda r: abs(r[key]))
    return {
        "dots": w[key],
        "t": w["t"],
        "toThresholdM": w["toThresholdM"],
        "shareWithinOneDot": round(sum(abs(r[key]) <= 1 for r in usable) / len(usable), 2),
    }


def _first(rows: list[dict], test) -> dict | None:
    row = next((r for r in rows if test(r)), None)
    return row and {"t": row["t"], "toThresholdM": row["toThresholdM"], "aboveThresholdFt": row["aboveThresholdFt"]}


def summary(log: dict) -> dict:
    """Hovedtallene for én innflyging."""
    rows = track(log)
    flying = rows[:-1] if len(rows) > 1 else rows  # siste måling er etter at det endte
    dt = [b["t"] - a["t"] for a, b in zip(flying, flying[1:])] + [0]
    slowest = min(flying, key=lambda r: r["kt"] - r["stallKt"])
    return {
        "flight": log.get("flight"),
        "airport": f"{log['icao']} {log['airportName']}",
        "runway": log["runway"],
        "startedUtc": log["startedUtc"],
        "durationS": rows[-1]["t"],
        "startToThresholdM": rows[0]["toThresholdM"],
        "outcome": log["outcome"],
        "gameMessage": log["message"],
        "flownByAutopilotShare": round(sum(r["ap"] for r in rows) / len(rows), 2),
        "touchdown": log["touchdown"] and {k: round(v, 1) if isinstance(v, float) else v for k, v in log["touchdown"].items()},
        "grade": log["grade"],
        "events": log["events"],
        "gates": [g for g in (_gate(rows, ft) for ft in GATES_FT) if g],
        "centreline": _worst(flying, "courseDots"),
        "glidePath": _worst(flying, "glideDots"),
        "speed": {
            "minKt": min(r["kt"] for r in flying),
            "maxKt": max(r["kt"] for r in flying),
            "smallestMarginToStall": {"kt": round(slowest["kt"] - slowest["stallKt"], 1), "t": slowest["t"], "ratio": round(slowest["kt"] / slowest["stallKt"], 2)},
            "secondsAboveLimit": round(sum(d for r, d in zip(flying, dt) if r["kt"] > r["limitKt"]), 1),
        },
        "configuration": {
            "gearDownAndLocked": _first(flying, lambda r: r["gear"] >= 1),
            "flaps3": _first(flying, lambda r: r["flaps"] >= 3),
            "flapsFull": _first(flying, lambda r: r["flaps"] >= 4),
        },
        "lastSeconds": [{k: r[k] for k in ("t", "aglM", "kt", "vsFpm", "pitchDeg", "rollDeg", "thr")} for r in flying[-10:]],
        "notes": [
            "dots: som på PFD. courseDots positiv = flyet til høyre for senterlinja, glideDots positiv = over glidebanen. Ett merke = 0,8° / 0,35°.",
            "Glidebanen er syntetisk (3° fra baneendene), ikke flyplassens ILS. Kriteriene i gates er spillets egne.",
            "toThresholdM er positiv før terskelen. Høyder er NN2000, posisjoner EPSG:25833.",
        ],
    }


def samples(log: dict, from_s: float = 0, to_s: float = 1e9, every_s: float = 5) -> dict:
    """Målinger i et tidsrom, tynnet til én per `every_s` sekunder (høyst MAX_ROWS rader)."""
    rows = [r for r in track(log) if from_s <= r["t"] <= to_s]
    if not rows:
        return {"columns": [], "rows": [], "note": "ingen målinger i tidsrommet"}
    step = max(every_s, (rows[-1]["t"] - rows[0]["t"]) / MAX_ROWS)
    picked, nxt = [], rows[0]["t"]
    for r in rows:
        if r["t"] >= nxt - 1e-9:
            picked.append(r)
            nxt = r["t"] + step
    cols = ["t", "toThresholdM", "crossM", "altM", "aglM", "kt", "vsFpm", "pitchDeg", "rollDeg", "hdgTrueDeg", "thr", "gear", "flaps", "stallKt", "limitKt", "courseDots", "glideDots", "ap"]
    return {"columns": cols, "rows": [[r[c] for c in cols] for r in picked], "everyS": round(step, 1)}


def terrain_profile(log: dict, tiles: Path = TILES, every_s: float = 5) -> dict:
    """Terrenget under flyet og nærmeste stedsnavn underveis, fra spillflisene for utsnittet.

    Høyden er DTM (rent terreng): bygninger og bruer er ikke med. Stedsnavn er fra N50.
    """
    area = tiles / str(log["area"])
    if Path(str(log["area"])).name != log["area"] or not (area / "metadata.json").exists():
        raise FileNotFoundError(f"Fliser for {log['area']} er ikke bygget (uv run flypipe build {log['area']})")
    meta = json.loads((area / "metadata.json").read_text(encoding="utf-8"))
    assert meta["crs"] == log["crs"], (meta["crs"], log["crs"])
    cell, west, north = meta["cellSize"], meta["bbox"]["west"], meta["bbox"]["north"]
    dtm = np.memmap(area / meta["heightmap"]["file"], dtype="<f4", mode="r", shape=(meta["height"], meta["width"]))
    names = []
    if meta.get("names") and (area / meta["names"]["file"]).exists():
        # [navn, x, y, z, skriftstørrelse, type, gruppe] i rutenettceller; filen er sortert med viktigste først
        names = json.loads((area / meta["names"]["file"]).read_text(encoding="utf-8"))["items"]

    def ground(east: float, north_: float) -> float:
        col = min(max(int((east - west) / cell), 0), meta["width"] - 1)
        row = min(max(int((north - north_) / cell), 0), meta["height"] - 1)
        return max(0.0, float(dtm[row, col]))

    def nearest(east: float, north_: float) -> dict | None:
        x, y = (east - west) / cell, (north - north_) / cell
        best = None
        for n in names:
            d = math.hypot(n[1] - x, n[2] - y) * cell
            if d <= 1500 and (best is None or d < best[0]):
                best = (d, n)
        return best and {"name": best[1][0], "type": best[1][5], "distanceM": round(best[0])}

    rows, nxt, all_rows = [], 0.0, track(log)
    for r in all_rows:
        if r["t"] < nxt - 1e-9 and r is not all_rows[-1]:  # siste måling (der det endte) er alltid med
            continue
        nxt = r["t"] + every_s
        g = ground(r["east"], r["north"])
        rows.append({"t": r["t"], "toThresholdM": r["toThresholdM"], "altM": r["altM"], "terrainM": round(g, 1), "clearanceM": round(r["altM"] - g, 1), "near": nearest(r["east"], r["north"])})
    before = [r for r in rows if r["toThresholdM"] > 300] or rows
    lowest = min(before, key=lambda r: r["clearanceM"])
    # det pipeline har regnet ut om denne innflygingen (analysis.py): klaring under glidebanen, og hva tårnet ser
    ends = [e for a in meta["airports"] for rw in a["runways"] for e in rw["ends"] if e["ident"] == log["runway"]]
    return {
        "area": log["area"],
        "cellSizeM": cell,
        "onTheGlidePath": ends[0].get("approach") if ends else None,
        "lowestClearanceBeforeThreshold": lowest,
        "profile": rows[:MAX_ROWS],
    }
