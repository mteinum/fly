import { describe, expect, it } from "vitest";
import type { PlaceName } from "./labels";
import { sightsFrom, sightsLine, visitSights } from "./sights";
import { hasTiles, loadTestTerrain } from "./testTerrain";

const place = (name: string, x: number, y: number, type = "landemerke"): PlaceName => ({ name, x, y, z: 20, size: 8, type, group: "bebyggelse" });

describe("sightseeing", () => {
  it("tar bare landemerker, og bare når det er nok av dem", () => {
    expect(sightsFrom([place("A", 1, 1), place("B", 2, 2), place("By", 3, 3, "by")])).toEqual([]);
    expect(sightsFrom([place("A", 1, 1), place("B", 2, 2), place("C", 3, 3), place("By", 3, 3, "by")]).map((s) => s.name)).toEqual(["A", "B", "C"]);
  });

  it("finner et sted når flyet er nær og lavt nok, og bare én gang", () => {
    const s = sightsFrom([place("A", 100, 100), place("B", 200, 100), place("C", 300, 100)]);
    expect(visitSights(s, 100, 150, 300, 10)).toEqual([]); // 500 m unna
    expect(visitSights(s, 100, 140, 2000, 10)).toEqual([]); // 400 m unna, men 2 km over
    expect(visitSights(s, 100, 140, 300, 10).map((x) => x.name)).toEqual(["A"]);
    expect(visitSights(s, 100, 140, 300, 10)).toEqual([]);
    expect(s.filter((x) => x.found)).toHaveLength(1);
  });

  it("skriver linja til diplomet", () => {
    expect(sightsLine(null)).toBe("");
    expect(sightsLine({ found: 0, total: 9, seconds: null })).toBe("");
    expect(sightsLine({ found: 4, total: 9, seconds: null })).toBe("and found 4 of 9 sights");
    expect(sightsLine({ found: 9, total: 9, seconds: 400.7 })).toBe("and found all 9 sights in 6:40");
  });

  it.skipIf(!hasTiles("kjeller10"))("Oslo har Operaen og Stortinget å finne, men ikke Slottet", () => {
    const names = sightsFrom(loadTestTerrain("kjeller10").names).map((s) => s.name);
    expect(names).toContain("Operaen");
    expect(names).toContain("Stortinget");
    expect(names).not.toContain("Slottet");
  });
});
