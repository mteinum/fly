import math

import pytest
from pyproj import Proj

from flypipe.crs import grid_bearing_deg, grid_convergence_deg, scale_factor, utm33_to_wgs84, wgs84_to_utm33


def test_wgs84_to_utm33_matches_kartverket(reference):
    tol = reference["transform"]["toleranceM"]
    for p in reference["transform"]["points"]:
        e, n = wgs84_to_utm33(p["lon"], p["lat"])
        assert math.hypot(e - p["east"], n - p["north"]) < tol, p["name"]


def test_matches_place_name_register_within_rounding(reference):
    # SSR oppgir lon/lat med 5 desimaler (~1 m), så her er toleransen 1 m
    for p in reference["transform"]["points"]:
        if "ssrEast" in p:
            e, n = wgs84_to_utm33(p["lon"], p["lat"])
            assert math.hypot(e - p["ssrEast"], n - p["ssrNorth"]) < 1.0, p["name"]


def test_roundtrip(reference):
    for p in reference["transform"]["points"]:
        lon, lat = utm33_to_wgs84(*wgs84_to_utm33(p["lon"], p["lat"]))
        assert lon == pytest.approx(p["lon"], abs=1e-8)
        assert lat == pytest.approx(p["lat"], abs=1e-8)


def test_axis_order_is_lon_lat():
    # Byttes lon/lat havner punktet langt unna Norge; øst skal være ~94 km, nord ~6472 km
    e, n = wgs84_to_utm33(8.08537, 58.204201)
    assert 90_000 < e < 100_000
    assert 6_470_000 < n < 6_475_000


def test_grid_bearing_is_clockwise_from_north():
    assert grid_bearing_deg(0, 0, 0, 1) == pytest.approx(0)
    assert grid_bearing_deg(0, 0, 1, 0) == pytest.approx(90)
    assert grid_bearing_deg(0, 0, 0, -1) == pytest.approx(180)
    assert grid_bearing_deg(0, 0, -1, 0) == pytest.approx(270)


def test_convergence_sign_and_size_at_kjevik():
    e, n = wgs84_to_utm33(8.08537, 58.204201)
    conv = grid_convergence_deg(e, n)
    # Vest for sentralmeridianen: rutenett-nord peker vest for sann nord
    assert conv == pytest.approx(-5.89, abs=0.02)
    # Uavhengig kontroll mot PROJ sin analytiske verdi
    proj = Proj("EPSG:25833")
    assert conv == pytest.approx(proj.get_factors(8.08537, 58.204201).meridian_convergence, abs=0.01)
    assert grid_convergence_deg(*wgs84_to_utm33(15.0, 60.0)) == pytest.approx(0, abs=1e-6)
    assert grid_convergence_deg(*wgs84_to_utm33(20.0, 60.0)) > 0


def test_runway_grid_heading_is_true_heading_minus_convergence(reference):
    # Bane 03 ved ENCN: 35° sann (OurAirports). I rutenettet skal den være ~40,9°.
    le = wgs84_to_utm33(8.07541, 58.196701)
    he = wgs84_to_utm33(8.09527, 58.2117)
    grid_hdg = grid_bearing_deg(*le, *he)
    conv = grid_convergence_deg(*le)
    assert grid_hdg + conv == pytest.approx(35.0, abs=0.3)
    assert grid_hdg == pytest.approx(40.8, abs=0.3)


def test_scale_factor_at_kjevik():
    e, n = wgs84_to_utm33(8.08537, 58.204201)
    assert scale_factor(e, n) == pytest.approx(1.0016, abs=0.0002)
