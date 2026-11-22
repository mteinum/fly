"""T-bane, trikk og bybane fra OpenStreetMap: tolkingen av Overpass-elementene."""

from flypipe import crs, osm
from flypipe.grid import GridSpec

GRID = GridSpec.centered(262000.0, 6650000.0, 10.0, 400)  # 4 x 4 km rundt Oslo sentrum


def _node(east: float, north: float) -> dict:
    lon, lat = crs.utm33_to_wgs84(east, north)
    return {"lon": float(lon), "lat": float(lat)}


def _way(id: int, tags: dict, points: list[tuple[float, float]]) -> dict:
    return {"type": "way", "id": id, "tags": tags, "geometry": [_node(*p) for p in points]}


def _stop(id: int, name: str, east: float, north: float) -> dict:
    return {"type": "node", "id": id, "tags": {"railway": "station", "name": name}, **_node(east, north)}


def test_spor_faar_slag_og_tunnel_og_sidespor_tas_ikke_med():
    out = osm.rails_from_elements([
        _way(1, {"railway": "subway", "tunnel": "yes"}, [(261000, 6650000), (262000, 6650000)]),
        _way(2, {"railway": "tram"}, [(261000, 6650500), (262000, 6650500)]),
        _way(3, {"railway": "subway", "service": "yard"}, [(261000, 6651000), (262000, 6651000)]),
        _way(4, {"railway": "rail"}, [(261000, 6649000), (262000, 6649000)]),
    ], GRID)
    assert [(t["id"], t["kind"], t["tunnel"]) for t in out["tracks"]] == [(1, "metro", True), (2, "tram", False)]
    (e, n), _ = out["tracks"][0]["line"]
    assert abs(e - 261000) < 0.2 and abs(n - 6650000) < 0.2


def test_et_spor_som_gaar_ut_av_utsnittet_deles():
    # inne, ute (øst for kanten på 264 000), inne igjen
    out = osm.rails_from_elements([_way(1, {"railway": "tram"}, [(263000, 6650000), (263900, 6650000), (264500, 6650000), (263900, 6650300), (263000, 6650300)])], GRID)
    assert [len(t["line"]) for t in out["tracks"]] == [2, 2]


def test_holdeplasser_faar_slaget_til_naermeste_spor_og_en_per_navn():
    out = osm.rails_from_elements([
        _way(1, {"railway": "subway"}, [(261000, 6650000), (262000, 6650000)]),
        _way(2, {"railway": "tram"}, [(261000, 6650500), (262000, 6650500)]),
        _stop(10, "Majorstuen", 261500, 6650010),
        _stop(11, "Majorstuen", 261500, 6649990),   # den andre retningen
        _stop(12, "Majorstuen", 261500, 6650490),   # trikkeholdeplassen med samme navn
        _stop(13, "Oslo S", 261500, 6649000),       # jernbanestasjon, langt fra sporene våre
        {"type": "node", "id": 14, "tags": {"railway": "station"}, **_node(261600, 6650000)},  # uten navn
    ], GRID)
    assert [(s["id"], s["kind"], s["name"]) for s in out["stops"]] == [(10, "metro", "Majorstuen"), (12, "tram", "Majorstuen")]


def test_bybane_blir_trikk_der_utsnittet_har_trikk_og_forblir_bybane_ellers():
    way = _way(1, {"railway": "light_rail"}, [(261000, 6650000), (262000, 6650000)])
    assert osm.rails_from_elements([way], GRID)["tracks"][0]["kind"] == "lightrail"
    with_tram = osm.rails_from_elements([way, _way(2, {"railway": "tram"}, [(261000, 6650500), (262000, 6650500)])], GRID)
    assert {t["kind"] for t in with_tram["tracks"]} == {"tram"}
