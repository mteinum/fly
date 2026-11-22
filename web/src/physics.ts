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
const BRAKE_TIME = 1.2; // s fra inne til helt ute
const BRAKE_DRAG = 26; // m/s lavere toppfart med luftbremsene ute
export const AUTOBRAKE_NAMES = ["", "LO", "MED", "MAX"];
/** Nedbremsing (m/s²) etter landing for autobremsens tre stillinger. LO og MED er som på flyet.
 *  SYNTETISK: MAX er sterkere enn flyet klarer (ca. 6 m/s² på tørr bane, og i flyet brukes MAX bare ved avbrutt
 *  avgang). Mehamn er 880 m, kortere enn en A320 kan stanse på, og skal likevel kunne landes på i spillet. */
export const AUTOBRAKE_DECEL = [0, 1.7, 3, 8];
/** Ruller flyet av banen fortere enn dette (m/s), er det en utforkjøring. */
const OVERRUN_SPEED = 5;
const ROLLOUT_STEER = 0.08; // rad/s: så fort nesehjulet retter flyet inn etter banen under utrullingen
/** Største stampefart med full stikke (rad/s), ca. 11°/s. Var 34°/s, som var altfor kvikt å håndfly. */
export const PITCH_RATE = 0.2;
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
const targetSpeed = (P: Plane, thr: number): number => 40 + thr * (table(TOP_SPEED, P.flaps) - GEAR_DRAG * P.gear - 40) - BRAKE_DRAG * P.brake;
/** Gassen (0-1) som holder `speed` (m/s) i flat flyging slik klaffer og understell står nå. */
export const throttleFor = (P: Plane, speed: number): number => clamp((speed - 40) / (targetSpeed(P, 1) - 40), 0, 1);

const G = 9.81;
const TURN_GAIN = 1.8; // svinger raskere enn en koordinert sving skulle tilsi (arv fra prototypen)

/** Vinden som en fart i rutenettet (m/s): dit lufta flytter seg, mot øst og mot nord. Jevn over hele kartet. */
export interface Wind { east: number; north: number }
export const CALM: Wind = { east: 0, north: 0 };
/** Vind som kommer FRA en rutenettretning (rad, 0 = rutenett-nord, med klokka) med farten `speed` (m/s). */
export const windFrom = (fromGridRad: number, speed: number): Wind => ({ east: -Math.sin(fromGridRad) * speed, north: -Math.cos(fromGridRad) * speed });
/** Flyets fart over bakken i rutenettet (m/s): mot øst og nord, farten, og kursen over bakken (rad, rutenettretning).
 *  Flyet beveger seg gjennom lufta der nesa peker, og lufta flytter seg med vinden. */
export function groundVelocity(P: Plane, wind: Wind = CALM): { east: number; north: number; speed: number; track: number } {
  const air = P.spd * Math.cos(P.pitch), east = Math.sin(P.hdg) * air + wind.east, north = Math.cos(P.hdg) * air + wind.north;
  return { east, north, speed: Math.hypot(east, north), track: Math.atan2(east, north) };
}

/** Svingrate i rad/s (positiv = mot høyre). */
export const turnRate = (P: Plane): number => ((G * Math.tan(P.roll)) / P.spd) * TURN_GAIN;
/** Stigerate i m/s. */
export const verticalSpeed = (P: Plane): number => P.spd * Math.sin(P.pitch);
export const APPROACH_DIST_M = 8000;
/** Halve bredden på et kirketårn slik det tegnes (m). SYNTETISK: dataene har høyde og plass, ikke bredde. */
export const CHURCH_TOWER_HALF_WIDTH = 2.5;
/** Radius på et fyrtårn slik det tegnes (m). SYNTETISK. */
export const LIGHTHOUSE_RADIUS = 3;

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
    gearDown: false, gear: 0, flapCfg: APPROACH_FLAPS, flaps: APPROACH_FLAPS, speedBrake: false, brake: 0, autobrake: P.autobrake, state: "fly", t: 0, touchdown: null, // autobremsen settes av den som starter innflygingen
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

/** Sett autobremsen: 1 = LO, 2 = MED, 3 = MAX. */
export function setAutobrake(P: Plane, level: number, say: Say): void {
  P.autobrake = clamp(Math.round(level), 1, 3);
  say(`Autobrake ${AUTOBRAKE_NAMES[P.autobrake]}`, 1.5);
}

/** Luftbremsespaken. Virker bare i lufta, og ikke med full klaff (da er de sperret, som på A320). */
export function toggleSpeedBrake(P: Plane, say: Say): void {
  if (P.state !== "fly") return;
  if (!P.speedBrake && P.flapCfg >= FLAP_NAMES.length - 1) { say("Speed brakes inhibited with flaps FULL", 2.5); return; }
  P.speedBrake = !P.speedBrake;
  say(P.speedBrake ? "Speed brakes out" : "Speed brakes in", 2);
}

/** Klaffspaken ett hakk ut (+1) eller inn (-1). */
export function moveFlaps(P: Plane, step: number, say: Say): void {
  if (P.state !== "fly") return;
  const cfg = clamp(P.flapCfg + step, 0, FLAP_NAMES.length - 1);
  if (cfg === P.flapCfg) return;
  P.flapCfg = cfg;
  say(`Flaps ${FLAP_NAMES[cfg]}`, 2);
  if (cfg >= FLAP_NAMES.length - 1 && P.speedBrake) { P.speedBrake = false; say("Flaps FULL, speed brakes in", 2.5); }
}

/** Ett fysikksteg. Returnerer true når flyet skal settes tilbake på innflyging. `wind` flytter flyet over bakken
 *  (fart og stigning er fortsatt i forhold til lufta); etter landing ruller flyet på hjulene og vinden virker ikke. */
export function update(P: Plane, t: Terrain, airport: Airport, K: Keys, dt: number, say: Say, wind: Wind = CALM): boolean {
  if (P.state !== "fly") {
    P.t -= dt;
    if (P.state === "landed") {
      // Utrulling: bakkespoilerne går ut av seg selv, autobremsen holder nedbremsingen den er satt til, og
      // nesehjulet retter flyet inn etter banen (SYNTETISK: spillet har ikke sideror eller hjulstyring).
      P.brake = Math.min(1, P.brake + dt / BRAKE_TIME);
      P.spd = Math.max(0, P.spd - AUTOBRAKE_DECEL[P.autobrake] * dt);
      const end = airport.runways.flatMap((rw) => rw.ends).find((e) => e.ident === P.touchdown?.runway);
      if (end) {
        const off = Math.atan2(Math.sin((end.headingGridDeg * Math.PI) / 180 - P.hdg), Math.cos((end.headingGridDeg * Math.PI) / 180 - P.hdg));
        P.hdg += clamp(off, -ROLLOUT_STEER * dt, ROLLOUT_STEER * dt);
      }
      P.x += (Math.sin(P.hdg) * P.spd * dt) / t.cell;
      P.y -= (Math.cos(P.hdg) * P.spd * dt) / t.cell;
      if (P.spd > OVERRUN_SPEED && !onRunway(t, airport, P.x, P.y)) {
        P.state = "crash"; P.t = 3;
        say("Runway overrun! Land earlier or use more autobrake (3 = MAX).", 3.5);
        return false;
      }
    }
    // etter landing blir flyet stående til piloten selv ber om ny innflyging (diplomet vises imens)
    return P.state !== "landed" && P.t <= 0;
  }
  const rollT = 0.75 * (axis(K.ArrowRight) - axis(K.ArrowLeft));
  P.roll += (rollT - P.roll) * Math.min(1, 3 * dt);
  const pin = axis(K.ArrowDown) - axis(K.ArrowUp);
  if (pin) P.pitch = clamp(P.pitch + pin * PITCH_RATE * dt, -0.5, 0.5);
  else P.pitch *= 1 - 0.5 * dt;
  P.thr = clamp(P.thr + 0.4 * dt * (axis(K.KeyW) - axis(K.KeyS)), 0, 1);
  P.gear = clamp(P.gear + ((P.gearDown ? 1 : -1) * dt) / GEAR_TIME, 0, 1);
  P.flaps += clamp(P.flapCfg - P.flaps, -FLAP_RATE * dt, FLAP_RATE * dt);
  P.brake = clamp(P.brake + ((P.speedBrake ? 1 : -1) * dt) / BRAKE_TIME, 0, 1);
  // mer motstand gir også raskere fartsendring
  const response = 0.35 * (1 + 0.075 * P.flaps + 0.2 * P.gear + 0.3 * P.brake);
  P.spd += (targetSpeed(P, P.thr) - P.spd) * response * dt - G * Math.sin(P.pitch) * dt;
  if (P.spd < stallSpeed(P)) P.pitch -= 0.5 * dt;
  P.spd = Math.max(20, P.spd);
  P.hdg += turnRate(P) * dt;
  const d = (P.spd * Math.cos(P.pitch) * dt) / t.cell;
  P.x += Math.sin(P.hdg) * d + (wind.east * dt) / t.cell;
  P.y -= Math.cos(P.hdg) * d + (wind.north * dt) / t.cell; // y øker mot sør, så nordover er minus
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
  // Kirketårn: smalere enn en celle, så de sjekkes for seg
  for (const [tx, ty, , top] of t.churchTowers) {
    if (P.alt <= top + 1.5 && Math.abs(P.x - tx) * t.cell < CHURCH_TOWER_HALF_WIDTH + 1.5 && Math.abs(P.y - ty) * t.cell < CHURCH_TOWER_HALF_WIDTH + 1.5) {
      P.state = "crash"; P.t = 2.5;
      say("Hit the church tower!", 2.5);
      return false;
    }
  }
  for (const [tx, ty, , top, tower] of t.lighthouses) {
    if (tower && P.alt <= top + 1.5 && Math.abs(P.x - tx) * t.cell < LIGHTHOUSE_RADIUS + 1.5 && Math.abs(P.y - ty) * t.cell < LIGHTHOUSE_RADIUS + 1.5) {
      P.state = "crash"; P.t = 2.5;
      say("Hit the lighthouse!", 2.5);
      return false;
    }
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
      // I vind: utrullingen starter med farten og retningen flyet hadde over bakken (motvind gir kortere utrulling)
      if (wind.east || wind.north) { const v = groundVelocity(P, wind); P.spd = v.speed; P.hdg = v.track; }
      P.state = "landed"; P.t = 5; P.alt = gh + 1; P.pitch = 0; P.roll = 0;
      say(`Landed! ${(P.spd * 1.944) | 0} kt, ${vs.toFixed(1)} m/s`, 5);
    } else {
      P.state = "crash"; P.t = 2.5; P.alt = gh + 1;
      say(t.isWater(P.x, P.y) ? "Splash!" : "Ground contact!", 2.5);
    }
  }
  return false;
}
