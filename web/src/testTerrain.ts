/* Laster de ekte flisene fra disk for tester (Node, ikke nettleser). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Terrain, type TerrainMeta } from "./terrain";

const DATA = fileURLToPath(new URL("../public/data/kjevik/", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../tests/fixtures/reference_points.json", import.meta.url));

export function loadTestTerrain(): Terrain {
  const meta: TerrainMeta = JSON.parse(readFileSync(DATA + "metadata.json", "utf-8"));
  const raw = readFileSync(DATA + meta.heightmap.file);
  const hgt = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  // fargekartet trengs ikke i testene
  return new Terrain(meta, hgt, new Uint32Array(hgt.length));
}

export interface ReferencePoints {
  transform: { points: { name: string; lon: number; lat: number; east: number; north: number }[] };
  heights: { toleranceM: number; points: { name: string; east: number; north: number; z: number }[] };
}

export const loadReference = (): ReferencePoints => JSON.parse(readFileSync(FIXTURES, "utf-8"));
