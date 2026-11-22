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
});
