"""Analysene, mot tilfeller der svaret kan regnes for hånd."""

import math

import numpy as np
import pytest

from flypipe import analysis


def test_flatt_hav_ses_til_horisonten_og_ikke_lenger():
    cell, eye = 100.0, 30.0
    hgt = np.zeros((11, 400), dtype=np.float32)  # 40 km stripe
    need = analysis.required_altitude(hgt, cell, 0.5, 5.5, eye)
    k = (1 - analysis.REFRACTION) / (2 * analysis.EARTH_RADIUS_M)
    horizon = math.sqrt(eye / k)  # 21,0 km med brytning; 19,5 km uten
    assert 20_500 < horizon < 21_500
    row = need[5]
    dist = (np.arange(400) + 0.5 - 0.5) * cell
    assert np.all(row[dist < horizon - 500] == 0)  # havflata ses
    # bak horisonten må punktet opp: høyden følger (d - horisont)^2 * k
    for d in (25_000, 35_000):
        i = int(d / cell)
        assert row[i] == pytest.approx((dist[i] - horizon) ** 2 * k, abs=1.5)


def test_en_vegg_skygger_bak_seg_men_ikke_til_siden():
    cell, eye = 10.0, 10.0
    hgt = np.zeros((101, 201), dtype=np.float32)
    hgt[40:61, 60] = 100  # 200 m bred vegg, 100 m høy, 500 m øst for øyet
    need = analysis.required_altitude(hgt, cell, 10.5, 50.5, eye)
    # rett bak veggen, 1000 m fra øyet: siktlinja over veggtoppen har steget dobbelt så høyt som ved veggen
    assert need[50, 110] == pytest.approx(eye + (100 - eye) * 1000 / 500, rel=0.03)
    assert need[50, 59] == 0  # foran veggen ses bakken
    assert need[50, 60] == 100  # veggen selv ses (toppen)
    assert need[5, 110] == 0 and need[95, 110] == 0  # til siden for skyggen
    # symmetrisk om øst-vest-aksen gjennom øyet (fanger feil i asimut og y-retning)
    assert np.allclose(need[40:61, 61:200], need[40:61, 61:200][::-1], atol=3)


def test_y_oker_mot_sor():
    # en topp NORD for øyet (lavere radnummer) skal skygge nord for seg, ikke sør
    hgt = np.zeros((101, 101), dtype=np.float32)
    hgt[30, 45:56] = 80
    need = analysis.required_altitude(hgt, 10.0, 50.5, 50.5, 5.0)
    assert need[10, 50] > 100 and need[90, 50] == 0


def test_glidebane_og_klaring():
    cell = 10.0
    hgt = np.full((400, 1200), 5.0, dtype=np.float32)
    # bane rett østover langs rad 200; baneenden i x=1000, innflyging fra vest
    end = {"x": 1000.0, "y": 200.0, "headingGridDeg": 90.0, "displacedThresholdM": 0.0}
    tan3 = math.tan(math.radians(3))
    assert analysis.glide_path_altitude(end, hgt, cell, 8000) == pytest.approx(5 + 8300 * tan3, abs=0.01)
    top = analysis.surface_top(hgt, [[600, 200, 2, 5, 200, 0, 0, 0], [500, 300, 2, 5, 400, 0, 0, 0]])
    f = analysis.approach_facts(end, hgt, top, None, cell)
    # bygget på 200 m står 4 km før baneenden, rett under glidebanen; det på 400 m står 1 km til siden og teller ikke
    assert f["lowestClearanceAtM"] == pytest.approx(4000, abs=10)
    assert f["lowestClearanceM"] == pytest.approx(5 + 4300 * tan3 - 200, abs=1)
    assert f["startAltitudeM"] == pytest.approx(440.0, abs=0.1)


def test_klynger():
    rng = np.random.default_rng(1)
    village = rng.normal((1000, 1000), 40, (60, 2))
    hamlet = rng.normal((5000, 2000), 30, (8, 2))
    farms = np.array([[9000.0, 9000.0], [12000.0, 500.0], [300.0, 7000.0]])
    labels = analysis.building_clusters(np.vstack([village, hamlet, farms]), analysis.CLUSTER_EPS_GENERALISED_M)
    assert len(set(labels[:60])) == 1 and labels[0] >= 0
    assert len(set(labels[60:68])) == 1 and labels[60] not in (-1, labels[0])
    assert list(labels[68:]) == [-1, -1, -1]
    s = analysis.cluster_summary(labels)
    assert s["clusters"] == 2 and s["largestCluster"] == 60 and s["buildings"] == 71
    assert analysis.cluster_summary(analysis.building_clusters(np.zeros((0, 2))))["clusters"] == 0


def test_synlighet_mot_uavhengig_siktlinje_paa_ekte_terreng():
    """Rasteret fra strålemetoden mot en enkel siktlinje regnet punkt for punkt, i tilfeldige celler ved Kjevik."""
    import json
    from pathlib import Path

    tiles = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "kjevik"
    meta = json.loads((tiles / "metadata.json").read_text(encoding="utf-8"))
    hgt = np.fromfile(tiles / "heightmap.f32", dtype="<f4").reshape(meta["height"], meta["width"])
    tower, cell = meta["airports"][0]["tower"], meta["cellSize"]
    need = analysis.required_altitude(hgt, cell, tower["x"], tower["y"], tower["eyeM"])
    k = (1 - analysis.REFRACTION) / (2 * analysis.EARTH_RADIUS_M)
    rng = np.random.default_rng(3)
    agree = total = 0
    for col, row in zip(rng.integers(0, meta["width"], 400), rng.integers(0, meta["height"], 400)):
        dx, dy = col + 0.5 - tower["x"], row + 0.5 - tower["y"]
        n = int(np.hypot(dx, dy) * 2)
        if n < 20:
            continue
        t = (np.arange(1, n) / n)[:, None]
        xs, ys = tower["x"] + dx * t[:, 0], tower["y"] + dy * t[:, 0]
        d = np.hypot(xs - tower["x"], ys - tower["y"]) * cell
        ground = np.maximum(hgt[ys.astype(int), xs.astype(int)], 0) - d**2 * k
        dist = np.hypot(dx, dy) * cell
        steepest = ((ground - tower["eyeM"]) / d).max()
        expected = max(tower["eyeM"] + steepest * dist + dist**2 * k, max(hgt[row, col], 0))
        total += 1
        agree += abs(need[row, col] - expected) < max(15, 0.1 * (expected - max(hgt[row, col], 0)))
    # de to metodene leser terrenget i ulike punkter, så noen celler ved kanten av en skygge skiller seg
    assert total > 350 and agree / total > 0.9
    # og tallene i metadata er de samme som regnes her
    assert meta["analysis"]["towerViewshed"]["groundSeenShare"] == round(float((need - np.maximum(hgt, 0) < 1).mean()), 3)
