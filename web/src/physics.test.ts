import { describe, expect, it } from "vitest";
import { onRunway, runwayOffset, startApproach, update } from "./physics";
import { newPlane } from "./plane";
import { loadTestTerrain } from "./testTerrain";

const t = loadTestTerrain();
const airport = t.meta.airports[0];
const rw = airport.runways[0];
const [le, he] = rw.ends;
const quiet = () => {};

describe("rullebanen", () => {
  it("dekker senterlinja mellom baneendene, og ikke mer", () => {
    const at = (f: number): [number, number] => [le.x + f * (he.x - le.x), le.y + f * (he.y - le.y)];
    for (const f of [0.01, 0.5, 0.99]) expect(onRunway(t, airport, ...at(f))).toBe(true);
    for (const f of [-0.05, 1.05]) expect(onRunway(t, airport, ...at(f))).toBe(false);
    // 100 m til siden er utenfor
    const hdg = (le.headingGridDeg * Math.PI) / 180, [mx, my] = at(0.5);
    expect(onRunway(t, airport, mx + (Math.cos(hdg) * 100) / t.cell, my + (Math.sin(hdg) * 100) / t.cell)).toBe(false);
  });

  it("har lengde lik publisert banelengde (± målestokkfaktor)", () => {
    const { along, cross } = runwayOffset(t, rw, he.x, he.y);
    expect(Math.abs(along - rw.lengthM)).toBeLessThan(10);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
  });
});

describe("innflyging", () => {
  for (const end of rw.ends) {
    it(`bane ${end.ident}: starter 4 km ute på forlenget senterlinje med kurs mot banen`, () => {
      const P = newPlane();
      startApproach(P, t, end);
      const { along, cross } = runwayOffset(t, rw, P.x, P.y);
      expect(Math.abs(cross)).toBeLessThan(1);
      // avstand langs banen måles fra ende 03; rutenettlengden er ~6 m lengre enn publisert lengde
      const gridLen = runwayOffset(t, rw, he.x, he.y).along;
      expect(end === le ? along : along - gridLen).toBeCloseTo(end === le ? -4000 : 4000, 0);
      expect(t.inBounds(P.x, P.y)).toBe(true);
      expect(P.alt - t.heightAt(P.x, P.y)).toBeGreaterThan(100);
      // flyr rett fram i 20 s: avstanden til baneenden skal minke
      const d0 = Math.hypot(P.x - end.x, P.y - end.y);
      for (let i = 0; i < 400; i++) update(P, t, airport, {}, 0.05, quiet);
      expect(Math.hypot(P.x - end.x, P.y - end.y)).toBeLessThan(d0 - 15);
    });
  }
});

describe("bakkekontakt", () => {
  const lowOver = (x: number, y: number) => {
    const P = newPlane();
    Object.assign(P, { x, y, alt: Math.max(0, t.heightAt(x, y)) + 2, hdg: (le.headingGridDeg * Math.PI) / 180, spd: 60, pitch: -0.03, thr: 0.1 });
    let said = "";
    for (let i = 0; i < 100 && P.state === "fly"; i++) update(P, t, airport, {}, 0.02, (m) => { said = m; });
    return { P, said };
  };

  it("rolig sett på banen gir landing", () => {
    const { P, said } = lowOver(le.x + 0.2 * (he.x - le.x), le.y + 0.2 * (he.y - le.y));
    expect(P.state).toBe("landed");
    expect(said).toMatch(/^Landet/);
  });

  it("fjorden gir plask", () => {
    const { P, said } = lowOver(...t.utmToGrid(92000, 6469000));
    expect(P.state).toBe("crash");
    expect(said).toMatch(/^Plask/);
  });

  it("å fly ut av utsnittet stopper flyet", () => {
    const P = newPlane();
    Object.assign(P, { x: 1, y: 100, alt: 800, hdg: (270 * Math.PI) / 180, spd: 80, thr: 0.2 });
    for (let i = 0; i < 100 && P.state === "fly"; i++) update(P, t, airport, {}, 0.05, quiet);
    expect(P.state).toBe("outside");
  });
});
