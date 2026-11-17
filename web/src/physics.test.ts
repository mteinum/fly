import { describe, expect, it } from "vitest";
import { onRunway, runwayOffset, startApproach, update } from "./physics";
import { newPlane } from "./plane";
import { BRIDGE, BUILDING } from "./terrain";
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

  describe("Varoddbrua", () => {
    // høyeste brucelle over sjø i Topdalsfjorden, nær SSR-punktet for brua
    const [bx, by] = t.utmToGrid(91491, 6467883);
    let ci = -1;
    for (let i = 0; i < t.sKind.length; i++) {
      const cx = i % t.width, cy = (i / t.width) | 0;
      if (t.sKind[i] === BRIDGE && Math.hypot(cx - bx, cy - by) < 15 && t.isWater(cx, cy) && (ci < 0 || t.sTop[i] > t.sTop[ci])) ci = i;
    }
    const cx = (ci % t.width) + 0.5, cy = ((ci / t.width) | 0) + 0.5;
    const cross = (alt: number) => {
      const P = newPlane();
      // på tvers av brua (brua går øst-vest): fly nordover fra 100 m sør for cella
      Object.assign(P, { x: cx, y: cy + 2, alt, hdg: 0, spd: 60, pitch: 0, thr: 0.11 });
      let said = "";
      for (let i = 0; i < 160 && P.state === "fly"; i++) update(P, t, airport, {}, 0.02, (m) => { said = m; });
      return { P, said };
    };

    it("har dekket 30-40 m over fjorden (DOM), med sjø under i høydekartet", () => {
      expect(ci).toBeGreaterThanOrEqual(0);
      expect(t.sTop[ci]).toBeGreaterThan(30);
      expect(t.sTop[ci]).toBeLessThan(40);
      expect(t.heightAt(cx, cy)).toBeLessThan(1);
    });

    it("kan flys under", () => {
      const { P } = cross(12);
      expect(P.state).toBe("fly");
      expect(P.y).toBeLessThan(cy - 0.5);
    });

    it("stopper et fly i dekkhøyde", () => {
      const { P, said } = cross(t.sTop[ci] - 1);
      expect(P.state).toBe("crash");
      expect(said).toBe("Traff brua!");
    });

    it("kan flys over", () => {
      expect(cross(t.sTop[ci] + 30).P.state).toBe("fly");
    });
  });

  it("bygninger stikker opp over terrenget", () => {
    const i = t.sKind.indexOf(BUILDING), x = (i % t.width) + 0.5, y = ((i / t.width) | 0) + 0.5;
    expect(t.sTop[i] - Math.max(0, t.hgt[i])).toBeGreaterThan(6.9); // 7 m nominelt, avrundet til 0,1 m
    const P = newPlane();
    Object.assign(P, { x, y, alt: t.sTop[i] + 2, hdg: 0, spd: 60, pitch: -0.05, thr: 0.1 });
    let said = "";
    for (let k = 0; k < 20 && P.state === "fly"; k++) update(P, t, airport, {}, 0.02, (m) => { said = m; });
    expect(said).toBe("Traff en bygning!");
  });

  it("å fly ut av utsnittet stopper flyet", () => {
    const P = newPlane();
    Object.assign(P, { x: 1, y: 100, alt: 800, hdg: (270 * Math.PI) / 180, spd: 80, thr: 0.2 });
    for (let i = 0; i < 100 && P.state === "fly"; i++) update(P, t, airport, {}, 0.05, quiet);
    expect(P.state).toBe("outside");
  });
});
