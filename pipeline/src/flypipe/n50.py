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
import pandas as pd
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


def counties(county: str) -> list[str]:
    """Fylkene et utsnitt ligger i. Ett utsnitt over en fylkesgrense skrives «32_Akershus+03_Oslo»."""
    return county.split("+")


def gdb_paths(county: str, raw_dir: Path) -> list[Path]:
    return [gdb_path(c, raw_dir) for c in counties(county)]


def read_layers(gdbs: list[Path], layer: str, grid: GridSpec, **kwargs) -> gpd.GeoDataFrame:
    """Ett lag innenfor rutenettet, satt sammen fra alle fylkesfilene. Fylkesfilene er klippet i fylkesgrensa og overlapper ikke."""
    parts = []
    for gdb in gdbs:
        gdf = gpd.read_file(gdb, layer=layer, bbox=(grid.west, grid.south, grid.east, grid.north), engine="pyogrio", **kwargs)
        assert gdf.crs is not None and gdf.crs.to_epsg() == 25833, gdf.crs
        parts.append(gdf)
    return parts[0] if len(parts) == 1 else gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=parts[0].crs)


def _read(county: str, raw_dir: Path, layer: str, grid: GridSpec) -> gpd.GeoDataFrame:
    return read_layers(gdb_paths(county, raw_dir), layer, grid)


def load_features(
    county: str, grid: GridSpec, raw_dir: Path, road_categories: tuple[str, ...] = ROAD_CATEGORIES
) -> dict[str, gpd.GeoDataFrame]:
    """Veier, bruer og bygninger innenfor rutenettet, i UTM 33."""
    lines = _read(county, raw_dir, "N50_Samferdsel_senterlinje", grid)
    cars = lines[(lines["objtype"] == "Veglenke") & (lines["typeveg"] == "enkelBilveg")]
    # medium: T = på terrenget, L = i lufta (bru), U = under terrenget (tunnel, tegnes ikke)
    roads = cars[(cars["medium"] == "T") & cars["vegkategori"].isin(road_categories)]
    bridges = cars[(cars["medium"] == "L") & cars["vegkategori"].isin(BRIDGE_CATEGORIES)]
    tunnels = cars[(cars["medium"] == "U") & cars["vegkategori"].isin(road_categories)]
    points = _read(county, raw_dir, "N50_BygningerOgAnlegg_posisjon", grid)
    areas = _read(county, raw_dir, "N50_BygningerOgAnlegg_omrade", grid)
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
# Navnene flyttes fra kartteksten til stedets eget punkt i SSR (se load_names)
SSR_URL = "https://ws.geonorge.no/stedsnavn/v1/sted"
LIGHTHOUSE_TYPES = ("fyrstasjon", "fyrlykt")


SSR_POINTS = Path(__file__).resolve().parents[3] / "data" / "ssr_points.json"
SSR_NEAR_URL = "https://ws.geonorge.no/stedsnavn/v1/punkt"
SSR_NEAR_RADIUS_M = 5000  # tjenestens største radius
SSR_PAGE = 500  # tjenestens største sidestørrelse


def _ssr_get(url: str, params: dict) -> dict:
    """Ett kall mot stedsnavn-API-et, med nye forsøk. Tjenesten svarer av og til 503."""
    import time

    status: object = None
    for attempt in range(5):
        try:
            r = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=90)
            if r.status_code == 200:
                return r.json()
            status = r.status_code
        except requests.RequestException as e:  # tidsavbrudd og brutte forbindelser: prøv igjen
            status = type(e).__name__
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(
        f"Stedsnavn-API-et svarte {status} for {params}. "
        "Kjør bygget lokalt, så legges punktene i data/ssr_points.json, og sjekk fila inn."
    )


def _ssr_xy(hit: dict) -> list[float] | None:
    p = hit.get("representasjonspunkt")
    assert p is None or p.get("koordsys") == 25833, p
    return [round(float(p["øst"]), 2), round(float(p["nord"]), 2)] if p else None


def ssr_points(numbers: list[int], grid: GridSpec) -> dict[int, tuple[float, float] | None]:
    """Stedenes representasjonspunkt (øst, nord i EPSG:25833) fra Sentralt stedsnavnregister, per stedsnummer.

    Punktene ligger i data/ssr_points.json, som er i git: bygget skal ikke stoppe fordi et API
    er nede (det skjedde: tjenesten svarte 503 til GitHub Actions mens den virket lokalt).
    Stedsnumre som mangler der slås opp og legges til i fila. Mangler det mange, hentes alle steder
    i utsnittet med /punkt (sirkler på 5 km som dekker rutenettet) i stedet for ett kall per sted.
    """
    import json
    import time

    store = json.loads(SSR_POINTS.read_text(encoding="utf-8")) if SSR_POINTS.exists() else {"points": {}}
    points = store["points"]

    def save() -> None:
        store["points"] = dict(sorted(points.items(), key=lambda kv: int(kv[0])))
        SSR_POINTS.write_text(json.dumps(store, ensure_ascii=False, indent=0), encoding="utf-8")

    missing = {n for n in numbers if str(n) not in points}
    if len(missing) > 20:
        step = SSR_NEAR_RADIUS_M * 1.4  # sirklene overlapper så vidt i hjørnene av rutene (radius > step / sqrt(2))
        nx, ny = int(-(-(grid.east - grid.west) // step)), int(-(-(grid.north - grid.south) // step))
        for i in range(nx):
            for j in range(ny):
                page = 1
                while True:
                    data = _ssr_get(SSR_NEAR_URL, {
                        "ost": grid.west + (i + 0.5) * step, "nord": grid.south + (j + 0.5) * step, "koordsys": 25833,
                        "utkoordsys": 25833, "radius": SSR_NEAR_RADIUS_M, "treffPerSide": SSR_PAGE, "side": page,
                    })
                    for hit in data.get("navn", []):
                        if hit.get("stedsnummer") in missing:
                            points[str(hit["stedsnummer"])] = _ssr_xy(hit)
                    if page * SSR_PAGE >= data["metadata"]["totaltAntallTreff"]:
                        break
                    page += 1
                    time.sleep(0.1)
                save()  # etter hver sirkel, så et avbrudd ikke kaster det som er hentet
        missing = {n for n in missing if str(n) not in points}
    for n in sorted(missing):
        hits = _ssr_get(SSR_URL, {"stedsnummer": n, "utkoordsys": 25833}).get("navn", [])
        points[str(n)] = _ssr_xy(hits[0]) if hits else None
    if missing:
        save()
    return {n: (tuple(points[str(n)]) if points[str(n)] else None) for n in numbers}


def load_names(county: str, grid: GridSpec, raw_dir: Path) -> list[dict]:
    """Stedsnavn fra N50 sitt tekstlag: navn, plass, type og kartets skriftstørrelse.

    Laget er laget for å trykke kartet i 1:50 000: ett navn kan være delt i flere
    tekstbiter («Topdals-» + «fjorden»), og skriftstørrelsen sier hvor viktig
    kartografen mente navnet var. Vi slår bitene sammen per sted (stedsnummer),
    bruker hele navnet (`fulltekst`), og legger navnet midt i tekstbitene.
    Høydetall og fastmerker (rader uten stedsnummer) tas ikke med.

    Kartteksten står ved siden av stedet, ikke på det: «Kristiansand» er trykket
    1,4 km fra sentrum, ute i havna, og «Ramsøya» 400 m ute i sjøen. Alle navn
    flyttes derfor til stedets eget punkt i SSR, slått opp på stedsnummer. Bare
    steder uten punkt i registeret, eller med punktet utenfor utsnittet, står ved kartteksten.
    """
    gdf = _read(county, raw_dir, "N50_Stedsnavn_tekstplassering", grid)
    gdf = gdf[gdf["stedsnummer"].notna() & gdf["fulltekst"].notna() & ~gdf["navneobjekttype"].isin(SKIP_NAME_TYPES)]
    names = []
    points = ssr_points(sorted({int(n) for n in gdf["stedsnummer"]}), grid)
    for _, parts in gdf.groupby("stedsnummer"):
        first = parts.iloc[0]
        where = parts.geometry.union_all().centroid
        x, y = grid.utm_to_grid(where.x, where.y)
        if not (0 <= x < grid.width and 0 <= y < grid.height):
            continue
        point = points[int(first["stedsnummer"])]
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
