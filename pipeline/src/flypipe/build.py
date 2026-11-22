"""Bygg spillfliser for ett utsnitt: heightmap.f32 + colormap.png + metadata.json."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.features import rasterize
from shapely.geometry import LineString

from . import airports, analysis, dtm, footprints, landcover, lights, matrikkel, n50, osm, structures, terrain
from .areas import AREAS, Area
from .crs import UTM33, geoid_separation, grid_convergence_deg, scale_factor, utm33_to_wgs84
from .grid import GridSpec

REPO = Path(__file__).resolve().parents[3]
RAW = REPO / "data" / "raw"
PROCESSED = REPO / "data" / "processed"
TILES = REPO / "web" / "public" / "data"
LANDMARKS = REPO / "data" / "landmarks.json"

SUN_AZIMUTH_TRUE = 225.0
SUN_ELEVATION = 28.0


def runway_mask(airport: dict, grid: GridSpec) -> np.ndarray:
    """Rasteriser rullebanene (senterlinje bufret til full bredde) til rutenettet."""
    shapes = []
    for rw in airport["runways"]:
        le, he = rw["ends"]
        line = LineString([(le["east"], le["north"]), (he["east"], he["north"])])
        shapes.append(line.buffer(rw["widthM"] / 2, cap_style="flat"))
    # all_touched: banen er 45 m bred og ville ellers falle mellom 50 m-cellene
    return rasterize(shapes, out_shape=(grid.height, grid.width), transform=grid.transform, all_touched=True).astype(bool)


def _write_geotiff(path: Path, data: np.ndarray, grid: GridSpec) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bands = data[None] if data.ndim == 2 else np.moveaxis(data, -1, 0)
    with rasterio.open(
        path, "w", driver="GTiff", width=grid.width, height=grid.height, count=bands.shape[0],
        dtype=bands.dtype, crs=UTM33, transform=grid.transform, compress="deflate",
    ) as dst:
        dst.write(bands)


def build(area: Area) -> Path:
    raw = RAW / area.raw_id
    print(f"[{area.id}] flyplass {area.icao} (OurAirports)")
    arp = airports.load_airport(area.icao, RAW)["arp"]
    grid = GridSpec.centered(arp["east"] + area.center_offset[0], arp["north"] + area.center_offset[1], area.cell, area.size)
    airport = airports.load_airport(area.icao, RAW, grid)

    print(f"[{area.id}] DTM {area.source_res:g} m fra WCS, bbox {grid.west:.0f},{grid.south:.0f},{grid.east:.0f},{grid.north:.0f}")
    src = dtm.load_source_dtm(grid, area.source_res, raw)
    factor = int(area.cell / area.source_res)
    hgt = terrain.block_mean(src, factor)

    cx, cy = grid.grid_to_utm(grid.width / 2, grid.height / 2)
    conv = grid_convergence_deg(cx, cy)
    sun_grid = (SUN_AZIMUTH_TRUE - conv) % 360
    shade = terrain.hillshade(hgt, area.cell, sun_grid, SUN_ELEVATION)
    features = lc = None
    items: list[list] = []
    bridge_lines: list[dict] = []
    towers: list[list[float]] = []
    church = []
    profile_cells: dict[str, int] = {}
    if area.n50_county:
        print(f"[{area.id}] N50 {area.n50_county}: arealdekke, veier, bruer, bygninger")
        lc = landcover.load_landcover(n50.gdb_paths(area.n50_county, RAW), grid)
        vectors = n50.load_features(area.n50_county, grid, RAW, area.road_categories)
        point_heights = None
        if area.matrikkel_buildings:
            # alle bygg fra Matrikkelen erstatter N50s utvalg av bygningspunkter. N50s flater (store bygg) beholdes:
            # de gir form, og høyde fra DOM
            print(f"[{area.id}] Matrikkelen {area.n50_county}: bygningspunkter")
            n50_points = len(vectors["buildingPoints"])
            vectors["buildingPoints"] = matrikkel.load_buildings(area.n50_county, grid, RAW)
            all_buildings = vectors["buildingPoints"]  # alle bygg, til klynger og nattlys
        ndsm = None
        if area.dom_building_heights:
            print(f"[{area.id}] DOM {area.source_res:g} m (bygningshøyder)")
            ndsm = terrain.block_mean(dtm.load_source_dom(grid, area.source_res, raw), factor) - hgt
        shaped: list[dict] = []
        if area.osm_footprints:
            # Bygg med omriss tegnes som form. Bare Matrikkel-byggene uten omriss blir igjen som bokser, og N50s
            # flater for store bygg trengs ikke (omrissene dekker dem).
            fp = osm.load(area.id)
            print(f"[{area.id}] OpenStreetMap: {len(fp)} bygningsomriss (hentet {fp.fetched})")
            shaped, used = footprints.build(fp, matrikkel.type_by_number(area.n50_county, grid, RAW), hgt, ndsm, grid)
            vectors["buildingPoints"] = footprints.unmatched(vectors["buildingPoints"], fp, used)
            vectors = {**vectors, "towerAreas": vectors["buildingAreas"], "buildingAreas": vectors["buildingAreas"].iloc[0:0]}
        if area.matrikkel_buildings:
            point_heights = matrikkel.height_raster(vectors["buildingPoints"], grid)
        print(f"[{area.id}] DOM 1 m rundt bruene (dekkhøyde)")
        items, bridge_lines, features = structures.build_structures(
            vectors, n50.rasterize_features(vectors, grid), hgt, grid, raw, ndsm, point_heights=point_heights
        )
        if shaped:
            # cellene under omrissene: til kollisjon, nattlys og analyser. Niende felt = 1: tegnes som form, ikke som boks
            boxes = {(it[0], it[1]) for it in items}
            for b in shaped:
                for cell in b["cells"]:
                    row, col = divmod(int(cell), grid.width)
                    if features[row, col] == n50.NONE and (col, row) not in boxes:
                        features[row, col] = n50.BUILDING
                        items.append([col, row, structures.BUILDING, round(b["base"], 1), round(b["top"], 1), *b["color"], 1])
        if area.matrikkel_buildings:
            # Farge etter bygningstype (se matrikkel.PROFILE_*). Celler uten kjent type beholder fargen de har.
            types = matrikkel.type_raster(vectors["buildingPoints"], vectors["buildingAreas"], grid)
            for b in shaped:
                profile_cells[b["profile"]] = profile_cells.get(b["profile"], 0) + len(b["cells"])
            for it in items:
                code = int(types[it[1], it[0]])
                if it[2] == structures.BUILDING and code and len(it) == 8:
                    name, colors = matrikkel.profile(code)
                    it[5:8] = colors[(it[0] * 7 + it[1] * 13) % 2]  # fast veksling, så naboer ikke blir helt like
                    profile_cells[name] = profile_cells.get(name, 0) + 1
            # Kirker med tårn der overflatemodellen viser et
            church = all_buildings[all_buildings["bygningstype"] == matrikkel.CHURCH]
            print(f"[{area.id}] DOM 1 m rundt {len(church)} kirker (tårn)")
            towers = structures.church_towers(church, hgt, grid, raw)
    if area.tours:
        airport["tours"] = []
        for tour in area.tours:
            tx, ty = grid.utm_to_grid(tour.east, tour.north)
            assert 0 <= tx < grid.width and 0 <= ty < grid.height, tour
            assert any(e["ident"] == tour.runway for rw in airport["runways"] for e in rw["ends"]), tour
            airport["tours"].append({
                "name": tour.name, "runway": tour.runway, "east": tour.east, "north": tour.north, "x": round(tx, 3), "y": round(ty, 3),
                "altitudeM": tour.altitude_m, "headingTrueDeg": tour.heading_true_deg,
                "source": "valgt for hånd (ikke en publisert rute)",
            })
    airport["tower"] = airports.tower_position(airport, vectors.get("towerAreas", vectors["buildingAreas"]) if area.n50_county else None, hgt, grid)

    # Analyser: hva tårnet ser, klaringen under hver innflyging, og bygningsklynger (se analysis.py)
    print(f"[{area.id}] analyser: synlighet fra tårnet, klaring under innflygingene, bygningsklynger")
    tower = airport["tower"]
    need = analysis.required_altitude(hgt, area.cell, tower["x"], tower["y"], tower["eyeM"])
    top = analysis.surface_top(hgt, items)
    for rw in airport["runways"]:
        for end in rw["ends"]:
            end["approach"] = analysis.approach_facts(end, hgt, top, need, area.cell)
    above_ground = need - np.maximum(hgt, 0)
    viewshed = {
        "groundSeenShare": round(float((above_ground < 1).mean()), 3),
        "seenAt300mShare": round(float((above_ground <= 300).mean()), 3),
        "method": "siktlinjer fra tårnets øyepunkt over terrenget (DTM), med jordkrumning og standard brytning (k = 0,13)",
        "limits": "trær og bygninger sperrer ikke sikten her; tårnets plassering og øyehøyde er antatt",
    }
    building_xy = np.zeros((0, 2))
    clusters = np.zeros(0, dtype=int)
    if area.n50_county:
        # Matrikkelen har alle bygg som punkt. Med N50 må flatene (store bygg) tas med i tillegg til punktene.
        centres = [all_buildings.geometry] if area.matrikkel_buildings else [vectors["buildingPoints"].geometry, vectors["buildingAreas"].geometry.centroid]
        building_xy = np.array([(p.x, p.y) for series in centres for p in series], dtype=float).reshape(-1, 2)
        cluster_eps = analysis.CLUSTER_EPS_M if area.matrikkel_buildings else analysis.CLUSTER_EPS_GENERALISED_M
        clusters = analysis.building_clusters(building_xy, cluster_eps)
    # Stedsnavn: høyden er terrenget under navnet. Brunavn flyttes opp på brua, til nærmeste punkt på dekket.
    names: list[dict] = n50.load_names(area.n50_county, grid, RAW) if area.n50_county else []
    deck = [(px, py, pz) for b in bridge_lines for px, py, pz in b["points"]]
    def ground(n: dict) -> float:
        # Avrund FØR oppslaget: fila lagrer to desimaler, og 123,996 -> 124,00 er en annen celle
        n["x"], n["y"] = min(round(n["x"], 2), grid.width - 0.01), min(round(n["y"], 2), grid.height - 0.01)
        return max(0.0, float(hgt[int(n["y"]), int(n["x"])]))

    for n in names:
        # Flyplassens navn står i kartet ved siden av plassen (ved Kjevik 1,5 km unna, ute i fjorden).
        # Det flyttes til flyplassens referansepunkt, som vi har fra OurAirports.
        if n["type"] == "flyplass" and np.hypot(n["x"] - airport["arp"]["x"], n["y"] - airport["arp"]["y"]) * area.cell < 3000:
            n["x"], n["y"] = airport["arp"]["x"], airport["arp"]["y"]
        n["z"] = ground(n)
        if n["type"] == "bru" and deck:
            px, py, pz = min(deck, key=lambda p: (p[0] - n["x"]) ** 2 + (p[1] - n["y"]) ** 2)
            if np.hypot(px - n["x"], py - n["y"]) * area.cell < 400:
                n["x"], n["y"] = px, py
                n["z"] = max(ground(n), pz)
    # Kjennemerker med logo (data/landmarks.json): de som ligger i utsnittet, med høyden på stedet
    landmarks = []
    for lm in json.loads(LANDMARKS.read_text(encoding="utf-8"))["landmarks"] if area.n50_county else []:
        lx, ly = grid.utm_to_grid(lm["east"], lm["north"])
        if 0 <= lx < grid.width and 0 <= ly < grid.height:
            roofs = [it[4] for it in items if it[2] == structures.BUILDING and abs(it[0] - lx) < 3 and abs(it[1] - ly) < 3]
            z = max([max(0.0, float(hgt[int(ly), int(lx)])), *roofs])  # over takene rundt, så skiltet ikke står inne i et bygg
            landmarks.append({"id": lm["id"], "name": lm["name"], "x": round(lx, 2), "y": round(ly, 2), "z": round(z, 1), "image": lm["image"]})
    # Signalbygg uten navn i N50 (data/landmarks.json, «signs»): et navneskilt som de andre stedsnavnene, over taket
    for sign in json.loads(LANDMARKS.read_text(encoding="utf-8")).get("signs", []) if area.n50_county else []:
        sx, sy = grid.utm_to_grid(sign["east"], sign["north"])
        if not (0 <= sx < grid.width and 0 <= sy < grid.height):
            continue
        # står navnet alt i kartet like ved, løftes det i stedet (fyr beholder typen: den styrer fyrtårnene)
        same = [n for n in names if n["name"] == sign["name"] and np.hypot(n["x"] - sx, n["y"] - sy) * area.cell < 600]
        if same:
            for n in same:
                if n["type"] not in n50.LIGHTHOUSE_TYPES:
                    n["type"], n["size"] = "landemerke", max(n["size"], 8.0)
        else:
            roofs = [it[4] for it in items if it[2] == structures.BUILDING and abs(it[0] - sx) < 3 and abs(it[1] - sy) < 3]
            names.append({"name": sign["name"], "x": round(sx, 2), "y": round(sy, 2), "z": round(max([max(0.0, float(hgt[int(sy), int(sx)])), *roofs]), 1),
                          "size": 8.0, "type": "landemerke", "group": "bebyggelse"})
    names.sort(key=lambda n: -n["size"])  # fortsatt viktigste først (stabil: rekkefølgen ellers er som før)
    # Sightseeingtur der det er signalbygg å finne og ingen tur er lagt inn for hånd: start 3,5 km unna, mot dem
    marks = [n for n in names if n["type"] == "landemerke"]
    start = analysis.sightseeing_start([n["x"] for n in marks], [n["y"] for n in marks], hgt, area.cell) if len(marks) >= 3 and not airport.get("tours") else None
    if start:
        tx, ty, altitude, heading_grid = start
        east, north = grid.grid_to_utm(tx, ty)
        airport["tours"] = [{
            "name": f"{airport['name'].split(' Airport')[0]} sights", "runway": airport["runways"][0]["ends"][0]["ident"],
            "east": round(east, 1), "north": round(north, 1), "x": round(tx, 3), "y": round(ty, 3), "altitudeM": altitude,
            "headingTrueDeg": round((heading_grid + conv) % 360, 1),  # utsnittets konvergens, som spillet regner tilbake med
            "source": "regnet ut (analysis.sightseeing_start): 3,5 km fra midten av signalbyggene, fra den kanten der terrenget er lavest",
        }]
    # Fyr: stedet fra stedsnavnregisteret (navnene over er alt flyttet dit), tårn fra DOM der det finnes
    lights_at = [(*grid.grid_to_utm(n["x"], n["y"]), n["type"]) for n in names if n["type"] in n50.LIGHTHOUSE_TYPES]
    beacons = structures.lighthouses(lights_at, hgt, grid, raw) if lights_at else []
    for n in names:  # navnet står i toppen av fyret, ikke ved foten
        if n["type"] in n50.LIGHTHOUSE_TYPES:
            n["z"] = max([n["z"], *[b[3] for b in beacons if abs(b[0] - n["x"]) < 3 and abs(b[1] - n["y"]) < 3]])
    flat_light = np.ones_like(shade)
    # Tunneler ses ikke fra lufta. Spillet tegner dem som stiplet linje oppå bakken og sjøen, slik et kart gjør.
    tunnels = n50.tunnel_lines(vectors, grid) if area.n50_county else []
    on_runway = runway_mask(airport, grid)
    # Taksebaner og oppstillingsflater fra OpenStreetMap (data/osm/, hentet med `flypipe aeroways`): bakes inn i
    # fargekartet og overflateklassene, og følger med som vektorer i aeroways.json så spillet kan tegne dem skarpt.
    aero = osm.load_aeroways(area.id) if area.osm_footprints else None
    if aero:
        aero = osm.for_airport(aero, [(e["east"], e["north"]) for rw in airport["runways"] for e in rw["ends"]])
    on_taxiway = np.zeros_like(on_runway)
    ground = lc  # arealdekket fargekartet og overflateklassene bygges fra
    fringe = np.zeros_like(on_runway)
    if aero and (aero["taxiways"] or aero["aprons"]):
        # Spillet tegner rullebanen og bakkeanlegget som skarpe flater. I 10 m-celler stikker asfalten ut forbi
        # dem som en hakkete kant, både fra rasteriseringen her og fra N50s egne flater (klasse 15). Derfor:
        #  - bare celler som ligger HELT INNE i en skarp flate får asfalt
        #  - celler i kanten (innen 20 m utenfor) som ellers ville vært asfalt, blir flyplassgress (klasse 11)
        # N50-asfalt lenger unna enn det (flater OpenStreetMap ikke har) står som den er. landcover.bin er urørt.
        from shapely.ops import unary_union

        rw_shapes = [LineString([(e["east"], e["north"]) for e in rw["ends"]]).buffer(rw["widthM"] / 2, cap_style="flat") for rw in airport["runways"]]
        paved = unary_union([*rw_shapes, *osm.aeroway_shapes(aero)])
        burn = lambda shape, touched=False: rasterize([shape], out_shape=(grid.height, grid.width), transform=grid.transform, all_touched=touched).astype(bool)  # noqa: E731
        inside = burn(paved.buffer(-0.75 * area.cell))
        asphalt_before = (lc == landcover.RUNWAY_APRON) | on_runway | burn(unary_union(osm.aeroway_shapes(aero)))
        fringe = burn(paved.buffer(20), touched=True) & ~inside & asphalt_before
        on_runway = inside & burn(unary_union(rw_shapes).buffer(-0.75 * area.cell))
        on_taxiway = inside & ~on_runway
        ground = lc.copy()
        ground[fringe] = landcover.AIRPORT_GRASS
    rgb = terrain.colormap(hgt, area.cell, shade if area.bake_hillshade else flat_light, ground, features, steep_slope=area.steep_slope)
    rgb[on_taxiway] = terrain.TAXIWAY
    rgb[on_runway] = terrain.RUNWAY

    out = TILES / area.id
    out.mkdir(parents=True, exist_ok=True)
    if area.osm_footprints:
        footprints.write(out / "buildings.bin", shaped, grid)
    if area.cell == 10:
        # Oversiktskart til flyplassvelgeren (delingssiden): fargekartet i 320 x 320, med rullebanene tegnet inn
        # i hvitt så de synes (en bane er smalere enn en piksel i den målestokken)
        from PIL import ImageDraw

        size = 320
        thumb = Image.fromarray(rgb, "RGB").resize((size, size), Image.LANCZOS)
        draw, k = ImageDraw.Draw(thumb), size / grid.width
        for rw in airport["runways"]:
            le, he = rw["ends"]
            draw.line([(le["x"] * k, le["y"] * k), (he["x"] * k, he["y"] * k)], fill=(255, 255, 255), width=3)
        thumb.save(out / "thumb.jpg", quality=82, optimize=True)
    hgt.astype("<f4").tofile(out / "heightmap.f32")
    Image.fromarray(rgb, "RGB").save(out / "colormap.png", optimize=True)
    has_lights = area.night_lights and lc is not None and features is not None
    if has_lights:
        bx, by = (building_xy[:, 0] - grid.west) / area.cell, (grid.north - building_xy[:, 1]) / area.cell
        ok = (bx >= 0) & (bx < grid.width) & (by >= 0) & (by < grid.height)
        placed = (by[ok].astype(int), bx[ok].astype(int), clusters[ok] >= 0)
        glow = lights.night_lights(lc, features, n50.major_road_mask(vectors, grid), buildings=placed, cell=area.cell, every_house=area.matrikkel_buildings)
        Image.fromarray(glow, "RGB").save(out / "lights.png", optimize=True)
    if lc is None:
        lc = np.where(hgt <= terrain.SEA_LEVEL_MAX, landcover.CLASSES[1].code, landcover.UNKNOWN).astype(np.uint8)
    lc.tofile(out / "landcover.bin")
    surface = ground.copy()
    if features is not None:
        surface[features == n50.ROAD] = landcover.SURFACE_ROAD
    surface[on_taxiway] = landcover.SURFACE_TAXIWAY
    surface[on_runway] = landcover.SURFACE_RUNWAY
    surface.tofile(out / "surface.bin")
    (out / "structures.json").write_text(
        json.dumps({"columns": ["col", "row", "kind", "base", "top", "r", "g", "b"], "kinds": structures.KINDS, "items": items, "bridges": bridge_lines, "churchTowers": towers, "tunnels": tunnels, "lighthouses": beacons}, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    n_bridge = sum(1 for it in items if it[2] == structures.BRIDGE)
    if aero:
        to_grid = lambda p: [round((p[0] - grid.west) / area.cell, 3), round((grid.north - p[1]) / area.cell, 3)]  # noqa: E731
        (out / "aeroways.json").write_text(json.dumps({
            "about": "Rutenettkoordinater [x, y]. width er i meter; widthFromSource sier om bredden står i OpenStreetMap eller er antatt. "
                     "En stand merket synthetic er lagt midt på en oppstillingsflate fordi OpenStreetMap ikke har stands der.",
            "taxiways": [{"ref": t["ref"], "kind": t["kind"], "width": t["width"] or osm.AEROWAY_WIDTH_M[t["kind"]], "widthFromSource": t["width"] is not None,
                          "line": [to_grid(q) for q in t["line"]]} for t in aero["taxiways"]],
            "aprons": [[to_grid(q) for q in a["ring"]] for a in aero["aprons"]],
            "stands": [{"ref": st["ref"], "at": to_grid(st["at"]), "line": [to_grid(q) for q in st["line"]] if st["line"] else None,
                        **({"synthetic": True} if st.get("synthetic") else {})} for st in aero["stands"]],
            "holds": [to_grid(h["at"]) for h in aero["holds"]],
        }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # T-bane, trikk og bybane fra OpenStreetMap (data/osm/, hentet med `flypipe rails`): følger med som vektorer
    rails = osm.load_rails(area.id)
    if rails:
        to_cell = lambda p: [round((p[0] - grid.west) / area.cell, 2), round((grid.north - p[1]) / area.cell, 2)]  # noqa: E731
        (out / "rails.json").write_text(json.dumps({
            "about": "Rutenettkoordinater [x, y]. kind: rail, metro, tram eller lightrail. tunnel: sporet går under bakken der.",
            "tracks": [{"kind": t["kind"], "tunnel": t["tunnel"], "line": [to_cell(q) for q in t["line"]]} for t in rails["tracks"]],
            "stops": [{"kind": s["kind"], "name": s["name"], "at": to_cell(s["at"])} for s in rails["stops"]],
        }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Bussholdeplasser fra Enturs stoppestedsregister (data/entur/, hentet med `flypipe stops`)
    from . import entur

    bus_stops = entur.load_stops(area.id)
    if bus_stops:
        (out / "busstops.json").write_text(json.dumps({
            "columns": ["x", "y", "name"],
            "items": [[round((s["at"][0] - grid.west) / area.cell, 2), round((grid.north - s["at"][1]) / area.cell, 2), s["name"]] for s in bus_stops["stops"]],
        }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "names.json").write_text(
        json.dumps({"columns": ["name", "x", "y", "z", "size", "type", "group"],
                    "items": [[n["name"], round(n["x"], 2), round(n["y"], 2), round(n["z"], 1), n["size"], n["type"], n["group"]] for n in names]},
                   separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    meta = {
        "id": area.id,
        "name": area.name,
        "crs": UTM33,
        "verticalDatum": "NN2000",
        "cellSize": area.cell,
        "width": grid.width,
        "height": grid.height,
        "bbox": {"west": grid.west, "south": grid.south, "east": grid.east, "north": grid.north},
        "gridOrigin": "nordvest: rad 0 = nord, kolonne 0 = vest, y øker mot sør",
        "minHeight": round(float(hgt.min()), 2),
        "maxHeight": round(float(hgt.max()), 2),
        "seaColor": list(terrain.SEA),
        "gridConvergenceDeg": round(conv, 4),
        "scaleFactor": round(scale_factor(cx, cy), 6),
        "heightmap": {"file": "heightmap.f32", "dtype": "float32", "byteOrder": "little", "unit": "m"},
        "colormap": {"file": "colormap.png", "hillshadeBaked": area.bake_hillshade},
        "lights": {"file": "lights.png", "placement": "syntetisk: langs veier, i bebygde flater og ved bygningene; bygningsklynger avgjør hvor det er gatelys"} if has_lights else None,
        "landcover": {
            "unknownShare": round(float((lc == landcover.UNKNOWN).mean()), 5),
            "file": "landcover.bin",
            "dtype": "uint8",
            "source": "N50 Arealdekke" if area.n50_county else "kun DTM (hav der høyde <= 0,1 m)",
            "method": f"rasterisert til {landcover.SUBCELL:g} m, flertall per {area.cell:g} m-celle",
            "classes": [{"code": c.code, "name": c.name, "water": c.water} for c in landcover.CLASSES],
        },
        "surface": {
            "file": "surface.bin",
            "dtype": "uint8",
            "about": "arealdekke med vei og rullebane lagt oppå; styrer detaljmønster på bakken",
            "classes": landcover.surface_classes(terrain.ROAD, terrain.RUNWAY, terrain.TAXIWAY),
        },
        "busStops": {
            "file": "busstops.json",
            "source": f"Entur, nasjonalt stoppestedsregister (NLOD), hentet {bus_stops['fetched']}",
            "count": len(bus_stops["stops"]),
        } if bus_stops else None,
        "rails": {
            "file": "rails.json",
            "source": f"OpenStreetMap (ODbL), hentet {rails['fetched']}",
            "tracks": len(rails["tracks"]),
            "stops": len(rails["stops"]),
        } if rails else None,
        "aeroways": {
            "file": "aeroways.json",
            "source": f"OpenStreetMap (ODbL), hentet {aero['fetched']}",
            "taxiways": len(aero["taxiways"]),
            "aprons": len(aero["aprons"]),
            "stands": len(aero["stands"]),
            "syntheticStands": sum(1 for st in aero["stands"] if st.get("synthetic")),
            "cells": int(on_taxiway.sum()),
            "fringeCells": int(fringe.sum()),
            "fringe": "celler i kanten av de skarpe flatene som er gjort til flyplassgress i surface.bin og fargekartet",
        } if aero else None,
        "names": {
            "file": "names.json",
            "count": len(names),
            "source": "N50 Kartdata, tekstlaget (stedsnavn fra Sentralt stedsnavnregister)",
            "about": "size er kartets skriftstørrelse i 1:50 000 og brukes som mål på hvor viktig navnet er",
        },
        "structures": {
            "file": "structures.json",
            "bridgeCells": n_bridge,
            "buildingCells": len(items) - n_bridge,
            "bridgeHeights": "DOM 1 m (nhm_dom_topo_25833), median langs senterlinja per celle",
            "bridgeLines": len(bridge_lines),
            "footprints": {
                "file": "buildings.bin",
                "count": len(shaped),
                "boxesWithoutOutline": int(len(vectors["buildingPoints"])),
                "source": f"OpenStreetMap (hentet {fp.fetched}), forenklet til 0,6 m; type fra Matrikkelen via bygningsnummer",
                "license": "Open Database License (ODbL) 1.0, © OpenStreetMap contributors. Denne fila og cellene avledet av den deles under samme lisens.",
                "heights": {k: sum(b["height_source"] == k for b in shaped) for k in ("dom", "levels", "nominal")},
                "heightsAbout": "dom: median av DOM - DTM innenfor omrisset (minst tre 10 m-celler); levels: etasjer x 3 m + 1; nominal: antatt etter bygningstype",
            } if area.osm_footprints else None,
            "buildingColors": {
                "about": "farge etter bygningstype fra Matrikkelen; fargene er valgt, ikke observert",
                "cells": dict(sorted(profile_cells.items(), key=lambda kv: -kv[1])),
                # til forklaringen i spillet: navn og første farge, vanligste først
                "legend": [
                    [name, "#%02x%02x%02x" % colors[0]]
                    for name, colors in {n: c for n, c in [*matrikkel.PROFILE_BY_MAIN.values(), *matrikkel.PROFILE_BY_GROUP.values()]}.items()
                    if profile_cells.get(name)
                ],
            } if profile_cells else None,
            "lighthouses": len(beacons),
            "lighthouseTowers": sum(b[4] for b in beacons),
            "lighthouseSource": "fyrstasjoner og fyrlykter fra N50 og stedsnavnregisteret; tårnhøyde målt i DOM 1 m, lykter har nominell høyde; lyset er syntetisk",
            "churches": len(church),
            "churchTowers": len(towers),
            "churchTowerSource": "kirker fra Matrikkelen (type 671); tårnets plass og høyde målt i DOM 1 m, se structures.church_towers",
            "buildingHeights": (
                ("punkt: nominell etter bygningstype (Matrikkelen har ikke høyde); flate: " if area.matrikkel_buildings else f"punkt: nominell {structures.HEIGHT_HOUSE:g} m; flate: ")
                + ("median av DOM - DTM innenfor flaten" if area.dom_building_heights else f"nominell {structures.HEIGHT_LARGE:g} m")
            ),
        },
        "resampling": {
            "source": f"{dtm.COVERAGE} (1 m) via WCS, {dtm.INTERPOLATION} til {area.source_res:g} m",
            "method": f"blokkmiddel {factor}x{factor} til {area.cell:g} m" if factor > 1 else "ingen videre resampling (tjenestens rutenett brukes direkte)",
        },
        "hillshade": {
            "sunAzimuthTrueDeg": SUN_AZIMUTH_TRUE,
            "sunAzimuthGridDeg": round(sun_grid, 2),
            "sunElevationDeg": SUN_ELEVATION,
        },
        "features": None if features is None else {
            "source": f"N50 Kartdata, {area.n50_county} (FGDB)",
            "roadCategories": list(area.road_categories),
            "roadCells": int((features == n50.ROAD).sum()),
            "roadKm": round(float(vectors["roads"].length.sum()) / 1000, 1),
            "bridgeKm": round(float(vectors["bridges"].length.sum()) / 1000, 1),
            "tunnels": len(tunnels),
            "tunnelsAbout": "veier under terrenget (N50, medium = U), minst 150 m; i structures.json, tegnes stiplet av spillet",
            "buildings": int(len(all_buildings) if area.matrikkel_buildings else len(vectors["buildingPoints"]) + len(vectors["buildingAreas"])),
            "buildingSource": (
                f"Matrikkelen - Bygningspunkt, {area.n50_county}: bygg som står, uten garasjer, uthus og naust (N50 hadde {n50_points} punkter). "
                "Store bygg har i tillegg form fra N50"
                if area.matrikkel_buildings else "N50 Kartdata"
            ),
        },
        "analysis": {
            "towerViewshed": viewshed,
            "approach": {
                "about": "per baneende i airports[].runways[].ends[].approach",
                "glidePath": f"{analysis.GLIDE_ANGLE_DEG:g}° mot et punkt {analysis.AIM_POINT_M:g} m innenfor terskelen (syntetisk, ikke flyplassens ILS)",
                "clearance": f"laveste klaring fra glidebanen til terreng, bygninger og bruer i et belte på ±{analysis.CORRIDOR_HALF_WIDTH_M:g} m, "
                f"fra {analysis.CLEARANCE_FROM_M:g} til {analysis.APPROACH_DIST_M:g} m før baneenden",
            },
            "buildingClusters": analysis.cluster_summary(clusters, cluster_eps if area.n50_county else analysis.CLUSTER_EPS_M),
        },
        "landmarks": landmarks,
        "airports": [airport],
        "attribution": [
            "Elevation data (DTM, DOM), N50 map data and building points (Matrikkelen): © Kartverket (CC BY 4.0)"
            if area.matrikkel_buildings else "Elevation data (DTM, DOM) and N50 map data: © Kartverket (CC BY 4.0)",
            *(["Building outlines and airport layout: © OpenStreetMap contributors (ODbL)" if aero else "Building outlines: © OpenStreetMap contributors (ODbL)"] if area.osm_footprints else []),
            "Airport data: OurAirports (public domain)",
        ],
    }
    (out / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Indeks over utsnittene som finnes, så spillet kan tilby dem
    index_path = TILES / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"areas": []}
    entry = {"id": area.id, "name": area.name, "icao": area.icao, "cellSize": area.cell}
    index["areas"] = sorted([a for a in index["areas"] if a["id"] != area.id] + [entry], key=lambda a: list(AREAS).index(a["id"]))
    index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Utsnitt med sjø: skipstjenesten (web/public/ais) trenger rutene for å velge ut skip. Bare 10 m-utsnittene
    # spillet bruker, og bare der det er hav (Gardermoen har innsjøer, men ingen skip med AIS).
    sea = float((lc == next(c.code for c in landcover.CLASSES if c.name == "Havflate")).mean())
    ais_path = TILES.parent / "ais" / "areas.json"
    ais_areas = json.loads(ais_path.read_text(encoding="utf-8")) if ais_path.exists() else {}
    ais_areas.pop(area.icao, None) if area.cell != 10 or sea < 0.01 else ais_areas.update({area.icao: [grid.west, grid.south, grid.east, grid.north]})
    if area.cell == 10:
        ais_path.parent.mkdir(parents=True, exist_ok=True)
        ais_path.write_text(json.dumps(dict(sorted(ais_areas.items()))) + "\n", encoding="utf-8")
        meta["ships"] = {"source": "Kystverkets åpne AIS-strøm via /ais/ (sanntid, ikke en del av flisene)", "seaShare": round(sea, 3)} if area.icao in ais_areas else None
        (out / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Flytrafikk (web/public/traffic): tjenesten spør adsb.lol om fly rundt utsnittets sentrum. Den trenger
    # sentrum i lengde/bredde, en radius som dekker hele ruta, ruta selv, og geoidehøyden (flyene sender
    # GPS-høyde over ellipsoiden, spillet regner NN2000).
    if area.cell == 10:
        lon, lat = utm33_to_wgs84(cx, cy)
        half_diagonal_nm = np.hypot(grid.width, grid.height) * area.cell / 2 / 1852
        traffic_path = TILES.parent / "traffic" / "areas.json"
        traffic = json.loads(traffic_path.read_text(encoding="utf-8")) if traffic_path.exists() else {}
        traffic[area.icao] = {
            "lat": round(lat, 4), "lon": round(lon, 4), "radiusNm": int(np.ceil(half_diagonal_nm)),
            "box": [grid.west, grid.south, grid.east, grid.north], "geoidM": geoid_separation(area.id, lon, lat),
        }
        traffic_path.parent.mkdir(parents=True, exist_ok=True)
        traffic_path.write_text(json.dumps(dict(sorted(traffic.items()))) + "\n", encoding="utf-8")
        meta["traffic"] = {"source": "adsb.lol via /traffic/ (sanntid, ikke en del av flisene)", "geoidSeparationM": traffic[area.icao]["geoidM"]}
        (out / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Georefererte kopier for kontroll i QGIS
    _write_geotiff(PROCESSED / area.id / f"dtm{area.cell:g}m.tif", hgt, grid)
    _write_geotiff(PROCESSED / area.id / "colormap.tif", rgb, grid)
    if features is not None:
        _write_geotiff(PROCESSED / area.id / "features.tif", features, grid)
    _write_geotiff(PROCESSED / area.id / "landcover.tif", lc, grid)
    # m over bakken et fly må ha for å ses fra tårnet (0 = bakken ses)
    _write_geotiff(PROCESSED / area.id / "tower_viewshed.tif", above_ground.astype(np.float32), grid)
    if len(building_xy):
        import geopandas as gpd

        gpd.GeoDataFrame({"cluster": clusters}, geometry=gpd.points_from_xy(building_xy[:, 0], building_xy[:, 1]), crs=UTM33).to_file(
            PROCESSED / area.id / "building_clusters.gpkg", driver="GPKG"
        )
    print(f"[{area.id}] skrev {out.relative_to(REPO)} (høyde {meta['minHeight']}-{meta['maxHeight']} m, konvergens {conv:.2f}°)")
    return out
