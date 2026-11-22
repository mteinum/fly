/* Ruta til en stand: nettet henger sammen fra rullebanen, og ruta følger asfalten. */
import { describe, expect, it } from "vitest";
import { onPavement } from "./physics";
import { autobrakeFor } from "./autopilot";
import { buildTaxiGraph, chooseStand, lastExitM, planTaxi } from "./taxiRoute";
import { hasTiles, loadTestTerrain } from "./testTerrain";

const AREAS = ["kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10", "mehamn10", "tromso10", "alesund10"];

for (const area of AREAS) {
  describe.skipIf(!hasTiles(area))(`rute til stand, ${area}`, () => {
    if (!hasTiles(area)) return;
    const t = loadTestTerrain(area), airport = t.meta.airports[0], graph = buildTaxiGraph(t, airport)!;

    it("har stands som kan nås fra rullebanen", () => {
      expect(graph.stands.length, `${graph.stands.length} av ${t.aeroways!.stands.length} stands kan nås`).toBeGreaterThan(0);
      expect(chooseStand(graph, airport, 0)).not.toBeNull();
    });

    it("finner en rute fra midt på hver rullebane som holder seg på asfalten", () => {
      for (const rw of airport.runways) {
        const x = (rw.ends[0].x + rw.ends[1].x) / 2, y = (rw.ends[0].y + rw.ends[1].y) / 2;
        for (let pick = 0; pick < 6; pick++) {
          const stand = chooseStand(graph, airport, pick)!, plan = planTaxi(t, graph, x, y, stand)!;
          expect(plan, `stand ${stand.ref}`).not.toBeNull();
          expect(plan.route[0]).toEqual([x, y]);
          expect(plan.route[plan.route.length - 1]).toEqual(stand.at);
          expect(plan.distanceM).toBeGreaterThan(100);
          expect(plan.distanceM).toBeLessThan(9000);
          // prøv et punkt for hver femte meter langs ruta
          let off = 0, total = 0;
          for (let i = 1; i < plan.route.length; i++) {
            const [ax, ay] = plan.route[i - 1], [bx, by] = plan.route[i], n = Math.max(1, Math.ceil((Math.hypot(bx - ax, by - ay) * t.cell) / 5));
            for (let k = 0; k <= n; k++) { total++; if (!onPavement(t, airport, ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)) off++; }
          }
          expect(off / total, `stand ${stand.ref} fra bane ${rw.ident}: ${off} av ${total} punkter utenfor asfalten`).toBeLessThan(0.02);
        }
      }
    });
  });
}

describe.skipIf(!hasTiles("kjevik10"))("valg av stand på Kjevik", () => {
  if (!hasTiles("kjevik10")) return;
  const t = loadTestTerrain("kjevik10"), airport = t.meta.airports[0], graph = buildTaxiGraph(t, airport)!;

  it("varierer mellom innflyginger, og gir nummererte stands", () => {
    const refs = new Set([0, 1, 2, 3, 4, 5].map((i) => chooseStand(graph, airport, i)!.ref));
    expect(refs.size).toBeGreaterThan(2);
    expect([...refs].every((r) => r !== "")).toBe(true);
  });

  it("sier hvilke taksebaner ruta følger", () => {
    const rw = airport.runways[0], plan = planTaxi(t, graph, (rw.ends[0].x + rw.ends[1].x) / 2, (rw.ends[0].y + rw.ends[1].y) / 2, chooseStand(graph, airport, 0)!)!;
    expect(plan.via.length).toBeGreaterThan(0);
    for (const v of plan.via) expect(v).toMatch(/^[A-Z][0-9]?$/);
  });
});

describe.skipIf(!hasTiles("kjevik10"))("retningen flyet har", () => {
  if (!hasTiles("kjevik10")) return;
  const t = loadTestTerrain("kjevik10"), airport = t.meta.airports[0], graph = buildTaxiGraph(t, airport)!;
  it("lar ruta gå forover når det ikke koster mer enn 600 m, og sender aldri flyet på en kortere vei bakover uten grunn", () => {
    const rw = airport.runways[0], [a, b] = rw.ends, x = a.x + (b.x - a.x) * 0.45, y = a.y + (b.y - a.y) * 0.45, stand = chooseStand(graph, airport, 0)!;
    const shortest = planTaxi(t, graph, x, y, stand)!.distanceM;
    const firstLegAhead: boolean[] = [];
    for (const h of [(a.headingGridDeg * Math.PI) / 180, (b.headingGridDeg * Math.PI) / 180]) {
      const p = planTaxi(t, graph, x, y, stand, h)!, [nx, ny] = p.route[2];
      firstLegAhead.push((nx - x) * Math.sin(h) - (ny - y) * Math.cos(h) > 0);
      expect(p.distanceM).toBeGreaterThanOrEqual(shortest - 0.01);
      expect(p.distanceM).toBeLessThanOrEqual(shortest + 600.01); // en omvei forover velges bare når den er under 600 m lengre
    }
    expect(firstLegAhead).toContain(true); // i minst én av retningene ligger korteste vei forover
  });
});

describe.skipIf(!hasTiles("kjevik10"))("avkjøringene på Kjevik", () => {
  if (!hasTiles("kjevik10")) return;
  const t = loadTestTerrain("kjevik10"), airport = t.meta.airports[0], graph = buildTaxiGraph(t, airport)!, rw = airport.runways[0];
  it("ligger alle på den sørlige halvdelen: siste avkjøring fra 03 er C, ca. 1250 m inne", () => {
    const from03 = lastExitM(graph, rw, rw.ends.find((e) => e.ident === "03")!)!, from21 = lastExitM(graph, rw, rw.ends.find((e) => e.ident === "21")!)!;
    expect(from03).toBeGreaterThan(1100);
    expect(from03).toBeLessThan(1350);
    expect(from21).toBeGreaterThan(1900); // fra 21 ligger A helt i enden
  });
  it("gir MAX autobrems fra 03 (MED ville rullet forbi C) og MED fra 21", () => {
    const e03 = rw.ends.find((e) => e.ident === "03")!, e21 = rw.ends.find((e) => e.ident === "21")!;
    expect(autobrakeFor(rw, e03)).toBe(2); // uten å kjenne avkjøringene
    expect(autobrakeFor(rw, e03, lastExitM(graph, rw, e03))).toBe(3);
    expect(autobrakeFor(rw, e21, lastExitM(graph, rw, e21))).toBe(2);
  });
});

describe.skipIf(!hasTiles("kjevik"))("uten bakkeanlegg", () => {
  if (!hasTiles("kjevik")) return;
  it("finnes det ikke noe nett", () => { const t = loadTestTerrain("kjevik"); expect(buildTaxiGraph(t, t.meta.airports[0])).toBeNull(); });
});
