"""CRS-regler samlet på ett sted.

Arbeidsprojeksjon: EUREF89 UTM 33 (EPSG:25833). Alt som kommer inn i WGS84
(EPSG:4326) transformeres her, og bare her. always_xy=True overalt, så
rekkefølgen er alltid (lon, lat) og (øst, nord) - aldri (lat, lon).

WGS84 og ETRS89 behandles som sammenfallende (pyproj bruker
nulltransformasjon). Avviket er under 1 m og uten betydning på 50 m-celler.
"""

from __future__ import annotations

import math

from pyproj import Geod, Transformer

WGS84 = "EPSG:4326"
UTM33 = "EPSG:25833"

_to_utm = Transformer.from_crs(WGS84, UTM33, always_xy=True)
_to_wgs = Transformer.from_crs(UTM33, WGS84, always_xy=True)
_geod = Geod(ellps="GRS80")


def wgs84_to_utm33(lon: float, lat: float) -> tuple[float, float]:
    """(lon, lat) i grader -> (øst, nord) i meter."""
    return _to_utm.transform(lon, lat)


def utm33_to_wgs84(east: float, north: float) -> tuple[float, float]:
    """(øst, nord) i meter -> (lon, lat) i grader."""
    return _to_wgs.transform(east, north)


def grid_bearing_deg(e0: float, n0: float, e1: float, n1: float) -> float:
    """Retning i rutenettet fra punkt 0 til punkt 1, grader med klokka fra rutenett-nord."""
    return math.degrees(math.atan2(e1 - e0, n1 - n0)) % 360.0


def grid_convergence_deg(east: float, north: float) -> float:
    """Meridiankonvergens i punktet, definert slik at

        sann retning = rutenettretning + konvergens

    Beregnes numerisk: gå 1 km mot sann nord langs geodeten og mål retningen
    i rutenettet. Vest for sentralmeridianen (15° Ø) er verdien negativ.
    Kjevik ligger nesten 7° vest for sentralmeridianen, så dette er ca. -5,9°
    og kan ikke ignoreres.
    """
    lon, lat = utm33_to_wgs84(east, north)
    lon1, lat1, _ = _geod.fwd(lon, lat, 0.0, 1000.0)
    e1, n1 = wgs84_to_utm33(lon1, lat1)
    true_north_in_grid = math.degrees(math.atan2(e1 - east, n1 - north))
    return -true_north_in_grid


def scale_factor(east: float, north: float) -> float:
    """Målestokkfaktor (rutenettavstand / avstand på ellipsoiden) i punktet."""
    lon, lat = utm33_to_wgs84(east, north)
    lon1, lat1, _ = _geod.fwd(lon, lat, 90.0, 1000.0)
    e1, n1 = wgs84_to_utm33(lon1, lat1)
    return math.hypot(e1 - east, n1 - north) / 1000.0
