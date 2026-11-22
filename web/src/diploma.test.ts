import { describe, expect, it } from "vitest";
import { gradeLanding, shareText, shareUrl } from "./diploma";
import { update } from "./physics";
import { newPlane, type Touchdown } from "./plane";
import { loadTestTerrain } from "./testTerrain";

const good: Touchdown = { runway: "03", kt: 138, fpm: 150, crossM: 2, pastThresholdM: 400, flaps: 4 };

describe("karakter for landingen", () => {
  it("gir fem stjerner for en rolig landing i landingssonen", () => {
    expect(gradeLanding(good)).toEqual({ stars: 5, title: "Butter landing", remarks: [] });
  });

  it("trekker for hver ting som er galt, og sier hva", () => {
    expect(gradeLanding({ ...good, fpm: 300 })).toMatchObject({ stars: 4, title: "Nice landing", remarks: ["firm touchdown"] });
    expect(gradeLanding({ ...good, fpm: 600 })).toMatchObject({ stars: 3, remarks: ["hard touchdown"] });
    expect(gradeLanding({ ...good, crossM: 15 }).remarks).toEqual(["off the centreline"]);
    expect(gradeLanding({ ...good, pastThresholdM: -40 }).remarks).toEqual(["short of the threshold"]);
    expect(gradeLanding({ ...good, pastThresholdM: 1400 }).remarks).toEqual(["long landing"]);
    expect(gradeLanding({ ...good, kt: 160, flaps: 2 })).toMatchObject({ stars: 3, remarks: ["high speed", "not enough flap"] });
  });

  it("gir aldri mindre enn én stjerne", () => {
    expect(gradeLanding({ runway: "03", kt: 164, fpm: 780, crossM: 20, pastThresholdM: 1900, flaps: 0 })).toMatchObject({ stars: 1, title: "You got it down" });
  });

  it("lager en tekst til deling med stedsnavn, bane og stjerner", () => {
    const text = shareText({ name: "", airportName: "Stavanger Airport, Sola", icao: "ENZV", touchdown: { ...good, runway: "18" }, grade: gradeLanding({ ...good, fpm: 300 }), date: new Date() });
    expect(text).toBe("I landed an Airbus A320 at Sola, runway 18: ★★★★☆ Nice landing.");
  });
});

describe("lenke til delingssiden", () => {
  it("har resultatet i adressen, slik web/public/share/lib.php leser det", () => {
    const td = { ...good, runway: "25", kt: 110.6, fpm: 183.4, crossM: 0.04, pastThresholdM: 152.6 };
    const url = new URL(shareUrl("https://fly.teinum.no/", { name: " Morten Ø ", airportName: "Bodø Airport", icao: "ENBO", touchdown: td, grade: gradeLanding(td), date: new Date(2026, 10, 20) }));
    expect(url.origin + url.pathname).toBe("https://fly.teinum.no/share/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ n: "Morten Ø", a: "ENBO", r: "25", s: "5", k: "111", f: "183", c: "0.0", t: "153", d: "2026-11-20" });
  });
});

describe("måling av landingen", () => {
  const t = loadTestTerrain(), airport = t.meta.airports[0], rw = airport.runways[0], [le, he] = rw.ends;
  const land = (from: typeof le, fraction: number, sideM = 0) => {
    const to = from === le ? he : le, hdg = (from.headingGridDeg * Math.PI) / 180;
    // `fraction` av banen fra enden vi lander fra, `sideM` meter til høyre for senterlinja
    const x = from.x + fraction * (to.x - from.x) + (Math.cos(hdg) * sideM) / t.cell, y = from.y + fraction * (to.y - from.y) + (Math.sin(hdg) * sideM) / t.cell;
    const P = Object.assign(newPlane(), { x, y, alt: t.heightAt(x, y) + 1.6, hdg, spd: 70, pitch: -0.02, thr: 0.4 });
    for (let i = 0; i < 50 && P.state === "fly"; i++) update(P, t, airport, {}, 0.02, () => {});
    return P;
  };

  it("vet hvilken bane det ble landet på, ut fra flyets kurs", () => {
    expect(land(le, 0.3).touchdown?.runway).toBe("03");
    expect(land(he, 0.3).touchdown?.runway).toBe("21");
  });

  it("måler avstand fra den forskjøvne terskelen i landingsretningen", () => {
    const P = land(le, 0.3), td = P.touchdown!;
    const gridLength = Math.hypot(he.x - le.x, he.y - le.y) * t.cell;
    // flyet ruller noen meter fra startpunktet før hjulene tar bakken, derfor 15 m slakk
    expect(Math.abs(td.pastThresholdM - (0.3 * gridLength - le.displacedThresholdM))).toBeLessThan(15);
    expect(Math.abs(land(he, 0.3).touchdown!.pastThresholdM - (0.3 * gridLength - he.displacedThresholdM))).toBeLessThan(15);
    expect(land(le, 0.02).touchdown!.pastThresholdM).toBeLessThan(0); // før den forskjøvne terskelen
  });

  it("måler fart, synkerate og avstand fra senterlinja", () => {
    const td = land(le, 0.3, 12).touchdown!;
    expect(td.kt).toBeGreaterThan(125);
    expect(td.kt).toBeLessThan(140);
    expect(td.fpm).toBeGreaterThan(100); // 70 m/s * sin(0,02 rad) = 1,4 m/s = 275 fot/min, minus litt
    expect(td.fpm).toBeLessThan(400);
    expect(td.crossM).toBeCloseTo(12, 0);
    expect(td.flaps).toBe(4);
  });

  it("blir stående etter landing til piloten ber om ny innflyging", () => {
    const P = land(le, 0.3);
    let restart = false;
    for (let i = 0; i < 2000; i++) restart = update(P, t, airport, {}, 0.02, () => {}) || restart; // 40 s: MED bruker ca. 23 s fra 70 m/s
    expect([P.state, P.spd, restart]).toEqual(["landed", 0, false]);
  });

  it("nullstiller målingen i et fly som ikke har landet", () => {
    expect(newPlane().touchdown).toBeNull();
  });
});
