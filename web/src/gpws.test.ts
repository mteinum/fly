/* Terrengvarselet skal tie på en riktig innflyging til alle baner, og si fra når flyet er på vei i terrenget. */
import { describe, expect, it } from "vitest";
import { autopilot } from "./autopilot";
import { requiredClearance, terrainAlert, WARNING_S } from "./gpws";
import { moveFlaps, startApproach, toggleGear, update } from "./physics";
import { newPlane } from "./plane";
import { hasTiles, loadTestTerrain } from "./testTerrain";

const quiet = () => {};
const AREAS = ["kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10", "mehamn10", "tromso10", "alesund10", "kjeller10"];

for (const area of AREAS) {
  describe.skipIf(!hasTiles(area))(`terrengvarsel ${area}`, () => {
    if (!hasTiles(area)) return;
    const t = loadTestTerrain(area), airport = t.meta.airports[0];
    const ends = airport.runways.flatMap((rw) => rw.ends.map((end) => [end.ident, rw, end] as const));

    it.each(ends)("bane %s: tier hele veien når autopiloten lander", (_, rw, end) => {
      const P = newPlane();
      startApproach(P, t, end);
      const alerts: string[] = [];
      for (let i = 0; i < 300 * 60 && P.state === "fly"; i++) {
        const cmd = autopilot(P, t, rw, end);
        if ("unable" in cmd) break;
        if (cmd.gearDown !== P.gearDown) toggleGear(P, quiet);
        if (cmd.flapCfg !== P.flapCfg) moveFlaps(P, Math.sign(cmd.flapCfg - P.flapCfg), quiet);
        update(P, t, airport, cmd.keys, 1 / 60, quiet);
        const a = terrainAlert(P, t, airport);
        if (a) alerts.push(`${a.level} ${Math.round(P.alt)} m`);
      }
      expect(P.state).toBe("landed");
      expect(alerts.length ? `${alerts.length}: ${alerts[0]} … ${alerts[alerts.length - 1]}` : "").toBe("");
    });

    it.each(ends)("bane %s: varsler når flyet stuper mot bakken 8 km ute", (_, _rw, end) => {
      const P = newPlane();
      startApproach(P, t, end);
      P.pitch = -0.2; // 11° ned i 160 kt: ca. 3200 fot per minutt
      const a = terrainAlert(P, t, airport);
      expect(a).not.toBeNull();
      // senere, rett før bakken, er det rødt
      for (let i = 0; i < 60 * 60 && P.state === "fly"; i++) {
        const now = terrainAlert(P, t, airport);
        if (now?.level === "warning") { expect(now.seconds).toBeLessThanOrEqual(WARNING_S); return; }
        update(P, t, airport, {}, 1 / 60, quiet);
        P.pitch = -0.2;
      }
      throw new Error("ingen rød varsling før flyet traff bakken");
    });
  });
}

describe.skipIf(!hasTiles("kjevik10"))("terrengvarsel, regler", () => {
  if (!hasTiles("kjevik10")) return;
  const t = loadTestTerrain("kjevik10"), airport = t.meta.airports[0], end = airport.runways[0].ends[0];

  it("krever ingen klaring ved banen og full klaring langt unna", () => {
    expect(requiredClearance(t, airport, end.x, end.y)).toBe(0);
    expect(requiredClearance(t, airport, end.x + 5000 / t.cell, end.y)).toBe(45);
  });

  it("tier i flat flyging høyt over terrenget, og når flyet står på bakken", () => {
    const P = newPlane();
    startApproach(P, t, end);
    P.alt = 1400; P.pitch = 0;
    expect(terrainAlert(P, t, airport)).toBeNull();
    P.pitch = -0.3; P.state = "landed";
    expect(terrainAlert(P, t, airport)).toBeNull();
  });
});
