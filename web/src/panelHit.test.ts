/* Det som kan betjenes på instrumentpanelet skal treffes der det er tegnet, og ingenting annet skal reagere. */
import { describe, expect, it } from "vitest";
import { panelHit, thrustAt } from "./panel";

describe("trykk på instrumentpanelet", () => {
  it("treffer spakene på midtkonsollen", () => {
    expect(panelHit(115.6, 185)).toEqual({ kind: "speedBrake" });
    expect(panelHit(198.6, 153)).toEqual({ kind: "gear" });
    expect(panelHit(129.6, 190)).toMatchObject({ kind: "thrust" });
  });

  it("setter klaffspaken i hakket som trykkes: øverst er 0, nederst er FULL", () => {
    expect(panelHit(190, 181.5)).toEqual({ kind: "flaps", cfg: 0 });
    expect(panelHit(194, 189)).toEqual({ kind: "flaps", cfg: 2 });
    expect(panelHit(190, 197.4)).toEqual({ kind: "flaps", cfg: 4 });
  });

  it("gir full gass øverst i sporet og tomgang nederst", () => {
    expect(thrustAt(170)).toBe(1);
    expect(thrustAt(200)).toBe(0);
    expect(thrustAt(188)).toBeGreaterThan(thrustAt(192));
  });

  it("treffer AP1 på FCU og FD på begge EFIS-panelene", () => {
    expect(panelHit(106 + 47.9, 108.4 + 10)).toEqual({ kind: "autopilot" });
    expect(panelHit(70 + 9.8, 108.4 + 8.3)).toEqual({ kind: "flightDirector" });
    expect(panelHit(217 + 23.2, 108.4 + 8.3)).toEqual({ kind: "flightDirector" });
  });

  it("treffer rekkeviddeknappen på EFIS-panelene og TERR ON ND under skjermene", () => {
    expect(panelHit(70 + 27.6, 108.4 + 8.9)).toEqual({ kind: "ndRange" });
    expect(panelHit(217 + 5.4, 108.4 + 8.9)).toEqual({ kind: "ndRange" });
    expect(panelHit(57, 190)).toEqual({ kind: "ndTerrain" });
    expect(panelHit(263, 190)).toEqual({ kind: "ndTerrain" });
  });

  it("reagerer ikke på skjermene, frontruta eller resten av panelet", () => {
    for (const [x, y] of [[33, 147], [83, 147], [160, 140], [160, 180], [160, 50], [30, 190], [290, 190], [106 + 53, 108.4 + 10]]) expect(panelHit(x, y)).toBeNull();
  });
});
