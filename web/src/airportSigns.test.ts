/* Skilt og ventepunktmerking: riktig innhold, riktig side, og på alle flyplassene. */
import { describe, expect, it } from "vitest";
import { airportSigns, holdingPoints, holdMarkings } from "./airportSigns";
import { hasTiles, loadTestTerrain } from "./testTerrain";

const AREAS = ["kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10", "mehamn10", "tromso10", "alesund10", "kjeller10"];

describe.skipIf(!hasTiles("kjevik10"))("skilt på Kjevik", () => {
  if (!hasTiles("kjevik10")) return;
  const t = loadTestTerrain("kjevik10"), airport = t.meta.airports[0], signs = airportSigns(t, airport);

  it("har påbudsskilt med rullebanens navn ved hvert ventepunkt, vendt mot den som kjører mot banen", () => {
    const holds = holdingPoints(t, airport), mandatory = signs.filter((s) => s.panels.some((p) => p.kind === "mandatory"));
    expect(holds.length).toBeGreaterThan(0);
    expect(mandatory.length).toBe(holds.length);
    const rw = airport.runways[0], [a, b] = rw.ends;
    for (const s of mandatory) {
      expect(s.panels.find((p) => p.kind === "mandatory")!.text).toBe("03-21");
      // et stykke fram i skiltets retning er nærmere rullebanen enn skiltet selv
      const dist = (x: number, y: number) => { const dx = b.x - a.x, dy = b.y - a.y, f = ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy); return Math.hypot(x - a.x - f * dx, y - a.y - f * dy); };
      expect(dist(s.x + Math.sin(s.heading) * 3, s.y - Math.cos(s.heading) * 3)).toBeLessThan(dist(s.x, s.y));
    }
  });

  it("har retningsskilt foran kryssene, med stedsskiltet mellom venstre- og høyresvingene", () => {
    const direction = signs.filter((s) => s.panels.some((p) => p.kind === "direction"));
    expect(direction.length).toBeGreaterThan(8);
    const names = new Set(t.aeroways!.taxiways.map((tw) => tw.ref).filter(Boolean));
    for (const s of direction) {
      const kinds = s.panels.map((p) => (p.kind === "direction" ? (p.turn < 0 ? "L" : "R") : p.kind === "location" ? "O" : "M")).join("");
      expect(kinds).toMatch(/^L*O?R*$/);
      for (const p of s.panels) expect(names.has(p.text)).toBe(true);
      // retningsskiltene peker aldri på taksebanen flyet allerede står på
      const here = s.panels.find((p) => p.kind === "location")?.text;
      for (const p of s.panels) if (p.kind === "direction") expect(p.text).not.toBe(here);
    }
  });

  it("har skilt langs rullebanen som viser avkjøringene, uten stedsskilt", () => {
    const onRunway = signs.filter((s) => s.panels.length && s.panels.every((p) => p.kind === "direction"));
    expect(onRunway.length).toBeGreaterThan(2);
  });

  it("merker ventepunktene med to hele og to stiplede linjer", () => {
    const marks = holdMarkings(t, airport), holds = holdingPoints(t, airport);
    const long = marks.filter((m) => Math.hypot(m.line[1][0] - m.line[0][0], m.line[1][1] - m.line[0][1]) > 10);
    expect(long.length).toBe(holds.length * 2);
    expect(marks.length).toBeGreaterThan(holds.length * 6);
  });
});

for (const area of AREAS) {
  describe.skipIf(!hasTiles(area))(`skilt, ${area}`, () => {
    if (!hasTiles(area)) return;
    const t = loadTestTerrain(area), airport = t.meta.airports[0];
    it("står innenfor kartet, og hvert skilt har noe på seg", () => {
      const signs = airportSigns(t, airport);
      expect(signs.length).toBeGreaterThan(0);
      for (const s of signs) { expect(t.inBounds(s.x, s.y)).toBe(true); expect(s.panels.length).toBeGreaterThan(0); expect(Number.isFinite(s.heading)).toBe(true); }
    });
  });
}
