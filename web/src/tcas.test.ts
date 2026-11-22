import { describe, expect, it } from "vitest";
import { tcasLevel } from "./tcas";

const CELL = 10, KT = 1.943844;
/** Oss: i (0, 0), 600 m, på vei nordover i 160 kt. */
const own = { x: 0, y: 0, alt: 600, course: 0, speed: 160 / KT, climb: 0 };
/** Et annet fly `north` m foran oss og `east` m til siden, `up` m over, med kurs i grader. */
const other = (north: number, east: number, up: number, courseDeg: number, o: object = {}) =>
  ({ x: east / CELL, y: -north / CELL, alt: 600 + up, course: (courseDeg * Math.PI) / 180, speed: 160 / KT, climb: 0, ground: false, ...o });

describe("trafikkvarsel", () => {
  it("varsler for et fly som kommer rett imot i samme høyde", () => {
    expect(tcasLevel(own, other(4000, 0, 0, 180), CELL)).toBe("advisory"); // 165 m/s imot: 20 s unna
    expect(tcasLevel(own, other(9000, 0, 0, 180), CELL)).toBe("proximate"); // 50 s unna: nær, men ikke varsel
  });

  it("varsler ikke når flyet er godt over eller under", () => {
    expect(tcasLevel(own, other(4000, 0, 700, 180), CELL)).toBe("other");
    expect(tcasLevel(own, other(4000, 0, 300, 180), CELL)).toBe("proximate");
  });

  it("varsler når et fly høyere oppe synker mot vår høyde", () => {
    expect(tcasLevel(own, other(4000, 0, 450, 180, { climb: -10 }), CELL)).toBe("advisory");
    expect(tcasLevel(own, other(4000, 0, 450, 180, { climb: 5 }), CELL)).toBe("other");
  });

  it("varsler ikke for fly som fjerner seg eller flyr ved siden av", () => {
    expect(tcasLevel(own, other(-4000, 0, 0, 180), CELL)).toBe("proximate"); // bak oss, på vei bort
    expect(tcasLevel(own, other(0, 3000, 0, 0), CELL)).toBe("proximate"); // parallelt, samme fart
  });

  it("varsler alltid innenfor 0,4 NM i samme høyde, og aldri for fly på bakken", () => {
    expect(tcasLevel(own, other(0, 500, 100, 0), CELL)).toBe("advisory");
    expect(tcasLevel(own, other(200, 0, -550, 180, { ground: true }), CELL)).toBe("ground");
  });

  it("regner flyet som fjernt når det er langt unna", () => {
    expect(tcasLevel(own, other(0, 15000, 0, 0), CELL)).toBe("other");
  });
});
