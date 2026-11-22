/* T-bane, trikk og bybane fra OpenStreetMap: sporene ligger i kartet, og stasjonene får navn. */
import { describe, expect, it } from "vitest";
import { hasTiles, loadTestTerrain } from "./testTerrain";

const lengthKm = (line: [number, number][], cell: number) => line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]) * cell, 0) / 1000;

describe.skipIf(!hasTiles("kjeller10"))("skinner i Oslo", () => {
  if (!hasTiles("kjeller10")) return;
  const t = loadTestTerrain("kjeller10"), rails = t.rails!;

  it("har både T-bane og trikk, og T-banen går i tunnel gjennom sentrum", () => {
    const km = (kind: string, tunnel?: boolean) => rails.tracks.filter((r) => r.kind === kind && (tunnel === undefined || r.tunnel === tunnel)).reduce((s, r) => s + lengthKm(r.line, t.cell), 0);
    expect(km("metro")).toBeGreaterThan(80); // to spor: 85 km bane gir rundt 170 km spor i hele nettet
    expect(km("tram")).toBeGreaterThan(30);
    expect(km("metro", true)).toBeGreaterThan(10);
    expect(km("metro", false)).toBeGreaterThan(40);
  });

  it("holder alle spor og holdeplasser innenfor kartet", () => {
    for (const r of rails.tracks) for (const [x, y] of r.line) expect(t.inBounds(x, y)).toBe(true);
    for (const s of rails.stops) expect(t.inBounds(s.at[0], s.at[1]), s.name).toBe(true);
  });

  it("gir T-banestasjonene navneskilt, men ikke trikkeholdeplassene", () => {
    const metro = rails.stops.filter((s) => s.kind === "metro").map((s) => s.name);
    expect(metro).toEqual(expect.arrayContaining(["Majorstuen", "Jernbanetorget", "Tøyen"]));
    const signs = t.names.filter((n) => n.type === "banestasjon").map((n) => n.name);
    expect(signs).toContain("T Majorstuen");
    expect(signs.length).toBe(metro.length);
    // stasjonen ligger der stedet ligger: Majorstuen stasjon innen 600 m fra stedsnavnet
    const sign = t.names.find((n) => n.name === "T Majorstuen")!, place = t.names.find((n) => n.name === "Majorstuen")!;
    expect(Math.hypot(sign.x - place.x, sign.y - place.y) * t.cell).toBeLessThan(600);
  });
});

describe.skipIf(!hasTiles("flesland10"))("Bybanen i Bergen", () => {
  if (!hasTiles("flesland10")) return;
  const t = loadTestTerrain("flesland10");

  it("går fra sentrum til flyplassen", () => {
    const stops = t.rails!.stops.filter((s) => s.kind === "lightrail").map((s) => s.name);
    expect(stops).toEqual(expect.arrayContaining(["Byparken", "Bergen lufthavn"]));
    expect(t.rails!.tracks.some((r) => r.kind === "lightrail" && r.tunnel)).toBe(true);
  });
});
