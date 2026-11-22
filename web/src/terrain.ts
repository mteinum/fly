/* Terreng: fliser fra pipeline (web/public/data/<utsnitt>/).
 *
 * Rutenettkoordinater (x, y) er UTM 33-meter / cellestørrelse:
 *   x = (øst - bbox.west) / cellSize     øker mot øst
 *   y = (bbox.north - nord) / cellSize   øker mot SØR (rad 0 = nord)
 * Heltall ligger på cellekanter; celleverdien gjelder i cellesenteret (+0.5).
 * Kurs i spillet er rutenettretning: 0 = rutenett-nord, med klokka.
 */

export interface RunwayEnd {
  ident: string;
  lon: number; lat: number;
  east: number; north: number;
  x: number; y: number;
  elevationM: number;
  headingTrueDeg: number;
  headingGridDeg: number;
  displacedThresholdM: number;
  /** Fra pipeline (analysis.py): glidebanens høyde 8 km ute, laveste klaring til terreng og bygg, og hva tårnet ser. */
  approach?: { startAltitudeM: number; lowestClearanceM: number; lowestClearanceAtM: number; seenFromTowerShare?: number; hiddenFromTowerM?: [number, number][] };
}

export interface Runway {
  ident: string;
  lengthM: number;
  widthM: number;
  surface: string;
  ends: [RunwayEnd, RunwayEnd];
}

export interface Airport {
  icao: string;
  name: string;
  elevationM: number;
  arp: { lon: number; lat: number; east: number; north: number; x: number; y: number };
  runways: Runway[];
  /** Kontrolltårnet: posisjon fra N50 (terminalbygningen), øyehøyde antatt. Høyder i m (NN2000). */
  tower: { east: number; north: number; x: number; y: number; groundM: number; eyeM: number; source: string };
}

export interface TerrainMeta {
  id: string;
  name: string;
  crs: string;
  cellSize: number;
  width: number;
  height: number;
  bbox: { west: number; south: number; east: number; north: number };
  minHeight: number;
  maxHeight: number;
  seaColor: [number, number, number];
  gridConvergenceDeg: number;
  heightmap: { file: string };
  colormap: { file: string };
  lights: { file: string } | null;
  surface: { file: string; classes: { code: number; name: string; color: [number, number, number] }[] };
  landcover: { file: string; classes: { code: number; name: string; water: boolean }[] };
  /** `buildingColors.legend`: [navn, farge] per bygningstype som finnes i utsnittet (fra pipeline, matrikkel.py). */
  structures: { file: string; buildingColors?: { legend: [string, string][] } | null; footprints?: { file: string; count: number } | null };
  names?: { file: string; count: number };
  /** Flyplassens bakkeanlegg (taksebaner, oppstillingsflater, stands), når det er hentet for utsnittet. */
  aeroways?: { file: string; source: string; taxiways: number; aprons: number; stands: number } | null;
  /** Satt for utsnittene spillet bruker: andre fly kan hentes fra /traffic/ (se traffic.ts). */
  traffic?: { source: string } | null;
  /** Satt når utsnittet har sjø: da finnes det skipstrafikk å hente fra /ais/ (se ships.ts). */
  ships?: { source: string } | null;
  /** Kjennemerker som vises med logo: posisjon i rutenettet, høyde (m), og bildefil i web/public/. */
  landmarks?: { id: string; name: string; x: number; y: number; z: number; image: string }[];
  airports: Airport[];
  attribution: string[];
}

import type { PlaceName } from "./labels";

/** names.json: [navn, x, y, z, skriftstørrelse, type, gruppe]. */
export interface NameFile { items: [string, number, number, number, number, string, string][] }
export const parseNames = (f: NameFile): PlaceName[] => f.items.map(([name, x, y, z, size, type, group]) => ({ name, x, y, z, size, type, group }));

import { type Footprint, parseFootprints } from "./footprints";

export const BUILDING = 1;
export const BRIDGE = 2;

/** structures.json: [kol, rad, type, bunn, topp, r, g, b, form?], høyder i m (NN2000).
 *  form = 1: cella hører til et bygg som tegnes med omriss (buildings.bin), ikke som boks. */
export interface StructureFile {
  items: [number, number, number, number, number, number, number, number, number?][];
  /** Bruer som polylinjer: punkter [x, y, z] i rutenettkoordinater og m (NN2000), bredde i m. */
  bridges: { width: number; points: [number, number, number][] }[];
  /** Kirketårn: [x, y, bunn, topp] i rutenettkoordinater og m (NN2000). Plass og høyde målt i DOM av pipeline. */
  churchTowers?: [number, number, number, number][];
  /** Veitunneler som polylinjer [x, y] i rutenettkoordinater. De ligger under bakken og tegnes stiplet oppå den. */
  tunnels?: [number, number][][];
  /** Fyr: [x, y, bunn, topp, tårn]. tårn = 1: fyrtårn med målt høyde; 0: fyrlykt med nominell høyde. */
  lighthouses?: [number, number, number, number, number][];
}

/** aeroways.json: flyplassens bakkeanlegg fra OpenStreetMap, i rutenettkoordinater [x, y]. Bredden er i meter. */
export interface Aeroways {
  taxiways: { ref: string; kind: "taxiway" | "taxilane"; width: number; widthFromSource: boolean; line: [number, number][] }[];
  aprons: [number, number][][];
  /** Stands: nummeret, stedet, og innkjøringslinja der den er kartlagt. */
  stands: { ref: string; at: [number, number]; line: [number, number][] | null }[];
  holds: [number, number][];
}

export class Terrain {
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  /** Strukturer oppå terrenget, per celle. sKind 0 = ingen. Høydekartet er rent terreng. */
  readonly sKind: Uint8Array;
  readonly sBase: Float32Array;
  readonly sTop: Float32Array;
  readonly sCol: Uint32Array; // 0xRRGGBB
  /** 1 der bygningscella tegnes som del av et omriss og ikke som egen boks. */
  readonly sShaped: Uint8Array;
  /** Bygninger med form (omriss fra OpenStreetMap). Tom når utsnittet ikke har dem. */
  footprints: Footprint[] = [];
  readonly bridges: StructureFile["bridges"];
  readonly churchTowers: NonNullable<StructureFile["churchTowers"]>;
  readonly tunnels: NonNullable<StructureFile["tunnels"]>;
  readonly lighthouses: NonNullable<StructureFile["lighthouses"]>;
  /** Stedsnavn fra N50, viktigste først. */
  names: PlaceName[] = [];
  aeroways: Aeroways | null = null;
  private readonly waterCodes: Uint8Array;

  constructor(
    readonly meta: TerrainMeta,
    readonly hgt: Float32Array,
    readonly landcover: Uint8Array,
    structures: StructureFile,
  ) {
    this.width = meta.width;
    this.height = meta.height;
    this.cell = meta.cellSize;
    const n = this.width * this.height;
    if (hgt.length !== n || landcover.length !== n) throw new Error("flis har feil størrelse");
    this.waterCodes = new Uint8Array(256);
    for (const c of meta.landcover.classes) if (c.water) this.waterCodes[c.code] = 1;
    this.sKind = new Uint8Array(n);
    this.sBase = new Float32Array(n);
    this.sTop = new Float32Array(n);
    this.sCol = new Uint32Array(n);
    this.sShaped = new Uint8Array(n);
    this.bridges = structures.bridges;
    this.churchTowers = structures.churchTowers ?? [];
    this.tunnels = structures.tunnels ?? [];
    this.lighthouses = structures.lighthouses ?? [];
    for (const [col, row, kind, base, top, r, g, b, shaped] of structures.items) {
      const i = row * this.width + col;
      this.sShaped[i] = shaped ? 1 : 0;
      this.sKind[i] = kind;
      this.sBase[i] = base;
      this.sTop[i] = top;
      this.sCol[i] = (r << 16) | (g << 8) | b;
    }
  }

  utmToGrid(east: number, north: number): [number, number] {
    return [(east - this.meta.bbox.west) / this.cell, (this.meta.bbox.north - north) / this.cell];
  }

  gridToUtm(x: number, y: number): [number, number] {
    return [this.meta.bbox.west + x * this.cell, this.meta.bbox.north - y * this.cell];
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Terrenghøyde (m), bilineært mellom cellesentre. Utenfor utsnittet: 0 (hav). */
  heightAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    const w = this.width, h = this.height;
    const gx = Math.min(Math.max(x - 0.5, 0), w - 1), gy = Math.min(Math.max(y - 0.5, 0), h - 1);
    const x0 = Math.min(gx | 0, w - 2), y0 = Math.min(gy | 0, h - 2);
    const fx = gx - x0, fy = gy - y0, i = y0 * w + x0;
    const top = this.hgt[i] + (this.hgt[i + 1] - this.hgt[i]) * fx;
    const bot = this.hgt[i + w] + (this.hgt[i + w + 1] - this.hgt[i + w]) * fx;
    return top + (bot - top) * fy;
  }

  /** Celleindeks, eller -1 utenfor utsnittet. */
  cellIndex(x: number, y: number): number {
    return this.inBounds(x, y) ? (y | 0) * this.width + (x | 0) : -1;
  }

  /** Vann ifølge arealdekket (hav, innsjø, elv). Utenfor utsnittet er alt hav. */
  isWater(x: number, y: number): boolean {
    const i = this.cellIndex(x, y);
    return i < 0 || this.waterCodes[this.landcover[i]] === 1;
  }

  /** Sann kurs (grader) fra rutenettkurs (radianer). */
  trueHeadingDeg(gridHdgRad: number): number {
    const deg = (gridHdgRad * 180) / Math.PI + this.meta.gridConvergenceDeg;
    return ((deg % 360) + 360) % 360;
  }
}

export interface TerrainAssets {
  terrain: Terrain;
  /** Fargekartet: flatefarge uten skygge (til tekstur og kart). */
  colormap: HTMLImageElement;
  /** Nattlys: gatelys og vinduslys, svart ellers. */
  lights: HTMLImageElement | null;
  /** Overflateklasse per celle: arealdekke med vei og rullebane oppå. */
  surface: Uint8Array;
}

export async function loadTerrain(baseUrl: string): Promise<TerrainAssets> {
  const meta: TerrainMeta = await (await fetch(`${baseUrl}/metadata.json`)).json();
  const [hgtBuf, colormap, lights, lcBuf, surfaceBuf, structures, names, footprints, aeroways] = await Promise.all([
    fetch(`${baseUrl}/${meta.heightmap.file}`).then((r) => r.arrayBuffer()),
    loadImage(`${baseUrl}/${meta.colormap.file}`),
    meta.lights ? loadImage(`${baseUrl}/${meta.lights.file}`) : null,
    fetch(`${baseUrl}/${meta.landcover.file}`).then((r) => r.arrayBuffer()),
    fetch(`${baseUrl}/${meta.surface.file}`).then((r) => r.arrayBuffer()),
    fetch(`${baseUrl}/${meta.structures.file}`).then((r) => r.json() as Promise<StructureFile>),
    meta.names ? fetch(`${baseUrl}/${meta.names.file}`).then((r) => r.json() as Promise<NameFile>) : null,
    meta.structures.footprints ? fetch(`${baseUrl}/${meta.structures.footprints.file}`).then((r) => r.arrayBuffer()) : null,
    meta.aeroways ? fetch(`${baseUrl}/${meta.aeroways.file}`).then((r) => r.json() as Promise<Aeroways>) : null,
  ]);
  // heightmap.f32 er little-endian, som alle plattformer nettlesere kjører på
  const terrain = new Terrain(meta, new Float32Array(hgtBuf), new Uint8Array(lcBuf), structures);
  if (names) terrain.names = parseNames(names);
  if (footprints) terrain.footprints = parseFootprints(footprints);
  terrain.aeroways = aeroways;
  return { terrain, colormap, lights, surface: new Uint8Array(surfaceBuf) };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`kunne ikke laste ${url}`));
    im.src = url;
  });
}
