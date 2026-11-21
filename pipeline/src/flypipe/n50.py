"""N50 Kartdata (Kartverket): veier, bruer og bygninger.

Kilde: ferdig fylkesfil i FGDB-format, EPSG:25833, fra Geonorge:
  https://nedlasting.geonorge.no/geonorge/Basisdata/N50Kartdata/FGDB/
Fila caches i data/raw/n50/ (256 MB for Agder).

N50 er generalisert for målestokk 1:50 000. Bygninger er punkter (eller flater
for store bygg), veier er senterlinjer. Det passer til 50 m-celler: en celle
er enten «vei», «bygning» eller ingen av delene.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests
from rasterio.features import rasterize

from . import USER_AGENT
from .grid import GridSpec

BASE_URL = "https://nedlasting.geonorge.no/geonorge/Basisdata/N50Kartdata/FGDB"

# Klasser i feature-rasteret. Høyere tall vinner der flere treffer samme celle.
NONE, BUILDING, ROAD, BRIDGE = 0, 1, 2, 3

# Europa-, riks- og fylkesveier. Kommunale og private veier (1050 km i
# Kjevik-utsnittet) ville fylt nesten hver celle i tettbygde strøk.
ROAD_CATEGORIES = ("E", "R", "F")
# Bruer tas med for alle bilveier, også kommunale og private.
BRIDGE_CATEGORIES = ("E", "R", "F", "K", "P")
MAJOR_ROAD_HALF_WIDTH = 7.0  # m


def gdb_path(county: str, raw_dir: Path) -> Path:
    """Last ned og pakk ut fylkesfila hvis den ikke finnes. `county` f.eks. '42_Agder'."""
    name = f"Basisdata_{county}_25833_N50Kartdata_FGDB"
    target = raw_dir / "n50" / county
    gdb = target / f"{name}.gdb"
    if not gdb.exists():
        zip_path = raw_dir / "n50" / f"{name}.zip"
        if not zip_path.exists():
            print(f"  N50: laster ned {name}.zip")
            zip_path.parent.mkdir(parents=True, exist_ok=True)
            with requests.get(f"{BASE_URL}/{name}.zip", headers={"User-Agent": USER_AGENT}, stream=True, timeout=600) as r:
                r.raise_for_status()
                with zip_path.open("wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(target)
    return gdb


def _read(gdb: Path, layer: str, grid: GridSpec) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(gdb, layer=layer, bbox=(grid.west, grid.south, grid.east, grid.north), engine="pyogrio")
    assert gdf.crs is not None and gdf.crs.to_epsg() == 25833, gdf.crs
    return gdf


def load_features(
    county: str, grid: GridSpec, raw_dir: Path, road_categories: tuple[str, ...] = ROAD_CATEGORIES
) -> dict[str, gpd.GeoDataFrame]:
    """Veier, bruer og bygninger innenfor rutenettet, i UTM 33."""
    gdb = gdb_path(county, raw_dir)
    lines = _read(gdb, "N50_Samferdsel_senterlinje", grid)
    cars = lines[(lines["objtype"] == "Veglenke") & (lines["typeveg"] == "enkelBilveg")]
    # medium: T = på terrenget, L = i lufta (bru), U = under terrenget (tunnel, tegnes ikke)
    roads = cars[(cars["medium"] == "T") & cars["vegkategori"].isin(road_categories)]
    bridges = cars[(cars["medium"] == "L") & cars["vegkategori"].isin(BRIDGE_CATEGORIES)]
    tunnels = cars[(cars["medium"] == "U") & cars["vegkategori"].isin(road_categories)]
    points = _read(gdb, "N50_BygningerOgAnlegg_posisjon", grid)
    areas = _read(gdb, "N50_BygningerOgAnlegg_omrade", grid)
    return {
        "roads": roads,
        "bridges": bridges,
        "tunnels": tunnels,
        "buildingPoints": points[points["objtype"] == "Bygning"],
        "buildingAreas": areas[areas["objtype"] == "Bygning"],
    }


def rasterize_large_buildings(features: dict[str, gpd.GeoDataFrame], grid: GridSpec) -> np.ndarray:
    """Celler med en bygning som er stor nok til å være flate i N50."""
    areas = features["buildingAreas"].geometry
    shapes = [g for geoms in (areas, areas.representative_point()) for g in geoms if g is not None and not g.is_empty]
    if not shapes:
        return np.zeros((grid.height, grid.width), dtype=bool)
    return rasterize(shapes, out_shape=(grid.height, grid.width), transform=grid.transform, dtype="uint8").astype(bool)


def major_road_mask(features: dict[str, gpd.GeoDataFrame], grid: GridSpec) -> np.ndarray:
    """Celler med europa- eller riksvei."""
    roads = features["roads"]
    shapes = [g for g in roads.geometry[roads["vegkategori"].isin(("E", "R"))] if g is not None and not g.is_empty]
    if not shapes:
        return np.zeros((grid.height, grid.width), dtype=bool)
    return rasterize(shapes, out_shape=(grid.height, grid.width), transform=grid.transform, dtype="uint8").astype(bool)


def rasterize_features(features: dict[str, gpd.GeoDataFrame], grid: GridSpec) -> np.ndarray:
    """Feature-raster (uint8) i spillrutenettet. Bru > vei > bygning."""
    areas = features["buildingAreas"].geometry
    roads = features["roads"]
    if grid.cell <= MAJOR_ROAD_HALF_WIDTH * 2 and len(roads):
        # fine celler: europa- og riksveier får bredde, resten er 1-celle-streker
        major = roads["vegkategori"].isin(("E", "R"))
        roads = gpd.GeoDataFrame(geometry=roads.geometry.where(~major, roads.geometry.buffer(MAJOR_ROAD_HALF_WIDTH, cap_style="flat")))
    order = [
        (features["buildingAreas"], BUILDING),
        # de fleste bygningsflater er mindre enn en celle og ville falt mellom cellesentrene
        (gpd.GeoDataFrame(geometry=areas.representative_point()), BUILDING),
        (features["buildingPoints"], BUILDING),
        (roads, ROAD),
        (features["bridges"], BRIDGE),
    ]
    shapes = [(geom, value) for gdf, value in order for geom in gdf.geometry if geom is not None and not geom.is_empty]
    if not shapes:
        return np.zeros((grid.height, grid.width), dtype=np.uint8)
    # Uten all_touched: linjer brennes som sammenhengende 1-celle-streker,
    # flater tar celler med sentrum innenfor. Senere former overskriver tidligere.
    return rasterize(shapes, out_shape=(grid.height, grid.width), transform=grid.transform, fill=NONE, dtype="uint8")


TUNNEL_MIN_LENGTH_M = 150.0  # kortere tunneler (underganger, kulverter) tegnes ikke


def tunnel_lines(features: dict[str, gpd.GeoDataFrame], grid: GridSpec) -> list[list[list[float]]]:
    """Tunnelene (veier med medium = U) som polylinjer i rutenettkoordinater: [[x, y], ...] per tunnel."""
    out = []
    for geom in features["tunnels"].geometry:
        for line in getattr(geom, "geoms", [geom]) if geom is not None and not geom.is_empty else []:
            if line.length < TUNNEL_MIN_LENGTH_M:
                continue
            pts = [[round(v, 2) for v in grid.utm_to_grid(x, y)] for x, y, *_ in line.simplify(2.0).coords]
            if all(0 <= x < grid.width and 0 <= y < grid.height for x, y in pts):
                out.append(pts)
    return sorted(out)


# Navnetyper som ikke tas med. Tunnelnavn er med (tunnelene tegnes stiplet), merket så de ikke forveksles med stedet.
SKIP_NAME_TYPES: set[str] = set()
# Navn med minst denne skriftstørrelsen flyttes fra kartteksten til stedets eget punkt i SSR
SSR_POINT_MIN_SIZE = 8.5
SSR_URL = "https://ws.geonorge.no/stedsnavn/v1/sted"
# Fyr står på små skjær: kartteksten ved siden av ville lagt dem i sjøen. De flyttes alltid til stedets punkt.
LIGHTHOUSE_TYPES = ("fyrstasjon", "fyrlykt")


SSR_POINTS = Path(__file__).resolve().parents[3] / "data" / "ssr_points.json"


def ssr_point(stedsnummer: int, raw_dir: Path) -> tuple[float, float] | None:
    """Stedets representasjonspunkt (øst, nord i EPSG:25833) fra Sentralt stedsnavnregister.

    Punktene ligger i data/ssr_points.json, som er i git: bygget skal ikke stoppe fordi et API
    er nede (det skjedde: tjenesten svarte 503 til GitHub Actions mens den virket lokalt).
    Et stedsnummer som mangler der slås opp og legges til i fila.
    """
    import json
    import time

    store = json.loads(SSR_POINTS.read_text(encoding="utf-8")) if SSR_POINTS.exists() else {"points": {}}
    key = str(stedsnummer)
    if key not in store["points"]:
        for attempt in range(4):
            r = requests.get(SSR_URL, params={"stedsnummer": stedsnummer, "utkoordsys": 25833}, headers={"User-Agent": USER_AGENT}, timeout=60)
            if r.status_code == 200:
                break
            time.sleep(2 * (attempt + 1))
        else:
            raise RuntimeError(
                f"Stedsnavn-API-et svarte {r.status_code} for stedsnummer {stedsnummer}. "
                "Kjør bygget lokalt, så legges punktet i data/ssr_points.json, og sjekk fila inn."
            )
        hits = r.json().get("navn", [])
        p = hits[0].get("representasjonspunkt") if hits else None
        assert p is None or p.get("koordsys") == 25833, p
        store["points"][key] = [round(float(p["øst"]), 2), round(float(p["nord"]), 2)] if p else None
        store["points"] = dict(sorted(store["points"].items(), key=lambda kv: int(kv[0])))
        SSR_POINTS.write_text(json.dumps(store, ensure_ascii=False, indent=0), encoding="utf-8")
    point = store["points"][key]
    return (point[0], point[1]) if point else None


def load_names(county: str, grid: GridSpec, raw_dir: Path) -> list[dict]:
    """Stedsnavn fra N50 sitt tekstlag: navn, plass, type og kartets skriftstørrelse.

    Laget er laget for å trykke kartet i 1:50 000: ett navn kan være delt i flere
    tekstbiter («Topdals-» + «fjorden»), og skriftstørrelsen sier hvor viktig
    kartografen mente navnet var. Vi slår bitene sammen per sted (stedsnummer),
    bruker hele navnet (`fulltekst`), og legger navnet midt i tekstbitene.
    Høydetall og fastmerker (rader uten stedsnummer) tas ikke med.

    Kartteksten står ved siden av stedet, ikke på det: «Kristiansand» er trykket
    1,4 km fra sentrum, ute i havna. De største navnene (ses på lang avstand)
    flyttes derfor til stedets eget punkt i SSR, slått opp på stedsnummer.
    """
    gdf = _read(gdb_path(county, raw_dir), "N50_Stedsnavn_tekstplassering", grid)
    gdf = gdf[gdf["stedsnummer"].notna() & gdf["fulltekst"].notna() & ~gdf["navneobjekttype"].isin(SKIP_NAME_TYPES)]
    names = []
    for _, parts in gdf.groupby("stedsnummer"):
        first = parts.iloc[0]
        where = parts.geometry.union_all().centroid
        x, y = grid.utm_to_grid(where.x, where.y)
        if not (0 <= x < grid.width and 0 <= y < grid.height):
            continue
        if float(parts["FontSize"].max()) >= SSR_POINT_MIN_SIZE or first["navneobjekttype"] in LIGHTHOUSE_TYPES:
            point = ssr_point(int(first["stedsnummer"]), raw_dir)
            if point:
                sx, sy = grid.utm_to_grid(*point)
                if 0 <= sx < grid.width and 0 <= sy < grid.height:
                    x, y = sx, sy
        name = str(first["fulltekst"]).strip()
        if first["navneobjekttype"] == "tunnel" and "tunnel" not in name.lower():
            name += " (tunnel)"  # kartet har tunnelsymbol ved navnet; her må ordet til
        names.append({
            "name": name,
            "x": x, "y": y,
            "size": round(float(parts["FontSize"].max()), 2),
            "type": str(first["navneobjekttype"]),
            "group": str(first["navneobjekthovedgruppe"]),
            "stedsnummer": int(first["stedsnummer"]),
        })
    return sorted(names, key=lambda n: (-n["size"], n["name"]))
