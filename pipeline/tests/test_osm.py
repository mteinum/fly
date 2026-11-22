"""Omriss fra OpenStreetMap: at relasjoner med delt ytre omriss blir hele bygg."""

from flypipe import osm

P = lambda lon, lat: {"lon": lon, "lat": lat}


def test_way_is_its_own_ring():
    g = [P(0, 0), P(1, 0), P(1, 1), P(0, 0)]
    assert osm._rings({"type": "way", "geometry": g}) == [g]


def test_relation_with_outer_split_over_several_ways_is_joined():
    # et kvadrat delt i tre veier som ikke er lukket hver for seg, slik Slottet er kartlagt
    members = [
        {"role": "outer", "geometry": [P(0, 0), P(2, 0), P(2, 2)]},
        {"role": "outer", "geometry": [P(2, 2), P(0, 2)]},
        {"role": "outer", "geometry": [P(0, 2), P(0, 0)]},
        {"role": "inner", "geometry": [P(0.5, 0.5), P(1, 0.5), P(1, 1), P(0.5, 0.5)]},  # gårdsrom: tas ikke med
    ]
    rings = osm._rings({"type": "relation", "members": members})
    assert len(rings) == 1
    assert {(p["lon"], p["lat"]) for p in rings[0]} == {(0, 0), (2, 0), (2, 2), (0, 2)}
    assert rings[0][0] == rings[0][-1]


def test_relation_keeps_closed_outers_and_drops_loose_ends():
    closed = [P(5, 5), P(6, 5), P(6, 6), P(5, 5)]
    members = [{"role": "outer", "geometry": closed}, {"role": "outer", "geometry": [P(0, 0), P(1, 0)]}]
    assert osm._rings({"type": "relation", "members": members}) == [closed]
