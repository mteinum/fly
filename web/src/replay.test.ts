import { describe, expect, it } from "vitest";
import { newPlane } from "./plane";
import { Recorder, REPLAY_SECONDS } from "./replay";
import { loadTestTerrain } from "./testTerrain";

const t = loadTestTerrain();
/** Fly rett nordover i 70 m/s og synk 5 m/s, `seconds` lenge med 50 opptak i sekundet. */
function fly(rec: Recorder, seconds: number, from = { x: 250, y: 300, alt: 400 }) {
  const P = Object.assign(newPlane(), from, { hdg: 0, spd: 70 });
  for (let i = 0; i < seconds * 50; i++) {
    P.y -= (70 * 0.02) / t.cell;
    P.alt -= 5 * 0.02;
    rec.record(P, 0.02);
  }
  return P;
}

describe("opptak til reprise", () => {
  it("beholder bare de siste fem sekundene", () => {
    const rec = new Recorder();
    fly(rec, 12);
    expect(rec.duration).toBeGreaterThan(REPLAY_SECONDS - 0.05);
    expect(rec.duration).toBeLessThanOrEqual(REPLAY_SECONDS + 0.05);
  });

  it("er kortere når flyet krasjet tidlig, og tomt etter nullstilling", () => {
    const rec = new Recorder();
    fly(rec, 2);
    expect(rec.duration).toBeCloseTo(2, 1);
    rec.clear();
    expect(rec.duration).toBe(0);
  });

  it("spiller av i riktig rekkefølge og ender der flyet endte", () => {
    const rec = new Recorder(), end = fly(rec, 12), out = newPlane();
    rec.sample(0, out);
    const start = { ...out };
    rec.sample(rec.duration / 2, out);
    const mid = { ...out };
    rec.sample(rec.duration, out);
    // nordover = minkende y, synkende = minkende høyde
    expect(start.y).toBeGreaterThan(mid.y);
    expect(mid.y).toBeGreaterThan(out.y);
    expect(start.alt - out.alt).toBeCloseTo(5 * rec.duration, 0);
    expect(out.y).toBeCloseTo(end.y, 6);
    expect(out.alt).toBeCloseTo(end.alt, 6);
    // forbi slutten blir flyet stående
    rec.sample(rec.duration + 3, out);
    expect(out.y).toBeCloseTo(end.y, 6);
  });

  it("interpolerer jevnt mellom opptakene", () => {
    const rec = new Recorder(), out = newPlane();
    fly(rec, 3);
    rec.sample(1.0, out);
    const a = out.alt;
    rec.sample(1.01, out); // midt mellom to opptak (0,02 s fra hverandre)
    expect(a - out.alt).toBeCloseTo(0.05, 3);
  });

  it("setter kameraet til side for der det endte, over terrenget og nær nok til å se flyet", () => {
    const rec = new Recorder(), end = fly(rec, 6);
    const [x, y, z] = rec.spectator(t);
    const dist = Math.hypot(x - end.x * t.cell, z - end.y * t.cell);
    expect(dist).toBeGreaterThan(60);
    expect(dist).toBeLessThan(200);
    expect(y).toBeGreaterThan(Math.max(0, t.heightAt(x / t.cell, z / t.cell)) + 10);
    expect(y).toBeGreaterThanOrEqual(end.alt + 10);
    // foran flyet: flyet kommer mot kameraet
    expect(z).toBeLessThan(end.y * t.cell);
  });
});
