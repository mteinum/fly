/* Enkel flymodell, landing og krasj. Posisjon i rutenettceller, høyde og fart i meter. */
import { glidePathAltitude } from "./guidance";
import type { Plane, Touchdown } from "./plane";
import { type Airport, BRIDGE, BUILDING, type Runway, type RunwayEnd, type Terrain } from "./terrain";

export const MAX_ALT = 1500;
// Tall i samme størrelsesorden som en Airbus A320 på ca. 60 tonn. Modellen er fortsatt prototypens
// enkle fartsmodell, ikke aerodynamikk: klaffer og understell virker gjennom tabellene under.
const KT = 1.943844;
export const FLAP_NAMES = ["0", "1", "2", "3", "FULL"];
const STALL_KT = [145, 125, 116, 110, 105]; // steilefart per klaffstilling
const FLAP_LIMIT_KT = [350, 230, 200, 185, 177]; // høyeste tillatte fart (VFE; 350 = VMO uten klaff)
const TOP_SPEED = [180, 150, 135, 125, 115]; // m/s ved full gass i flat flyging: mer klaff, mer motstand
const GEAR_DRAG = 12; // m/s lavere toppfart med understellet ute
export const GEAR_LIMIT_KT = 280; // høyeste fart med understellet ute (VLE)
export const MAX_LANDING_SPEED = 85; // m/s (165 kt)
const GEAR_TIME = 8; // s fra oppe til nede
const FLAP_RATE = 0.3; // klaffstillinger per sekund
const APPROACH_FLAPS = 2;
const APPROACH_SPEED = 82; // m/s (160 kt)

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const table = (t: number[], flaps: number): number => {
  const i = Math.min(Math.floor(flaps), t.length - 2), f = flaps - i;
  return t[i] + (t[i + 1] - t[i]) * f;
};
/** Steilefart (m/s) for klaffene slik de står nå. */
export const stallSpeed = (P: Plane): number => table(STALL_KT, P.flaps) / KT;
/** Høyeste tillatte fart (m/s): strengeste av klaffgrense og understellsgrense. Mens klaffene går ut gjelder grensen for stillingen de er på vei til. */
export const speedLimit = (P: Plane): number =>
  Math.min(FLAP_LIMIT_KT[Math.ceil(Math.max(P.flaps, P.flapCfg) - 1e-6)], P.gear > 0.01 || P.gearDown ? GEAR_LIMIT_KT : 350) / KT;
export interface Warnings { overspeed: boolean; stall: boolean; gearNotDown: boolean }

/** Varslene flyet gir nå. `raFt` er radiohøyden i fot. Brukes av både panelet og lyden. */
export function warnings(P: Plane, raFt: number): Warnings {
  const flying = P.state === "fly";
  return {
    overspeed: flying && P.spd > speedLimit(P) + 2,
    stall: flying && P.spd < stallSpeed(P),
    // lavt, og understellet ikke nede og låst
    gearNotDown: flying && raFt < 750 && P.gear < 1,
  };
}

/** Fart (m/s) flyet går mot med gitt gass i flat flyging. */
const targetSpeed = (P: Plane, thr: number): number => 40 + thr * (table(TOP_SPEED, P.flaps) - GEAR_DRAG * P.gear - 40);
/** Gassen (0-1) som holder `speed` (m/s) i flat flyging slik klaffer og understell står nå. */
export const throttleFor = (P: Plane, speed: number): number => clamp((speed - 40) / (targetSpeed(P, 1) - 40), 0, 1);

const G = 9.81;
const TURN_GAIN = 1.8; // svinger raskere enn en koordinert sving skulle tilsi (arv fra prototypen)

/** Svingrate i rad/s (positiv = mot høyre). */
export const turnRate = (P: Plane): number => ((G * Math.tan(P.roll)) / P.spd) * TURN_GAIN;
/** Stigerate i m/s. */
export const verticalSpeed = (P: Plane): number => P.spd * Math.sin(P.pitch);
export const APPROACH_DIST_M = 8000;

/** Kontrollene: en tast er av/på, autopiloten gir utslag trinnløst (0-1) på de samme kontrollene. */
export type Keys = Record<string, boolean | number | undefined>;
const axis = (k: boolean | number | undefined): number => (typeof k === "number" ? clamp(k, 0, 1) : k ? 1 : 0);
export type Say = (msg: string, seconds?: number) => void;

const STICK = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
/** Hvor fort utslaget bygger seg opp mens en piltast holdes (per sekund): fullt utslag etter ca. 0,8 s. */
export const STICK_RAMP = 1.25;

/** Mykere stikke på tastatur: et kort trykk gir et lite utslag, og utslaget vokser mens tasten holdes.
 *  Slippes tasten, går det rett til null. `held` husker utslaget mellom stegene. Gassen (W/S) er som før. */
export function softStick(held: Record<string, number>, K: Keys, dt: number): Keys {
  const out: Keys = { ...K };
  for (const k of STICK) out[k] = held[k] = K[k] ? Math.min(1, (held[k] ?? 0) + STICK_RAMP * dt) : 0;
  return out;
}

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

/** Mål landingen: hvilken bane, hvor på banen, hvor fort og hvor hardt. */
function measureTouchdown(t: Terrain, airport: Airport, P: Plane, vs: number): Touchdown | null {
  for (const rw of airport.runways) {
    const { along, cross } = runwayOffset(t, rw, P.x, P.y);
    const length = Math.hypot(rw.ends[1].x - rw.ends[0].x, rw.ends[1].y - rw.ends[0].y) * t.cell;
    if (along < 0 || along > length || Math.abs(cross) > rw.widthM / 2 + t.cell / 2) continue;
    // landingsretning: den baneenden flyets kurs passer best med
    const forward = Math.cos(P.hdg - (rw.ends[0].headingGridDeg * Math.PI) / 180) >= 0;
    const end = forward ? rw.ends[0] : rw.ends[1];
    return {
      runway: end.ident,
      kt: P.spd * KT,
      fpm: -vs * 196.85,
      crossM: Math.abs(cross),
      pastThresholdM: (forward ? along : length - along) - end.displacedThresholdM,
      flaps: P.flapCfg,
    };
  }
  return null;
}

/** Sett flyet på 3° innflyging, 8 km før baneenden: klaff 2, understell oppe, 160 kt. Resten må piloten gjøre. */
export function startApproach(P: Plane, t: Terrain, end: RunwayEnd): void {
  const hdg = (end.headingGridDeg * Math.PI) / 180, d = APPROACH_DIST_M / t.cell;
  Object.assign(P, {
    x: end.x - Math.sin(hdg) * d,
    y: end.y + Math.cos(hdg) * d,
    alt: glidePathAltitude(t, end, APPROACH_DIST_M), // på glidebanen som PFD viser
    hdg, spd: APPROACH_SPEED, pitch: -0.05, roll: 0, thr: 0,
    gearDown: false, gear: 0, flapCfg: APPROACH_FLAPS, flaps: APPROACH_FLAPS, state: "fly", t: 0, touchdown: null,
  } satisfies Plane);
  // gass som holder startfarten i flat flyging
  P.thr = throttleFor(P, APPROACH_SPEED);
}

/** Understellsspaken. Virker bare i lufta. */
export function toggleGear(P: Plane, say: Say): void {
  if (P.state !== "fly") return;
  P.gearDown = !P.gearDown;
  say(P.gearDown ? "Gear down" : "Gear up", 2);
}

/** Klaffspaken ett hakk ut (+1) eller inn (-1). */
export function moveFlaps(P: Plane, step: number, say: Say): void {
  if (P.state !== "fly") return;
  const cfg = clamp(P.flapCfg + step, 0, FLAP_NAMES.length - 1);
  if (cfg === P.flapCfg) return;
  P.flapCfg = cfg;
  say(`Flaps ${FLAP_NAMES[cfg]}`, 2);
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
    // etter landing blir flyet stående til piloten selv ber om ny innflyging (diplomet vises imens)
    return P.state !== "landed" && P.t <= 0;
  }
  const rollT = 0.75 * (axis(K.ArrowRight) - axis(K.ArrowLeft));
  P.roll += (rollT - P.roll) * Math.min(1, 3 * dt);
  const pin = axis(K.ArrowDown) - axis(K.ArrowUp);
  if (pin) P.pitch = clamp(P.pitch + pin * 0.6 * dt, -0.5, 0.5);
  else P.pitch *= 1 - 0.5 * dt;
  P.thr = clamp(P.thr + 0.4 * dt * (axis(K.KeyW) - axis(K.KeyS)), 0, 1);
  P.gear = clamp(P.gear + ((P.gearDown ? 1 : -1) * dt) / GEAR_TIME, 0, 1);
  P.flaps += clamp(P.flapCfg - P.flaps, -FLAP_RATE * dt, FLAP_RATE * dt);
  // mer motstand gir også raskere fartsendring
  const response = 0.35 * (1 + 0.075 * P.flaps + 0.2 * P.gear);
  P.spd += (targetSpeed(P, P.thr) - P.spd) * response * dt - G * Math.sin(P.pitch) * dt;
  if (P.spd < stallSpeed(P)) P.pitch -= 0.5 * dt;
  P.spd = Math.max(20, P.spd);
  P.hdg += turnRate(P) * dt;
  const d = (P.spd * Math.cos(P.pitch) * dt) / t.cell;
  P.x += Math.sin(P.hdg) * d;
  P.y -= Math.cos(P.hdg) * d; // y øker mot sør, så nordover er minus
  P.alt = Math.min(MAX_ALT, P.alt + P.spd * Math.sin(P.pitch) * dt);

  if (!t.inBounds(P.x, P.y)) {
    P.state = "outside";
    P.t = 2.5;
    say("Outside the map area", 2.5);
    return false;
  }
  const ci = t.cellIndex(P.x, P.y), kind = t.sKind[ci];
  // Bru: bare dekket er solid, så det går an å fly under
  if (kind === BRIDGE && P.alt <= t.sTop[ci] + 1.5 && P.alt >= t.sBase[ci] - 1) {
    P.state = "crash"; P.t = 2.5;
    say("Hit the bridge!", 2.5);
    return false;
  }
  let gh = Math.max(0, t.heightAt(P.x, P.y));
  if (kind === BUILDING && t.sTop[ci] > gh) {
    if (P.alt <= t.sTop[ci] + 1.5) {
      P.state = "crash"; P.t = 2.5; P.alt = t.sTop[ci] + 1;
      say("Hit a building!", 2.5);
      return false;
    }
    gh = t.sTop[ci];
  }
  if (P.alt <= gh + 1.5) {
    const vs = verticalSpeed(P);
    if (onRunway(t, airport, P.x, P.y) && P.gear < 1) {
      P.state = "crash"; P.t = 3; P.alt = gh + 1;
      say("Belly landing! The gear was not down.", 3);
    } else if (onRunway(t, airport, P.x, P.y) && vs > -4 && Math.abs(P.roll) < 0.2 && P.spd < MAX_LANDING_SPEED) {
      P.touchdown = measureTouchdown(t, airport, P, vs);
      P.state = "landed"; P.t = 5; P.alt = gh + 1; P.pitch = 0; P.roll = 0;
      say(`Landed! ${(P.spd * 1.944) | 0} kt, ${vs.toFixed(1)} m/s`, 5);
    } else {
      P.state = "crash"; P.t = 2.5; P.alt = gh + 1;
      say(t.isWater(P.x, P.y) ? "Splash!" : "Ground contact!", 2.5);
    }
  }
  return false;
}
