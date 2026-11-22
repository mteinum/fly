/* Det som virker på overheadpanelet og midtkonsollen skal treffes der det er tegnet, og ingenting annet skal reagere. */
import { describe, expect, it } from "vitest";
import { overheadHit, pedestalHit, pedestalThrustAt } from "./cockpitViews";

describe("trykk på overheadpanelet", () => {
  it("treffer TERR på GPWS-panelet og setebeltebryteren", () => {
    expect(overheadHit(29, 90)).toEqual({ kind: "gpwsTerr" });
    expect(overheadHit(201, 166)).toEqual({ kind: "seatBelts" });
  });

  it("reagerer ikke på naboene eller resten av panelet", () => {
    for (const [x, y] of [[42, 90], [214, 166], [207.5, 187], [160, 100], [160, 20], [250, 60]]) expect(overheadHit(x, y)).toBeNull();
  });
});

describe("trykk på midtkonsollen", () => {
  it("treffer ECAM-tastene ENG og WHEEL, men ikke de andre", () => {
    expect(pedestalHit(133, 42)).toEqual({ kind: "sdPage", page: "eng" });
    expect(pedestalHit(128.6 + 3 * 10.8 + 5, 39 + 9.4 + 3)).toEqual({ kind: "sdPage", page: "wheel" });
    expect(pedestalHit(128.6 + 1 * 10.8 + 5, 42)).toBeNull(); // BLEED
  });

  it("treffer gasshåndtakene, klaffspaken og TCAS-velgeren", () => {
    expect(pedestalHit(160, 110)).toMatchObject({ kind: "thrust" });
    expect(pedestalThrustAt(82)).toBe(1);
    expect(pedestalThrustAt(138)).toBe(0);
    expect(pedestalHit(232, 160)).toEqual({ kind: "flaps", cfg: 0 });
    expect(pedestalHit(240, 190)).toEqual({ kind: "flaps", cfg: 4 });
    expect(pedestalHit(262, 139)).toEqual({ kind: "tcasMode" });
  });

  it("armerer bakkespoilerne øverst i luftbremsens spor, og slår luftbremsen ut lenger ned", () => {
    expect(pedestalHit(86, 160)).toEqual({ kind: "spoilersArm" });
    expect(pedestalHit(86, 180)).toEqual({ kind: "speedBrake" });
  });

  it("reagerer ikke på MCDU-ene, radioene eller motorbryterne", () => {
    for (const [x, y] of [[80, 30], [240, 30], [80, 84], [240, 108], [160, 165], [60, 135]]) expect(pedestalHit(x, y)).toBeNull();
  });
});
