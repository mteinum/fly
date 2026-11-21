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

  it("taket vender opp og veggene ut, uansett hvilken vei omrisset går", () => {
    // Første utgave hadde alle flater vendt innover: takene ble borte, og man så innsiden av veggene bak.
    const cw = new Float32Array([0, 0, 20, 0, 20, 8, 8, 8, 8, 20, 0, 20]), ccw = new Float32Array(cw.length);
    for (let i = 0, n = cw.length / 2; i < n; i++) { ccw[i * 2] = cw[(n - 1 - i) * 2]; ccw[i * 2 + 1] = cw[(n - 1 - i) * 2 + 1]; }
    for (const ring of [cw, ccw]) {
      const m = buildingMesh([{ ring, base: 0, top: 10, color: [1, 2, 3] }]), p = m.position;
      let roofs = 0, walls = 0;
      for (let q = 0; q < m.index.length; q += 3) {
        const [a, b, c] = [m.index[q], m.index[q + 1], m.index[q + 2]].map((i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        // flatens forside er dit normalen peker (høyrehåndsregelen, som i WebGL)
        const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
        if (Math.abs(ny) > 1e-6) { expect(ny).toBeGreaterThan(0); roofs++; continue; } // tak: normalen peker opp
        // vegg: et lite steg langs normalen fra veggens midtpunkt skal havne UTENFOR omrisset
        const len = Math.hypot(nx, nz), mx = (a[0] + b[0] + c[0]) / 3 + (nx / len) * 0.1, mz = (a[2] + b[2] + c[2]) / 3 + (nz / len) * 0.1;
        let inside = false;
        for (let i = 0, n = ring.length / 2, j = n - 1; i < n; j = i++) {
          if (ring[i * 2 + 1] > mz !== ring[j * 2 + 1] > mz && mx < ((ring[j * 2] - ring[i * 2]) * (mz - ring[i * 2 + 1])) / (ring[j * 2 + 1] - ring[i * 2 + 1]) + ring[i * 2]) inside = !inside;
        }
        expect(inside).toBe(false);
        walls++;
      }
      expect([roofs, walls]).toEqual([4, 12]);
    }
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
