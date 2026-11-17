import json
from pathlib import Path

import numpy as np
import pytest

from flypipe.grid import GridSpec

REPO = Path(__file__).resolve().parents[2]
TILES = REPO / "web" / "public" / "data" / "kjevik"


@pytest.fixture(scope="session")
def reference():
    return json.loads((REPO / "tests" / "fixtures" / "reference_points.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def tiles():
    """Ferdige fliser slik spillet leser dem. Kjør `uv run flypipe build` først."""
    if not (TILES / "metadata.json").exists():
        pytest.skip("fliser mangler - kjør `uv run flypipe build kjevik`")
    meta = json.loads((TILES / "metadata.json").read_text(encoding="utf-8"))
    hgt = np.fromfile(TILES / meta["heightmap"]["file"], dtype="<f4").reshape(meta["height"], meta["width"])
    b = meta["bbox"]
    grid = GridSpec(b["west"], b["north"], meta["cellSize"], meta["width"], meta["height"])
    return meta, hgt, grid


def sample_bilinear(hgt: np.ndarray, x: float, y: float) -> float:
    """Samme interpolasjon som web/src/terrain.ts: celleverdien gjelder i cellesenteret."""
    x, y = x - 0.5, y - 0.5
    x0, y0 = int(np.floor(x)), int(np.floor(y))
    fx, fy = x - x0, y - y0
    a, b, c, d = hgt[y0, x0], hgt[y0, x0 + 1], hgt[y0 + 1, x0], hgt[y0 + 1, x0 + 1]
    return float(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy)
