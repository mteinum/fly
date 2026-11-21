"""Bygninger med form: omriss fra OpenStreetMap, type fra Matrikkelen, høyde fra DOM der bygget er stort nok.

Hvert bygg blir et omriss med flatt tak (buildings.bin, tegnes av spillet) og et sett celler i
spillrutenettet (structures.json, brukes til kollisjon, nattlys og analyser).

Hva som er ekte og ikke:
- Omrisset er ekte (OSM, opprinnelig Kartverket), forenklet til 0,6 m.
- Typen er ekte der omrisset har matrikkelens bygningsnummer; ellers ukjent.
- Høyden er MÅLT (median av DOM - DTM innenfor omrisset) for bygg som dekker minst tre 10 m-celler, fra
  etasjetallet i OSM der det finnes, og ellers NOMINELL etter bygningstype.
- Taket er flatt for alle. Saltak, tårn og karnapper finnes ikke.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
from rasterio.features import rasterize
from shapely.geometry import Polygon

from . import matrikkel, osm
from .grid import GridSpec

MAGIC = b"FBLD"
VERSION = 1
MIN_CELLS_FOR_DOM = 3  # færre celler gir ingen pålitelig median av 10 m-høyder
HEIGHT_RANGE = (4.0, 80.0)
STOREY_M = 3.0  # etasjehøyde når høyden regnes fra building:levels
MATCH_DISTANCE_M = 20.0  # et Matrikkel-punkt så nær et omriss regnes som samme bygg


def build(
    fp: osm.Footprints, types: dict[int, int], hgt: np.ndarray, ndsm: np.ndarray | None, grid: GridSpec
) -> tuple[list[dict], np.ndarray]:
    """Bygg fra omrissene: [{ring, base, top, color, type, cells, height_source}], og hvilke omriss som ble med (bool per omriss)."""
    ground = np.maximum(hgt, 0)
    polys = [Polygon(fp.ring(i)) for i in range(len(fp))]
    # hvilke celler hvert omriss dekker: cellesenter innenfor. Senere omriss overskriver tidligere der de overlapper.
    labels = rasterize([(p, i + 1) for i, p in enumerate(polys)], out_shape=hgt.shape, transform=grid.transform, fill=0, dtype="int32")
    order = np.argsort(labels, axis=None, kind="stable")
    bounds = np.searchsorted(labels.ravel()[order], np.arange(1, len(polys) + 2))
    out, used = [], np.zeros(len(fp), dtype=bool)
    for i, poly in enumerate(polys):
        kind = types.get(int(fp.ref[i]), 0)
        if kind in matrikkel.OUTBUILDINGS:
            continue
        cells = order[bounds[i] : bounds[i + 1]]
        if cells.size == 0:
            # mindre enn en celle, eller mellom cellesentrene: cella midt i bygget
            c = poly.representative_point()
            x, y = grid.utm_to_grid(c.x, c.y)
            cells = np.array([int(y) * grid.width + int(x)])
        if ndsm is not None and cells.size >= MIN_CELLS_FOR_DOM:
            height, source = float(np.clip(np.median(ndsm.ravel()[cells]), *HEIGHT_RANGE)), "dom"
        elif fp.levels[i] > 0:
            height, source = float(np.clip(fp.levels[i] * STOREY_M + 1.0, *HEIGHT_RANGE)), "levels"
        else:
            height, source = float(matrikkel.nominal_height(np.array([kind]))[0]) if kind else matrikkel.HEIGHT_DEFAULT, "nominal"
        g = ground.ravel()[cells]
        base = float(g.min())  # veggene går ned til laveste punkt, så bygget ikke svever i en bakke
        name, colors = matrikkel.profile(kind) if kind else matrikkel.PROFILE_DEFAULT
        ring = fp.ring(i)
        out.append({
            "ring": ring, "base": base, "top": float(np.median(g)) + height, "type": kind, "profile": name,
            "color": colors[int(ring[0, 0] + ring[0, 1]) % 2],  # fast veksling mellom de to fargene
            "cells": cells, "height_source": source,
        })
        used[i] = True
    return out, used


def unmatched(points, fp: osm.Footprints, used: np.ndarray):
    """Matrikkel-byggene som ikke har noe omriss: de beholdes som bokser.

    Et bygg har omriss når bygningsnummeret finnes blant omrissene, eller når punktet ligger i eller nær et.
    """
    from scipy.spatial import cKDTree

    refs = set(int(r) for r in fp.ref[used] if r)
    by_number = points["bygningsnummer"].isin(refs).to_numpy()
    centres = np.array([fp.ring(i).mean(axis=0) for i in np.flatnonzero(used)])
    px = np.c_[points.geometry.x, points.geometry.y]
    near = cKDTree(centres).query(px)[0] <= MATCH_DISTANCE_M if len(centres) else np.zeros(len(px), dtype=bool)
    return points[~(by_number | near)].reset_index(drop=True)


def write(path: Path, buildings: list[dict], grid: GridSpec) -> None:
    """buildings.bin, little-endian: «FBLD», versjon (u32), antall (u32), og per bygg:
    hjørner (u16), r, g, b (u8), 0 (u8), bunn og topp (f32, m NN2000), så hjørnene som (x, z) i f32:
    meter fra kartets nordvestre hjørne, x mot øst og z mot sør, som i rendereren."""
    with path.open("wb") as f:
        f.write(MAGIC + struct.pack("<II", VERSION, len(buildings)))
        for b in buildings:
            ring = b["ring"]
            f.write(struct.pack("<H4Bff", len(ring), *b["color"], 0, b["base"], b["top"]))
            xz = np.c_[ring[:, 0] - grid.west, grid.north - ring[:, 1]].astype("<f4")
            f.write(xz.tobytes())
