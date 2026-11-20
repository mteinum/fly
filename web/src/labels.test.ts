import { describe, expect, it } from "vitest";
import { candidates, declutter, inSight, labelStyle, type PlaceName, visibleRange } from "./labels";
import { hasTiles, loadReference, loadTestTerrain } from "./testTerrain";

const place = (o: Partial<PlaceName>): PlaceName => ({ name: "x", x: 0, y: 0, z: 0, size: 6, type: "gard", group: "bebyggelse", ...o });

describe("stedsnavn: rekkevidde og utvalg", () => {
  it("viser store navn langt unna og små bare på nært hold", () => {
    expect(visibleRange(place({ size: 12.75 }))).toBeGreaterThan(visibleRange(place({ size: 8.7 })));
    expect(visibleRange(place({ size: 8.7 }))).toBeGreaterThan(visibleRange(place({ size: 5 })));
    expect(visibleRange(place({ size: 5 }))).toBeLessThanOrEqual(2000);
  });

  it("lar bruer og flyplasser ses lenger enn skriftstørrelsen tilsier", () => {
    expect(visibleRange(place({ size: 6, type: "bru" }))).toBeGreaterThanOrEqual(7000);
    expect(visibleRange(place({ size: 6 }))).toBeLessThan(7000);
    expect(visibleRange(place({ size: 7.3, type: "flyplass" }))).toBeGreaterThanOrEqual(15000);
  });

  it("dropper navn som ville overlappet et viktigere navn", () => {
    const boxes = [{ x: 0, y: 0, w: 30, h: 6, id: 1 }, { x: 20, y: 2, w: 30, h: 6, id: 2 }, { x: 60, y: 0, w: 20, h: 6, id: 3 }, { x: 0, y: 20, w: 30, h: 6, id: 4 }];
    expect(declutter(boxes, 10).map((b) => b.id)).toEqual([1, 3, 4]);
    expect(declutter(boxes, 2).map((b) => b.id)).toEqual([1, 3]);
  });

  it("gir vann, terreng og kjennemerker hver sin stil", () => {
    expect(labelStyle(place({ group: "sjø", type: "fjord" })).italic).toBe(true);
    expect(labelStyle(place({ type: "bru", group: "infrastruktur" })).color).not.toBe(labelStyle(place({})).color);
  });
});

describe.skipIf(!hasTiles("kjevik"))("stedsnavn i flisene (Kjevik)", () => {
  const t = loadTestTerrain(), ref = loadReference() as unknown as { landmarks: { points: { name: string; east: number; north: number }[] } };
  const find = (name: string) => t.names.find((n) => n.name === name)!;

  it("har hele navn, ikke tekstbitene kartet er trykket med", () => {
    expect(t.names.length).toBeGreaterThan(500);
    for (const name of ["Kristiansand", "Topdalsfjorden", "Moseidvarden", "Varoddbrua"]) expect(find(name), name).toBeDefined();
    expect(t.names.some((n) => n.name.endsWith("-"))).toBe(false); // «Topdals-» er en bit, ikke et navn
    expect(find("Topdalsfjorden").group).toBe("sjø");
    expect(find("Varoddbrua").type).toBe("bru");
  });

  it("har Varoddbrua på brua, i dekkhøyde, der stedsnavnregisteret sier", () => {
    const b = find("Varoddbrua"), p = ref.landmarks.points.find((q) => q.name === "Varoddbrua")!;
    const [x, y] = t.utmToGrid(p.east, p.north);
    expect(Math.hypot(b.x - x, b.y - y) * t.cell).toBeLessThan(500);
    expect(b.z).toBeGreaterThan(12); // over fjorden, ikke på havnivå
    expect(b.z).toBeLessThan(40);
  });

  it("har Moseidvarden på toppen og Kristiansand i byen", () => {
    const top = find("Moseidvarden");
    expect(top.z).toBeGreaterThan(280);
    const [dx, dy] = t.utmToGrid(88033.63, 6466411.58); // domkirken
    // byens eget punkt i SSR ligger ved domkirken; kartteksten står 1,4 km unna, ute i havna
    expect(Math.hypot(find("Kristiansand").x - dx, find("Kristiansand").y - dy) * t.cell).toBeLessThan(300);
  });

  it("viser byen og flyplassen fra innflygingen, men ikke små navn langt unna", () => {
    const arp = t.meta.airports[0].arp;
    const names = candidates(t, arp.x - 80, arp.y + 80, 400).map((c) => c.place.name); // ca. 5,6 km sørvest for flyplassen
    expect(names).toContain("Kristiansand");
    expect(names).toContain("Varoddbrua");
    const far = candidates(t, arp.x - 80, arp.y + 80, 400).filter((c) => c.place.size <= 5.5 && c.distanceM > 2100);
    expect(far).toEqual([]);
  });

  it("skjuler navn som ligger bak en ås", () => {
    const top = find("Moseidvarden");
    // 2 km sør for toppen, lavt: sikt til toppen selv, men ikke til noe like bak og nedenfor den
    expect(inSight(t, top.x, top.y + 2000 / t.cell, top.z + 50, top)).toBe(true);
    const behind = { ...top, y: top.y - 1500 / t.cell, z: 60 };
    expect(inSight(t, top.x, top.y + 2000 / t.cell, 80, behind)).toBe(false);
  });
});
