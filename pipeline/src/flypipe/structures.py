"""Strukturer med høyde over terrenget: bruer og bygninger.

Høydekartet (DTM) røres ikke. Strukturene skrives som egen liste, og
renderne legger dem oppå terrenget.

Bruer:     vegsenterlinje fra N50 (medium = L), dekkhøyde fra DOM 1 m.
Bygninger: posisjon fra N50, eller fra Matrikkelen der den brukes (10 m-flisene).
           Store bygg (flater i N50) kan få høyde fra DOM - DTM; bygningspunkter
           har NOMINELL høyde (ingen av kildene har høyde).
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import numpy as np
from rasterio.features import rasterize

from . import dtm, n50, terrain
from .grid import GridSpec

BUILDING, BRIDGE = 1, 2
KINDS = ["none", "building", "bridge"]

BRIDGE_THICKNESS = 3.0  # m, dekke + bærebjelker
# Under dette er «brua» en kulvert eller lav overgang: ingen kollisjon, tegnes som vei
BRIDGE_MIN_CLEARANCE = 3.0
SAMPLE_STEP = 5.0  # m mellom DOM-prøver langs brua
CLUSTER_BUFFER = 40.0  # m rundt brulinjene når DOM-vinduer hentes
# Nominell bredde per senterlinje (N50 har én linje per kjørebane på motorvei)
BRIDGE_WIDTH = {"E": 12.0, "R": 10.0}
BRIDGE_WIDTH_DEFAULT = 8.0

HEIGHT_HOUSE = 7.0  # m, bygningspunkt (enebolig, hytte, naust ...)
HEIGHT_LARGE = 12.0  # m, stor bygning når DOM ikke brukes
HEIGHT_RANGE = (4.0, 80.0)  # m, grenser for høyde målt fra DOM


def sample_bridges(bridges: gpd.GeoDataFrame, raw_dir: Path) -> list[dict]:
    """Bruer som polylinjer med dekkhøyde: [{"width": m, "points": [(øst, nord, z), ...]}]."""
    parts = []
    for geom, cat in zip(bridges.geometry, bridges["vegkategori"]):
        if geom is None or geom.is_empty:
            continue
        for line in getattr(geom, "geoms", [geom]):
            parts.append((line, BRIDGE_WIDTH.get(cat, BRIDGE_WIDTH_DEFAULT)))
    if not parts:
        return []
    clusters = gpd.GeoSeries([line for line, _ in parts]).buffer(CLUSTER_BUFFER).union_all()
    out = []
    for cluster in getattr(clusters, "geoms", [clusters]):
        w, s, e, n = cluster.bounds
        dom, t = dtm.load_dom_window(int(np.floor(w)), int(np.floor(s)), int(np.ceil(e)), int(np.ceil(n)), raw_dir)
        for line, width in parts:
            if not cluster.contains(line):
                continue
            pts = []
            n_steps = max(1, int(np.ceil(line.length / SAMPLE_STEP)))
            for d in np.linspace(0.0, line.length, n_steps + 1):
                p = line.interpolate(d)
                c, r = ~t * (p.x, p.y)
                r, c = int(r), int(c)
                # median av 5 x 5 m: ser bort fra biler, rekkverk og lysmaster
                win = dom[max(r - 2, 0) : r + 3, max(c - 2, 0) : c + 3]
                pts.append((p.x, p.y, float(np.median(win))))
            out.append({"width": width, "points": pts})
    return out


def bridge_cells(bridge_lines: list[dict], grid: GridSpec) -> dict[tuple[int, int], float]:
    """Dekkhøyde per celle (kol, rad) under brudekket, i full bredde når cellene er smalere enn brua."""
    samples: dict[tuple[int, int], list[float]] = {}
    for b in bridge_lines:
        pts = b["points"]
        offsets = np.arange(-b["width"] / 2, b["width"] / 2 + 0.01, min(grid.cell, b["width"]) / 2) if grid.cell < b["width"] else [0.0]
        for i, (e, n, z) in enumerate(pts):
            e0, n0, _ = pts[max(i - 1, 0)]
            e1, n1, _ = pts[min(i + 1, len(pts) - 1)]
            length = np.hypot(e1 - e0, n1 - n0) or 1.0
            nx, ny = (n1 - n0) / length, -(e1 - e0) / length  # normal til kjøreretningen
            for o in offsets:
                x, y = grid.utm_to_grid(e + nx * o, n + ny * o)
                if 0 <= x < grid.width and 0 <= y < grid.height:
                    samples.setdefault((int(x), int(y)), []).append(z)
    return {cell: float(np.median(v)) for cell, v in samples.items()}


def building_heights(vectors: dict[str, gpd.GeoDataFrame], hgt: np.ndarray, grid: GridSpec, ndsm: np.ndarray | None) -> tuple[np.ndarray, np.ndarray]:
    """(høyde over bakken, takhøyde i NN2000) per celle for store bygg; NaN ellers.

    Med `ndsm` (DOM - DTM i spillrutenettet) er høyden medianen innenfor
    bygningsflaten, og hele bygget får flatt tak. Uten: nominell høyde.
    """
    height = np.full(hgt.shape, np.nan)
    roof = np.full(hgt.shape, np.nan)
    large = n50.rasterize_large_buildings(vectors, grid)
    height[large] = HEIGHT_LARGE
    roof[large] = np.maximum(hgt[large], 0) + HEIGHT_LARGE
    if ndsm is None:
        return height, roof
    polys = [g for g in vectors["buildingAreas"].geometry if g is not None and not g.is_empty]
    if not polys:
        return height, roof
    labels = rasterize(
        [(g, i + 1) for i, g in enumerate(polys)], out_shape=hgt.shape, transform=grid.transform, fill=0, dtype="int32"
    )
    order = np.argsort(labels, axis=None)
    sorted_labels = labels.ravel()[order]
    starts = np.searchsorted(sorted_labels, np.arange(1, len(polys) + 2))
    ground = np.maximum(hgt, 0).ravel()
    for i in range(len(polys)):
        cells = order[starts[i] : starts[i + 1]]
        if cells.size < 3:  # for få celler til en pålitelig median
            continue
        h = float(np.clip(np.median(ndsm.ravel()[cells]), *HEIGHT_RANGE))
        height.ravel()[cells] = h
        roof.ravel()[cells] = float(np.median(ground[cells])) + h
    return height, roof


def build_structures(
    vectors: dict[str, gpd.GeoDataFrame],
    features: np.ndarray,
    hgt: np.ndarray,
    grid: GridSpec,
    raw_dir: Path,
    ndsm: np.ndarray | None = None,
    seed: int = 7,
    point_heights: np.ndarray | None = None,
) -> tuple[list[list], list[dict], np.ndarray]:
    """Returnerer (celleliste, brulinjer, justert feature-raster).

    Celleliste: [kol, rad, type, bunn, topp, r, g, b] med høyder i m (NN2000).
    Brulinjer:  [{"width": m, "points": [[x, y, z], ...]}] i rutenettkoordinater.
    Brucellene fjernes fra feature-rasteret (bakken under er vann eller
    terreng); lave «bruer» gjøres om til vei.
    `point_heights` er nominell høyde per celle for bygningspunkter (NaN = bruk HEIGHT_HOUSE).
    """
    features = features.copy()
    features[features == n50.BRIDGE] = n50.NONE
    noise = np.random.default_rng(seed).random(hgt.shape) > 0.5
    items: list[list] = []

    bridge_lines = sample_bridges(vectors["bridges"], raw_dir)
    for (col, row), deck in sorted(bridge_cells(bridge_lines, grid).items()):
        ground = max(0.0, float(hgt[row, col]))
        if deck - ground < BRIDGE_MIN_CLEARANCE:
            features[row, col] = n50.ROAD
            continue
        items.append([col, row, BRIDGE, round(deck - BRIDGE_THICKNESS, 1), round(deck, 1), *terrain.BRIDGE])

    _, roof = building_heights(vectors, hgt, grid, ndsm)
    for row, col in zip(*np.nonzero(features == n50.BUILDING)):
        ground = max(0.0, float(hgt[row, col]))
        nominal = HEIGHT_HOUSE if point_heights is None or np.isnan(point_heights[row, col]) else float(point_heights[row, col])
        top = ground + nominal if np.isnan(roof[row, col]) else max(float(roof[row, col]), ground + HEIGHT_RANGE[0])
        color = terrain.ROOFS[0] if noise[row, col] else terrain.ROOFS[1]
        items.append([int(col), int(row), BUILDING, round(ground, 1), round(top, 1), *color])

    lines = []
    for b in bridge_lines:
        pts = [[*(round(v, 3) for v in grid.utm_to_grid(e, n)), round(z, 1)] for e, n, z in b["points"]]
        lines.append({"width": b["width"], "points": pts})
    return items, lines, features
