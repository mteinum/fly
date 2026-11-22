import { describe, expect, it } from "vitest";
import type { PlaceName } from "./labels";
import { namesInPhoto, sightsFrom, sightsInPhoto, sightsLine, visitSights } from "./sights";
import { hasTiles, loadTestTerrain } from "./testTerrain";
import { wrapText } from "./hud";

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

  it("et sted er med i bildet når det er i rammen, nær nok og synlig; nærmeste først", () => {
    const s = sightsFrom([place("Nær", 100, 100), place("Fjern", 100, 180), place("Tredje", 104, 190), place("Kant", 150, 100), place("Skjult", 120, 100), place("Langt", 100, 900)]);
    const eye: [number, number, number] = [1000, 300, 800]; // 200 m sør for «Nær» (y øker mot sør), 300 m oppe
    // en enkel «linse»: øst-vest gir x i bildet, alt havner midt i høyden; «Kant» faller utenfor rammen
    const project = (wx: number) => (wx > 1400 ? [0.9, 0.5] : [0.5 + (wx - 1000) / 1000, 0.5]) as [number, number];
    const seen = sightsInPhoto(s, eye, 10, project, (x) => x.name !== "Skjult");
    // «Langt» er 8 km unna, og «Tredje» er i bildet, men ett bilde gir høyst to steder
    expect(seen.map((x) => x.name)).toEqual(["Nær", "Fjern"]);
    expect(sightsInPhoto(s, eye, 10, () => null, () => true)).toEqual([]); // bak kameraet
  });

  it("navngir bildet etter stedene i det", () => {
    expect(namesInPhoto([])).toBe("");
    expect(namesInPhoto(["Operaen"])).toBe("Operaen");
    expect(namesInPhoto(["Operaen", "Munchmuseet"])).toBe("Operaen and Munchmuseet");
    expect(namesInPhoto(["Operaen", "Munchmuseet", "Barcode", "Deichman Bjørvika"])).toBe("Operaen, Munchmuseet and 2 more");
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

describe("lange meldinger", () => {
  it("brytes ved ordskiller så ingen linje er for bred", () => {
    const width = (s: string) => s.length; // ett tegn = én enhet
    expect(wrapText("Kort", 20, width)).toEqual(["Kort"]);
    expect(wrapText("Tower: taxi to stand 16 via C, Y. Optional: press W to taxi.", 30, width)).toEqual(["Tower: taxi to stand 16 via C,", "Y. Optional: press W to taxi."]);
    expect(wrapText("Etlangtordutenmellomrom her", 10, width)).toEqual(["Etlangtordutenmellomrom", "her"]); // et ord deles aldri
    expect(wrapText("", 10, width)).toEqual([""]);
  });
});

