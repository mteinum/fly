/* Flyloggen: tre innflyginger til Kjevik flys av kode og sammenlignes med loggene i tests/fixtures/flights/.
 * De samme filene er fasit for gjennomgangen i pipeline (pytest). Lag dem på nytt med UPDATE_FIXTURES=1 npm test. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { autopilot, type AutopilotCommand } from "./autopilot";
import { gradeLanding } from "./diploma";
import { type FlightLog, FlightLogger, flightLogName, SAMPLE_INTERVAL } from "./flightlog";
import { moveFlaps, startApproach, toggleGear, update } from "./physics";
import { newPlane, type Plane } from "./plane";
import { loadTestTerrain } from "./testTerrain";

const DIR = fileURLToPath(new URL("../../tests/fixtures/flights/", import.meta.url));
const t = loadTestTerrain(), airport = t.meta.airports[0], rw = airport.runways[0], end = rw.ends[0];

/** En pilot: tar autopilotens forslag og gjør det om til det som faktisk blir gjort. */
type Pilot = (cmd: AutopilotCommand, P: Plane, toThresholdM: number) => AutopilotCommand;
const PILOTS: Record<string, { ap: boolean; pilot: Pilot }> = {
  // autopiloten slik den er
  autopilot: { ap: true, pilot: (cmd) => cmd },
  // flyr rett fram de første 3 km og blir liggende høyt, understellet sent, og aldri mer enn klaff 2
  "late-and-high": {
    ap: false,
    pilot: (cmd, P, d) => ({
      keys: d > 5000 ? { ...cmd.keys, ArrowDown: 0, ArrowUp: 0 } : cmd.keys,
      gearDown: d < 2000, flapCfg: P.flapCfg,
    }),
  },
  // glemmer understellet
  "gear-up": { ap: false, pilot: (cmd) => ({ ...cmd, gearDown: false }) },
};

function fly(name: string): FlightLog {
  const { ap, pilot } = PILOTS[name], P = newPlane(), logger = new FlightLogger(t, airport), dt = 1 / 60;
  let message = "";
  const say = (m: string) => { message = m; };
  startApproach(P, t, end);
  logger.start(P, rw, end, new Date("2026-11-21T08:00:00Z"));
  for (let i = 0; i < 300 / dt && P.state === "fly"; i++) {
    const h = (end.headingGridDeg * Math.PI) / 180;
    const along = ((P.x - end.x) * Math.sin(h) - (P.y - end.y) * Math.cos(h)) * t.cell;
    const cmd = pilot(autopilot(P, t, rw, end)!, P, end.displacedThresholdM - along);
    if (cmd.gearDown !== P.gearDown) toggleGear(P, say);
    if (cmd.flapCfg !== P.flapCfg) moveFlaps(P, Math.sign(cmd.flapCfg - P.flapCfg), say);
    update(P, t, airport, cmd.keys, dt, say);
    logger.step(P, dt, ap);
  }
  return logger.finish(P, message, P.touchdown && gradeLanding(P.touchdown), ap)!;
}

describe("flylogg", () => {
  const auto = fly("autopilot");

  it("måler to ganger i sekundet, fra start til slutt", () => {
    const s = auto.samples;
    expect(s[0].t).toBe(0);
    for (let i = 1; i < s.length - 1; i++) expect(s[i].t - s[i - 1].t).toBeCloseTo(SAMPLE_INTERVAL, 1);
    expect(s.at(-1)!.aglM).toBeLessThan(2); // siste måling er der det endte
    expect(auto.outcome).toBe("landed");
    expect(auto.grade?.stars).toBe(5);
  });

  it("gir posisjon i UTM 33 og sann kurs, ikke rutenett", () => {
    const first = auto.samples[0], th = auto.threshold;
    // 8 km fra baneenden, altså 8 km + forskjøvet terskel fra terskelen
    expect(Math.hypot(first.east - th.east, first.north - th.north)).toBeCloseTo(8000 + th.displacedM, -1);
    // peilingen fra start til terskel i UTM er rutenettkurs: sann kurs = rutenett + konvergens
    const gridBearing = (Math.atan2(th.east - first.east, th.north - first.north) * 180) / Math.PI;
    expect(first.hdgTrueDeg).toBeCloseTo(gridBearing + auto.gridConvergenceDeg, 0);
    expect(first.hdgTrueDeg).toBeCloseTo(th.headingTrueDeg, 0);
    expect(auto.crs).toBe("EPSG:25833");
  });

  it("starter på glidebanen og senterlinja, og noterer hendelsene", () => {
    expect(Math.abs(auto.samples[0].glideDots!)).toBeLessThan(0.1);
    expect(Math.abs(auto.samples[0].courseDots!)).toBeLessThan(0.1);
    expect(auto.events.map((e) => e.what)).toEqual(["autopilot on", "gear lever down", "flap lever 3", "flap lever 4"]);
  });

  it("fanger varsler og utfall når det går galt", () => {
    const belly = fly("gear-up");
    expect(belly.outcome).toBe("crash");
    expect(belly.message).toMatch(/Belly landing/);
    expect(belly.events.map((e) => e.what)).toContain("warning gearNotDown on");
    const sloppy = fly("late-and-high");
    expect(sloppy.outcome).toBe("landed");
    expect(sloppy.grade!.remarks).toContain("not enough flap");
  });

  it("gir filnavn uten annet enn trygge tegn", () => {
    expect(flightLogName(auto)).toBe("20261121T080000Z-ENCN-03-landed.json");
    expect(flightLogName({ ...auto, icao: "../x", runway: "a/b" })).not.toMatch(/[\/\\]/);
  });

  it.each(Object.keys(PILOTS))("%s: lik loggen i tests/fixtures/flights/", (name) => {
    const file = `${DIR}${name}.json`, log = JSON.stringify(fly(name));
    if (process.env.UPDATE_FIXTURES) { mkdirSync(DIR, { recursive: true }); writeFileSync(file, log); }
    expect(existsSync(file), "kjør UPDATE_FIXTURES=1 npm test").toBe(true);
    expect(JSON.parse(log)).toEqual(JSON.parse(readFileSync(file, "utf-8")));
  });
});
