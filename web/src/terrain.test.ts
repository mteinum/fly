import { describe, expect, it } from "vitest";
import { loadReference, loadTestTerrain } from "./testTerrain";

const t = loadTestTerrain();
const ref = loadReference();

describe("rutenett <-> UTM 33", () => {
  it("har origo i nordvest, x mot øst og y mot sør", () => {
    const { west, north, east, south } = t.meta.bbox;
    expect(t.utmToGrid(west, north)).toEqual([0, 0]);
    expect(t.utmToGrid(east, south)).toEqual([t.width, t.height]);
    expect(t.utmToGrid(west + t.cell, north)).toEqual([1, 0]);
    expect(t.utmToGrid(west, north - t.cell)).toEqual([0, 1]);
  });

  it("går tur-retur", () => {
    const [e, n] = t.gridToUtm(...t.utmToGrid(94051.25, 6472303.86));
    expect(e).toBeCloseTo(94051.25, 6);
    expect(n).toBeCloseTo(6472303.86, 6);
  });

  it("plasserer fasitpunktene inne i utsnittet og på riktig side av flyplassen", () => {
    const arp = t.meta.airports[0].arp;
    const pt = (name: string) => {
      const p = ref.transform.points.find((q) => q.name === name)!;
      return t.utmToGrid(p.east, p.north);
    };
    // fasiten har også punkter for de andre flyplassene; her gjelder de tre ved Kjevik
    const local = ref.transform.points.filter((q) => ["ENCN baneende 03", "Kristiansand domkirke", "Moseidvarden"].includes(q.name));
    expect(local).toHaveLength(3);
    for (const p of local) expect(t.inBounds(...t.utmToGrid(p.east, p.north)), p.name).toBe(true);
    // Domkirken ligger sørvest for Kjevik: mindre x, større y
    const [dx, dy] = pt("Kristiansand domkirke");
    expect(dx).toBeLessThan(arp.x);
    expect(dy).toBeGreaterThan(arp.y);
    // Moseidvarden ligger nordvest: mindre x, mindre y
    const [mx, my] = pt("Moseidvarden");
    expect(mx).toBeLessThan(arp.x);
    expect(my).toBeLessThan(arp.y);
  });

  it("stemmer med rutenettkoordinatene pipeline skrev for baneendene", () => {
    for (const end of t.meta.airports[0].runways[0].ends) {
      const [x, y] = t.utmToGrid(end.east, end.north);
      expect(x).toBeCloseTo(end.x, 3);
      expect(y).toBeCloseTo(end.y, 3);
    }
  });
});

describe("høyde i spillet mot kilden", () => {
  it("heightAt er innenfor ±5 m av Kartverkets DTM 1 m i fasitpunktene", () => {
    for (const p of ref.heights.areas.kjevik) {
      const h = t.heightAt(...t.utmToGrid(p.east, p.north));
      expect(Math.abs(h - p.z), `${p.name}: spill ${h.toFixed(1)} m, kilde ${p.z} m`).toBeLessThanOrEqual(ref.heights.toleranceM);
    }
  });

  it("gir celleverdien i cellesenteret og 0 utenfor utsnittet", () => {
    expect(t.heightAt(100.5, 200.5)).toBeCloseTo(t.hgt[200 * t.width + 100], 4);
    expect(t.heightAt(-1, 10)).toBe(0);
    expect(t.heightAt(10, t.height + 1)).toBe(0);
  });

  it("har sjø i Topdalsfjorden, land på Kjevik og hav utenfor utsnittet", () => {
    expect(t.isWater(...t.utmToGrid(92000, 6469000))).toBe(true);
    const arp = t.meta.airports[0].arp;
    expect(t.isWater(arp.x, arp.y)).toBe(false);
    expect(t.isWater(-5, 10)).toBe(true);
  });

  it("har innsjø der Kartverket har innsjø (ikke bare der høyden er 0)", () => {
    // punkt-API: terreng Innsjø, 59 moh.
    const [x, y] = t.utmToGrid(99575, 6474475);
    expect(t.isWater(x, y)).toBe(true);
    expect(t.heightAt(x, y)).toBeGreaterThan(50);
  });
});

describe("kurs", () => {
  it("regner sann kurs = rutenettkurs + meridiankonvergens", () => {
    const [le] = t.meta.airports[0].runways[0].ends;
    const hdg = (le.headingGridDeg * Math.PI) / 180;
    expect(Math.abs(t.trueHeadingDeg(hdg) - le.headingTrueDeg)).toBeLessThan(0.5);
    expect(t.trueHeadingDeg(0)).toBeCloseTo(360 + t.meta.gridConvergenceDeg, 6);
  });
});
