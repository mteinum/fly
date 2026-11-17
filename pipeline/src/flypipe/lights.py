"""Nattlys: et eget bilde med gatelys og vinduslys, svart ellers.

Plasseringen er SYNTETISK. Vi har ingen data om hvor lyktestolper står eller
hvilke vinduer som lyser. Lysene legges der N50 sier det er vei og
bebyggelse, med fast tetthet og fast støyfrø, så bildet viser hvor det er
folk - ikke hvor det faktisk er lys.
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


def night_lights(landcover: np.ndarray, features: np.ndarray, major_roads: np.ndarray, seed: int = 11) -> np.ndarray:
    """RGB-bilde (uint8) i spillrutenettet."""
    rng = np.random.default_rng(seed)
    code = {c.name: c.code for c in CLASSES}
    rgb = np.zeros(landcover.shape + (3,), dtype=np.uint8)

    for name, density in WINDOW_DENSITY.items():
        rgb[(landcover == code[name]) & (rng.random(landcover.shape) < density)] = WINDOW

    settled = _dilate(np.isin(landcover, [code[n] for n in WINDOW_DENSITY]), SETTLEMENT_REACH)
    rows, cols = np.indices(landcover.shape)
    lit = (features == n50.ROAD) & (settled | major_roads) & ((rows * 3 + cols * 7) % STREET_SPACING == 0)
    rgb[lit] = STREET
    return rgb
