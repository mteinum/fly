"""Høydedata: Kartverket DTM (Nasjonal høydemodell) via WCS.

Tjeneste: https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833
Dekning:  nhm_dtm_topo_25833 (1 m, EPSG:25833, høyder i NN2000)

Tjenesten tillater maks 3840 x 2160 piksler per kall, så utsnittet hentes
som fliser og caches i data/raw/. Slett cachen for å hente på nytt.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
import requests

from . import USER_AGENT
from .grid import GridSpec

WCS_URL = "https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833"
COVERAGE = "nhm_dtm_topo_25833"
TILE_PX = 1280
# Målt mot blokkmiddel av 1 m-data: bilinear gir RMSE 0,25 m, standard
# (nearest) 0,92 m. Se docs/resampling.md.
INTERPOLATION = "bilinear"


def _fetch_tile(path: Path, west: float, south: float, east: float, north: float, w: int, h: int) -> None:
    params = {
        "SERVICE": "WCS",
        "VERSION": "1.0.0",
        "REQUEST": "GetCoverage",
        "COVERAGE": COVERAGE,
        "CRS": "EPSG:25833",
        "BBOX": f"{west},{south},{east},{north}",
        "WIDTH": w,
        "HEIGHT": h,
        "FORMAT": "GeoTIFF",
        "INTERPOLATION": INTERPOLATION,
    }
    r = requests.get(WCS_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=300)
    r.raise_for_status()
    if "tiff" not in r.headers.get("content-type", ""):
        raise RuntimeError(f"WCS svarte ikke med GeoTIFF: {r.text[:500]}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)


def load_source_dtm(grid: GridSpec, res: float, raw_dir: Path) -> np.ndarray:
    """Hent DTM for rutenettets utstrekning med oppløsning `res` (m). Rad 0 = nord."""
    factor = grid.cell / res
    if factor != int(factor):
        raise ValueError("cellestørrelsen må være et helt multiplum av kildeoppløsningen")
    w, h = grid.width * int(factor), grid.height * int(factor)
    out = np.empty((h, w), dtype=np.float32)
    for r0 in range(0, h, TILE_PX):
        for c0 in range(0, w, TILE_PX):
            th, tw = min(TILE_PX, h - r0), min(TILE_PX, w - c0)
            t_west = grid.west + c0 * res
            t_north = grid.north - r0 * res
            path = raw_dir / f"dtm{res:g}m_r{r0}_c{c0}.tif"
            if not path.exists():
                print(f"  WCS: {path.name}")
                _fetch_tile(path, t_west, t_north - th * res, t_west + tw * res, t_north, tw, th)
            with rasterio.open(path) as src:
                # Stol ikke på at tjenesten leverte det vi ba om
                assert src.crs.to_epsg() == 25833, src.crs
                assert (src.width, src.height) == (tw, th), (src.width, src.height)
                t = src.transform
                assert abs(t.c - t_west) < 1e-6 and abs(t.f - t_north) < 1e-6, t
                assert abs(t.a - res) < 1e-9 and abs(t.e + res) < 1e-9, t
                out[r0 : r0 + th, c0 : c0 + tw] = src.read(1)
    return out
