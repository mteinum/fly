"""Bussholdeplasser fra Enturs stoppestedsregister: utvalget og koordinatene."""

from flypipe import crs, entur
from flypipe.grid import GridSpec

GRID = GridSpec.centered(88000.0, 6466000.0, 10.0, 400)  # 4 x 4 km rundt Kristiansand sentrum


def _place(id: str, name: str, east: float, north: float, modes: list[str] | None) -> dict:
    lon, lat = crs.utm33_to_wgs84(east, north)
    return {"id": id, "name": name, "latitude": float(lat), "longitude": float(lon), "transportMode": modes}


def test_bare_stoppesteder_for_buss_innenfor_utsnittet_og_ett_per_id():
    stops = entur.bus_stops([
        _place("NSR:StopPlace:2", "Rådhuset", 88100, 6466400, ["bus"]),
        _place("NSR:StopPlace:1", "Rutebilstasjonen", 87700, 6466300, ["bus", "rail"]),
        _place("NSR:StopPlace:1", "Rutebilstasjonen", 87700, 6466300, ["bus", "rail"]),  # samme sted fra naboruta
        _place("NSR:StopPlace:3", "Kai 6", 88300, 6465900, ["water"]),
        _place("NSR:StopPlace:4", "Arendal", 140000, 6490000, ["bus"]),
        _place("NSR:StopPlace:5", "Ukjent", 88000, 6466000, None),
        _place("NSR:StopPlace:6", "Ekspressen", 88050, 6466050, ["coach"]),
    ], GRID)
    assert [s["id"] for s in stops] == ["NSR:StopPlace:1", "NSR:StopPlace:2", "NSR:StopPlace:6"]
    e, n = stops[1]["at"]
    assert abs(e - 88100) < 0.2 and abs(n - 6466400) < 0.2
    assert stops[1]["name"] == "Rådhuset"
