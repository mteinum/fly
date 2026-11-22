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
from scipy.ndimage import map_coordinates

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

# Kirketårn, lest ut av DOM 1 m rundt kirkens punkt i Matrikkelen
TOWER_SEARCH_RADIUS = 20.0  # m: tårnet står på kirka, og punktet ligger et sted i bygget
TOWER_MIN_HEIGHT = 16.0  # m over bakken: lavere enn dette er et kapell eller en kirke uten tårn
LIGHTHOUSE_MIN_HEIGHT = 8.0  # m: fyrtårn er lavere enn kirketårn. Under dette er det en lykt
LANTERN_HEIGHT = 5.0  # m, NOMINELL høyde på en fyrlykt (ingen data)
TOWER_MAX_TIP_AREA = 30  # m2 innen 3 m av toppen: et tårn er smalt øverst, et stort tak er det ikke


DECK_WINDOW = 15  # prøver til hver side (ca. 75 m) som medianen tas over: mer enn det lengste hullet vi har sett (45 m)
DECK_OUTLIER_M = 1.5  # en prøve som avviker mer enn dette fra medianen av naboene, er ikke veibanen


def smooth_deck(z: list[float]) -> list[float]:
    """Dekkhøyden langs en bru, renset for prøver som ikke traff veibanen.

    DOM er overflata sett ovenfra. Langs en bru treffer noen prøver et hull i modellen eller sjøen ved siden av
    (høyden faller mange meter), andre en lysmast, en kabel eller et tårn (høyden spretter opp). En veibane gjør
    ingen av delene. Prøver som avviker mer enn DECK_OUTLIER_M fra medianen av naboene, erstattes med en rett
    linje mellom de nærmeste prøvene som ikke gjør det, og resultatet glattes lett. Det legges aldri inn høyder
    utenfor det prøvene selv spenner over. Bruer med færre enn åtte prøver står urørt.
    """
    a = np.asarray(z, dtype=float)
    if a.size < 8:
        return [float(v) for v in a]
    half = min(DECK_WINDOW, (a.size - 1) // 2)
    pad = np.pad(a, half, mode="edge")
    med = np.array([np.median(pad[i : i + 2 * half + 1]) for i in range(a.size)])
    keep = np.abs(a - med) <= DECK_OUTLIER_M
    if keep.sum() < 2:
        return [float(v) for v in a]
    idx = np.arange(a.size)
    clean = np.interp(idx, idx[keep], a[keep])  # utenfor første og siste gode prøve holdes høyden
    pad = np.concatenate([[clean[0]] * 2, clean, [clean[-1]] * 2])
    smooth = np.convolve(pad, np.ones(5) / 5, mode="valid")
    smooth[[0, 1, -2, -1]] = clean[[0, 1, -2, -1]]  # endene skal møte veien på land der prøvene sier
    return [float(v) for v in smooth]


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
            out.append({"width": width, "points": [(x, y, z) for (x, y, _), z in zip(pts, smooth_deck([p[2] for p in pts]))]})
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


def church_towers(
    churches: gpd.GeoDataFrame, hgt: np.ndarray, grid: GridSpec, raw_dir: Path, min_height: float = TOWER_MIN_HEIGHT, cache: str = "churches"
) -> list[list[float]]:
    """Tårn som [x, y, bunn, topp]: posisjon i rutenettkoordinater, høyder i m (NN2000). Brukes for kirker og fyr.

    Matrikkelen sier hvilke bygg som er kirker, men ikke om de har tårn eller hvor høyt det er. Det leses
    ut av overflatemodellen (DOM 1 m): høyeste punkt innen 20 m fra kirkens punkt er tårnet, hvis det
    er høyt nok og smalt øverst. Posisjon og høyde er altså MÅLT, med to forbehold:
    - Et høyt, slankt tre ved kirka kan bli tatt for et tårn.
    - Tynne spir er smalere enn 1 m og kommer ikke med: tårnet er minst så høyt som dette.
    """
    r = int(TOWER_SEARCH_RADIUS) + 2
    out = []
    for p in churches.geometry:
        x, y = int(round(p.x)), int(round(p.y))
        gx, gy = grid.utm_to_grid(p.x, p.y)
        if not (r / grid.cell <= gx < grid.width - r / grid.cell and r / grid.cell <= gy < grid.height - r / grid.cell):
            continue  # for nær kartkanten til å lese et helt vindu
        dom, t = dtm.load_dom_window(x - r, y - r, x + r, y + r, raw_dir / cache)
        rows, cols = np.indices(dom.shape)
        # cellesentrenes avstand fra kirkens punkt
        east, north = t.c + cols + 0.5, t.f - rows - 0.5
        near = np.hypot(east - p.x, north - p.y) <= TOWER_SEARCH_RADIUS
        # Høyde over terrenget i HVERT punkt, ikke over bakken ved kirka: i en bakke ville terrenget 20 m unna
        # ellers blitt regnet som tårn. Terrenget er DTM i spillrutenettet, interpolert mellom cellesentrene.
        terrain_here = map_coordinates(hgt, [(grid.north - north) / grid.cell - 0.5, (east - grid.west) / grid.cell - 0.5], order=1, mode="nearest")
        above = np.where(near, dom - np.maximum(terrain_here, 0), -np.inf)
        top = float(above.max())
        if top < min_height or int((above > top - 3).sum()) > TOWER_MAX_TIP_AREA:
            continue
        i, j = np.unravel_index(int(np.argmax(above)), dom.shape)
        tx, ty = grid.utm_to_grid(float(east[i, j]), float(north[i, j]))
        ground = max(0.0, float(terrain_here[i, j]))
        out.append([round(tx, 3), round(ty, 3), round(ground, 1), round(ground + min(top, HEIGHT_RANGE[1]), 1)])
    # To kirkepunkter tett på hverandre (kirke og kapell, eller to registreringer) finner samme tårn: behold det høyeste
    out.sort(key=lambda t: t[2] - t[3])
    kept: list[list[float]] = []
    for t in out:
        if all(np.hypot(t[0] - k[0], t[1] - k[1]) * grid.cell > 2 * TOWER_SEARCH_RADIUS for k in kept):
            kept.append(t)
    return sorted(kept)


def lighthouses(points: list[tuple[float, float, str]], hgt: np.ndarray, grid: GridSpec, raw_dir: Path) -> list[list[float]]:
    """Fyr som [x, y, bunn, topp, tårn]: tårn = 1 for fyrtårn med målt høyde, 0 for lykt med nominell høyde.

    `points` er (øst, nord, type) fra stedsnavnregisteret, type «fyrstasjon» eller «fyrlykt». For
    fyrstasjoner letes tårnet opp i DOM 1 m som for kirkene. Finnes det ikke noe tårn der, og for alle
    lykter, settes et lite merke med nominell høyde på stedet.
    """
    from shapely.geometry import Point

    out = []
    for east, north, kind in points:
        gx, gy = grid.utm_to_grid(east, north)
        if not (0 <= gx < grid.width and 0 <= gy < grid.height):
            continue
        found = church_towers(gpd.GeoDataFrame(geometry=[Point(east, north)], crs=25833), hgt, grid, raw_dir, LIGHTHOUSE_MIN_HEIGHT, "lighthouses") if kind == "fyrstasjon" else []
        if found:
            out.append([*found[0], 1])
        else:
            ground = max(0.0, float(hgt[int(gy), int(gx)]))
            out.append([round(gx, 3), round(gy, 3), round(ground, 1), round(ground + LANTERN_HEIGHT, 1), 0])
    return sorted(out)


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
