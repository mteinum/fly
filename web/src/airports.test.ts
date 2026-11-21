/* Hver flyplass spillet har 10 m-fliser for: innflyging og landing skal virke på alle baner. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { glidePathAltitude } from "./guidance";
import { APPROACH_DIST_M, onRunway, runwayOffset, startApproach, update } from "./physics";
import { newPlane } from "./plane";
import { hasTiles, loadReference, loadTestTerrain } from "./testTerrain";
import { towerView } from "./tower";

const AREAS = ["kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10", "mehamn10"];
const audioDir = fileURLToPath(new URL("../public/audio/", import.meta.url));
const ref = loadReference();

for (const area of AREAS) {
  const suite = () => {
    const t = loadTestTerrain(area), airport = t.meta.airports[0];
    const ends = airport.runways.flatMap((rw) => rw.ends.map((end) => ({ rw, end })));

    it("har høyder innenfor ±2 m av Kartverkets DTM 1 m i fasitpunktene", () => {
      const points = ref.heights.areas[area.replace(/10$/, "")];
      expect(points.length).toBeGreaterThanOrEqual(3);
      for (const p of points) {
        const h = t.heightAt(...t.utmToGrid(p.east, p.north));
        expect(Math.abs(h - p.z), `${p.name}: ${h.toFixed(1)} mot ${p.z}`).toBeLessThanOrEqual(2);
      }
    });

    it("viser sann kurs lik publisert banekurs når flyet følger banen", () => {
      for (const { end } of ends) {
        const shown = t.trueHeadingDeg((end.headingGridDeg * Math.PI) / 180);
        expect(Math.abs(((shown - end.headingTrueDeg + 540) % 360) - 180), end.ident).toBeLessThan(0.6);
      }
    });

    it.each(ends.map((e) => [e.end.ident, e] as const))("bane %s: innflygingen starter 8 km ute, innenfor kartet, på senterlinja", (_, { rw, end }) => {
      const P = newPlane();
      startApproach(P, t, end);
      expect(t.inBounds(P.x, P.y)).toBe(true);
      expect(Math.hypot(P.x - end.x, P.y - end.y) * t.cell).toBeCloseTo(APPROACH_DIST_M, 0);
      expect(Math.abs(runwayOffset(t, rw, P.x, P.y).cross)).toBeLessThan(1);
      expect(P.alt - Math.max(0, t.heightAt(P.x, P.y))).toBeGreaterThan(150); // fri for terrenget ved start
      // rett fram i 30 s uten å treffe noe
      for (let i = 0; i < 1500 && P.state === "fly"; i++) { P.pitch = 0; update(P, t, airport, {}, 0.02, () => {}); }
      expect(P.state).toBe("fly");
    });

    it.each(ends.map((e) => [e.end.ident, e] as const))("bane %s: pipeline og spill regner samme glidebane, og innflygingen er fri for hindre", (_, { end }) => {
      // analysis.py (Python) og guidance.ts har hver sin utgave av geometrien: de skal gi samme høyde 8 km ute
      expect(end.approach!.startAltitudeM).toBeCloseTo(glidePathAltitude(t, end, APPROACH_DIST_M), 0);
      // Mehamn bane 35 går over en ås 3,4 km sør for banen: 3°-glidebanen har bare 9 m klaring der.
      // Det er terrenget, ikke en feil: analysen ble laget for å finne akkurat dette.
      expect(end.approach!.lowestClearanceM).toBeGreaterThan(area === "mehamn10" && end.ident === "35" ? 5 : 30);
      expect(end.approach!.lowestClearanceAtM).toBeGreaterThanOrEqual(1000);
    });

    it.each(ends.map((e) => [e.end.ident, e] as const))("bane %s: rolig sett på banen gir landing", (_, { rw, end }) => {
      const other = rw.ends.find((e) => e !== end)!;
      const x = end.x + 0.3 * (other.x - end.x), y = end.y + 0.3 * (other.y - end.y);
      expect(onRunway(t, airport, x, y)).toBe(true);
      const P = Object.assign(newPlane(), { x, y, alt: t.heightAt(x, y) + 2, hdg: (end.headingGridDeg * Math.PI) / 180, spd: 62, pitch: -0.03, thr: 0.3 });
      for (let i = 0; i < 100 && P.state === "fly"; i++) update(P, t, airport, {}, 0.02, () => {});
      expect(P.state).toBe("landed");
    });

    it("har tårnet på land med sikt til alle baneender", () => {
      const tw = airport.tower;
      expect(t.isWater(tw.x, tw.y)).toBe(false);
      for (const { end } of ends) {
        const v = towerView(t, Object.assign(newPlane(), { x: end.x, y: end.y, alt: t.heightAt(end.x, end.y) }));
        expect(v.distanceM, end.ident).toBeLessThan(4000);
        expect(v.pitch, end.ident).toBeLessThan(0); // ser ned på banen
      }
    });

    it("har tårnmelding for hver baneende og en velkomst", () => {
      for (const { end } of ends) expect(existsSync(`${audioDir}cleared_${airport.icao}_${end.ident}.mp3`), end.ident).toBe(true);
      expect(existsSync(`${audioDir}welcome_${airport.icao}.mp3`)).toBe(true);
    });
  };
  if (hasTiles(area)) describe(area, suite);
  else describe.skip(`${area} (fliser mangler)`, () => { it("hoppes over", () => {}); });
}
