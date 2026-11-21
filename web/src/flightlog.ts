/* Flylogg: det som skjedde på én innflyging, som tall. Brukes til gjennomgang etterpå
 * (L laster ned siste logg; i utviklingsmodus lagres den også i data/flights/).
 *
 * Loggen er ren måling fra flymodellen. Posisjon er EUREF89 UTM 33 (øst, nord i meter), høyde NN2000,
 * kurs er sann. Den inneholder ingenting om spilleren.
 */
import type { Grade } from "./diploma";
import { guidance } from "./guidance";
import { speedLimit, stallSpeed, verticalSpeed, warnings } from "./physics";
import type { Plane, PlaneState, Touchdown } from "./plane";
import type { Airport, Runway, RunwayEnd, Terrain } from "./terrain";

const KT = 1.943844, FT = 3.28084, DEG = 180 / Math.PI;
/** Sekunder mellom hver måling. */
export const SAMPLE_INTERVAL = 0.5;
const round = (v: number, digits = 1): number => { const f = 10 ** digits; return Math.round(v * f) / f; };

export interface FlightSample {
  t: number; // s siden innflygingen startet
  east: number; north: number; // EPSG:25833
  altM: number; aglM: number; // over havet, og over terrenget rett under
  kt: number; vsFpm: number; // fart, og stigerate (negativ = synker)
  pitchDeg: number; rollDeg: number; hdgTrueDeg: number;
  thr: number; gear: number; flaps: number; // gass 0-1, understell 0-1, klaffstilling 0-4
  stallKt: number; limitKt: number; // steilefart og høyeste tillatte fart slik flyet er satt opp nå
  /** Avvik i merker som på PFD (positiv = til høyre / over), og avstand til siktepunktet. null utenfor dekning. */
  courseDots: number | null; glideDots: number | null; toAimM: number | null;
  ap: boolean; // autopiloten fløy
}

export interface FlightLog {
  version: 1;
  area: string; icao: string; airportName: string; runway: string;
  startedUtc: string;
  crs: string; gridConvergenceDeg: number;
  /** Baneenden det ble fløyet mot: terskelens posisjon og høyde, og kursen. */
  /** `headingGridDeg` er kursen i UTM-planet, regnet fra baneendene. Bruk den til geometri: den publiserte
   *  sanne kursen er avrundet til hele grader, og 0,05° blir 7 m på 8 km. */
  threshold: { east: number; north: number; elevationM: number; headingTrueDeg: number; headingGridDeg: number; displacedM: number };
  samples: FlightSample[];
  events: { t: number; what: string }[];
  outcome: Exclude<PlaneState, "fly"> | "aborted";
  message: string; // det spillet skrev da det endte
  touchdown: Touchdown | null;
  grade: Grade | null;
}

export class FlightLogger {
  private log: FlightLog | null = null;
  private clock = 0;
  private next = 0;
  private was = { gearDown: false, flapCfg: 0, ap: false, overspeed: false, stall: false, gearNotDown: false };
  private rw!: Runway;
  private end!: RunwayEnd;

  constructor(private terrain: Terrain, private airport: Airport) {}

  /** Start en ny logg. En logg som ikke ble avsluttet kastes. */
  start(P: Plane, rw: Runway, end: RunwayEnd, startedUtc: Date): void {
    const t = this.terrain, h = (end.headingGridDeg * Math.PI) / 180, d = end.displacedThresholdM / t.cell;
    const [east, north] = t.gridToUtm(end.x + Math.sin(h) * d, end.y - Math.cos(h) * d);
    this.rw = rw; this.end = end; this.clock = 0; this.next = SAMPLE_INTERVAL;
    this.was = { gearDown: P.gearDown, flapCfg: P.flapCfg, ap: false, overspeed: false, stall: false, gearNotDown: false };
    this.log = {
      version: 1, area: t.meta.id, icao: this.airport.icao, airportName: this.airport.name, runway: end.ident,
      startedUtc: startedUtc.toISOString(), crs: t.meta.crs, gridConvergenceDeg: t.meta.gridConvergenceDeg,
      threshold: { east: round(east), north: round(north), elevationM: round(end.elevationM), headingTrueDeg: round(end.headingTrueDeg), headingGridDeg: round(end.headingGridDeg, 3), displacedM: round(end.displacedThresholdM) },
      samples: [], events: [], outcome: "aborted", message: "", touchdown: null, grade: null,
    };
    this.sample(P, false);
  }

  /** Kalles etter hvert fysikksteg mens flyet flyr. */
  step(P: Plane, dt: number, ap: boolean): void {
    const log = this.log;
    if (!log) return;
    this.clock += dt;
    const w = warnings(P, (P.alt - Math.max(0, this.terrain.heightAt(P.x, P.y))) * FT), was = this.was;
    const note = (what: string) => log.events.push({ t: round(this.clock), what });
    if (P.gearDown !== was.gearDown) note(P.gearDown ? "gear lever down" : "gear lever up");
    if (P.flapCfg !== was.flapCfg) note(`flap lever ${P.flapCfg}`);
    if (ap !== was.ap) note(ap ? "autopilot on" : "autopilot off");
    for (const k of ["overspeed", "stall", "gearNotDown"] as const) if (w[k] !== was[k]) note(`warning ${k} ${w[k] ? "on" : "off"}`);
    this.was = { gearDown: P.gearDown, flapCfg: P.flapCfg, ap, ...w };
    if (this.clock >= this.next - 1e-9) { this.next += SAMPLE_INTERVAL; this.sample(P, ap); }
  }

  /** Avslutt loggen og returner den. `grade` regnes av den som kaller (diploma.ts), så loggen ikke avhenger av den. */
  finish(P: Plane, message: string, grade: Grade | null, ap: boolean): FlightLog | null {
    const log = this.log;
    if (!log) return null;
    this.sample(P, ap);
    log.outcome = P.state === "fly" ? "aborted" : P.state;
    log.message = message; log.touchdown = P.touchdown; log.grade = grade;
    this.log = null;
    return log;
  }

  private sample(P: Plane, ap: boolean): void {
    const t = this.terrain, [east, north] = t.gridToUtm(P.x, P.y), gd = guidance(t, this.rw, this.end, P);
    this.log!.samples.push({
      t: round(this.clock), east: round(east), north: round(north),
      altM: round(P.alt), aglM: round(P.alt - Math.max(0, t.heightAt(P.x, P.y))),
      kt: round(P.spd * KT), vsFpm: Math.round(verticalSpeed(P) * 60 * FT),
      pitchDeg: round(P.pitch * DEG), rollDeg: round(P.roll * DEG), hdgTrueDeg: round(t.trueHeadingDeg(P.hdg)),
      thr: round(P.thr, 2), gear: round(P.gear, 2), flaps: round(P.flaps, 2),
      stallKt: round(stallSpeed(P) * KT), limitKt: round(speedLimit(P) * KT),
      courseDots: gd && round(gd.courseDots, 2), glideDots: gd && round(gd.glideDots, 2), toAimM: gd && Math.round(gd.distanceM),
      ap,
    });
  }
}

/** Filnavn for en logg: tid, flyplass, bane og utfall. Bare tegn som er trygge i filnavn. */
export const flightLogName = (log: FlightLog): string =>
  `${log.startedUtc.replace(/[-:]/g, "").replace(/\..*$/, "")}Z-${log.icao}-${log.runway}-${log.outcome}.json`.replace(/[^A-Za-z0-9.\-]/g, "");
