/* Taksing etter landing: piloten tar over under 30 kt, styrer på asfalten og parkerer. */
import { describe, expect, it } from "vitest";
import { autopilot } from "./autopilot";
import { type Keys, moveFlaps, onPavement, park, PARK_DELAY, startApproach, TAXI_ENTRY, toggleGear, update } from "./physics";
import { newPlane, type Plane } from "./plane";
import type { Terrain } from "./terrain";
import { hasTiles, loadTestTerrain } from "./testTerrain";

const quiet = () => {};
const AREAS = ["kjevik10", "sola10", "flesland10", "gardermoen10", "bodo10", "mehamn10", "tromso10", "alesund10"];

/** Land med autopiloten på første baneende og rull til flyet står. */
function landed(t: Terrain): Plane {
  const airport = t.meta.airports[0], rw = airport.runways[0], end = rw.ends[0], P = newPlane();
  startApproach(P, t, end);
  for (let i = 0; i < 300 * 60 && P.state === "fly"; i++) {
    const cmd = autopilot(P, t, rw, end);
    if ("unable" in cmd) break;
    if (cmd.gearDown !== P.gearDown) toggleGear(P, quiet);
    if (cmd.flapCfg !== P.flapCfg) moveFlaps(P, Math.sign(cmd.flapCfg - P.flapCfg), quiet);
    P.autobrake = cmd.autobrake;
    update(P, t, airport, cmd.keys, 1 / 60, quiet);
  }
  for (let i = 0; i < 120 * 60 && P.spd > 0; i++) update(P, t, airport, {}, 1 / 60, quiet);
  return P;
}
const run = (P: Plane, t: Terrain, K: Keys, seconds: number) => { for (let i = 0; i < seconds * 60; i++) update(P, t, t.meta.airports[0], K, 1 / 60, quiet); };

describe.skipIf(!hasTiles("kjevik10"))("taksing på Kjevik", () => {
  if (!hasTiles("kjevik10")) return;
  const t = loadTestTerrain("kjevik10"), airport = t.meta.airports[0];

  it("regner flyet som parkert noen sekunder etter at det har stanset, hvis piloten ikke gjør noe", () => {
    const P = landed(t);
    expect([P.state, P.spd, P.parked]).toEqual(["landed", 0, false]);
    run(P, t, {}, PARK_DELAY - 1);
    expect(P.parked).toBe(false);
    run(P, t, {}, 2);
    expect([P.parked, P.taxi]).toEqual([true, false]);
    run(P, t, { KeyW: true }, 5); // parkert er parkert: gass gjør ingenting
    expect(P.spd).toBe(0);
  });

  it("lar piloten ta over med gass, styre, bremse og parkere", () => {
    const P = landed(t), hdg = P.hdg;
    run(P, t, { KeyW: true }, 1);
    expect(P.taxi).toBe(true);
    run(P, t, {}, 20);
    expect(P.spd).toBeGreaterThan(8); // ca. 30 kt med 40 % gass etter hvert
    expect(P.spd).toBeLessThan(TAXI_ENTRY + 8);
    expect(P.state).toBe("landed");
    run(P, t, { KeyS: true }, 2);
    run(P, t, { Space: true }, 8);
    expect(P.spd).toBe(0);
    expect(Math.abs(P.hdg - hdg)).toBeLessThan(0.02); // rett fram uten styring
    park(P, quiet);
    expect(P.parked).toBe(true);
  });

  it("svinger med piltastene, krappere i lav fart, og ikke når flyet står stille", () => {
    const P = landed(t), h0 = P.hdg;
    run(P, t, { ArrowRight: 1 }, 2);
    expect([P.taxi, P.hdg]).toEqual([false, h0]); // står stille: styring alene starter ikke taksingen
    run(P, t, { KeyW: true }, 0.5);
    run(P, t, {}, 4);
    const h1 = P.hdg;
    run(P, t, { ArrowRight: 1 }, 1);
    expect(P.hdg).toBeGreaterThan(h1 + 0.1);
  });

  it("kjører seg fast i gresset i lav fart", () => {
    const P = landed(t);
    run(P, t, { KeyW: true }, 0.5);
    run(P, t, {}, 15); // få litt fart
    run(P, t, { ArrowRight: 1 }, 4); // sving av mot kanten
    run(P, t, {}, 30); // og rett fram ut i gresset
    expect([P.state, P.spd, P.parked]).toEqual(["landed", 0, true]);
    expect(onPavement(t, airport, P.x, P.y)).toBe(false);
  });

  it("stanser på kortere strekning under utrullingen når piloten bremser selv", () => {
    const roll = (K: Keys): number => {
      const airport = t.meta.airports[0], rw = airport.runways[0], end = rw.ends[0], P = newPlane();
      startApproach(P, t, end);
      for (let i = 0; i < 300 * 60 && P.state === "fly"; i++) {
        const cmd = autopilot(P, t, rw, end);
        if ("unable" in cmd) break;
        if (cmd.gearDown !== P.gearDown) toggleGear(P, quiet);
        if (cmd.flapCfg !== P.flapCfg) moveFlaps(P, Math.sign(cmd.flapCfg - P.flapCfg), quiet);
        update(P, t, airport, cmd.keys, 1 / 60, quiet);
      }
      let m = 0;
      for (let i = 0; i < 120 * 60 && P.spd > 0; i++) { m += P.spd / 60; update(P, t, airport, K, 1 / 60, quiet); }
      return m;
    };
    const auto = roll({}), braked = roll({ Space: true });
    expect(auto).toBeGreaterThan(600); // MED: ca. 700 m
    expect(braked).toBeLessThan(auto * 0.6); // fotbremsene: ca. halve strekningen
  });

  it("viser bremsene: varme etter landingen, trykk når piloten bremser, og fullt trykk når flyet er parkert", () => {
    const P = landed(t);
    expect(P.brakeTemp).toBeGreaterThan(150); // autobremsen har bremset flyet ned fra 125 kt
    expect(P.brakeTemp).toBeLessThan(450);
    expect(P.wheelBrake).toBeCloseTo(3 / 8, 6); // står stille: autobremsen (MED) holder flyet
    run(P, t, { KeyW: true }, 1);
    run(P, t, {}, 6);
    expect(P.wheelBrake).toBe(0);
    run(P, t, { Space: true }, 0.2);
    expect(P.wheelBrake).toBeGreaterThan(0.3);
    run(P, t, { Space: true }, 6);
    const hot = P.brakeTemp;
    park(P, quiet);
    run(P, t, {}, 60);
    expect(P.wheelBrake).toBe(1);
    expect(P.brakeTemp).toBeLessThan(hot); // kjøles mens flyet står
  });

  it("nekter å sette parkeringsbremsen i fart", () => {
    const P = landed(t);
    run(P, t, { KeyW: true }, 6);
    park(P, quiet);
    expect(P.parked).toBe(false);
  });
});

describe.skipIf(!hasTiles("kjevik"))("uten bakkeanlegg (50 m-flisene)", () => {
  if (!hasTiles("kjevik")) return;
  it("kan det ikke takses, og flyet er parkert i det det stanser", () => {
    const t = loadTestTerrain("kjevik"), P = landed(t);
    expect(t.aeroways).toBeNull();
    run(P, t, {}, 0.1);
    expect([P.spd, P.parked]).toEqual([0, true]);
    run(P, t, { KeyW: true }, 3);
    expect([P.spd, P.taxi]).toEqual([0, false]);
  });
});

for (const area of AREAS) {
  describe.skipIf(!hasTiles(area))(`asfalten på ${area}`, () => {
    if (!hasTiles(area)) return;
    const t = loadTestTerrain(area), airport = t.meta.airports[0];
    it("dekker rullebanene og taksebanene, men ikke terrenget rundt", () => {
      for (const rw of airport.runways) expect(onPavement(t, airport, (rw.ends[0].x + rw.ends[1].x) / 2, (rw.ends[0].y + rw.ends[1].y) / 2)).toBe(true);
      for (const tw of t.aeroways!.taxiways) for (const [x, y] of tw.line) expect(onPavement(t, airport, x, y)).toBe(true);
      expect(onPavement(t, airport, 5, 5)).toBe(false);
    });
    it("har de fleste standene på asfalt", () => {
      const stands = t.aeroways!.stands, on = stands.filter((s) => onPavement(t, airport, s.at[0], s.at[1])).length;
      // noen stands er kartlagt uten flate under (småflyplasser i Tromsø): de kan ikke nås, og velges ikke som mål
      expect(on / stands.length, `${on} av ${stands.length}`).toBeGreaterThan(0.7);
    });
  });
}
