import { describe, expect, it } from "vitest";
import { AIM_POINT_M, COURSE_DOT_DEG, GLIDE_ANGLE_DEG, GLIDE_DOT_DEG, glidePathAltitude, guidance } from "./guidance";
import { APPROACH_DIST_M, startApproach, update } from "./physics";
import { newPlane } from "./plane";
import { loadTestTerrain } from "./testTerrain";

const t = loadTestTerrain(), airport = t.meta.airports[0], rw = airport.runways[0], [le, he] = rw.ends;
const RAD = Math.PI / 180;

/** Fly `distM` før baneenden, `rightM` til høyre for senterlinja sett i innflygingsretningen, i gitt høyde. */
function at(end: typeof le, distM: number, rightM: number, alt: number) {
  const h = end.headingGridDeg * RAD;
  return Object.assign(newPlane(), {
    x: end.x + (-Math.sin(h) * distM + Math.cos(h) * rightM) / t.cell,
    y: end.y + (Math.cos(h) * distM + Math.sin(h) * rightM) / t.cell,
    alt,
  });
}

describe("kurs- og glidebaneviser", () => {
  for (const end of rw.ends) {
    const other = end === le ? he : le;

    it(`bane ${end.ident}: står i midten når flyet er på senterlinja og på 3° glidebane`, () => {
      for (const dist of [8000, 3000, 500]) {
        const g = guidance(t, rw, end, at(end, dist, 0, glidePathAltitude(t, end, dist)))!;
        expect(g.courseDots).toBeCloseTo(0, 6);
        expect(g.glideDots).toBeCloseTo(0, 6);
        expect(g.distanceM).toBeCloseTo(dist + end.displacedThresholdM + AIM_POINT_M, 3);
      }
    });

    it(`bane ${end.ident}: viser over og under glidebanen med riktig fortegn og størrelse`, () => {
      const on = glidePathAltitude(t, end, 5000), toAim = 5000 + end.displacedThresholdM + AIM_POINT_M;
      // ett merke over: glidevinkelen sett fra siktepunktet er 3,35°
      const oneDotHigh = on + toAim * (Math.tan((GLIDE_ANGLE_DEG + GLIDE_DOT_DEG) * RAD) - Math.tan(GLIDE_ANGLE_DEG * RAD));
      expect(guidance(t, rw, end, at(end, 5000, 0, oneDotHigh))!.glideDots).toBeCloseTo(1, 3);
      expect(guidance(t, rw, end, at(end, 5000, 0, on - 60))!.glideDots).toBeLessThan(-1);
    });

    it(`bane ${end.ident}: viser til høyre og venstre for senterlinja med riktig fortegn og størrelse`, () => {
      const length = Math.hypot(other.x - end.x, other.y - end.y) * t.cell, dist = 5000;
      const oneDotRight = Math.tan(COURSE_DOT_DEG * RAD) * (dist + length); // vinkelen måles fra den andre enden
      const alt = glidePathAltitude(t, end, dist);
      expect(guidance(t, rw, end, at(end, dist, oneDotRight, alt))!.courseDots).toBeCloseTo(1, 3);
      expect(guidance(t, rw, end, at(end, dist, -oneDotRight, alt))!.courseDots).toBeCloseTo(-1, 3);
    });

    it(`bane ${end.ident}: til høyre for linja betyr at banen ligger til venstre for flyet`, () => {
      // uavhengig kontroll av «høyre»: fra et punkt til høyre peiler baneenden mot venstre for innflygingskursen
      const P = at(end, 5000, 400, 300);
      const bearing = Math.atan2(end.x - P.x, -(end.y - P.y)) / RAD; // rutenettkurs mot baneenden
      const turn = ((bearing - end.headingGridDeg + 540) % 360) - 180;
      expect(turn).toBeLessThan(0); // må svinge venstre
      expect(guidance(t, rw, end, P)!.courseDots).toBeGreaterThan(0);
    });
  }

  it("slår seg av forbi siktepunktet, bak banen og langt ute", () => {
    expect(guidance(t, rw, le, at(le, -(le.displacedThresholdM + AIM_POINT_M + 10), 0, 30))).toBeNull();
    expect(guidance(t, rw, le, at(le, -4000, 0, 300))).toBeNull();
    expect(guidance(t, rw, le, at(le, 60000, 0, 3000))).toBeNull();
    expect(guidance(t, rw, le, at(le, 2000, 6000, 300))).toBeNull(); // mer enn 35° til siden
  });

  it("innflygingen starter på glidebanen og senterlinja, og et fly som holder 3° blir der", () => {
    const P = newPlane();
    startApproach(P, t, le);
    const g0 = guidance(t, rw, le, P)!;
    expect(Math.abs(g0.glideDots)).toBeLessThan(0.01);
    expect(Math.abs(g0.courseDots)).toBeLessThan(0.01);
    expect(g0.distanceM).toBeCloseTo(APPROACH_DIST_M + le.displacedThresholdM + AIM_POINT_M, 0);
    for (let i = 0; i < 1500; i++) { P.pitch = -GLIDE_ANGLE_DEG * RAD; update(P, t, airport, {}, 0.02, () => {}); }
    const g1 = guidance(t, rw, le, P)!;
    expect(Math.abs(g1.glideDots)).toBeLessThan(0.3);
    expect(Math.abs(g1.courseDots)).toBeLessThan(0.05);
  });
});
