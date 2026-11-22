/* Bussholdeplassene fra Enturs stoppestedsregister ligger i kartet, på land, der de skal. */
import { describe, expect, it } from "vitest";
import { hasTiles, loadTestTerrain } from "./testTerrain";

const AREAS = ["kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10", "mehamn10", "tromso10", "alesund10", "kjeller10"];

for (const area of AREAS) {
  describe.skipIf(!hasTiles(area))(`bussholdeplasser, ${area}`, () => {
    if (!hasTiles(area)) return;
    const t = loadTestTerrain(area);

    it("har holdeplasser med navn, innenfor kartet", () => {
      expect(t.busStops.length).toBeGreaterThan(3);
      for (const s of t.busStops) { expect(t.inBounds(s.x, s.y), s.name).toBe(true); expect(s.name.length, "navn").toBeGreaterThan(0); }
    });

    it("har nesten alle holdeplassene på land eller på en bru", () => {
      const wet = t.busStops.filter((s) => t.isWater(s.x, s.y) && t.roadPlace(s.x, s.y)[2] < 1);
      expect(wet.length / t.busStops.length, wet.slice(0, 5).map((s) => s.name).join(", ")).toBeLessThan(0.02);
    });
  });
}

describe.skipIf(!hasTiles("kjevik10"))("bussholdeplasser i Kristiansand", () => {
  it("har rutebilstasjonen vest i Kvadraturen", () => {
    const t = loadTestTerrain("kjevik10"), stop = t.busStops.find((s) => s.name === "Kristiansand rutebilstasjon")!;
    const [x, y] = t.utmToGrid(87650, 6466330); // jernbanestasjonen ligger vegg i vegg
    expect(Math.hypot(stop.x - x, stop.y - y) * t.cell).toBeLessThan(400);
  });
});
