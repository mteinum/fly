/* Morofigurene står der de skal: innenfor kartet, skip og hval på åpent vann, resten på land. */
import { describe, expect, it } from "vitest";
import { FIGURES, inSeason, placeFigures } from "./figures";
import { hasTiles, loadTestTerrain } from "./testTerrain";

const AREAS = ["kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10", "mehamn10", "tromso10", "alesund10", "kjeller10"];
const AT_SEA = ["pirateShip", "vikingShip", "oilPlatform", "maelstrom", "whale", "puffins"];

for (const area of AREAS) {
  describe.skipIf(!hasTiles(area))(`morofigurer, ${area}`, () => {
    if (!hasTiles(area)) return;
    const t = loadTestTerrain(area), icao = t.meta.airports[0].icao, placed = placeFigures(t);

    it("får plass til alle figurene flyplassen har, og en ballong og flagg i tillegg", () => {
      const kinds = placed.map((f) => f.kind);
      for (const spec of FIGURES[icao] ?? []) expect(kinds, spec.kind).toContain(spec.kind);
      expect(kinds).toContain("balloon");
      expect(kinds).toContain("flags");
    });

    it("setter skip og hval på vann og resten på land, innenfor kartet", () => {
      for (const f of placed) {
        expect(t.inBounds(f.x, f.y), f.kind).toBe(true);
        if (AT_SEA.includes(f.kind)) { expect(t.isWater(f.x, f.y), f.kind).toBe(true); expect(f.groundM, f.kind).toBe(0); }
        else if (f.kind !== "balloon") expect(t.isWater(f.x, f.y), f.kind).toBe(false);
        if (f.to) expect(t.inBounds(f.to.x, f.to.y), f.kind).toBe(true);
      }
    });
  });
}

describe.skipIf(!hasTiles("kjeller10") || !hasTiles("flesland10"))("figurer som beveger seg", () => {
  it("lar skihopperen sveve nedover fra Holmenkollen", () => {
    const jumper = placeFigures(loadTestTerrain("kjeller10")).find((f) => f.kind === "skiJumper")!;
    expect(jumper.to!.groundM).toBeLessThan(jumper.groundM - 20);
  });

  it("lar Fløibanen gå oppover til Fløyen", () => {
    const car = placeFigures(loadTestTerrain("flesland10")).find((f) => f.kind === "funicular")!;
    expect(car.to!.groundM - car.groundM).toBeGreaterThan(250);
    expect(car.to!.groundM - car.groundM).toBeLessThan(350);
  });
});

describe("figurer som hører til en tid på året", () => {
  it("viser nissen bare i desember og flaggene bare 17. mai", () => {
    expect(inSeason("santa", 12, 3)).toBe(true);
    expect(inSeason("santa", 11, 30)).toBe(false);
    expect(inSeason("flags", 5, 17)).toBe(true);
    expect(inSeason("flags", 5, 16)).toBe(false);
    expect(inSeason("crown", 7, 1)).toBe(true);
  });
});
