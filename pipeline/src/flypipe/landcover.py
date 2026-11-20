"""Arealdekke fra N50 Kartdata -> palettindeks per celle.

Polygonene rasteriseres først til 10 m, og hver 50 m-celle får den klassen
som dekker mest av cella (flertall av 25 delceller). Se docs/resampling.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
from rasterio.features import rasterize

from .grid import GridSpec

RGB = tuple[int, int, int]


@dataclass(frozen=True)
class LandClass:
    code: int
    name: str
    objtypes: tuple[str, ...]
    colors: tuple[RGB, RGB]  # veksles med støy for tekstur
    water: bool = False
    shaded: bool = True  # ganges med hillshade
    rock_when_steep: bool = False


UNKNOWN = 0
CLASSES = [
    LandClass(0, "Ukjent", (), ((0, 0, 0), (0, 0, 0))),  # farges med høydebånd
    LandClass(1, "Havflate", ("Havflate",), ((45, 110, 150), (45, 110, 150)), water=True, shaded=False),
    LandClass(2, "Innsjø", ("Innsjø", "InnsjøRegulert"), ((58, 128, 170), (58, 128, 170)), water=True, shaded=False),
    LandClass(3, "Elv", ("Elv", "ElvBekk"), ((58, 128, 170), (58, 128, 170)), water=True, shaded=False),
    LandClass(4, "Skog", ("Skog",), ((52, 110, 58), (40, 92, 50)), rock_when_steep=True),
    LandClass(5, "Åpent område", ("ÅpentOmråde", "FerskvannTørrfall"), ((122, 132, 74), (104, 118, 66)), rock_when_steep=True),
    LandClass(6, "Myr", ("Myr",), ((138, 122, 72), (122, 110, 64))),
    LandClass(7, "Dyrket mark", ("DyrketMark",), ((182, 184, 96), (166, 172, 86))),
    LandClass(8, "Tettbebyggelse", ("Tettbebyggelse",), ((150, 148, 132), (126, 140, 108))),
    LandClass(9, "Bymessig bebyggelse", ("BymessigBebyggelse",), ((162, 158, 152), (142, 138, 134))),
    LandClass(10, "Industriområde", ("Industriområde",), ((150, 150, 158), (134, 134, 144))),
    LandClass(11, "Lufthavn", ("Lufthavn",), ((112, 132, 92), (104, 124, 86))),
    LandClass(12, "Gress og anlegg", ("Golfbane", "Park", "SportIdrettPlass", "Gravplass", "Alpinbakke"), ((100, 154, 72), (88, 140, 64))),
    LandClass(13, "Steinbrudd", ("Steinbrudd", "Steintipp"), ((152, 146, 138), (140, 134, 126))),
    LandClass(14, "Snø og isbre", ("SnøIsbre",), ((236, 238, 242), (226, 230, 236))),
    LandClass(15, "Rullebane og oppstilling", ("Rullebane",), ((98, 100, 106), (98, 100, 106))),
]
WATER_CODES = [c.code for c in CLASSES if c.water]

# Overflateklasser: arealdekket pluss det som er lagt oppå det. Brukes av spillet
# til å velge detaljmønster på bakken; landcover.bin selv er rent N50-arealdekke.
SURFACE_ROAD = 16
SURFACE_RUNWAY = 17


def surface_classes(road: RGB, runway: RGB) -> list[dict]:
    """Klasseliste for surface.bin: kode, navn og middelfarge (til skarpe flater på nært hold)."""
    out = [
        {"code": c.code, "name": c.name, "color": [round((a + b) / 2) for a, b in zip(*c.colors)]}
        for c in CLASSES
    ]
    out[UNKNOWN]["color"] = [112, 122, 92]
    out.append({"code": SURFACE_ROAD, "name": "Vei", "color": list(road)})
    out.append({"code": SURFACE_RUNWAY, "name": "Rullebane (OurAirports)", "color": list(runway)})
    return out
_BY_OBJTYPE = {o: c.code for c in CLASSES for o in c.objtypes}
SUBCELL = 10.0  # m


def majority(codes: np.ndarray, factor: int) -> np.ndarray:
    """Flertallsklasse per factor x factor-blokk. Ved likt antall vinner laveste kode."""
    h, w = codes.shape
    blocks = codes.reshape(h // factor, factor, w // factor, factor)
    counts = np.stack([(blocks == c.code).sum(axis=(1, 3)) for c in CLASSES])
    return counts.argmax(axis=0).astype(np.uint8)


def rasterize_landcover(polygons: gpd.GeoDataFrame, grid: GridSpec) -> np.ndarray:
    """Arealdekke-polygoner (kolonne `objtype`) -> klassekode per spillcelle."""
    unknown = sorted(set(polygons["objtype"]) - set(_BY_OBJTYPE))
    if unknown:
        print(f"  arealdekke: objekttyper uten klasse (blir Ukjent): {unknown}")
    factor = int(grid.cell / SUBCELL)
    fine = GridSpec(grid.west, grid.north, SUBCELL, grid.width * factor, grid.height * factor)
    # Rullebane ligger oppå Lufthavn-flaten: sorter så høyeste kode brennes sist
    known = polygons[polygons["objtype"].isin(_BY_OBJTYPE)]
    shapes = sorted(((_BY_OBJTYPE[o], g) for o, g in zip(known["objtype"], known.geometry) if g is not None), key=lambda s: s[0])
    codes = rasterize(
        [(g, code) for code, g in shapes], out_shape=(fine.height, fine.width), transform=fine.transform, fill=UNKNOWN, dtype="uint8"
    )
    return majority(codes, factor)


def load_landcover(gdb: Path, grid: GridSpec) -> np.ndarray:
    polygons = gpd.read_file(gdb, layer="N50_Arealdekke_omrade", bbox=(grid.west, grid.south, grid.east, grid.north), engine="pyogrio")
    assert polygons.crs is not None and polygons.crs.to_epsg() == 25833, polygons.crs
    return rasterize_landcover(polygons, grid)
