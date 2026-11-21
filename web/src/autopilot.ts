/* Autopilot for innflyging og landing: følger senterlinja og 3°-glidebanen, setter ut understell og
 * klaffer underveis, og flater ut over banen.
 *
 * Dette er en regelstyrt regulator, ikke maskinlæring og ikke en språkmodell: tre proporsjonalregulatorer
 * (kurs, glidebane, fart) og en tabell for når understell og klaffer skal ut. Den flyr med de samme
 * kontrollene som spilleren (se Keys i physics.ts), bare trinnløst der tastaturet er av/på.
 *
 * SYNTETISK: tallene er valgt for spillets flymodell, ikke hentet fra en ekte A320.
 */
import { aimPoint, GLIDE_ANGLE_DEG } from "./guidance";
import { type Keys, stallSpeed, throttleFor } from "./physics";
import type { Plane } from "./plane";
import type { Runway, RunwayEnd, Terrain } from "./terrain";

const RAD = Math.PI / 180, KT = 1.943844;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Oppsett etter avstand til terskelen (m): understell, klaffstilling og fart (kt). Første rad som passer gjelder. */
const SCHEDULE = [
  { beyondM: 6500, gear: false, flaps: 2, kt: 160 },
  { beyondM: 5500, gear: true, flaps: 2, kt: 160 },
  { beyondM: 4000, gear: true, flaps: 3, kt: 148 },
  { beyondM: -Infinity, gear: true, flaps: 4, kt: 135 },
];
const FLARE_HEIGHT_M = 12; // herfra flates det ut
const FLARE_KT = 126;
const LOOKAHEAD_M = 900; // siktepunkt på senterlinja foran flyet: kortere gir krappere inndreining
const MAX_INTERCEPT = 30 * RAD, MAX_BANK = 0.4;

export interface AutopilotCommand {
  /** Utslag på rorene og gassen, i samme form som tastene. */
  keys: Keys;
  /** Hvor understellsspaken og klaffspaken skal stå. */
  gearDown: boolean;
  flapCfg: number;
}

/** Hva autopiloten vil gjøre nå for å lande fra baneenden `end`, eller null når den ikke kan (flyr bort fra banen eller er forbi den). */
export function autopilot(P: Plane, t: Terrain, rw: Runway, end: RunwayEnd): AutopilotCommand | null {
  const h = end.headingGridDeg * RAD, cell = t.cell;
  const ex = (P.x - end.x) * cell, ey = (P.y - end.y) * cell;
  // langs landingsretningen (nord = -y), og til høyre for den: samme regnestykke som i guidance.ts
  const along = ex * Math.sin(h) - ey * Math.cos(h), right = ex * Math.cos(h) + ey * Math.sin(h);
  const length = Math.hypot(rw.ends[1].x - rw.ends[0].x, rw.ends[1].y - rw.ends[0].y) * cell;
  if (along > length || Math.cos(P.hdg - h) < 0) return null;

  // Kurs: sikt mot et punkt på senterlinja et stykke foran, og krenge etter kursfeilen
  const intercept = clamp(Math.atan2(right, LOOKAHEAD_M), -MAX_INTERCEPT, MAX_INTERCEPT);
  const bank = clamp(wrap(h - intercept - P.hdg) * 2, -MAX_BANK, MAX_BANK);

  // Høyde: synkeraten som følger glidebanen, pluss en korreksjon som henter inn avviket
  const aim = aimPoint(t, end), toAim = aim.fromEndM - along;
  const toThreshold = end.displacedThresholdM - along;
  const step = SCHEDULE.find((s) => toThreshold > s.beyondM)!;
  const agl = P.alt - Math.max(0, t.heightAt(P.x, P.y));
  const flare = toThreshold < 150 && agl < FLARE_HEIGHT_M;
  const pathAlt = aim.elevationM + Math.max(0, toAim) * Math.tan(GLIDE_ANGLE_DEG * RAD);
  let sink = clamp(-P.spd * Math.sin(GLIDE_ANGLE_DEG * RAD) - 0.25 * (P.alt - pathAlt), -8, 3);
  // utflating: synkeraten avtar med høyden, til ca. 1 m/s i det hjulene tar bakken
  if (flare || toAim <= 0) sink = Math.max(sink, -(0.8 + 0.25 * Math.max(0, agl - 1.5)));
  const pitch = Math.asin(clamp(sink / P.spd, -0.3, 0.3));

  // Fart: aldri under 1,15 x steilefart for klaffene slik de faktisk står
  const speed = Math.max((flare ? FLARE_KT : step.kt) / KT, stallSpeed(P) * 1.15);
  const thr = throttleFor(P, speed + 1.5 * (speed - P.spd));

  const keys: Keys = {};
  const push = (plus: string, minus: string, v: number) => { keys[plus] = Math.max(0, v); keys[minus] = Math.max(0, -v); };
  push("ArrowRight", "ArrowLeft", bank / 0.75); // rorutslaget er krengingen flyet går mot
  push("ArrowDown", "ArrowUp", ((pitch - P.pitch) * 4) / 0.6); // pil ned = nese opp
  push("KeyW", "KeyS", ((thr - P.thr) * 2) / 0.4);
  return { keys, gearDown: step.gear, flapCfg: step.flaps };
}
