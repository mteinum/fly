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


def _load_tiles(area_id: str):
    d = TILES.parent / area_id
    if not (d / "metadata.json").exists():
        pytest.skip(f"fliser mangler - kjør `uv run flypipe build {area_id}`")
    meta = json.loads((d / "metadata.json").read_text(encoding="utf-8"))
    hgt = np.fromfile(d / meta["heightmap"]["file"], dtype="<f4").reshape(meta["height"], meta["width"])
    b = meta["bbox"]
    grid = GridSpec(b["west"], b["north"], meta["cellSize"], meta["width"], meta["height"])
    return meta, hgt, grid


@pytest.fixture(scope="session")
def tiles():
    """50 m-flisene (pikselmodus) slik spillet leser dem."""
    return _load_tiles("kjevik")


@pytest.fixture(scope="session", params=["kjevik", "kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10", "mehamn10"])
def any_tiles(request):
    """Hvert flissett etter tur: 50 m-nivået for Kjevik, og 10 m-flisene for hver flyplass."""
    return _load_tiles(request.param)


def area_key(meta: dict) -> str:
    """Flyplassområdet et flissett hører til: «kjevik10» og «kjevik» -> «kjevik»."""
    return meta["id"].removesuffix("10")


def sample_bilinear(hgt: np.ndarray, x: float, y: float) -> float:
    """Samme interpolasjon som web/src/terrain.ts: celleverdien gjelder i cellesenteret."""
    x, y = x - 0.5, y - 0.5
    x0, y0 = int(np.floor(x)), int(np.floor(y))
    fx, fy = x - x0, y - y0
    a, b, c, d = hgt[y0, x0], hgt[y0, x0 + 1], hgt[y0 + 1, x0], hgt[y0 + 1, x0 + 1]
    return float(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy)
