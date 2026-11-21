import { describe, expect, it } from "vitest";
import { buildingMesh, type Footprint, parseFootprints, triangulate } from "./footprints";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Arealet av trekantene, uten fortegn. */
const triArea = (r: Float32Array, t: number[]) => {
  let a = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [p, q, s] = [t[i], t[i + 1], t[i + 2]];
    a += Math.abs((r[q * 2] - r[p * 2]) * (r[s * 2 + 1] - r[p * 2 + 1]) - (r[q * 2 + 1] - r[p * 2 + 1]) * (r[s * 2] - r[p * 2])) / 2;
  }
  return a;
};
const polyArea = (r: Float32Array) => {
  let a = 0;
  for (let i = 0, n = r.length / 2; i < n; i++) { const j = (i + 1) % n; a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; }
  return Math.abs(a) / 2;
};

describe("bygningsomriss", () => {
  it("deler mangekanter i trekanter som dekker nøyaktig arealet, også med innoverhjørner og begge omløpsretninger", () => {
    const square = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
    const lShape = new Float32Array([0, 0, 20, 0, 20, 8, 8, 8, 8, 20, 0, 20]); // vinkelbygg, 256 m2
    const uShape = new Float32Array([0, 0, 30, 0, 30, 20, 22, 20, 22, 8, 8, 8, 8, 20, 0, 20]);
    for (const ring of [square, lShape, uShape]) {
      const reversed = new Float32Array(ring.length);
      for (let i = 0, n = ring.length / 2; i < n; i++) { reversed[i * 2] = ring[(n - 1 - i) * 2]; reversed[i * 2 + 1] = ring[(n - 1 - i) * 2 + 1]; }
      for (const r of [ring, reversed]) {
        const t = triangulate(r);
        expect(t.length).toBe((r.length / 2 - 2) * 3);
        expect(triArea(r, t)).toBeCloseTo(polyArea(r), 3);
      }
    }
    expect(polyArea(lShape)).toBe(256);
  });

  it("lager vegger fra bunn til topp og et tak, med mørkere vegger", () => {
    const b: Footprint = { ring: new Float32Array([100, 200, 110, 200, 110, 215, 100, 215]), base: 12, top: 19, color: [200, 100, 50] };
    const m = buildingMesh([b, b]);
    expect(m.position.length).toBe(2 * 4 * 3 * 3); // per bygg: fire hjørner i tak, nedre og øvre veggkant
    expect(m.index.length).toBe(2 * (4 * 6 + 2 * 3));
    expect(Math.max(...m.index)).toBe(m.position.length / 3 - 1);
    const ys = new Set(Array.from({ length: m.position.length / 3 }, (_, i) => m.position[i * 3 + 1]));
    expect([...ys].sort()).toEqual([12, 19]);
    expect([m.color[0], m.color[1], m.color[2]]).toEqual([200, 100, 50]); // tak
    expect(m.color[4 * 3]).toBe(156); // vegg: 200 x 0,78
  });

  it("leser buildings.bin slik pipeline skriver den", () => {
    const file = fileURLToPath(new URL("../public/data/kjevik10/buildings.bin", import.meta.url));
    if (!existsSync(file)) return; // 10 m-flisene er ikke i git
    const raw = readFileSync(file), all = parseFootprints(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
    expect(all.length).toBeGreaterThan(20000);
    for (const b of all) {
      expect(b.ring.length).toBeGreaterThanOrEqual(6);
      expect(b.top - b.base).toBeGreaterThan(3);
      expect(b.top - b.base).toBeLessThan(120); // høyde 4-80 m, pluss fall i terrenget under store bygg
    }
    // alle hjørner innenfor kartet (25,6 km), og trekantene dekker omrissene
    const xs = all.flatMap((b) => [b.ring[0], b.ring[1]]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-50);
    expect(Math.max(...xs)).toBeLessThanOrEqual(25650);
    let poly = 0, tri = 0;
    for (const b of all) { poly += polyArea(b.ring); tri += triArea(b.ring, triangulate(b.ring)); }
    expect(tri / poly).toBeGreaterThan(0.999);
    expect(tri / poly).toBeLessThan(1.001);
  });
});
