"""Bygningspunkter fra Matrikkelen: høyde etter type, og hva som ender i 10 m-flisene."""

import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pytest
from shapely.geometry import Point

from flypipe import matrikkel
from flypipe.grid import GridSpec

TILES = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


def test_nominell_hoyde_folger_bygningstypen():
    # enebolig, rekkehus, boligblokk, fritidsbolig, lager, kontor, ukjent kode
    h = matrikkel.nominal_height(np.array([111, 131, 142, 161, 231, 311, 999]))
    assert list(h) == [7.0, 8.0, 14.0, 5.0, 9.0, 12.0, matrikkel.HEIGHT_DEFAULT]
    assert h[2] > h[0] > h[3]


def test_hoyderaster_y_oker_mot_sor_og_hoyeste_bygg_vinner():
    grid = GridSpec(west=1000.0, north=5000.0, cell=10.0, width=20, height=10)
    b = gpd.GeoDataFrame(
        {"height": [7.0, 14.0, 5.0]},
        # to bygg i samme celle helt i nordvest, ett i sørøst
        geometry=[Point(1003, 4997), Point(1008, 4992), Point(1195, 4905)], crs=25833,
    )
    r = matrikkel.height_raster(b, grid)
    assert r[0, 0] == 14.0 and r[9, 19] == 5.0
    assert np.isnan(r).sum() == r.size - 2


@pytest.mark.parametrize("area", ["kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10"])
def test_flisene_har_alle_bygg_ogsaa_i_tettbebyggelse(area):
    if not (TILES / area / "metadata.json").exists():
        pytest.skip(f"{area} er ikke bygget")
    meta = json.loads((TILES / area / "metadata.json").read_text(encoding="utf-8"))
    assert meta["features"]["buildingSource"].startswith("Matrikkelen")
    assert "Matrikkelen" in meta["attribution"][0]
    items = json.loads((TILES / area / "structures.json").read_text(encoding="utf-8"))["items"]
    lc = np.fromfile(TILES / area / "landcover.bin", dtype=np.uint8).reshape(meta["height"], meta["width"])
    code = {c["name"]: c["code"] for c in meta["landcover"]["classes"]}
    buildings = np.array([(it[1], it[0], it[4] - it[3]) for it in items if it[2] == 1])
    cls = lc[buildings[:, 0].astype(int), buildings[:, 1].astype(int)]
    # N50 hadde ingen enkelthus i tettbebyggelse: nå står en stor del av byggene der
    assert (cls == code["Tettbebyggelse"]).mean() > 0.25
    # ingen bygg i sjøen (punktet kan ligge på kaikanten: noen få tåles)
    assert (cls == code["Havflate"]).mean() < 0.01
    # høydene er rimelige: nominelle 5-14 m for småhus, opptil 80 m målt for store bygg
    assert 3.9 <= buildings[:, 2].min() and buildings[:, 2].max() <= 80.5
    assert 5 < np.median(buildings[:, 2]) < 10


def test_kirketaarn_leses_ut_av_overflatemodellen(monkeypatch, tmp_path):
    """Et smalt, høyt punkt ved kirka er et tårn. Et stort flatt tak og et lavt kapell er det ikke."""
    from rasterio import Affine

    from flypipe import dtm, structures

    grid = GridSpec(west=0.0, north=2000.0, cell=10.0, width=200, height=200)
    hgt = np.full((200, 200), 20.0, dtype=np.float32)

    def fake_dom(west, south, east, north, raw_dir):
        dom = np.full((north - south, east - west), 20.0, dtype=np.float32)
        rows, cols = np.indices(dom.shape)
        e, n = west + cols + 0.5, north - rows - 0.5
        dom[(abs(e - 512) < 2) & (abs(n - 1495) < 2)] = 20 + 31  # tårn 12 m øst og 5 m sør for kirke A
        dom[(abs(e - 1000) < 15) & (abs(n - 1000) < 15)] = 20 + 25  # kirke B: høyt, men 900 m2 flatt tak
        dom[(abs(e - 1500) < 2) & (abs(n - 500) < 2)] = 20 + 11  # kirke C: lavt kapell
        return dom, Affine(1, 0, west, 0, -1, north)

    monkeypatch.setattr(dtm, "load_dom_window", fake_dom)
    churches = gpd.GeoDataFrame(geometry=[Point(500, 1500), Point(1000, 1000), Point(1500, 500), Point(505, 1505), Point(5, 5)], crs=25833)
    towers = structures.church_towers(churches, hgt, grid, tmp_path)
    # A og punktet 7 m unna (D) finner samme tårn: ett tårn. B og C har ikke tårn. Punktet i kartkanten hoppes over.
    assert len(towers) == 1
    x, y, base, top = towers[0]
    assert (x * 10, 2000 - y * 10) == pytest.approx((512, 1495), abs=1.5)  # y øker mot sør i rutenettet
    assert (base, top) == (20.0, 51.0)


def test_tarnene_i_flisene_staar_ved_en_kirke():
    area = TILES / "kjevik10"
    if not (area / "metadata.json").exists():
        pytest.skip("kjevik10 er ikke bygget")
    meta = json.loads((area / "metadata.json").read_text(encoding="utf-8"))
    s = json.loads((area / "structures.json").read_text(encoding="utf-8"))
    towers = s["churchTowers"]
    assert meta["structures"]["churchTowers"] == len(towers) and 5 <= len(towers) <= meta["structures"]["churches"]
    buildings = {(it[0], it[1]) for it in s["items"] if it[2] == 1}
    for x, y, base, top in towers:
        assert 16 <= top - base <= 80
        # tårnet står i eller inntil en bygningscelle
        assert any((int(x) + dx, int(y) + dy) in buildings for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2))
    # Kristiansand domkirke: det høyeste tårnet, midt i Kvadraturen
    x, y, base, top = max(towers, key=lambda t: t[3] - t[2])
    east, north = meta["bbox"]["west"] + x * 10, meta["bbox"]["north"] - y * 10
    assert abs(east - 88086) < 30 and abs(north - 6466410) < 30 and top - base > 50


def test_fargeprofil_og_type_per_celle():
    from shapely.geometry import box

    assert matrikkel.profile(111)[0] == "houses" and matrikkel.profile(142)[0] == "apartment blocks"
    assert matrikkel.profile(161)[0] == "holiday homes" and matrikkel.profile(231)[0] == "industry and storage"
    assert matrikkel.profile(322)[0] == "offices and shops" and matrikkel.profile(613)[0] == "schools and culture"
    assert matrikkel.profile(651)[0] == "sports" and matrikkel.profile(671)[0] == "churches"
    assert matrikkel.profile(999)[0] == "other"
    # alle profiler har to gyldige farger, og ingen to hovedgrupper har samme
    profiles = [*matrikkel.PROFILE_BY_MAIN.values(), *matrikkel.PROFILE_BY_GROUP.values()]
    assert all(len(c) == 2 and all(0 <= v <= 255 for rgb in c for v in rgb) for _, c in profiles)
    assert len({c[0] for _, c in matrikkel.PROFILE_BY_MAIN.values()}) == len(matrikkel.PROFILE_BY_MAIN)

    grid = GridSpec(west=0.0, north=100.0, cell=10.0, width=10, height=10)
    points = gpd.GeoDataFrame({"bygningstype": [322, 111, 613]}, geometry=[Point(25, 75), Point(85, 15), Point(55, 55)], crs=25833)
    # et stort bygg (30 x 20 m) rundt butikken, og et uten noe punkt i seg
    areas = gpd.GeoDataFrame(geometry=[box(10, 60, 40, 80), box(60, 60, 90, 90)], crs=25833)
    t = matrikkel.type_raster(points, areas, grid)
    assert (t[2:4, 1:4] == 322).all()  # hele flaten får butikkens type; rad 2-3 = nord 60-80
    assert t[8, 8] == 111 and t[4, 5] == 613
    assert (t[1:4, 6:9] == 0).all()  # flaten uten punkt er ukjent


def test_fyr_i_flisene():
    """Oksøy og Grønningen fyr: tårnhøyden målt i overflatemodellen mot det som er kjent om fyrene."""
    area = TILES / "kjevik10"
    if not (area / "metadata.json").exists():
        pytest.skip("kjevik10 er ikke bygget")
    meta = json.loads((area / "metadata.json").read_text(encoding="utf-8"))
    s = json.loads((area / "structures.json").read_text(encoding="utf-8"))
    names = {(round(n[1]), round(n[2])): n[0] for n in json.loads((area / "names.json").read_text(encoding="utf-8"))["items"] if n[5] in ("fyrstasjon", "fyrlykt")}
    by_name = {names.get((round(x), round(y))): (top - base, tower) for x, y, base, top, tower in s["lighthouses"]}
    assert meta["structures"]["lighthouses"] == len(s["lighthouses"]) == 8
    # Oksøy fyr er 36 m høyt og Grønningen 14 m, slik jeg husker det (ikke slått opp i Norsk fyrliste)
    assert by_name["Oksøy"] == (pytest.approx(36, abs=1.5), 1)
    assert by_name["Grønningen"] == (pytest.approx(14, abs=1.5), 1)
    # lyktene har nominell høyde og er ikke tårn
    assert by_name["Odderøya"] == (pytest.approx(5.0), 0)


def test_bygg_med_form_fra_omriss(tmp_path):
    """Omriss + type + høyde: stort bygg får høyde fra DOM, lite fra etasjer eller type, uthus tas ikke med."""
    import struct

    from flypipe import footprints, osm

    grid = GridSpec(west=0.0, north=1000.0, cell=10.0, width=100, height=100)
    hgt = np.full((100, 100), 20.0, dtype=np.float32)
    hgt[:, 50:] = 30.0  # terrenget er 10 m høyere i øst
    ndsm = np.full((100, 100), 2.0, dtype=np.float32)
    ndsm[10:14, 10:15] = 18.0  # et 18 m høyt bygg på 50 x 40 m
    rings = [
        [(100, 900), (150, 900), (150, 860), (100, 860)],  # 0: stort, kontor (type 311)
        [(300, 500), (308, 500), (308, 492), (300, 492)],  # 1: lite hus med 3 etasjer
        [(600, 300), (609, 300), (609, 291), (600, 291)],  # 2: lite hus uten annet enn type (enebolig)
        [(700, 700), (706, 700), (706, 694), (700, 694)],  # 3: garasje (type 181)
        [(490, 200), (520, 200), (520, 190), (490, 190)],  # 4: over terrengspranget, ukjent type
    ]
    fp = osm.Footprints(
        xy=np.array([p for r in rings for p in r], dtype=float), start=np.arange(0, 21, 4),
        ref=np.array([11, 22, 33, 44, 0]), levels=np.array([0, 3, 0, 0, 0]), fetched="2026-11-21",
    )
    out, used = footprints.build(fp, {11: 311, 22: 111, 33: 111, 44: 181}, hgt, ndsm, grid)
    assert list(used) == [True, True, True, False, True]
    big, storeys, nominal, slope = out
    assert (big["height_source"], big["top"] - 20) == ("dom", 18.0) and big["profile"] == "offices and shops" and len(big["cells"]) == 20
    assert (storeys["height_source"], storeys["top"] - 20) == ("levels", 10.0) and len(storeys["cells"]) == 1
    assert (nominal["height_source"], nominal["top"] - 30) == ("nominal", 7.0) and nominal["profile"] == "houses"  # står på 30 m-terrenget
    # veggene går ned til laveste terreng under bygget
    assert slope["base"] == 20.0 and slope["profile"] == "other"

    # fila spillet leser: hode, så hvert bygg med hjørner i meter fra nordvestre hjørne (z mot sør)
    footprints.write(tmp_path / "b.bin", out, grid)
    raw = (tmp_path / "b.bin").read_bytes()
    assert raw[:4] == b"FBLD" and struct.unpack_from("<II", raw, 4) == (1, 4)
    n, r, g, b, _, base, top = struct.unpack_from("<H4Bff", raw, 12)
    assert (n, base, top) == (4, 20.0, 38.0) and (r, g, b) in matrikkel.PROFILE_BY_MAIN[3][1]
    assert struct.unpack_from("<8f", raw, 26) == (100, 100, 150, 100, 150, 140, 100, 140)
    assert len(raw) == 12 + 4 * (14 + 4 * 8)


def test_matrikkelbygg_uten_omriss_blir_bokser():
    from flypipe import footprints, osm

    fp = osm.Footprints(xy=np.array([(0, 0), (10, 0), (10, 10), (0, 10)], dtype=float), start=np.array([0, 4]), ref=np.array([7]), levels=np.array([0]), fetched="")
    points = gpd.GeoDataFrame({"bygningsnummer": [7, 8, 9]}, geometry=[Point(500, 500), Point(8, 8), Point(300, 300)], crs=25833)
    left = footprints.unmatched(points, fp, np.array([True]))
    # 7 har omriss (samme nummer, selv om punktet ligger langt unna), 8 ligger i omrisset, 9 har ingenting
    assert list(left["bygningsnummer"]) == [9]
