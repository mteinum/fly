/* Enkel flymodell, landing og krasj. Posisjon i rutenettceller, høyde og fart i meter. */
import type { Plane } from "./plane";
import { type Airport, BRIDGE, BUILDING, type Runway, type RunwayEnd, type Terrain } from "./terrain";

export const MAX_ALT = 1500;
// Tall i samme størrelsesorden som en Airbus A320 i landingsoppsett. Modellen er fortsatt
// prototypens enkle fartsmodell, ikke aerodynamikk: ingen klaffer, understell eller vekt.
export const STALL_SPEED = 55; // m/s (107 kt): under dette synker nesa
export const MAX_LANDING_SPEED = 85; // m/s (165 kt)
export const MAX_SPEED = 180; // m/s (350 kt, VMO) ved full gass i flat flyging
const APPROACH_THRUST = 0.22; // gir ca. 71 m/s (138 kt) i flat flyging
const G = 9.81;
const TURN_GAIN = 1.8; // svinger raskere enn en koordinert sving skulle tilsi (arv fra prototypen)
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Svingrate i rad/s (positiv = mot høyre). */
export const turnRate = (P: Plane): number => ((G * Math.tan(P.roll)) / P.spd) * TURN_GAIN;
/** Stigerate i m/s. */
export const verticalSpeed = (P: Plane): number => P.spd * Math.sin(P.pitch);
const APPROACH_DIST_M = 4000;
const GLIDE_SLOPE = Math.tan((3 * Math.PI) / 180);

export type Keys = Record<string, boolean | undefined>;
export type Say = (msg: string, seconds?: number) => void;

/** Posisjon relativt til banen: langs (m fra baneende 0) og på tvers (m fra senterlinja). */
export function runwayOffset(t: Terrain, rw: Runway, x: number, y: number): { along: number; cross: number } {
  const [a, b] = rw.ends;
  const dx = (b.x - a.x) * t.cell, dy = (b.y - a.y) * t.cell, len = Math.hypot(dx, dy);
  const px = (x - a.x) * t.cell, py = (y - a.y) * t.cell;
  return { along: (px * dx + py * dy) / len, cross: (px * dy - py * dx) / len };
}

export function onRunway(t: Terrain, airport: Airport, x: number, y: number): boolean {
  return airport.runways.some((rw) => {
    const { along, cross } = runwayOffset(t, rw, x, y);
    const len = Math.hypot(rw.ends[1].x - rw.ends[0].x, rw.ends[1].y - rw.ends[0].y) * t.cell;
    // en halv celle slakk på tvers: banen er smalere enn rutenettet
    return along >= 0 && along <= len && Math.abs(cross) <= rw.widthM / 2 + t.cell / 2;
  });
}

/** Sett flyet på 3° innflyging, 4 km før baneenden. */
export function startApproach(P: Plane, t: Terrain, end: RunwayEnd): void {
  const hdg = (end.headingGridDeg * Math.PI) / 180, d = APPROACH_DIST_M / t.cell;
  Object.assign(P, {
    x: end.x - Math.sin(hdg) * d,
    y: end.y + Math.cos(hdg) * d,
    alt: t.heightAt(end.x, end.y) + APPROACH_DIST_M * GLIDE_SLOPE,
    hdg, spd: 72, pitch: -0.05, roll: 0, thr: APPROACH_THRUST, state: "fly", t: 0,
  } satisfies Plane);
}

/** Ett fysikksteg. Returnerer true når flyet skal settes tilbake på innflyging. */
export function update(P: Plane, t: Terrain, airport: Airport, K: Keys, dt: number, say: Say): boolean {
  if (P.state !== "fly") {
    P.t -= dt;
    if (P.state === "landed") {
      P.spd = Math.max(0, P.spd - 25 * dt);
      P.x += (Math.sin(P.hdg) * P.spd * dt) / t.cell;
      P.y -= (Math.cos(P.hdg) * P.spd * dt) / t.cell;
    }
    return P.t <= 0;
  }
  const rollT = (K.ArrowRight ? 0.75 : 0) - (K.ArrowLeft ? 0.75 : 0);
  P.roll += (rollT - P.roll) * Math.min(1, 3 * dt);
  const pin = (K.ArrowDown ? 1 : 0) - (K.ArrowUp ? 1 : 0);
  if (pin) P.pitch = clamp(P.pitch + pin * 0.6 * dt, -0.5, 0.5);
  else P.pitch *= 1 - 0.5 * dt;
  if (K.KeyW) P.thr = Math.min(1, P.thr + 0.4 * dt);
  if (K.KeyS) P.thr = Math.max(0, P.thr - 0.4 * dt);
  const target = 40 + P.thr * (MAX_SPEED - 40);
  P.spd += (target - P.spd) * 0.35 * dt - G * Math.sin(P.pitch) * dt;
  if (P.spd < STALL_SPEED) P.pitch -= 0.5 * dt;
  P.spd = Math.max(20, P.spd);
  P.hdg += turnRate(P) * dt;
  const d = (P.spd * Math.cos(P.pitch) * dt) / t.cell;
  P.x += Math.sin(P.hdg) * d;
  P.y -= Math.cos(P.hdg) * d; // y øker mot sør, så nordover er minus
  P.alt = Math.min(MAX_ALT, P.alt + P.spd * Math.sin(P.pitch) * dt);

  if (!t.inBounds(P.x, P.y)) {
    P.state = "outside";
    P.t = 2.5;
    say("Utenfor kartutsnittet", 2.5);
    return false;
  }
  const ci = t.cellIndex(P.x, P.y), kind = t.sKind[ci];
  // Bru: bare dekket er solid, så det går an å fly under
  if (kind === BRIDGE && P.alt <= t.sTop[ci] + 1.5 && P.alt >= t.sBase[ci] - 1) {
    P.state = "crash"; P.t = 2.5;
    say("Traff brua!", 2.5);
    return false;
  }
  let gh = Math.max(0, t.heightAt(P.x, P.y));
  if (kind === BUILDING && t.sTop[ci] > gh) {
    if (P.alt <= t.sTop[ci] + 1.5) {
      P.state = "crash"; P.t = 2.5; P.alt = t.sTop[ci] + 1;
      say("Traff en bygning!", 2.5);
      return false;
    }
    gh = t.sTop[ci];
  }
  if (P.alt <= gh + 1.5) {
    const vs = verticalSpeed(P);
    if (onRunway(t, airport, P.x, P.y) && vs > -4 && Math.abs(P.roll) < 0.2 && P.spd < MAX_LANDING_SPEED) {
      P.state = "landed"; P.t = 5; P.alt = gh + 1; P.pitch = 0; P.roll = 0;
      say(`Landet! ${(P.spd * 1.944) | 0} kt, ${vs.toFixed(1)} m/s`, 5);
    } else {
      P.state = "crash"; P.t = 2.5; P.alt = gh + 1;
      say(t.isWater(P.x, P.y) ? "Plask!" : "Bakkekontakt!", 2.5);
    }
  }
  return false;
}
