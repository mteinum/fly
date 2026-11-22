import { describe, expect, it } from "vitest";
import { resample, ribbon, taxiLightPositions } from "./taxiDecal";
import { hasTiles, loadTestTerrain } from "./testTerrain";

describe("bånd langs en taksebane", () => {
  it("deler opp lange biter og beholder endene", () => {
    const r = resample([[0, 0], [100, 0], [100, 30]], 12);
    expect(r[0]).toEqual([0, 0]);
    expect(r[r.length - 1]).toEqual([100, 30]);
    for (let i = 1; i < r.length; i++) expect(Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1])).toBeLessThanOrEqual(12.001);
  });

  it("har riktig bredde på rett strekning, med venstre kant til venstre for retningen", () => {
    // retning øst (x øker): venstre er nord, og nord er -z
    const edges = ribbon([[0, 0], [10, 0], [20, 0]], 23);
    for (const [l, r] of edges) { expect(l[1]).toBeCloseTo(-11.5, 6); expect(r[1]).toBeCloseTo(11.5, 6); }
  });

  it("holder bredden gjennom en sving", () => {
    const edges = ribbon([[0, 0], [50, 0], [50, 50]], 20), [l, r] = edges[1];
    // i hjørnet ligger kantene på diagonalen, 10 m fra begge de rette strekningene
    expect(Math.abs(l[1])).toBeCloseTo(10, 5);
    expect(Math.abs(r[1])).toBeCloseTo(10, 5);
    expect(Math.abs(l[0] - 50)).toBeCloseTo(10, 5);
  });
});

describe.skipIf(!hasTiles("kjevik10"))("bakkeanlegget på Kjevik", () => {
  if (!hasTiles("kjevik10")) return;
  const t = loadTestTerrain("kjevik10");

  it.skipIf(!t.aeroways)("har taksebaner som når rullebanen, og stands med nummer", () => {
    const aero = t.aeroways!, rw = t.meta.airports[0].runways[0], [a, b] = rw.ends;
    expect(aero.taxiways.length).toBeGreaterThan(5);
    expect(aero.stands.filter((s) => s.ref).length).toBeGreaterThan(5);
    // minst én taksebane har et punkt innen 30 m fra rullebanens senterlinje
    const toCentre = (x: number, y: number) => {
      const dx = b.x - a.x, dy = b.y - a.y, f = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - a.x - f * dx, y - a.y - f * dy) * t.cell;
    };
    expect(aero.taxiways.some((tw) => tw.line.some(([x, y]) => toCentre(x, y) < 30))).toBe(true);
    for (const st of aero.stands) expect(t.inBounds(st.at[0], st.at[1])).toBe(true);
  });

  it.skipIf(!t.aeroways)("har blå kantlys langs taksebanene, men ikke på rullebanen", () => {
    const lights = taxiLightPositions(t), rw = t.meta.airports[0].runways[0], [a, b] = rw.ends;
    expect(lights.length).toBeGreaterThan(100);
    for (const [x, , z, r, g, bl] of lights) {
      expect([r, g, bl]).toEqual([40, 100, 255]);
      const px = x / t.cell, py = z / t.cell, dx = b.x - a.x, dy = b.y - a.y, f = ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy);
      const cross = Math.hypot(px - a.x - f * dx, py - a.y - f * dy) * t.cell;
      expect(f > 0 && f < 1 && cross < rw.widthM / 2).toBe(false);
    }
  });
});
