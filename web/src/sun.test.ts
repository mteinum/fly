import { describe, expect, it } from "vitest";
import { formatOslo, osloTime, osloToUtc, startTime } from "./clock";
import { skyState } from "./sky";
import { sunPosition } from "./sun";

// Kjevik (ENCN referansepunkt)
const LAT = 58.204201, LON = 8.08537;
const utc = (s: string) => Date.parse(s + "Z");

/** Høyeste solhøyde i døgnet, og asimut da (søk med 1 min steg). */
function culmination(day: string) {
  let best = { elevationDeg: -90, azimuthDeg: 0 }, at = 0;
  for (let m = 0; m < 1440; m++) {
    const t = utc(`${day}T00:00:00`) + m * 60000, s = sunPosition(t, LAT, LON);
    if (s.elevationDeg > best.elevationDeg) { best = s; at = t; }
  }
  return { ...best, at };
}

describe("solas posisjon", () => {
  // Fasit: middagshøyde = 90° - breddegrad + deklinasjon (±23,44° ved solverv, 0° ved jevndøgn)
  it.each([
    ["2026-06-21", 90 - LAT + 23.44],
    ["2026-12-21", 90 - LAT - 23.44],
    ["2026-03-20", 90 - LAT],
  ])("står rett i sør og riktig høyt midt på dagen %s", (day, expected) => {
    const c = culmination(day);
    expect(c.elevationDeg).toBeCloseTo(expected, 0);
    expect(Math.abs(c.elevationDeg - expected)).toBeLessThan(0.3);
    expect(Math.abs(c.azimuthDeg - 180)).toBeLessThan(0.5);
    // sann middag ved 8,085° Ø er 12:00 UTC - 32 min, ± tidsjevningen (maks 16,5 min)
    const minutes = (c.at - utc(`${day}T11:27:40`)) / 60000;
    expect(Math.abs(minutes)).toBeLessThan(17);
  });

  it("står opp i øst og går ned i vest ved jevndøgn", () => {
    let rise = 0, set = 0, prev = sunPosition(utc("2026-03-20T00:00:00"), LAT, LON);
    for (let m = 1; m < 1440; m++) {
      const s = sunPosition(utc("2026-03-20T00:00:00") + m * 60000, LAT, LON);
      if (prev.elevationDeg < 0 && s.elevationDeg >= 0) rise = s.azimuthDeg;
      if (prev.elevationDeg >= 0 && s.elevationDeg < 0) set = s.azimuthDeg;
      prev = s;
    }
    expect(Math.abs(rise - 90)).toBeLessThan(1.5);
    expect(Math.abs(set - 270)).toBeLessThan(1.5);
  });

  it("er under horisonten ved midnatt, også midtsommers (ingen midnattssol på Sørlandet)", () => {
    expect(sunPosition(utc("2026-06-21T23:30:00"), LAT, LON).elevationDeg).toBeLessThan(-5);
    expect(sunPosition(utc("2026-12-21T23:30:00"), LAT, LON).elevationDeg).toBeLessThan(-50);
  });

  it("beveger seg med klokka: fra sørøst om formiddagen til sørvest om ettermiddagen", () => {
    const am = sunPosition(utc("2026-06-21T08:00:00"), LAT, LON), pm = sunPosition(utc("2026-06-21T15:00:00"), LAT, LON);
    expect(am.azimuthDeg).toBeGreaterThan(90);
    expect(am.azimuthDeg).toBeLessThan(180);
    expect(pm.azimuthDeg).toBeGreaterThan(180);
    expect(pm.azimuthDeg).toBeLessThan(270);
  });
});

describe("klokke", () => {
  it("regner norsk tid med sommer- og vintertid", () => {
    expect(formatOslo(utc("2026-11-17T14:00:00"))).toBe("15:00"); // vintertid, UTC+1
    expect(formatOslo(utc("2026-06-21T14:00:00"))).toBe("16:00"); // sommertid, UTC+2
    expect(osloToUtc({ year: 2026, month: 6, day: 21, hour: 22, minute: 30 })).toBe(utc("2026-06-21T20:30:00"));
    expect(osloToUtc({ year: 2026, month: 12, day: 21, hour: 0, minute: 15 })).toBe(utc("2026-12-20T23:15:00"));
    const t = utc("2026-03-29T03:30:00");
    expect(osloToUtc(osloTime(t))).toBe(t);
  });

  it("leser ?time og ?date som norsk tid, og bruker nå ellers", () => {
    const now = utc("2026-11-17T14:00:00");
    expect(startTime(new URLSearchParams(""), now)).toBe(now);
    expect(startTime(new URLSearchParams("time=23:00"), now)).toBe(utc("2026-11-17T22:00:00"));
    expect(startTime(new URLSearchParams("date=2026-06-21&time=12:00"), now)).toBe(utc("2026-06-21T10:00:00"));
    expect(startTime(new URLSearchParams("time=tull"), now)).toBe(now);
  });
});

describe("himmel", () => {
  it("er dag med sola høyt og natt med sola langt under horisonten", () => {
    const day = skyState(30), night = skyState(-30);
    expect(day.night).toBe(0);
    expect(night.night).toBe(1);
    expect(night.sunLight).toBe(0);
    expect(day.sunLight).toBeGreaterThan(2);
    expect(night.ambient).toBeGreaterThan(0); // aldri helt svart: terrenget skal anes
  });

  it("blir jevnt mørkere når sola synker", () => {
    let prev = skyState(40);
    for (let e = 39; e >= -25; e -= 1) {
      const s = skyState(e);
      expect(s.sunLight).toBeLessThanOrEqual(prev.sunLight + 1e-9);
      expect(s.ambient).toBeLessThanOrEqual(prev.ambient + 1e-9);
      expect(s.night).toBeGreaterThanOrEqual(prev.night - 1e-9);
      prev = s;
    }
  });
});
