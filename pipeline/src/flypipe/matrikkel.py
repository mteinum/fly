"""Matrikkelen - Bygningspunkt (Kartverket): ett punkt per bygning, med bygningstype.

Kilde: fylkesfil i FGDB-format, EPSG:25833, fra Geonorge (CC BY 4.0):
  https://nedlasting.geonorge.no/geonorge/Basisdata/MatrikkelenBygning/FGDB/
Fila caches i data/raw/matrikkel/ (40 MB for Agder).

N50 har bare et utvalg av bygningene og ingen enkelthus i by og tettsted. Matrikkelen har alle:
57 883 i Kjevik-utsnittet mot 8 098 i N50. Den har ikke form og ikke høyde, bare et punkt.

Bare punkt, type og status leses. Fila har også ID-er for adresse og eiendom; de trengs ikke og
tas ikke med videre.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests

from . import USER_AGENT
from .grid import GridSpec

BASE_URL = "https://nedlasting.geonorge.no/geonorge/Basisdata/MatrikkelenBygning/FGDB"
LAYER = "bygning"

# Bygninger som står: tatt i bruk, ferdigattest, midlertidig brukstillatelse. Resten er søknader,
# tillatelser og bygg som er revet eller ikke satt opp.
STANDING = ("TB", "FA", "MB")
# Garasjer, uthus og naust (til bolig, til fritidsbolig, og naust/båthus). De står tett inntil hus som
# alt fyller en 10 m-celle, og tegnes derfor ikke.
OUTBUILDINGS = (181, 182, 183)
CHURCH = 671  # kirke, kapell

# NOMINELL høyde (m) etter bygningstype. Matrikkelen har ikke høyde; tallene er anslag per hovedgruppe
# i bygningstypekoden (NS 3457), ikke målinger. Store bygg får i stedet høyde fra DOM (se structures.py).
HEIGHT_BY_GROUP = {
    11: 7.0,  # enebolig
    12: 7.0,  # tomannsbolig
    13: 8.0,  # rekkehus, kjedehus
    14: 14.0,  # store boligbygg (blokk)
    15: 10.0,  # bygning for bofellesskap
    16: 5.0,  # fritidsbolig
    17: 5.0,  # koie, seterhus
    19: 6.0,  # annen boligbygning
}
HEIGHT_BY_MAIN = {2: 9.0, 3: 12.0, 4: 8.0, 5: 10.0, 6: 10.0, 7: 12.0, 8: 8.0}  # industri/lager, kontor/forretning, ...
HEIGHT_DEFAULT = 7.0


# Fargeprofil per bygningstype: (navn, to takfarger som veksles). Navnene vises i spillet (hjelpepanelet), derfor engelsk. Typen er ekte (Matrikkelen);
# fargene er SYNTETISKE: valgt så bygningstyper kan skilles fra lufta, ikke observert på takene.
# Slås opp på hovedgruppe (første siffer), og mer spesifikt på de to første sifrene der det finnes.
PROFILE_BY_MAIN = {
    1: ("houses", ((172, 86, 66), (184, 178, 164))),  # teglrødt og lys grått, som før
    2: ("industry and storage", ((138, 152, 168), (164, 172, 180))),  # stålblått
    3: ("offices and shops", ((92, 108, 128), (116, 130, 146))),  # mørkt blågrått
    4: ("transport", ((128, 126, 122), (148, 146, 140))),  # grått
    5: ("hotels and restaurants", ((196, 150, 84), (208, 170, 110))),  # oker
    6: ("schools and culture", ((214, 186, 92), (224, 200, 120))),  # gult
    7: ("health", ((150, 196, 196), (176, 210, 208))),  # lyst blågrønt
    8: ("emergency services", ((120, 118, 112), (138, 134, 126))),
}
PROFILE_BY_GROUP = {
    14: ("apartment blocks", ((206, 198, 182), (190, 184, 172))),  # lys betong
    15: ("apartment blocks", ((206, 198, 182), (190, 184, 172))),
    16: ("holiday homes", ((112, 84, 62), (96, 74, 58))),  # mørkt brunt
    17: ("holiday homes", ((112, 84, 62), (96, 74, 58))),
    65: ("sports", ((120, 168, 132), (140, 182, 150))),  # grønt
    67: ("churches", ((238, 236, 228), (238, 236, 228))),  # hvitt
}
PROFILE_DEFAULT = ("other", ((184, 178, 164), (172, 86, 66)))


def profile(building_type: int) -> tuple[str, tuple[tuple[int, int, int], tuple[int, int, int]]]:
    """Fargeprofilen for en bygningstype (tresifret kode)."""
    return PROFILE_BY_GROUP.get(building_type // 10) or PROFILE_BY_MAIN.get(building_type // 100) or PROFILE_DEFAULT


def gdb_path(county: str, raw_dir: Path) -> Path:
    """Last ned og pakk ut fylkesfila hvis den ikke finnes. `county` f.eks. '42_Agder'."""
    name = f"Basisdata_{county}_25833_MatrikkelenBygning_FGDB"
    target = raw_dir / "matrikkel" / county
    gdb = target / f"{name}.gdb"
    if not gdb.exists():
        zip_path = raw_dir / "matrikkel" / f"{name}.zip"
        if not zip_path.exists():
            print(f"  Matrikkelen: laster ned {name}.zip")
            zip_path.parent.mkdir(parents=True, exist_ok=True)
            with requests.get(f"{BASE_URL}/{name}.zip", headers={"User-Agent": USER_AGENT}, stream=True, timeout=600) as r:
                r.raise_for_status()
                with zip_path.open("wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(target)
    return gdb


def nominal_height(building_type: np.ndarray) -> np.ndarray:
    """Antatt høyde (m) per bygning ut fra bygningstypen (tresifret kode)."""
    code = np.asarray(building_type, dtype=int)
    out = np.full(code.shape, HEIGHT_DEFAULT)
    for main, h in HEIGHT_BY_MAIN.items():
        out[code // 100 == main] = h
    for group, h in HEIGHT_BY_GROUP.items():
        out[code // 10 == group] = h
    return out


def _standing(county: str, grid: GridSpec, raw_dir: Path) -> gpd.GeoDataFrame:
    """Alle bygg som står, også garasjer og uthus, med bygningsnummer (nøkkelen OSM-omrissene bruker)."""
    from .n50 import counties, read_layers

    gdf = read_layers([gdb_path(c, raw_dir) for c in counties(county)], LAYER, grid, columns=["bygningstype", "bygningsstatus", "bygningsnummer"])
    assert len(gdf) and set(gdf.geom_type) == {"Point"}, set(gdf.geom_type)
    return gdf[gdf["bygningsstatus"].isin(STANDING) & gdf["bygningstype"].notna()]


def type_by_number(county: str, grid: GridSpec, raw_dir: Path) -> dict[int, int]:
    """Bygningstype per bygningsnummer, for alle bygg som står (også uthus, så de kan velges bort)."""
    gdf = _standing(county, grid, raw_dir)
    return dict(zip(gdf["bygningsnummer"].astype("int64"), gdf["bygningstype"].astype(int)))


def load_buildings(county: str, grid: GridSpec, raw_dir: Path) -> gpd.GeoDataFrame:
    """Bygninger som står, innenfor rutenettet og uten garasjer og uthus: punkt, `bygningstype`, `bygningsnummer` og `height` (nominell)."""
    gdf = _standing(county, grid, raw_dir)
    gdf = gdf[~gdf["bygningstype"].astype(int).isin(OUTBUILDINGS)]
    # bbox-filteret i leseren tar med punkter på kanten: hold oss strengt innenfor
    x, y = gdf.geometry.x, gdf.geometry.y
    gdf = gdf[(x >= grid.west) & (x < grid.east) & (y > grid.south) & (y <= grid.north)].copy()
    gdf["bygningstype"] = gdf["bygningstype"].astype(int)
    gdf["height"] = nominal_height(gdf["bygningstype"].to_numpy())
    gdf["bygningsnummer"] = gdf["bygningsnummer"].astype("int64")
    return gdf[["bygningstype", "bygningsnummer", "height", "geometry"]].reset_index(drop=True)


def height_raster(buildings: gpd.GeoDataFrame, grid: GridSpec) -> np.ndarray:
    """Nominell høyde per celle (høyeste bygning i cella), NaN der det ikke står noen."""
    out = np.full((grid.height, grid.width), np.nan)
    col = ((buildings.geometry.x.to_numpy() - grid.west) / grid.cell).astype(int)
    row = ((grid.north - buildings.geometry.y.to_numpy()) / grid.cell).astype(int)
    np.fmax.at(out, (row, col), buildings["height"].to_numpy())
    return out


def type_raster(buildings: gpd.GeoDataFrame, areas: gpd.GeoDataFrame, grid: GridSpec) -> np.ndarray:
    """Bygningstype per celle (0 = ukjent). Store bygg (flater fra N50) får typen til Matrikkel-punktet som ligger i flaten."""
    from rasterio.features import rasterize

    out = np.zeros((grid.height, grid.width), dtype=np.int32)
    if len(areas) and len(buildings):
        inside = gpd.sjoin(buildings[["bygningstype", "geometry"]], areas[["geometry"]].reset_index(drop=True), predicate="within")
        # flere bygg i samme flate: det vanligste typenummeret (laveste ved likt antall, så svaret er entydig)
        common = inside.groupby("index_right")["bygningstype"].agg(lambda s: int(s.value_counts().sort_index().idxmax()))
        geoms = areas.geometry.reset_index(drop=True)
        shapes = [(geoms[i], t) for i, t in common.items() if geoms[i] is not None and not geoms[i].is_empty]
        if shapes:
            out = rasterize(shapes, out_shape=out.shape, transform=grid.transform, fill=0, dtype="int32")
    col = ((buildings.geometry.x.to_numpy() - grid.west) / grid.cell).astype(int)
    row = ((grid.north - buildings.geometry.y.to_numpy()) / grid.cell).astype(int)
    # punktet selv vinner i sin egen celle; rekkefølgen i fila er fast, så siste bygg i cella gir samme svar hver gang
    out[row, col] = buildings["bygningstype"].to_numpy()
    return out
