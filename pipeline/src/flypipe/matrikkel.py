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


def load_buildings(county: str, grid: GridSpec, raw_dir: Path) -> gpd.GeoDataFrame:
    """Bygninger som står, innenfor rutenettet og uten garasjer og uthus: punkt, `bygningstype` og `height` (nominell)."""
    gdf = gpd.read_file(
        gdb_path(county, raw_dir), layer=LAYER, bbox=(grid.west, grid.south, grid.east, grid.north),
        columns=["bygningstype", "bygningsstatus"], engine="pyogrio",
    )
    assert gdf.crs is not None and gdf.crs.to_epsg() == 25833, gdf.crs
    assert len(gdf) and set(gdf.geom_type) == {"Point"}, set(gdf.geom_type)
    gdf = gdf[gdf["bygningsstatus"].isin(STANDING) & gdf["bygningstype"].notna()]
    gdf = gdf[~gdf["bygningstype"].astype(int).isin(OUTBUILDINGS)]
    # bbox-filteret i leseren tar med punkter på kanten: hold oss strengt innenfor
    x, y = gdf.geometry.x, gdf.geometry.y
    gdf = gdf[(x >= grid.west) & (x < grid.east) & (y > grid.south) & (y <= grid.north)].copy()
    gdf["bygningstype"] = gdf["bygningstype"].astype(int)
    gdf["height"] = nominal_height(gdf["bygningstype"].to_numpy())
    return gdf[["bygningstype", "height", "geometry"]].reset_index(drop=True)


def height_raster(buildings: gpd.GeoDataFrame, grid: GridSpec) -> np.ndarray:
    """Nominell høyde per celle (høyeste bygning i cella), NaN der det ikke står noen."""
    out = np.full((grid.height, grid.width), np.nan)
    col = ((buildings.geometry.x.to_numpy() - grid.west) / grid.cell).astype(int)
    row = ((grid.north - buildings.geometry.y.to_numpy()) / grid.cell).astype(int)
    np.fmax.at(out, (row, col), buildings["height"].to_numpy())
    return out
