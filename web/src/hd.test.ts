/* 10 m-flisene (3D-modus): samme Terrain og fysikk som pikselmodus, finere rutenett. */
import { describe, expect, it } from "vitest";
import { onRunway, startApproach, update } from "./physics";
import { newPlane } from "./plane";
import { BRIDGE } from "./terrain";
import { hasTiles, loadReference, loadTestTerrain } from "./testTerrain";

describe.skipIf(!hasTiles("kjevik10"))("kjevik10", () => {
  const t = loadTestTerrain("kjevik10");
  const lo = loadTestTerrain("kjevik");
  const ref = loadReference();
  const airport = t.meta.airports[0];
  const [le, he] = airport.runways[0].ends;

  it("dekker samme område som 50 m-flisene, med 10 m-celler", () => {
    expect(t.meta.bbox).toEqual(lo.meta.bbox);
    expect(t.cell).toBe(10);
    expect(t.width * t.cell).toBe(lo.width * lo.cell);
  });

  it("er nærmere Kartverkets DTM 1 m enn 50 m-flisene: ±2 m i fasitpunktene", () => {
    for (const p of ref.heights.points) {
      const h = t.heightAt(...t.utmToGrid(p.east, p.north));
      expect(Math.abs(h - p.z), `${p.name}: ${h.toFixed(1)} mot ${p.z}`).toBeLessThanOrEqual(2);
    }
  });

  it("har rullebanen samme sted i UTM som 50 m-flisene", () => {
    const [a] = lo.meta.airports[0].runways[0].ends;
    expect(t.gridToUtm(le.x, le.y)[0]).toBeCloseTo(lo.gridToUtm(a.x, a.y)[0], 1);
    expect(t.gridToUtm(le.x, le.y)[1]).toBeCloseTo(lo.gridToUtm(a.x, a.y)[1], 1);
    expect(onRunway(t, airport, (le.x + he.x) / 2, (le.y + he.y) / 2)).toBe(true);
  });

  it("starter innflygingen 4 km ute i meter, ikke i celler", () => {
    const P = newPlane();
    startApproach(P, t, le);
    expect(Math.hypot(P.x - le.x, P.y - le.y) * t.cell).toBeCloseTo(4000, 0);
  });

  it("lander på banen", () => {
    const P = newPlane();
    const x = le.x + 0.3 * (he.x - le.x), y = le.y + 0.3 * (he.y - le.y);
    Object.assign(P, { x, y, alt: t.heightAt(x, y) + 2, hdg: (le.headingGridDeg * Math.PI) / 180, spd: 60, pitch: -0.03, thr: 0.1 });
    for (let i = 0; i < 100 && P.state === "fly"; i++) update(P, t, airport, {}, 0.02, () => {});
    expect(P.state).toBe("landed");
  });

  it("har Varoddbrua som polylinje med dekket 30-40 m over fjorden", () => {
    const [bx, by] = t.utmToGrid(91491, 6467883);
    const near = t.bridges.filter((b) => b.points.some(([x, y]) => Math.hypot(x - bx, y - by) * t.cell < 100));
    expect(near.length).toBeGreaterThan(0);
    const top = Math.max(...near.flatMap((b) => b.points.map((p) => p[2])));
    expect(top).toBeGreaterThan(30);
    expect(top).toBeLessThan(40);
    // brucellene (kollisjon) følger polylinja
    const [x, y, z] = near[0].points[(near[0].points.length / 2) | 0];
    const ci = t.cellIndex(x, y);
    expect(t.sKind[ci]).toBe(BRIDGE);
    expect(Math.abs(t.sTop[ci] - z)).toBeLessThan(1.5);
  });
});
