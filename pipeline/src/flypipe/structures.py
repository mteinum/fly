"""Strukturer med høyde over terrenget: bruer og bygninger.

Høydekartet (DTM) røres ikke. Strukturene skrives som egen liste, og
renderne legger dem oppå terrenget.

Bruer:     vegsenterlinje fra N50 (medium = L), dekkhøyde fra DOM 1 m.
Bygninger: posisjon fra N50, NOMINELL høyde (N50 har ikke bygningshøyde).
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import numpy as np

from . import dtm, n50, terrain
from .grid import GridSpec

BUILDING, BRIDGE = 1, 2
KINDS = ["none", "building", "bridge"]

BRIDGE_THICKNESS = 3.0  # m, dekke + bærebjelker
# Under dette er «brua» en kulvert eller lav overgang: tegnes som vanlig vei
BRIDGE_MIN_CLEARANCE = 3.0
SAMPLE_STEP = 5.0  # m mellom DOM-prøver langs brua
CLUSTER_BUFFER = 40.0  # m rundt brulinjene når DOM-vinduer hentes

HEIGHT_HOUSE = 7.0  # m, bygningspunkt (enebolig, hytte, naust ...)
HEIGHT_LARGE = 12.0  # m, bygning stor nok til å være flate i N50


def bridge_decks(bridges: gpd.GeoDataFrame, grid: GridSpec, raw_dir: Path) -> dict[tuple[int, int], float]:
    """Dekkhøyde (m, NN2000) per celle (kol, rad) som en bru går gjennom."""
    lines = [g for g in bridges.geometry if g is not None and not g.is_empty]
    if not lines:
        return {}
    clusters = gpd.GeoSeries(lines).buffer(CLUSTER_BUFFER).union_all()
    clusters = list(getattr(clusters, "geoms", [clusters]))
    samples: dict[tuple[int, int], list[float]] = {}
    for cluster in clusters:
        w, s, e, n = cluster.bounds
        dom, t = dtm.load_dom_window(int(np.floor(w)), int(np.floor(s)), int(np.ceil(e)), int(np.ceil(n)), raw_dir)
        for line in lines:
            if not line.intersects(cluster):
                continue
            for d in np.arange(0.0, line.length + SAMPLE_STEP, SAMPLE_STEP):
                p = line.interpolate(min(d, line.length))
                c, r = ~t * (p.x, p.y)
                r, c = int(r), int(c)
                # median av 5 x 5 m: ser bort fra biler, rekkverk og lysmaster
                win = dom[max(r - 2, 0) : r + 3, max(c - 2, 0) : c + 3]
                x, y = grid.utm_to_grid(p.x, p.y)
                if win.size and 0 <= x < grid.width and 0 <= y < grid.height:
                    samples.setdefault((int(x), int(y)), []).append(float(np.median(win)))
    return {cell: float(np.median(v)) for cell, v in samples.items()}


def build_structures(
    vectors: dict[str, gpd.GeoDataFrame], features: np.ndarray, hgt: np.ndarray, grid: GridSpec, raw_dir: Path, seed: int = 7
) -> tuple[list[list], np.ndarray]:
    """Returnerer (strukturliste, justert feature-raster).

    Liste: [kol, rad, type, bunn, topp, r, g, b] med høyder i m (NN2000).
    Brucellene fjernes fra feature-rasteret (bakken under er vann eller
    terreng); lave «bruer» gjøres om til vei.
    """
    features = features.copy()
    features[features == n50.BRIDGE] = n50.NONE
    noise = np.random.default_rng(seed).random(hgt.shape) > 0.5
    items: list[list] = []

    for (col, row), deck in sorted(bridge_decks(vectors["bridges"], grid, raw_dir).items()):
        ground = max(0.0, float(hgt[row, col]))
        if deck - ground < BRIDGE_MIN_CLEARANCE:
            features[row, col] = n50.ROAD
            continue
        items.append([col, row, BRIDGE, round(deck - BRIDGE_THICKNESS, 1), round(deck, 1), *terrain.BRIDGE])

    large = n50.rasterize_large_buildings(vectors, grid)
    for row, col in zip(*np.nonzero(features == n50.BUILDING)):
        ground = max(0.0, float(hgt[row, col]))
        height = HEIGHT_LARGE if large[row, col] else HEIGHT_HOUSE
        roof = terrain.ROOFS[0] if noise[row, col] else terrain.ROOFS[1]
        items.append([int(col), int(row), BUILDING, round(ground, 1), round(ground + height, 1), *roof])
    return items, features
