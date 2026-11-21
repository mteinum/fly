/* Autopiloten skal lande på alle baner spillet har, fra innflygingens startpunkt og fra skjeve utgangspunkt. */
import { describe, expect, it } from "vitest";
import { autopilot } from "./autopilot";
import { gradeLanding } from "./diploma";
import { glidePathAltitude } from "./guidance";
import { moveFlaps, startApproach, toggleGear, update } from "./physics";
import { newPlane, type Plane } from "./plane";
import type { Runway, RunwayEnd, Terrain } from "./terrain";
import { hasTiles, loadTestTerrain } from "./testTerrain";

const quiet = () => {};

/** Fly med autopilot til flyet står på bakken (eller i 5 minutter). Slik game.ts bruker den. */
function fly(t: Terrain, rw: Runway, end: RunwayEnd, P: Plane, dt: number): Plane {
  const airport = t.meta.airports[0];
  for (let i = 0; i < 300 / dt && P.state === "fly"; i++) {
    const cmd = autopilot(P, t, rw, end);
    if ("unable" in cmd) break;
    if (cmd.gearDown !== P.gearDown) toggleGear(P, quiet);
    if (cmd.flapCfg !== P.flapCfg) moveFlaps(P, Math.sign(cmd.flapCfg - P.flapCfg), quiet);
    update(P, t, airport, cmd.keys, dt, quiet);
  }
  return P;
}

const AREAS = ["kjevik", "kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10", "mehamn10"];
for (const area of AREAS) {
  describe.skipIf(!hasTiles(area))(`autopilot ${area}`, () => {
    if (!hasTiles(area)) return;
    const t = loadTestTerrain(area);
    const ends = t.meta.airports[0].runways.flatMap((rw) => rw.ends.map((end) => [end.ident, rw, end] as const));

    it.each(ends)("bane %s: lander med toppkarakter fra innflygingens startpunkt", (_, rw, end) => {
      const P = newPlane();
      startApproach(P, t, end);
      fly(t, rw, end, P, 1 / 60);
      expect(P.state).toBe("landed");
      const grade = gradeLanding(P.touchdown!);
      expect(P.touchdown!.runway).toBe(end.ident);
      expect(grade.remarks).toEqual([]);
      expect(grade.stars).toBe(5);
    });

    it.each(ends)("bane %s: lander også med lav bildefrekvens", (_, rw, end) => {
      const P = newPlane();
      startApproach(P, t, end);
      expect(fly(t, rw, end, P, 0.05).state).toBe("landed");
      expect(gradeLanding(P.touchdown!).stars).toBeGreaterThanOrEqual(4);
    });

    it.each(ends)("bane %s: henter seg inn fra 400 m til siden, 80 m for høyt og 20° feil kurs", (_, rw, end) => {
      const P = newPlane();
      startApproach(P, t, end);
      const h = (end.headingGridDeg * Math.PI) / 180;
      P.x += (Math.cos(h) * 400) / t.cell; P.y += (Math.sin(h) * 400) / t.cell; // til høyre for senterlinja
      P.alt += 80; P.hdg += (20 * Math.PI) / 180;
      fly(t, rw, end, P, 1 / 60);
      expect(P.state).toBe("landed");
      expect(P.touchdown!.crossM).toBeLessThan(8);
    });
  });
}

describe("autopilot", () => {
  const t = loadTestTerrain(), rw = t.meta.airports[0].runways[0], end = rw.ends[0];

  it("gir opp når flyet flyr bort fra banen", () => {
    const P = newPlane();
    startApproach(P, t, end);
    P.hdg += Math.PI;
    expect(autopilot(P, t, rw, end)).toEqual({ unable: "no runway ahead" });
  });

  it("tar ikke på seg en landing den ikke rekker: 440 m høyde 2,2 km før terskelen", () => {
    // fra en ekte logg: autopiloten ble koblet inn her, gikk ned så bratt den kunne og satte flyet ned bak banen
    const P = newPlane(), h = (end.headingGridDeg * Math.PI) / 180, d = (2200 + end.displacedThresholdM) / t.cell;
    startApproach(P, t, end);
    Object.assign(P, { x: end.x - Math.sin(h) * d, y: end.y + Math.cos(h) * d, alt: 444, pitch: 0, gearDown: true, gear: 1, flapCfg: 4, flaps: 4 });
    expect(autopilot(P, t, rw, end)).toEqual({ unable: "too high to land, go around" });
  });

  it("fra en ekte logg: koblet inn 1,7 km til siden, 3,6 km ute og på vei bort, sier den nei mens det er god tid", () => {
    // første utgave fløy mot senterlinja i 30°, rakk ikke å rette opp og satte flyet ned 45 m ved siden av banen.
    // Geometrien er for trang: flyet må først snu 50°, og da er det mer enn halve avstanden til siden.
    const P = newPlane(), h = (end.headingGridDeg * Math.PI) / 180, d = (3627 + end.displacedThresholdM) / t.cell, c = 1733 / t.cell;
    startApproach(P, t, end);
    Object.assign(P, { x: end.x - Math.sin(h) * d - Math.cos(h) * c, y: end.y + Math.cos(h) * d - Math.sin(h) * c, alt: 231, hdg: h - (20.8 * Math.PI) / 180, spd: 82, gearDown: false, gear: 0, flapCfg: 2, flaps: 2 });
    fly(t, rw, end, P, 1 / 60);
    expect(P.state).toBe("fly");
    expect(autopilot(P, t, rw, end)).toEqual({ unable: "too far off the centreline, go around" });
    const toThreshold = Math.hypot(P.x - end.x, P.y - end.y) * t.cell;
    expect(toThreshold).toBeGreaterThan(2500); // lenge før banen, og høyt nok til å fly videre selv
    expect(P.alt - Math.max(0, t.heightAt(P.x, P.y))).toBeGreaterThan(100);
  });

  it("lander fra 30 % av avstanden til siden, på alle avstander", () => {
    const h = (end.headingGridDeg * Math.PI) / 180;
    for (const distM of [1500, 2500, 4000, 7000]) for (const side of [1, -1]) {
      const P = newPlane(), d = (distM + end.displacedThresholdM) / t.cell, c = (side * distM * 0.3) / t.cell;
      startApproach(P, t, end);
      Object.assign(P, { x: end.x - Math.sin(h) * d + Math.cos(h) * c, y: end.y + Math.cos(h) * d + Math.sin(h) * c, alt: glidePathAltitude(t, end, distM + end.displacedThresholdM) });
      fly(t, rw, end, P, 1 / 60);
      expect(P.state, `${distM} m ute`).toBe("landed");
      expect(P.touchdown!.crossM, `${distM} m ute`).toBeLessThan(5);
    }
  });

  it("lander eller avbryter, men setter aldri flyet ned ved siden av banen", () => {
    const h = (end.headingGridDeg * Math.PI) / 180;
    for (const distM of [500, 800, 1500, 3000, 6000]) for (const ratio of [-2, -1, -0.45, 0.2, 0.45, 1, 2]) {
      const P = newPlane(), d = (distM + end.displacedThresholdM) / t.cell, c = (distM * ratio) / t.cell;
      startApproach(P, t, end);
      Object.assign(P, { x: end.x - Math.sin(h) * d + Math.cos(h) * c, y: end.y + Math.cos(h) * d + Math.sin(h) * c, alt: glidePathAltitude(t, end, distM + end.displacedThresholdM) });
      fly(t, rw, end, P, 1 / 60);
      // «fly» betyr at autopiloten ga fra seg flyet i lufta
      expect(["landed", "fly"], `${distM} m ute, ${distM * ratio} m til siden: ${P.state}`).toContain(P.state);
      if (P.state === "landed") expect(P.touchdown!.crossM, `${distM} m ute, ${distM * ratio} m til siden`).toBeLessThan(10);
    }
  });

  it("det den tar på seg, lander den i første halvdel av banen", () => {
    // 150 m over glidebanen 4 km ute er innenfor grensen
    for (const [distM, extraM] of [[4000, 150], [2500, 80], [6000, 250]]) {
      const P = newPlane(), h = (end.headingGridDeg * Math.PI) / 180, d = distM / t.cell;
      startApproach(P, t, end);
      Object.assign(P, { x: end.x - Math.sin(h) * d, y: end.y + Math.cos(h) * d, alt: glidePathAltitude(t, end, distM) + extraM, gearDown: true, gear: 1, flapCfg: 4, flaps: 4 });
      expect("unable" in autopilot(P, t, rw, end), `${distM} m, +${extraM} m`).toBe(false);
      fly(t, rw, end, P, 1 / 60);
      expect(P.state, `${distM} m, +${extraM} m`).toBe("landed");
      expect(P.touchdown!.pastThresholdM, `${distM} m, +${extraM} m`).toBeLessThan(900);
    }
  });

  it("setter ut understell og klaffer i rekkefølge, og aldri over fartsgrensen for dem", () => {
    const P = newPlane();
    startApproach(P, t, end);
    expect(autopilot(P, t, rw, end)).toMatchObject({ gearDown: false, flapCfg: 2 });
    fly(t, rw, end, P, 1 / 60);
    expect(P).toMatchObject({ gear: 1, flaps: 4 });
  });
});
