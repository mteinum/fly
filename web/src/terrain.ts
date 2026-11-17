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
  seaLevelMax: number;
  seaColor: [number, number, number];
  gridConvergenceDeg: number;
  heightmap: { file: string };
  colormap: { file: string };
  airports: Airport[];
  attribution: string[];
}

export class Terrain {
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  readonly seaColor: number;

  constructor(
    readonly meta: TerrainMeta,
    readonly hgt: Float32Array,
    readonly col: Uint32Array,
  ) {
    this.width = meta.width;
    this.height = meta.height;
    this.cell = meta.cellSize;
    this.seaColor = rgb(...meta.seaColor);
    if (hgt.length !== this.width * this.height) throw new Error("heightmap har feil størrelse");
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

  isSea(h: number): boolean {
    return h <= this.meta.seaLevelMax;
  }

  /** Sann kurs (grader) fra rutenettkurs (radianer). */
  trueHeadingDeg(gridHdgRad: number): number {
    const deg = (gridHdgRad * 180) / Math.PI + this.meta.gridConvergenceDeg;
    return ((deg % 360) + 360) % 360;
  }
}

export async function loadTerrain(baseUrl: string): Promise<Terrain> {
  const meta: TerrainMeta = await (await fetch(`${baseUrl}/metadata.json`)).json();
  const [hgtBuf, img] = await Promise.all([
    fetch(`${baseUrl}/${meta.heightmap.file}`).then((r) => r.arrayBuffer()),
    loadImage(`${baseUrl}/${meta.colormap.file}`),
  ]);
  // heightmap.f32 er little-endian, som alle plattformer nettlesere kjører på
  const hgt = new Float32Array(hgtBuf);
  const cv = document.createElement("canvas");
  cv.width = meta.width;
  cv.height = meta.height;
  const cx = cv.getContext("2d", { willReadFrequently: true })!;
  cx.drawImage(img, 0, 0);
  const col = new Uint32Array(cx.getImageData(0, 0, meta.width, meta.height).data.buffer);
  return new Terrain(meta, hgt, col);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`kunne ikke laste ${url}`));
    im.src = url;
  });
}
