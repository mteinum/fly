import { describe, expect, it } from "vitest";
import { APPROACH_DIST_M, moveFlaps, onRunway, runwayOffset, softStick, speedLimit, stallSpeed, startApproach, toggleGear, update } from "./physics";
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
    it(`bane ${end.ident}: starter 8 km ute på forlenget senterlinje med kurs mot banen`, () => {
      const P = newPlane();
      startApproach(P, t, end);
      const { along, cross } = runwayOffset(t, rw, P.x, P.y);
      expect(Math.abs(cross)).toBeLessThan(1);
      // avstand langs banen måles fra ende 03; rutenettlengden er ~6 m lengre enn publisert lengde
      const gridLen = runwayOffset(t, rw, he.x, he.y).along;
      expect(end === le ? along : along - gridLen).toBeCloseTo(end === le ? -APPROACH_DIST_M : APPROACH_DIST_M, 0);
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
    expect(said).toMatch(/^Landed/);
  });

  it("fjorden gir plask", () => {
    const { P, said } = lowOver(...t.utmToGrid(92000, 6469000));
    expect(P.state).toBe("crash");
    expect(said).toMatch(/^Splash/);
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
      Object.assign(P, { x: cx, y: cy + 2, alt, hdg: 0, spd: 60, pitch: 0, thr: 0.4 });
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
      expect(said).toBe("Hit the bridge!");
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
    expect(said).toBe("Hit a building!");
  });

  it("å fly ut av utsnittet stopper flyet", () => {
    const P = newPlane();
    Object.assign(P, { x: 1, y: 100, alt: 800, hdg: (270 * Math.PI) / 180, spd: 80, thr: 0.2 });
    for (let i = 0; i < 100 && P.state === "fly"; i++) update(P, t, airport, {}, 0.05, quiet);
    expect(P.state).toBe("outside");
  });
});

describe("klaffer og understell", () => {
  const level = (setup: (P: ReturnType<typeof newPlane>) => void, seconds: number, thr: number) => {
    const P = newPlane();
    Object.assign(P, { x: 250, y: 400, alt: 1200, hdg: 0, spd: 80, pitch: 0, thr });
    setup(P);
    for (let i = 0; i < seconds * 50 && P.state === "fly"; i++) { P.pitch = 0; update(P, t, airport, {}, 0.02, quiet); }
    return P;
  };

  it("innflygingen starter med klaff 2 og understellet oppe, og holder farten", () => {
    const P = newPlane();
    startApproach(P, t, le);
    expect([P.flapCfg, P.flaps, P.gearDown, P.gear]).toEqual([2, 2, false, 0]);
    const v0 = P.spd;
    for (let i = 0; i < 250; i++) { P.pitch = 0; update(P, t, airport, {}, 0.02, quiet); }
    expect(Math.abs(P.spd - v0)).toBeLessThan(0.5);
    expect(P.spd).toBeGreaterThan(stallSpeed(P) + 10);
    expect(P.spd).toBeLessThan(speedLimit(P));
  });

  it("understellet bruker 8 s på å gå ned, og kan ikke betjenes på bakken", () => {
    const P = level((p) => { p.gearDown = false; p.gear = 0; }, 0, 0.5);
    toggleGear(P, quiet);
    for (let i = 0; i < 200; i++) update(P, t, airport, {}, 0.02, quiet);
    expect(P.gear).toBeCloseTo(0.5, 1);
    for (let i = 0; i < 250; i++) update(P, t, airport, {}, 0.02, quiet);
    expect(P.gear).toBe(1);
    P.state = "landed";
    toggleGear(P, quiet);
    expect(P.gearDown).toBe(true);
  });

  it("klaffspaken går ett hakk om gangen mellom 0 og FULL", () => {
    const P = newPlane();
    let said = "";
    moveFlaps(P, 1, (m) => { said = m; });
    expect(P.flapCfg).toBe(4);
    expect(said).toBe("");
    moveFlaps(P, -1, (m) => { said = m; });
    expect([P.flapCfg, said]).toEqual([3, "Flaps 3"]);
    for (let i = 0; i < 9; i++) moveFlaps(P, -1, quiet);
    expect(P.flapCfg).toBe(0);
  });

  it("mer klaff gir lavere steilefart, lavere fartsgrense og mer motstand", () => {
    const P = newPlane();
    let prevStall = Infinity, prevLimit = Infinity, prevSpeed = Infinity;
    for (let c = 0; c <= 4; c++) {
      P.flapCfg = P.flaps = c;
      expect(stallSpeed(P)).toBeLessThan(prevStall);
      expect(speedLimit(P)).toBeLessThanOrEqual(prevLimit);
      const v = level((p) => { p.flapCfg = p.flaps = c; p.gearDown = false; p.gear = 0; }, 60, 0.6).spd;
      expect(v).toBeLessThan(prevSpeed);
      [prevStall, prevLimit, prevSpeed] = [stallSpeed(P), speedLimit(P), v];
    }
  });

  it("understellet bremser, og begrenser farten til 280 kt uten klaff", () => {
    const up = level((p) => { p.flapCfg = p.flaps = 0; p.gearDown = false; p.gear = 0; }, 60, 0.6);
    const down = level((p) => { p.flapCfg = p.flaps = 0; }, 60, 0.6);
    expect(down.spd).toBeLessThan(up.spd - 4);
    expect(speedLimit(up) * 1.943844).toBeCloseTo(350, 0);
    expect(speedLimit(down) * 1.943844).toBeCloseTo(280, 0);
  });

  it("landing med understellet oppe er buklanding", () => {
    const P = newPlane();
    const x = le.x + 0.3 * (he.x - le.x), y = le.y + 0.3 * (he.y - le.y);
    Object.assign(P, { x, y, alt: t.heightAt(x, y) + 2, hdg: (le.headingGridDeg * Math.PI) / 180, spd: 62, pitch: -0.03, thr: 0.3, gearDown: false, gear: 0 });
    let said = "";
    for (let i = 0; i < 100 && P.state === "fly"; i++) update(P, t, airport, {}, 0.02, (m) => { said = m; });
    expect(P.state).toBe("crash");
    expect(said).toMatch(/^Belly landing/);
  });
});

describe("myk stikke på tastatur", () => {
  /** Hold en tast i `seconds` og se hvor mye flyet har endret stilling. */
  const press = (key: string, seconds: number, soft: boolean) => {
    const P = newPlane(), held = {}, dt = 1 / 60;
    startApproach(P, t, le);
    P.pitch = 0;
    for (let i = 0; i < Math.round(seconds / dt); i++) update(P, t, airport, soft ? softStick(held, { [key]: true }, dt) : { [key]: true }, dt, quiet);
    return P;
  };

  it("et kort trykk gir et lite utslag, mye mindre enn før", () => {
    const tap = press("ArrowDown", 0.1, true).pitch, before = press("ArrowDown", 0.1, false).pitch;
    expect(tap * 57.3).toBeLessThan(0.5); // under en halv grad
    expect(before * 57.3).toBeGreaterThan(3);
    expect(Math.abs(press("ArrowRight", 0.2, true).roll)).toBeLessThan(Math.abs(press("ArrowRight", 0.2, false).roll) / 3);
  });

  it("holdes tasten, kommer fullt utslag", () => {
    const held = {};
    let keys = softStick(held, { ArrowLeft: true }, 0.5);
    expect(keys.ArrowLeft).toBeCloseTo(0.625);
    keys = softStick(held, { ArrowLeft: true }, 0.5);
    expect(keys.ArrowLeft).toBe(1);
    expect(softStick(held, {}, 0.016).ArrowLeft).toBe(0); // slipp: rett til null
    expect(softStick(held, { KeyW: true }, 0.016).KeyW).toBe(true); // gassen er uendret
  });
});
