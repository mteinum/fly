"""Gjennomgangen av flylogger, mot de tre loggene web-testene lager (tests/fixtures/flights/)."""

import json
import math
from pathlib import Path

import pytest

from flypipe import debrief

FLIGHTS = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "flights"


def test_lister_loggene_og_avviser_stier():
    assert {f["flight"] for f in debrief.list_flights(FLIGHTS)} == {"autopilot.json", "late-and-high.json", "gear-up.json"}
    for bad in ("../reference_points.json", "/etc/passwd", "autopilot"):
        with pytest.raises(ValueError):
            debrief.load(bad, FLIGHTS)


def test_avstand_til_terskel_bruker_rutenettkurs_ikke_sann_kurs():
    log = debrief.load("autopilot.json", FLIGHTS)
    rows = debrief.track(log)
    # starter 8 km før baneenden på senterlinja; terskelen ligger 120 m innenfor baneenden
    assert rows[0]["toThresholdM"] == pytest.approx(8000 + log["threshold"]["displacedM"], abs=5)
    assert abs(rows[0]["crossM"]) < 2
    de, dn = rows[0]["east"] - log["threshold"]["east"], rows[0]["north"] - log["threshold"]["north"]
    cross = lambda deg: abs(de * math.cos(math.radians(deg)) - dn * math.sin(math.radians(deg)))  # noqa: E731
    # med sann kurs brukt direkte i UTM (konvergensen glemt) ville startpunktet ligget ~800 m til siden
    assert cross(log["threshold"]["headingTrueDeg"]) > 700
    # og med publisert sann kurs minus konvergens (avrundet til hele grader) noen meter til siden
    assert 3 < cross(log["threshold"]["headingTrueDeg"] - log["gridConvergenceDeg"]) < 15
    # loggens egen avstand til siktepunktet (300 m forbi terskelen) stemmer med den vi regner
    for r in rows[:100:10]:
        assert r["toAimM"] - r["toThresholdM"] == pytest.approx(300, abs=5)


def test_autopiloten_er_stabilisert_og_feilfri():
    s = debrief.summary(debrief.load("autopilot.json", FLIGHTS))
    assert s["outcome"] == "landed" and s["grade"]["stars"] == 5 and s["flownByAutopilotShare"] == 1
    assert [g["gateFt"] for g in s["gates"]] == [1000, 500]
    assert all(g["stabilised"] for g in s["gates"])
    assert abs(s["glidePath"]["dots"]) < 0.5 and s["glidePath"]["shareWithinOneDot"] == 1
    assert s["speed"]["secondsAboveLimit"] == 0 and s["speed"]["smallestMarginToStall"]["ratio"] > 1.1
    cfg = s["configuration"]
    assert cfg["gearDownAndLocked"]["toThresholdM"] > cfg["flapsFull"]["toThresholdM"] > 5500  # alt ute før 1000 fot
    assert cfg["flaps3"]["toThresholdM"] > cfg["flapsFull"]["toThresholdM"]


def test_sen_og_hoy_innflyging_blir_tatt():
    s = debrief.summary(debrief.load("late-and-high.json", FLIGHTS))
    gate = {g["gateFt"]: g for g in s["gates"]}
    assert not gate[1000]["stabilised"]
    assert not gate[1000]["checks"]["gearDownAndLocked"] and not gate[1000]["checks"]["landingFlaps"]
    assert not gate[1000]["checks"]["onGlidePath"] and not gate[1000]["checks"]["sinkRateBelow1000fpm"]
    assert not gate[500]["checks"]["landingFlaps"]
    assert s["glidePath"]["dots"] > 4  # langt over glidebanen
    assert s["configuration"]["flaps3"] is None
    assert "not enough flap" in s["grade"]["remarks"]


def test_glemt_understell():
    s = debrief.summary(debrief.load("gear-up.json", FLIGHTS))
    assert s["outcome"] == "crash" and "Belly landing" in s["gameMessage"] and s["touchdown"] is None
    assert s["configuration"]["gearDownAndLocked"] is None
    assert "warning gearNotDown on" in [e["what"] for e in s["events"]]


def test_utdrag_av_malinger():
    log = debrief.load("autopilot.json", FLIGHTS)
    out = debrief.samples(log, 20, 60, 10)
    t = [r[0] for r in out["rows"]]
    assert t == [20, 30, 40, 50, 60] and len(out["rows"][0]) == len(out["columns"])
    assert len(debrief.samples(log, 0, 1e9, 0.1)["rows"]) <= debrief.MAX_ROWS + 1
    json.dumps(out)  # kan sendes som JSON


def test_terrengprofil_fra_flisene():
    p = debrief.terrain_profile(debrief.load("autopilot.json", FLIGHTS))
    assert p["area"] == "kjevik"
    # flyet lander: klaringen ender nær null, og er aldri negativ
    assert all(r["clearanceM"] > 0 for r in p["profile"])
    assert p["profile"][-1]["clearanceM"] < 5
    assert 20 < p["lowestClearanceBeforeThreshold"]["clearanceM"] < 200
