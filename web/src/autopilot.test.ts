/* Autopiloten skal lande på alle baner spillet har, fra innflygingens startpunkt og fra skjeve utgangspunkt. */
import { describe, expect, it } from "vitest";
import { autopilot } from "./autopilot";
import { gradeLanding } from "./diploma";
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
    if (!cmd) break;
    if (cmd.gearDown !== P.gearDown) toggleGear(P, quiet);
    if (cmd.flapCfg !== P.flapCfg) moveFlaps(P, Math.sign(cmd.flapCfg - P.flapCfg), quiet);
    update(P, t, airport, cmd.keys, dt, quiet);
  }
  return P;
}

const AREAS = ["kjevik", "kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10"];
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
    expect(autopilot(P, t, rw, end)).toBeNull();
  });

  it("setter ut understell og klaffer i rekkefølge, og aldri over fartsgrensen for dem", () => {
    const P = newPlane();
    startApproach(P, t, end);
    expect(autopilot(P, t, rw, end)).toMatchObject({ gearDown: false, flapCfg: 2 });
    fly(t, rw, end, P, 1 / 60);
    expect(P).toMatchObject({ gear: 1, flaps: 4 });
  });
});
