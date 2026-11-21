import { describe, expect, it } from "vitest";
import { loadTestTerrain } from "./testTerrain";
import { type AdsbAircraft, aircraftSize, fromAdsb, locate, Traffic } from "./traffic";

const t = loadTestTerrain(), arp = t.meta.airports[0].arp;
const plane = (over: Partial<AdsbAircraft> = {}): AdsbAircraft => ({ id: "47a32e", e: arp.east, n: arp.north - 5000, altM: 600, alt: "geom", ground: false, gs: 140, track: 0, vr: -700, age: 2, flight: "NOZ1793", type: "B738", cat: "A3", ...over });

describe("fly fra ADS-B", () => {
  it("legger flyet i rutenettet med høyde over havet, og regner sann kurs om til rutenettkurs", () => {
    const [a] = fromAdsb([plane()], t, 100);
    expect(t.gridToUtm(a.x, a.y)[0]).toBeCloseTo(arp.east, 3);
    expect(t.gridToUtm(a.x, a.y)[1]).toBeCloseTo(arp.north - 5000, 3);
    expect([a.alt, a.at, a.flight]).toEqual([600, 98, "NOZ1793"]);
    expect((a.course * 180) / Math.PI).toBeCloseTo(-t.meta.gridConvergenceDeg, 6); // sann nord
    expect(a.speed).toBeCloseTo(72.02, 1); // 140 knop
    expect(a.climb).toBeCloseTo(-3.556, 2); // 700 fot i minuttet ned
  });

  it("flyr rett fram og synker mellom oppdateringene: 30 s i 140 knop og 700 fot/min", () => {
    const [a] = fromAdsb([plane({ age: 0 })], t, 0);
    const [x0, y0, z0] = locate(a, t, 0), [x1, y1, z1] = locate(a, t, 30);
    const [e0, n0] = t.gridToUtm(x0, y0), [e1, n1] = t.gridToUtm(x1, y1);
    expect(Math.hypot(e1 - e0, n1 - n0)).toBeCloseTo(72.02 * 30, 0);
    // sann nord: i UTM-planet dreid med konvergensen
    expect((Math.atan2(e1 - e0, n1 - n0) * 180) / Math.PI + t.meta.gridConvergenceDeg).toBeCloseTo(0, 4);
    expect(z0 - z1).toBeCloseTo(106.7, 0);
    // etter halvannet minutt uten ny posisjon står flyet stille der vi sist kunne anslå det
    expect(locate(a, t, 500)).toEqual(locate(a, t, 1000));
  });

  it("fly på bakken står på terrenget, og fly i lufta havner aldri under det", () => {
    const [g] = fromAdsb([plane({ e: arp.east, n: arp.north, ground: true, altM: null, alt: null, vr: null, gs: 0 })], t, 0);
    expect(locate(g, t, 10)[2]).toBeCloseTo(Math.max(0, t.heightAt(g.x, g.y)), 1);
    // trykkhøyde som er for lav (her under havnivå): løftes til like over terrenget
    const [low] = fromAdsb([plane({ altM: -50, alt: "baro", vr: -2000 })], t, 0);
    for (const s of [0, 20, 60]) { const [x, y, z] = locate(low, t, s); expect(z).toBeGreaterThanOrEqual(Math.max(0, t.heightAt(x, y)) + 5 - 1e-6); }
  });

  it("dropper fly utenfor kartet og med ugyldige tall", () => {
    expect(fromAdsb([plane({ e: t.meta.bbox.east + 100 })], t, 0)).toHaveLength(0);
    expect(fromAdsb([plane({ e: NaN })], t, 0)).toHaveLength(0);
    expect(fromAdsb([plane({ age: -1 })], t, 0)).toHaveLength(0);
    // en følgebil på Gardermoen sendte kategori C2 og ble tegnet som et fly
    expect(fromAdsb([plane({ cat: "C2", ground: true, flight: "VAKT101" })], t, 0)).toHaveLength(0);
  });

  it("en ny posisjon gir ikke hopp, og fly som forsvinner fra lista blir borte", () => {
    const tr = new Traffic();
    tr.update([plane({ age: 0 })], t, 0);
    const before = locate(tr.list[0], t, 45), [e, n] = t.gridToUtm(before[0], before[1]);
    // etter 45 s: flyet har svingt og ligger 400 m til siden og 30 m høyere enn anslått
    tr.update([plane({ e: e + 400, n, altM: before[2] + 30, track: 20, age: 0 })], t, 45);
    const now = locate(tr.list[0], t, 45);
    expect(Math.hypot(now[0] - before[0], now[1] - before[1]) * t.cell).toBeLessThan(0.01);
    expect(now[2]).toBeCloseTo(before[2], 3);
    const later = locate(tr.list[0], t, 60), clean = locate({ ...tr.list[0], dx: 0, dy: 0, dz: 0 }, t, 60);
    expect(Math.hypot(later[0] - clean[0], later[1] - clean[1]) * t.cell).toBeLessThan(2); // hentet inn etter 15 s
    tr.update([], t, 90);
    expect(tr.list).toHaveLength(0);
  });

  it("gir størrelse etter kategori", () => {
    expect(aircraftSize("A3")).toEqual({ lengthM: 38, spanM: 35, rotor: false });
    expect(aircraftSize("A7").rotor).toBe(true);
    expect(aircraftSize("A5").spanM).toBeGreaterThan(aircraftSize("A1").spanM);
    expect(aircraftSize("")).toEqual({ lengthM: 30, spanM: 28, rotor: false });
  });
});
