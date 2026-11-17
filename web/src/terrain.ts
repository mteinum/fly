/* Terreng: fliser fra pipeline (web/public/data/<utsnitt>/).
 *
 * Rutenettkoordinater (x, y) er UTM 33-meter / cellestørrelse:
 *   x = (øst - bbox.west) / cellSize     øker mot øst
 *   y = (bbox.north - nord) / cellSize   øker mot SØR (rad 0 = nord)
 * Heltall ligger på cellekanter; celleverdien gjelder i cellesenteret (+0.5).
 * Kurs i spillet er rutenettretning: 0 = rutenett-nord, med klokka.
 */
import { rgb } from "./colors";

export interface RunwayEnd {
  ident: string;
  lon: number; lat: number;
  east: number; north: number;
  x: number; y: number;
  elevationM: number;
  headingTrueDeg: number;
  headingGridDeg: number;
  displacedThresholdM: number;
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
  hillshade: { sunAzimuthTrueDeg: number; sunAzimuthGridDeg: number; sunElevationDeg: number };
  heightmap: { file: string };
  colormap: { file: string };
  landcover: { file: string; classes: { code: number; name: string; water: boolean }[] };
  structures: { file: string };
  airports: Airport[];
  attribution: string[];
}

export const BUILDING = 1;
export const BRIDGE = 2;

/** structures.json: [kol, rad, type, bunn, topp, r, g, b], høyder i m (NN2000). */
export interface StructureFile {
  items: [number, number, number, number, number, number, number, number][];
  /** Bruer som polylinjer: punkter [x, y, z] i rutenettkoordinater og m (NN2000), bredde i m. */
  bridges: { width: number; points: [number, number, number][] }[];
}

export class Terrain {
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  readonly seaColor: number;
  /** Strukturer oppå terrenget, per celle. sKind 0 = ingen. Høydekartet er rent terreng. */
  readonly sKind: Uint8Array;
  readonly sBase: Float32Array;
  readonly sTop: Float32Array;
  readonly sCol: Uint32Array;
  readonly bridges: StructureFile["bridges"];
  private readonly waterCodes: Uint8Array;

  constructor(
    readonly meta: TerrainMeta,
    readonly hgt: Float32Array,
    readonly col: Uint32Array,
    readonly landcover: Uint8Array,
    structures: StructureFile,
  ) {
    this.width = meta.width;
    this.height = meta.height;
    this.cell = meta.cellSize;
    this.seaColor = rgb(...meta.seaColor);
    const n = this.width * this.height;
    if (hgt.length !== n || landcover.length !== n) throw new Error("flis har feil størrelse");
    this.waterCodes = new Uint8Array(256);
    for (const c of meta.landcover.classes) if (c.water) this.waterCodes[c.code] = 1;
    this.sKind = new Uint8Array(n);
    this.sBase = new Float32Array(n);
    this.sTop = new Float32Array(n);
    this.sCol = new Uint32Array(n);
    this.bridges = structures.bridges;
    for (const [col, row, kind, base, top, r, g, b] of structures.items) {
      const i = row * this.width + col;
      this.sKind[i] = kind;
      this.sBase[i] = base;
      this.sTop[i] = top;
      this.sCol[i] = rgb(r, g, b);
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
  /** Fargekartet som bilde (til tekstur og minikart). */
  image: HTMLImageElement;
}

export async function loadTerrain(baseUrl: string): Promise<Terrain> {
  return (await loadTerrainAssets(baseUrl, true)).terrain;
}

/** readPixels = false hopper over Terrain.col (trengs bare av piksel-rendererne). */
export async function loadTerrainAssets(baseUrl: string, readPixels: boolean): Promise<TerrainAssets> {
  const meta: TerrainMeta = await (await fetch(`${baseUrl}/metadata.json`)).json();
  const [hgtBuf, img, lcBuf, structures] = await Promise.all([
    fetch(`${baseUrl}/${meta.heightmap.file}`).then((r) => r.arrayBuffer()),
    loadImage(`${baseUrl}/${meta.colormap.file}`),
    fetch(`${baseUrl}/${meta.landcover.file}`).then((r) => r.arrayBuffer()),
    fetch(`${baseUrl}/${meta.structures.file}`).then((r) => r.json() as Promise<StructureFile>),
  ]);
  // heightmap.f32 er little-endian, som alle plattformer nettlesere kjører på
  const hgt = new Float32Array(hgtBuf);
  let col = new Uint32Array(0);
  if (readPixels) {
    const cv = document.createElement("canvas");
    cv.width = meta.width;
    cv.height = meta.height;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(img, 0, 0);
    col = new Uint32Array(cx.getImageData(0, 0, meta.width, meta.height).data.buffer);
  }
  return { terrain: new Terrain(meta, hgt, col, new Uint8Array(lcBuf), structures), image: img };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`kunne ikke laste ${url}`));
    im.src = url;
  });
}
