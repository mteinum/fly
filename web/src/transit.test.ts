/* Busser og tog fra Entur: plassering i rutenettet og jevn bevegelse mellom oppslagene. */
import { describe, expect, it } from "vitest";
import { hasTiles, loadTestTerrain } from "./testTerrain";
import { GLIDE_S, Transit, vehiclePosition, vehicleShape, type TransitReport } from "./transit";

describe.skipIf(!hasTiles("kjevik10"))("kollektivtrafikk", () => {
  if (!hasTiles("kjevik10")) return;
  const t = loadTestTerrain("kjevik10");
  const bus = (over: Partial<TransitReport>): TransitReport => ({ id: "AKT:1", mode: "bus", line: "M1", e: 88128, n: 6466407, bearing: 90, age: 5, ...over });

  it("setter kjøretøyet der meldingen sier, med sann kurs gjort om til rutenettkurs", () => {
    const tr = new Transit();
    tr.update([bus({})], t, 100);
    const [v] = tr.list, [x, y] = t.utmToGrid(88128, 6466407);
    expect(vehiclePosition(v, 100)).toEqual([x, y]);
    expect((v.heading * 180) / Math.PI).toBeCloseTo(90 - t.meta.gridConvergenceDeg, 6);
  });

  it("glir fra forrige posisjon til den nye i løpet av tiden mellom to oppslag, og snur seg i kjøreretningen", () => {
    const tr = new Transit();
    tr.update([bus({})], t, 100);
    tr.update([bus({ n: 6466407 + 200, bearing: 90 })], t, 120); // 200 m rett nord i rutenettet
    const [v] = tr.list, [x0, y0] = t.utmToGrid(88128, 6466407);
    expect(vehiclePosition(v, 120)).toEqual([x0, y0]);
    const [, yHalf] = vehiclePosition(v, 120 + GLIDE_S / 2);
    expect((y0 - yHalf) * t.cell).toBeCloseTo(100, 3);
    expect((y0 - vehiclePosition(v, 120 + GLIDE_S * 3)[1]) * t.cell).toBeCloseTo(200, 3); // stopper der, kjører ikke videre
    expect(v.heading).toBeCloseTo(0, 6); // nord, selv om kilden sa øst
  });

  it("beholder retningen når bussen står, og hopper rett til et nytt sted langt unna", () => {
    const tr = new Transit();
    tr.update([bus({ bearing: 45 })], t, 0);
    tr.update([bus({ e: 88130, bearing: null })], t, 20); // 2 m: støy
    expect((tr.list[0].heading * 180) / Math.PI).toBeCloseTo(45 - t.meta.gridConvergenceDeg, 6);
    tr.update([bus({ e: 92128 })], t, 40); // 4 km
    expect(vehiclePosition(tr.list[0], 40)).toEqual(t.utmToGrid(92128, 6466407));
  });

  it("slipper kjøretøy som ikke lenger meldes, og de som ligger utenfor kartet", () => {
    const tr = new Transit();
    tr.update([bus({}), bus({ id: "AKT:2", e: 300000 })], t, 0);
    expect(tr.list.map((v) => v.id)).toEqual(["AKT:1"]);
    tr.update([], t, 20);
    expect(tr.list).toEqual([]);
  });

  it("tegner tog lengre enn busser", () => {
    expect(vehicleShape("rail").lengthM).toBeGreaterThan(vehicleShape("bus").lengthM * 3);
  });

  it("setter en buss på Varoddbrua på brudekket, ikke i sjøen under", () => {
    // Varoddbrua: punktet fra stedsnavnregisteret (tests/fixtures/reference_points.json)
    const [vx, vy] = t.utmToGrid(91491.04, 6467882.7), near = (p: [number, number, number]) => Math.hypot(p[0] - vx, p[1] - vy);
    const bridge = t.bridges.reduce((a, c) => (Math.min(...c.points.map(near)) < Math.min(...a.points.map(near)) ? c : a));
    const mid = bridge.points.reduce((i, p, k) => (k > 0 && k < bridge.points.length - 1 && t.isWater(p[0], p[1]) && (i < 0 || p[2] > bridge.points[i][2]) ? k : i), -1);
    const [x, y, deck] = bridge.points[mid];
    expect(Math.min(...bridge.points.map(near)) * t.cell).toBeLessThan(100);
    expect(deck).toBeGreaterThan(15);
    expect(t.roadPlace(x, y)[2]).toBeCloseTo(deck, 1);
    // GPS-en treffer ikke senterlinja: ti meter til siden er fortsatt på brua
    const [nx, ny] = bridge.points[mid + 1], len = Math.hypot(nx - x, ny - y);
    const side = (m: number): [number, number] => [x - ((ny - y) / len) * (m / t.cell), y + ((nx - x) / len) * (m / t.cell)];
    expect(t.roadPlace(...side(10))).toEqual([...side(10), expect.closeTo(deck, 0)]);
    // seksti meter til siden er i sjøen: bussen flyttes inn på brua
    const [sx, sy, sz] = t.roadPlace(...side(60));
    expect(Math.hypot(sx - x, sy - y) * t.cell).toBeLessThan(40); // Varoddbrua er to bruer side om side: den nærmeste
    expect(Math.abs(sz - deck)).toBeLessThan(4);
    // fire hundre meter unna er det ingen bru å flytte til: da står den der den er (en ferge)
    expect(t.roadPlace(...side(400))).toEqual([...side(400), Math.max(0, t.heightAt(...side(400)))]);
    // på land er det terrenget som gjelder
    const [lx, ly] = t.utmToGrid(88128, 6466407);
    expect(t.roadPlace(lx, ly)).toEqual([lx, ly, Math.max(0, t.heightAt(lx, ly))]);
  });
});
