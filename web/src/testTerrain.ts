/* Laster de ekte flisene fra disk for tester (Node, ikke nettleser). */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFootprints } from "./footprints";
import { parseNames, type StructureFile, Terrain, type TerrainMeta } from "./terrain";

const dataDir = (area: string): string => fileURLToPath(new URL(`../public/data/${area}/`, import.meta.url));

/** 10 m-flisene er ikke i git; tester som trenger dem hoppes over når de ikke er bygget. */
export const hasTiles = (area: string): boolean => existsSync(dataDir(area) + "metadata.json");
const FIXTURES = fileURLToPath(new URL("../../tests/fixtures/reference_points.json", import.meta.url));

export function loadTestTerrain(area = "kjevik"): Terrain {
  const DATA = dataDir(area);
  const meta: TerrainMeta = JSON.parse(readFileSync(DATA + "metadata.json", "utf-8"));
  const raw = readFileSync(DATA + meta.heightmap.file);
  const hgt = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const lc = new Uint8Array(readFileSync(DATA + meta.landcover.file));
  const structures: StructureFile = JSON.parse(readFileSync(DATA + meta.structures.file, "utf-8"));
  const terrain = new Terrain(meta, hgt, lc, structures);
  if (meta.structures.footprints && existsSync(DATA + meta.structures.footprints.file)) {
    const fp = readFileSync(DATA + meta.structures.footprints.file);
    terrain.footprints = parseFootprints(fp.buffer.slice(fp.byteOffset, fp.byteOffset + fp.byteLength) as ArrayBuffer);
  }
  if (meta.names && existsSync(DATA + meta.names.file)) terrain.names = parseNames(JSON.parse(readFileSync(DATA + meta.names.file, "utf-8")));
  return terrain;
}

export interface ReferencePoints {
  transform: { points: { name: string; lon: number; lat: number; east: number; north: number }[] };
  heights: { toleranceM: number; areas: Record<string, { name: string; east: number; north: number; z: number }[]> };
}

export const loadReference = (): ReferencePoints => JSON.parse(readFileSync(FIXTURES, "utf-8"));
