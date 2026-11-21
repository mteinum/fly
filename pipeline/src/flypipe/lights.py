"""Nattlys: et eget bilde med gatelys og vinduslys, svart ellers.

Plasseringen er SYNTETISK. Vi har ingen data om hvor lyktestolper står eller
hvilke vinduer som lyser. Lysene legges der N50 sier det er vei og
bebyggelse, med fast tetthet og fast støyfrø, så bildet viser hvor det er
folk - ikke hvor det faktisk er lys.

To kilder til «bebyggelse»:
- Arealdekkets bebygde flater (by, tettsted, industri). Der tegner ikke N50 hvert hus, så lysene
  strøs med fast tetthet.
- Bygningene selv. Hver bygning kan få lys, og bygningsklynger (DBSCAN, se analysis.py) avgjør hva
  som er en grend med gatelys og hva som er et enslig hus uten. Med N50 gjelder det bare utenfor de
  bebygde flatene; med Matrikkelen (alle bygg) gjelder det også i tettbebyggelse.
"""

from __future__ import annotations

import numpy as np

from . import n50
from .landcover import CLASSES

STREET = (255, 176, 96)  # varmt gatelys
WINDOW = (255, 216, 156)

# Andel celler med vinduslys per arealdekkeklasse
WINDOW_DENSITY = {"Tettbebyggelse": 0.05, "Bymessig bebyggelse": 0.18, "Industriområde": 0.07, "Lufthavn": 0.02}
STREET_SPACING = 5  # hver n-te veicelle langs en belyst vei
SETTLEMENT_REACH = 3  # celler: veier så nær bebyggelse regnes som belyst
CLUSTER_REACH_M = 60  # veier så nær en bygning i en klynge regnes som belyst
# Andel bygninger med lys i vinduet: i en klynge, og for seg selv
LIT_IN_CLUSTER, LIT_ALONE = 0.8, 0.5
# Med alle bygg (Matrikkelen) er det mange flere hus: lavere andel, så det blir lyspunkter og ikke et teppe
LIT_EVERY_HOUSE = 0.5


def _dilate(mask: np.ndarray, n: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(n):
        grown = out.copy()
        grown[1:] |= out[:-1]
        grown[:-1] |= out[1:]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def night_lights(
    landcover: np.ndarray,
    features: np.ndarray,
    major_roads: np.ndarray,
    seed: int = 11,
    buildings: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None,
    cell: float = 10.0,
    every_house: bool = False,
) -> np.ndarray:
    """RGB-bilde (uint8) i spillrutenettet.

    `buildings` er (rad, kolonne, i_klynge) per bygning. Uten dem brukes bare arealdekket.
    `every_house`: bygningene er alle som finnes (Matrikkelen). Da lyser husene selv også i
    tettbebyggelse, og lys strøs bare i sentrum, industri og på flyplassen, der byggene er store.
    """
    rng = np.random.default_rng(seed)
    code = {c.name: c.code for c in CLASSES}
    rgb = np.zeros(landcover.shape + (3,), dtype=np.uint8)

    for name, density in WINDOW_DENSITY.items():
        if every_house and name == "Tettbebyggelse":
            continue
        rgb[(landcover == code[name]) & (rng.random(landcover.shape) < density)] = WINDOW

    built_up = np.isin(landcover, [code[n] for n in WINDOW_DENSITY])
    settled = _dilate(built_up, SETTLEMENT_REACH)
    if buildings is not None and len(buildings[0]):
        rows_b, cols_b, clustered = buildings
        # bygninger utenfor de bebygde flatene (der er lysene alt strødd)
        outside = np.ones(len(rows_b), dtype=bool) if every_house else ~built_up[rows_b, cols_b]
        lit = outside & (rng.random(len(rows_b)) < (LIT_EVERY_HOUSE if every_house else np.where(clustered, LIT_IN_CLUSTER, LIT_ALONE)))
        if every_house:
            # Huset tegnes som en boks oppå cella og ville skjult lyset. Lyset legges derfor på bakken i en
            # ledig nabocelle (lys fra vinduene ut i hagen), i en tilfeldig av de fire retningene som er fri.
            h, w = landcover.shape
            r0, c0, start = rows_b[lit], cols_b[lit], rng.integers(0, 4, int(lit.sum()))
            placed = np.zeros(len(r0), dtype=bool)
            for k in range(4):
                turn = (start + k) % 4
                r = np.clip(r0 + np.array([0, 1, 0, -1])[turn], 0, h - 1)
                c = np.clip(c0 + np.array([1, 0, -1, 0])[turn], 0, w - 1)
                free = ~placed & (features[r, c] == n50.NONE)
                rgb[r[free], c[free]] = WINDOW
                placed |= free
        else:
            rgb[rows_b[lit], cols_b[lit]] = WINDOW
        hamlet = np.zeros(landcover.shape, dtype=bool)
        hamlet[rows_b[clustered], cols_b[clustered]] = True
        settled |= _dilate(hamlet, max(1, round(CLUSTER_REACH_M / cell)))
    rows, cols = np.indices(landcover.shape)
    lit = (features == n50.ROAD) & (settled | major_roads) & ((rows * 3 + cols * 7) % STREET_SPACING == 0)
    rgb[lit] = STREET
    return rgb
