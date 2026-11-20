import { describe, expect, it } from "vitest";
import { newPlane } from "./plane";
import { W } from "./screen";
import { runwayOffset } from "./physics";
import { loadTestTerrain } from "./testTerrain";
import { azimuthToScreenX, towerView } from "./tower";

const t = loadTestTerrain();
const airport = t.meta.airports[0], tw = airport.tower;
const at = (dxCells: number, dyCells: number, alt: number) => Object.assign(newPlane(), { x: tw.x + dxCells, y: tw.y + dyCells, alt });

describe("tårnet", () => {
  it("står ved rullebanen, på land, med fri sikt over banen", () => {
    const { along, cross } = runwayOffset(t, airport.runways[0], tw.x, tw.y);
    expect(Math.abs(cross)).toBeGreaterThan(100); // ikke på banen
    expect(Math.abs(cross)).toBeLessThan(700);
    expect(along).toBeGreaterThan(0);
    expect(along).toBeLessThan(airport.runways[0].lengthM);
    expect(t.isWater(tw.x, tw.y)).toBe(false);
    expect(tw.eyeM - tw.groundM).toBeGreaterThan(15);
    expect(tw.groundM).toBeCloseTo(Math.max(0, t.heightAt(tw.x, tw.y)), 0);
  });

  it("ser i riktig kompassretning mot flyet (rutenettkurs, med klokka fra nord)", () => {
    const d = 1000 / t.cell;
    expect(towerView(t, at(0, -d, tw.eyeM)).yaw).toBeCloseTo(0, 6); // fly rett nord: y minker
    expect(towerView(t, at(d, 0, tw.eyeM)).yaw).toBeCloseTo(Math.PI / 2, 6); // øst
    expect(Math.abs(towerView(t, at(0, d, tw.eyeM)).yaw)).toBeCloseTo(Math.PI, 6); // sør
    expect(towerView(t, at(-d, 0, tw.eyeM)).yaw).toBeCloseTo(-Math.PI / 2, 6); // vest
  });

  it("ser opp på et fly over tårnhøyde og ned på et fly på bakken, men aldri ned i benken", () => {
    const d = 1000 / t.cell;
    const high = towerView(t, at(d, 0, tw.eyeM + 1000 - 3.6));
    expect(high.pitch).toBeCloseTo(Math.PI / 4, 3);
    expect(high.distanceM).toBeCloseTo(Math.SQRT2 * 1000, 0);
    const low = towerView(t, at(d / 10, 0, tw.groundM));
    expect(low.pitch).toBeLessThan(-0.2);
    expect(low.headPitch).toBe(-0.1);
  });

  it("zoomer kikkertkameraet inn når flyet er langt unna", () => {
    const near = towerView(t, at(300 / t.cell, 0, 100)), far = towerView(t, at(8000 / t.cell, 0, 400));
    expect(far.scopeFov).toBeLessThan(near.scopeFov);
    expect(far.scopeFov).toBeGreaterThanOrEqual(1.2);
    expect(near.scopeFov).toBeLessThanOrEqual(30);
  });

  it("legger det blikket peker på midt i bildet, og det til høyre til høyre", () => {
    expect(azimuthToScreenX(1, 1)).toBeCloseTo(W / 2, 6);
    expect(azimuthToScreenX(1.2, 1)!).toBeGreaterThan(W / 2);
    expect(azimuthToScreenX(0.8, 1)!).toBeLessThan(W / 2);
    expect(azimuthToScreenX(0.1, 2 * Math.PI - 0.1)!).toBeGreaterThan(W / 2); // over nord
    expect(azimuthToScreenX(Math.PI, 0)).toBeNull(); // bak ryggen
  });
});
