"""Resampling, hillshade og fargekart."""

from __future__ import annotations

import math

import numpy as np

# Celler med middelhøyde <= denne regnes som sjø (fase 1: kun fra DTM).
SEA_LEVEL_MAX = 0.1

SEA = (45, 110, 150)
RUNWAY = (68, 70, 78)


def block_mean(src: np.ndarray, factor: int) -> np.ndarray:
    """Nedsampling ved aritmetisk middel over factor x factor kildeceller."""
    h, w = src.shape
    return src.reshape(h // factor, factor, w // factor, factor).mean(axis=(1, 3), dtype=np.float64).astype(np.float32)


def gradients(hgt: np.ndarray, cell: float) -> tuple[np.ndarray, np.ndarray]:
    """(dz/dx mot øst, dz/dy mot SØR). Høyder under 0 klippes, som i prototypen."""
    z = np.maximum(hgt, 0).astype(np.float64)
    dz_south, dz_east = np.gradient(z, cell)
    return dz_east, dz_south


def hillshade(
    hgt: np.ndarray,
    cell: float,
    sun_azimuth_grid_deg: float,
    sun_elevation_deg: float,
    z_factor: float = 2.0,
    levels: int = 6,
) -> np.ndarray:
    """Lambert-skygge, posterisert. Returnerer faktor ca. 0.45-1.2 per celle.

    Asimut er i RUTENETTET (med klokka fra rutenett-nord). Lysvektoren peker
    mot sola: (øst, sør, opp) = (sin az, -cos az, tan el) * cos el.
    """
    az, el = math.radians(sun_azimuth_grid_deg), math.radians(sun_elevation_deg)
    lx, ly, lz = math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)
    dz_east, dz_south = gradients(hgt, cell)
    nx, ny = -dz_east * z_factor, -dz_south * z_factor
    norm = np.sqrt(nx * nx + ny * ny + 1.0)
    lambert = np.maximum(0.0, (nx * lx + ny * ly + lz) / norm)
    return np.round((0.45 + 0.75 * lambert) * levels) / levels


# (øvre høydegrense i m, farge A, farge B) - A/B veksles med støy for tekstur
BANDS = [
    (3.0, (216, 197, 138), (206, 188, 132)),  # strand/svaberg
    (120.0, (52, 110, 58), (40, 92, 50)),  # skog
    (250.0, (122, 132, 74), (104, 118, 66)),  # lynghei
    (math.inf, (140, 134, 126), (132, 126, 118)),  # snaufjell
]
STEEP = (128, 124, 118)
STEEP_SLOPE = 0.6  # stigningstall (dz/dxy) på 50 m-rutenettet


def colormap(hgt: np.ndarray, cell: float, shade: np.ndarray, seed: int = 7) -> np.ndarray:
    """RGB-fargekart (uint8, h x w x 3): høydebånd + helning + hillshade."""
    dz_east, dz_south = gradients(hgt, cell)
    slope = np.hypot(dz_east, dz_south)
    noise = np.random.default_rng(seed).random(hgt.shape) > 0.5

    rgb = np.zeros(hgt.shape + (3,), dtype=np.float64)
    lower = -math.inf
    for upper, a, b in BANDS:
        band = (hgt > lower) & (hgt <= upper)
        rgb[band & noise] = a
        rgb[band & ~noise] = b
        lower = upper
    rgb[(slope > STEEP_SLOPE) & (hgt > BANDS[0][0])] = STEEP
    rgb = np.minimum(255, np.floor(rgb * shade[..., None]))
    rgb[hgt <= SEA_LEVEL_MAX] = SEA
    return rgb.astype(np.uint8)
