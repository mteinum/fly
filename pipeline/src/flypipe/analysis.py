"""Romlige analyser som mater spillet: synlighet fra tårnet, klaring under innflygingen og bygningsklynger.

Alt regnes i EUREF89 UTM 33 (meter) på spillrutenettet. Resultatene skrives til metadata.json og som
georefererte kopier i data/processed/ for kontroll i QGIS.

Valgene som styrer svarene står som konstanter under. De er valg, ikke fasit: en annen terskel eller
avstand gir et annet svar, og det er grunnen til at de står i metadata sammen med tallene.
"""

from __future__ import annotations

import math

import numpy as np

EARTH_RADIUS_M = 6_371_000.0
REFRACTION = 0.13  # standard atmosfærisk brytning: siktlinja krummer litt med jorda

# Samme geometri som web/src/guidance.ts og physics.ts (kontrolleres mot hverandre i airports.test.ts)
GLIDE_ANGLE_DEG = 3.0
AIM_POINT_M = 300.0
APPROACH_DIST_M = 8000.0
CORRIDOR_HALF_WIDTH_M = 150.0  # klaringen måles i et belte rundt senterlinja, ikke bare rett under
CLEARANCE_FROM_M = 1000.0  # nærmere banen enn dette skal klaringen gå mot null, så det sier ingenting

# Bygningsklynger (DBSCAN). Med alle bygg (Matrikkelen) brukes SSBs tettstedsavstand, 50 m mellom husene.
# N50 er generalisert og har ikke med alle hus: der må avstanden være romsligere for at en grend skal henge sammen.
CLUSTER_EPS_M = 50.0
CLUSTER_EPS_GENERALISED_M = 100.0
CLUSTER_MIN_BUILDINGS = 5


def required_altitude(hgt: np.ndarray, cell: float, eye_x: float, eye_y: float, eye_m: float) -> np.ndarray:
    """Laveste høyde (m over havet) et punkt over hver celle må ha for å ses fra øyepunktet.

    Der verdien er lik terrenget, ses bakken. Sikten sperres bare av terrenget (DTM): trær og bygninger
    er ikke med, så virkeligheten er dårligere enn dette. Jordkrumning og standard brytning er med:
    på 18 km utgjør de 22 m.

    Metode: terrenget leses langs stråler ut fra øyet (én stråle per celle langs ytterkanten). Langs hver
    stråle holdes største høydevinkel så langt; et punkt lenger ut ses hvis det ligger over den vinkelen.
    """
    h, w = hgt.shape
    corners = [(0, 0), (w, 0), (0, h), (w, h)]
    n_r = int(math.ceil(max(math.hypot(cx - eye_x, cy - eye_y) for cx, cy in corners))) + 1
    n_az = int(math.ceil(2 * math.pi * n_r))
    r = np.arange(1, n_r + 1, dtype=np.float32)  # celler fra øyet
    az = (np.arange(n_az, dtype=np.float32) + 0.5) * (2 * math.pi / n_az)
    # rutenett: x øker mot øst, y mot sør. Asimut 0 = rutenett-nord (-y), med klokka.
    col = np.floor(eye_x + np.sin(az)[:, None] * r[None, :]).astype(np.int32)
    row = np.floor(eye_y - np.cos(az)[:, None] * r[None, :]).astype(np.int32)
    inside = (col >= 0) & (col < w) & (row >= 0) & (row < h)
    ground = np.where(inside, np.maximum(hgt[row.clip(0, h - 1), col.clip(0, w - 1)], 0), -np.inf).astype(np.float32)
    dist = r * cell
    drop = dist**2 * (1 - REFRACTION) / (2 * EARTH_RADIUS_M)  # så mye «synker» terrenget bak horisonten
    tangent = (ground - drop[None, :] - eye_m) / dist[None, :]
    # største vinkel NÆRMERE øyet enn punktet selv
    blocking = np.maximum.accumulate(tangent, axis=1)
    blocking = np.concatenate([np.full((n_az, 1), -np.inf, dtype=np.float32), blocking[:, :-1]], axis=1)
    need = np.maximum(eye_m + blocking * dist[None, :] + drop[None, :], ground)

    # tilbake til rutenettet: hver celle henter verdien fra nærmeste punkt på nærmeste stråle
    cy, cx = np.indices((h, w), dtype=np.float32)
    dx, dy = cx + 0.5 - eye_x, cy + 0.5 - eye_y
    ri = np.rint(np.hypot(dx, dy)).astype(np.int32) - 1
    ai = np.floor(np.arctan2(dx, -dy) % (2 * math.pi) / (2 * math.pi / n_az)).astype(np.int32) % n_az
    out = need[ai, ri.clip(0, n_r - 1)]
    floor = np.maximum(hgt, 0)
    return np.where(ri < 0, floor, np.maximum(out, floor)).astype(np.float32)


def surface_top(hgt: np.ndarray, items: list[list]) -> np.ndarray:
    """Terrenget med bygninger og bruer lagt oppå (toppen av det høyeste i hver celle)."""
    top = np.maximum(hgt, 0).astype(np.float32)
    if items:
        a = np.asarray([(it[1], it[0], it[4]) for it in items], dtype=np.float64)
        np.maximum.at(top, (a[:, 0].astype(int), a[:, 1].astype(int)), a[:, 2].astype(np.float32))
    return top


def glide_path_altitude(end: dict, hgt: np.ndarray, cell: float, distance_m: float) -> float:
    """Høyden (m over havet) 3°-glidebanen har `distance_m` før baneenden. Samme regnestykke som guidance.ts."""
    hdg = math.radians(end["headingGridDeg"])
    from_end = end["displacedThresholdM"] + AIM_POINT_M
    ax, ay = end["x"] + math.sin(hdg) * from_end / cell, end["y"] - math.cos(hdg) * from_end / cell
    aim_elev = max(0.0, _bilinear(hgt, ax, ay))
    return aim_elev + (distance_m + from_end) * math.tan(math.radians(GLIDE_ANGLE_DEG))


def _bilinear(hgt: np.ndarray, x: float, y: float) -> float:
    """Høyden i (x, y) slik spillet leser den (Terrain.heightAt): verdien gjelder i cellesenteret."""
    h, w = hgt.shape
    fx, fy = min(max(x - 0.5, 0), w - 1), min(max(y - 0.5, 0), h - 1)
    x0, y0 = int(fx), int(fy)
    x1, y1 = min(x0 + 1, w - 1), min(y0 + 1, h - 1)
    tx, ty = fx - x0, fy - y0
    top = hgt[y0, x0] * (1 - tx) + hgt[y0, x1] * tx
    bottom = hgt[y1, x0] * (1 - tx) + hgt[y1, x1] * tx
    return float(top * (1 - ty) + bottom * ty)


def approach_facts(end: dict, hgt: np.ndarray, top: np.ndarray, need: np.ndarray | None, cell: float) -> dict:
    """Det innflygingen til én baneende byr på: klaring til terreng og bygg under glidebanen, og hvor tårnet ser flyet.

    Avstander er meter før baneenden, målt i rutenettet (målestokkfaktoren er ikke trukket fra).
    """
    h, w = hgt.shape
    hdg = math.radians(end["headingGridDeg"])
    fx, fy = math.sin(hdg), -math.cos(hdg)  # landingsretningen i rutenettet
    px, py = -fy, fx  # til høyre for den
    offsets = np.arange(-CORRIDOR_HALF_WIDTH_M, CORRIDOR_HALF_WIDTH_M + cell / 2, cell) / cell
    lowest, hidden, seen, steps = None, [], 0, 0
    for d in np.arange(0.0, APPROACH_DIST_M + cell / 2, cell):
        x, y = end["x"] - fx * d / cell, end["y"] - fy * d / cell
        if not (0 <= x < w and 0 <= y < h):
            break
        alt = glide_path_altitude(end, hgt, cell, d)
        cols = np.clip((x + px * offsets).astype(int), 0, w - 1)
        rows = np.clip((y + py * offsets).astype(int), 0, h - 1)
        clearance = alt - float(top[rows, cols].max())
        if d >= CLEARANCE_FROM_M and (lowest is None or clearance < lowest[0]):
            lowest = (clearance, d)
        if need is not None:
            steps += 1
            visible = alt >= float(need[int(y), int(x)])
            seen += visible
            if not visible:
                if hidden and abs(hidden[-1][1] - (d - cell)) < 1e-6:
                    hidden[-1][1] = d
                else:
                    hidden.append([d, d])
    out = {
        "startAltitudeM": round(glide_path_altitude(end, hgt, cell, APPROACH_DIST_M), 1),
        "lowestClearanceM": round(lowest[0], 1),
        "lowestClearanceAtM": round(lowest[1]),
    }
    if need is not None:
        out["seenFromTowerShare"] = round(seen / steps, 3)
        out["hiddenFromTowerM"] = [[round(a), round(b)] for a, b in hidden]
    return out


def building_clusters(xy_m: np.ndarray, eps_m: float = CLUSTER_EPS_M) -> np.ndarray:
    """Klyngenummer per bygning (DBSCAN), -1 for bygninger som står for seg selv.

    `xy_m` er (øst, nord) i meter. Avstand regnes i projisert CRS, aldri i grader.
    """
    from sklearn.cluster import DBSCAN

    if len(xy_m) == 0:
        return np.zeros(0, dtype=int)
    return DBSCAN(eps=eps_m, min_samples=CLUSTER_MIN_BUILDINGS).fit(xy_m).labels_


def cluster_summary(labels: np.ndarray, eps_m: float = CLUSTER_EPS_M) -> dict:
    sizes = np.bincount(labels[labels >= 0]) if (labels >= 0).any() else np.zeros(0, dtype=int)
    return {
        "method": f"DBSCAN, eps {eps_m:g} m, minst {CLUSTER_MIN_BUILDINGS} bygninger",
        "buildings": int(len(labels)),
        "clusters": int(len(sizes)),
        "inClustersShare": round(float((labels >= 0).mean()), 3) if len(labels) else 0.0,
        "largestCluster": int(sizes.max()) if len(sizes) else 0,
        "medianCluster": int(np.median(sizes)) if len(sizes) else 0,
    }
