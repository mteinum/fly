import { describe, expect, it } from "vitest";
import { type AisShip, Fleet, fromAis, MAX_AGE_S, position, shipColor, shipKind, shipModelKind } from "./ships";
import { loadTestTerrain } from "./testTerrain";

const t = loadTestTerrain();
// et punkt i Topdalsfjorden, i sjøen (fasitpunkt for arealdekke i pipeline-testene)
const SEA = { e: 92000, n: 6469000 };
const ship = (over: Partial<AisShip> = {}): AisShip => ({ id: 257000001, ...SEA, sog: 12, cog: 90, hdg: 92, age: 4, name: "TESTSKIP", type: 70, len: 120, beam: 18, ...over });

describe("skip fra AIS", () => {
  it("legger skipet i rutenettet der UTM-posisjonen sier, med y mot sør", () => {
    const [s] = fromAis([ship()], t, 100);
    expect(s.x).toBeCloseTo((SEA.e - t.meta.bbox.west) / t.cell, 6);
    expect(s.y).toBeCloseTo((t.meta.bbox.north - SEA.n) / t.cell, 6);
    expect(t.isWater(s.x, s.y)).toBe(true);
    expect(s.at).toBe(96); // meldingen er fire sekunder gammel
    expect([s.lengthM, s.beamM]).toEqual([120, 18]);
  });

  it("gjør sann kurs om til rutenettkurs med meridiankonvergensen", () => {
    const [s] = fromAis([ship({ cog: 90, hdg: 0 })], t, 0);
    const conv = t.meta.gridConvergenceDeg; // ca. -5,9° ved Kjevik
    expect((s.course * 180) / Math.PI).toBeCloseTo(90 - conv, 6);
    expect((s.heading * 180) / Math.PI).toBeCloseTo(0 - conv, 6);
    // skipet går sann øst i ett minutt: mål hvor det havner, i UTM
    const [x0, y0] = position(s, t, 0), [x1, y1] = position(s, t, 60);
    const [e0, n0] = t.gridToUtm(x0, y0), [e1, n1] = t.gridToUtm(x1, y1);
    expect(Math.hypot(e1 - e0, n1 - n0)).toBeCloseTo((12 / 1.943844) * 60, 0); // 12 knop i ett minutt = 370 m
    const gridBearing = (Math.atan2(e1 - e0, n1 - n0) * 180) / Math.PI;
    expect(gridBearing + conv).toBeCloseTo(90, 4); // tilbake til sann kurs
    expect(Math.sign(n1 - n0)).toBe(Math.sign(conv)); // negativ konvergens: sann øst er litt sør for rutenett-øst
  });

  it("dropper skip som er for gamle, utenfor kartet eller på land", () => {
    expect(fromAis([ship({ age: MAX_AGE_S + 1 })], t, 0)).toHaveLength(0);
    expect(fromAis([ship({ e: t.meta.bbox.west - 500 })], t, 0)).toHaveLength(0);
    const arp = t.meta.airports[0].arp; // flyplassen ligger 17 m over havet
    expect(fromAis([ship({ e: arp.east, n: arp.north })], t, 0)).toHaveLength(0);
    expect(fromAis([ship({ e: NaN })], t, 0)).toHaveLength(0);
  });

  it("skip i ro ligger stille, og mangler det mål og kompass får det faste erstatninger", () => {
    const [s] = fromAis([ship({ sog: 0.2, cog: null, hdg: null, len: null, beam: null })], t, 0);
    expect(s.speed).toBe(0);
    expect(position(s, t, 300)).toEqual(position(s, t, 0));
    expect(s.lengthM).toBe(28);
    expect(fromAis([ship({ sog: 0, cog: null, hdg: null })], t, 0)[0].heading).toBe(s.heading); // samme skip, samme retning hver gang
  });

  it("flytter ikke skipet videre når meldingen er blitt gammel", () => {
    const [s] = fromAis([ship()], t, 0);
    expect(position(s, t, 1000)).toEqual(position(s, t, 2000));
  });

  it("en ny melding gir ikke hopp: skipet fortsetter fra der det ble tegnet og hentes inn", () => {
    const fleet = new Fleet();
    fleet.update([ship({ age: 0 })], t, 0);
    const before = position(fleet.list[0], t, 30);
    // ny melding etter 30 s: skipet er 60 m lenger nord enn vi trodde
    const [e, n] = t.gridToUtm(...before);
    fleet.update([ship({ e, n: n + 60, age: 0 })], t, 30);
    const s = fleet.list[0], at = (now: number) => t.gridToUtm(...position(s, t, now));
    expect(Math.hypot(at(30)[0] - e, at(30)[1] - n)).toBeLessThan(0.01); // ingen hopp i det meldingen kommer
    const after10 = at(40), where = t.gridToUtm(...position({ ...s, dx: 0, dy: 0 }, t, 40));
    expect(Math.hypot(after10[0] - where[0], after10[1] - where[1])).toBeLessThan(1); // 10 s senere er avviket borte
    // et skip som ikke lenger er i lista, forsvinner
    fleet.update([], t, 60);
    expect(fleet.list).toHaveLength(0);
  });

  it("gir skrogfarge etter skipstype", () => {
    expect(shipColor(70)).not.toBe(shipColor(80));
    expect(shipColor(60)).toBe(shipColor(69));
    expect(shipColor(0)).toBe(shipColor(99));
  });
});

describe("skipets plass og skilt", () => {
  it("flytter skroget fra antenna til skipets midtpunkt", () => {
    // 200 m langt skip med antenna på brua akter: midtpunktet ligger 70 m foran antenna og 4 m mot styrbord
    const base = { sog: 0, cog: null, hdg: 0, fwd: 70, stb: 4 };
    const [north] = fromAis([ship(base)], t, 0), [plain] = fromAis([ship({ ...base, fwd: 0, stb: 0 })], t, 0);
    const [e0, n0] = t.gridToUtm(plain.x, plain.y), [e1, n1] = t.gridToUtm(north.x, north.y);
    // baugen peker sann nord: i rutenettet dreid med konvergensen. Avstanden skal være 70 m framover og 4 m til høyre
    const h = (-t.meta.gridConvergenceDeg * Math.PI) / 180;
    expect((e1 - e0) * Math.sin(h) + (n1 - n0) * Math.cos(h)).toBeCloseTo(70, 3);
    expect((e1 - e0) * Math.cos(h) - (n1 - n0) * Math.sin(h)).toBeCloseTo(4, 3);
    // sann øst: 70 m østover (styrbord er da sør)
    const [east] = fromAis([ship({ ...base, hdg: 90 })], t, 0), [e2, n2] = t.gridToUtm(east.x, east.y);
    expect(Math.hypot(e2 - e0, n2 - n0)).toBeCloseTo(Math.hypot(70, 4), 3);
    expect(e2 - e0).toBeGreaterThan(65);
    expect(n2 - n0).toBeLessThan(0);
    // uten kompass og uten fart vet vi ikke hvor baugen peker: da flyttes ingenting
    const [unknown] = fromAis([ship({ ...base, hdg: null })], t, 0);
    expect([unknown.x, unknown.y]).toEqual([plain.x, plain.y]);
  });

  it("gir type i klartekst og tar med destinasjonen", () => {
    expect([shipKind(70), shipKind(79), shipKind(84), shipKind(60), shipKind(52), shipKind(30), shipKind(0), shipKind(99)]).toEqual(["Cargo", "Cargo", "Tanker", "Passenger", "Tug", "Fishing", "", ""]);
    expect(fromAis([ship({ dest: "BERGEN-FLAAM-BERGEN" })], t, 0)[0].dest).toBe("BERGEN-FLAAM-BERGEN");
    expect(fromAis([ship()], t, 0)[0].dest).toBe("");
  });

  it("kjenner igjen SuperSpeed på navnet, og bare den", () => {
    for (const name of ["SUPERSPEED 1", "SUPERSPEED 2", "SuperSpeed 1 ", "SUPERSPEED1", "SUPER SPEED 1", "SUPERSPEED"]) expect(shipModelKind(name)).toBe("superspeed");
    for (const name of ["", "TESTSKIP", "COLOR FANTASY", "SUPERSPEEDY", "MS SUPERSPEED EXPRESS"]) expect(shipModelKind(name)).toBeNull();
  });
});
