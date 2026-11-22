import { describe, expect, it } from "vitest";
import { altitudeCallout, CALLOUTS, windReadout } from "./audio";
import { warnings } from "./physics";
import { newPlane } from "./plane";

describe("utrop av radiohøyde", () => {
  it("kommer når en høyde passeres på vei ned", () => {
    expect(altitudeCallout(510, 498)).toBe(500);
    expect(altitudeCallout(500.5, 500)).toBe(500);
    expect(altitudeCallout(498, 480)).toBeNull();
    expect(altitudeCallout(11, 9)).toBe(10);
  });

  it("kommer ikke på vei opp eller i flat flyging", () => {
    expect(altitudeCallout(498, 510)).toBeNull();
    expect(altitudeCallout(500, 500)).toBeNull();
  });

  it("gir det laveste når flere passeres i samme steg", () => {
    expect(altitudeCallout(55, 28)).toBe(30);
  });

  it("gir hvert utrop nøyaktig én gang i en jevn nedstigning", () => {
    const said: number[] = [];
    for (let ft = 1200; ft > 0; ft -= 0.7) { const c = altitudeCallout(ft, ft - 0.7); if (c !== null) said.push(c); }
    expect(said).toEqual(CALLOUTS);
  });
});

describe("varsler", () => {
  const plane = (o: object) => Object.assign(newPlane(), { spd: 70 }, o);

  it("er stille i en normal innflyging", () => {
    expect(warnings(plane({}), 300)).toEqual({ overspeed: false, stall: false, gearNotDown: false });
  });

  it("varsler om understell bare lavt nede", () => {
    const P = plane({ gearDown: false, gear: 0 });
    expect(warnings(P, 800).gearNotDown).toBe(false);
    expect(warnings(P, 700).gearNotDown).toBe(true);
    expect(warnings(plane({ gear: 0.6 }), 700).gearNotDown).toBe(true); // på vei ned er ikke nok
  });

  it("varsler om steiling og for høy fart etter klaffstilling", () => {
    expect(warnings(plane({ spd: 50 }), 300).stall).toBe(true);
    expect(warnings(plane({ spd: 70, flapCfg: 0, flaps: 0 }), 3000).stall).toBe(true); // 136 kt uten klaff
    expect(warnings(plane({ spd: 95 }), 3000).overspeed).toBe(true); // 185 kt med full klaff
    expect(warnings(plane({ spd: 95, flapCfg: 2, flaps: 2 }), 3000).overspeed).toBe(false);
  });

  it("er stille når flyet ikke flyr", () => {
    expect(warnings(plane({ spd: 10, state: "landed" }), 0)).toEqual({ overspeed: false, stall: false, gearNotDown: false });
  });
});

describe("tårnets vindmelding", () => {
  it("leser retningen i hele ti grader med tre sifre, og farten uten ledende null", () => {
    expect(windReadout(60, 7)).toEqual(["atc_wind", "atc_0", "atc_6", "atc_0", "atc_degrees", "atc_7", "atc_knots"]);
    expect(windReadout(326, 21)).toEqual(["atc_wind", "atc_3", "atc_3", "atc_0", "atc_degrees", "atc_2", "atc_1", "atc_knots"]);
  });

  it("sier 360 for nord, og tar med kast bare når de er sterkere enn middelvinden", () => {
    expect(windReadout(0, 10).slice(1, 4)).toEqual(["atc_3", "atc_6", "atc_0"]);
    expect(windReadout(357, 10).slice(1, 4)).toEqual(["atc_3", "atc_6", "atc_0"]);
    expect(windReadout(330, 21, 33).slice(-3)).toEqual(["atc_gusting", "atc_3", "atc_3"]);
    expect(windReadout(330, 21, 21)).not.toContain("atc_gusting");
  });
});
