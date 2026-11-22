/* Det piloten ser når blikket løftes eller senkes i cockpit: overheadpanelet (U) og midtkonsollen (J).
 *
 * Tegnes i de samme 320 x 200 logiske enhetene som instrumentpanelet (panel.ts), og fyller hele vinduet: mens
 * piloten ser opp eller ned, ser han ikke ut. Oppsettet følger hvordan panelene er bygget opp i en A320, forenklet.
 * All grafikk er tegnet her, ingenting er hentet fra bilder.
 *
 * Virker (se overheadHit og pedestalHit): setebeltebryteren og TERR på GPWS-panelet oppe; gasshåndtakene,
 * luftbremsen med armering av bakkespoilerne, klaffspaken, ECAM-tastene ENG og WHEEL, og TCAS-velgeren nede.
 * Alt annet er tegnet for at panelene skal ligne, og kan ikke betjenes. Som i flyet er trykkbryterne mørke når alt
 * er normalt.
 *
 * SYNTETISK: batterispenningene, transponderkoden (2000, standardkoden når ingen annen er tildelt), og
 * flygeplanen på MCDU (de samme oppdiktede veipunktene som på ND). Radioene viser streker: spillet har ingen
 * frekvenser, og ingen er diktet opp.
 */
import type { Game, PanelControl } from "./game";
import { AMBER, clamp, CYAN, type G2D, GREEN, ink, key, knob, line, MONO, NM, pad, panelLight, plate, RED, SANS, shade, text, WHITE } from "./panel";
import { FLAP_NAMES } from "./physics";
import { H, OX, TOP, W } from "./screen";
import type { Terrain } from "./terrain";

const PB = 6.4; // siden i en trykkbryter

/** Tekst på én eller flere linjer, midtstilt rundt y. */
function label(g: G2D, str: string, x: number, y: number, size: number, color: string): void {
  const rows = str.split("\n");
  rows.forEach((r, i) => text(g, r, x, y + (i - (rows.length - 1) / 2) * size * 1.08, size, color));
}

/** Trykkbryter med to lysfelt og navnet over. Feltene er mørke til de lyser: `upper` og `lower` er [tekst, farge, på]. */
function pb(g: G2D, x: number, y: number, name: string, body: number, upper: [string, string, boolean] = ["FAULT", AMBER, false], lower: [string, string, boolean] = ["OFF", WHITE, false]): void {
  label(g, name, x + PB / 2, y - 1.3 - (name.includes("\n") ? 0.7 : 0), 1.3, ink(body));
  g.fillStyle = "#0b0c0f"; g.beginPath(); g.roundRect(x, y, PB, PB, 0.5); g.fill();
  g.strokeStyle = shade(86, 94, 104, Math.max(body, 0.5)); g.lineWidth = 0.25; g.stroke();
  line(g, x + 0.6, y + PB / 2, x + PB - 0.6, y + PB / 2, 0.15, "#2a2e34");
  for (const [[str, color, on], ty] of [[upper, y + PB * 0.27], [lower, y + PB * 0.76]] as const) {
    g.globalAlpha = on ? 1 : 0.16;
    text(g, str, x + PB / 2, ty, 1.25, color, "center", SANS, 700);
    g.globalAlpha = 1;
  }
}

/** Vippebryter med navnet over. `up` er stillingen; `names` står ved siden av øvre og nedre stilling. */
function toggle(g: G2D, x: number, y: number, name: string, body: number, up: boolean, names: [string, string] = ["ON", "OFF"]): void {
  label(g, name, x, y - 5 - (name.includes("\n") ? 0.7 : 0), 1.3, ink(body));
  g.fillStyle = "#0a0b0d"; g.beginPath(); g.arc(x, y, 1.7, 0, 7); g.fill();
  g.strokeStyle = shade(120, 126, 134, Math.max(body, 0.5)); g.lineWidth = 0.25; g.stroke();
  const ty = y + (up ? -2.8 : 2.8);
  line(g, x, y, x, ty, 1, shade(200, 204, 210, Math.max(body, 0.5)));
  g.fillStyle = shade(225, 228, 232, Math.max(body, 0.5)); g.beginPath(); g.arc(x, ty, 0.9, 0, 7); g.fill();
  text(g, names[0], x + 2.6, y - 2.6, 1.1, ink(body, 0.8), "left"); text(g, names[1], x + 2.6, y + 2.6, 1.1, ink(body, 0.8), "left");
}

/** Dreievelger med navnet over og stillingen den står i under. */
function selector(g: G2D, x: number, y: number, name: string, caption: string, body: number, angle = 0, r = 2.6): void {
  label(g, name, x, y - r - 1.8 - (name.includes("\n") ? 0.7 : 0), 1.3, ink(body));
  knob(g, x, y, r, body, angle);
  if (caption) text(g, caption, x, y + r + 1.6, 1.2, ink(body, 0.85));
}

/** Lite vindu med tall, som på batteriene og radioene. */
function lcd(g: G2D, x: number, y: number, w: number, h: number, value: string, color = "#ffb347"): void {
  g.fillStyle = "#06080a"; g.fillRect(x, y, w, h);
  text(g, value, x + w - 0.8, y + h / 2 + 0.2, h * 0.68, color, "right", MONO, 600);
}

/** Et delpanel: plate med navnet oppe i hjørnet. */
function box(g: G2D, x: number, y: number, w: number, h: number, title: string, body: number): void {
  plate(g, x, y, w, h, body, 86, 100, 114);
  if (title) text(g, title, x + 3.2, y + 2.2, 1.6, ink(body), "left", SANS, 700);
}

/** Mørk bakgrunn over hele vinduet (taket eller gulvet i cockpit), og flytt til det faste oppsettet. */
function backdrop(g: G2D, body: number): void {
  const bg = g.createLinearGradient(0, TOP, 0, H);
  bg.addColorStop(0, shade(34, 38, 46, body)); bg.addColorStop(1, shade(22, 25, 31, body));
  g.fillStyle = bg; g.fillRect(0, TOP, W, H - TOP);
  g.translate(OX, 0);
}

/* ---------- overheadpanelet ---------- */

// Det som virker på overheadpanelet (logiske enheter i det faste oppsettet)
const TERR_PB = { x: 26, y: 87 }, SEAT_BELTS = { x: 201, y: 166 };

export function drawOverhead(g: G2D, game: Game): void {
  const body = panelLight(game), row = (x0: number, step: number, y: number, names: string[]) => names.forEach((n, i) => pb(g, x0 + i * step, y, n, body));
  g.save();
  backdrop(g, body);

  // venstre kolonne
  box(g, 22, 4, 70, 34, "ADIRS", body);
  row(30, 23, 11, ["IR 1", "IR 3", "IR 2"]);
  for (const x of [33.2, 56.2, 79.2]) selector(g, x, 29, "", "OFF NAV ATT", body, 0, 2.4);
  box(g, 22, 40, 70, 16, "FLT CTL", body);
  row(36, 19, 46.6, ["ELAC 1", "SEC 1", "FAC 1"]);
  box(g, 22, 58, 70, 16, "EVAC", body);
  pb(g, 40, 64.6, "COMMAND", body, ["EVAC", RED, false], ["ON", WHITE, false]); pb(g, 62, 64.6, "HORN OFF", body, ["", AMBER, false], ["", WHITE, false]);
  box(g, 22, 76, 70, 22, "GPWS", body);
  // TERR: slår terrengvarselet av (OFF lyser hvitt). De andre fire virker ikke.
  pb(g, TERR_PB.x, TERR_PB.y, "TERR", body, ["FAULT", AMBER, false], ["OFF", WHITE, !game.sys.gpwsTerr]);
  row(39.4, 13.4, 87, ["SYS", "G/S MODE", "FLAP MODE", "LDG\nFLAP 3"]);
  box(g, 22, 100, 70, 24, "RCDR / OXYGEN", body);
  row(26, 13.4, 112, ["GND CTL", "CVR\nERASE", "CVR\nTEST", "PASSEN-\nGER", "CREW\nSUPPLY"]);
  box(g, 22, 126, 70, 22, "CALLS", body);
  row(26, 13.4, 137, ["MECH", "FWD", "AFT"]); pb(g, 79.6, 137, "EMER", body, ["CALL", AMBER, false], ["ON", WHITE, false]);
  box(g, 22, 150, 70, 46, "WIPER", body);
  selector(g, 42, 174, "", "OFF  SLOW  FAST", body, -0.8, 4); pb(g, 68, 170, "RAIN RPLNT", body, ["", AMBER, false], ["", WHITE, false]);

  // midten: brann, hydraulikk, drivstoff, elektrisk, luft
  box(g, 96, 4, 128, 30, "FIRE", body);
  [["ENG 1", 104], ["APU", 149], ["ENG 2", 194]].forEach(([name, x]) => {
    const hx = x as number;
    g.fillStyle = "#16090a"; g.beginPath(); g.roundRect(hx, 10, 22, 9, 1); g.fill();
    g.strokeStyle = "#8f1d18"; g.lineWidth = 0.5; g.stroke();
    text(g, `${name} FIRE`, hx + 11, 13, 1.6, "#c93a30", "center", SANS, 700); text(g, "PUSH", hx + 11, 16.4, 1.3, "#c93a30");
    pb(g, hx + 1.4, 25, "", body, ["SQUIB", WHITE, false], ["DISCH", AMBER, false]); pb(g, hx + 14.2, 25, "", body, ["SQUIB", WHITE, false], ["DISCH", AMBER, false]);
  });
  text(g, "AGENT 1", 124.6 + 0, 22.6, 1.2, ink(body, 0.8), "right"); text(g, "AGENT 2", 127.4, 22.6, 1.2, ink(body, 0.8), "left");
  box(g, 96, 36, 128, 22, "HYD", body);
  text(g, "GREEN", 112, 39.2, 1.4, ink(body)); text(g, "BLUE", 160, 39.2, 1.4, ink(body)); text(g, "YELLOW", 205, 39.2, 1.4, ink(body));
  row(101, 20.8, 47.6, ["ENG 1 PUMP", "RAT MAN ON", "ELEC PUMP", "PTU", "ENG 2 PUMP", "ELEC PUMP"]);
  box(g, 96, 60, 128, 24, "FUEL", body);
  row(100, 15.5, 72.6, ["L TK\nPUMP 1", "L TK\nPUMP 2", "CTR TK\nPUMP 1", "MODE\nSEL", "X FEED", "CTR TK\nPUMP 2", "R TK\nPUMP 1", "R TK\nPUMP 2"]);
  box(g, 96, 86, 128, 30, "ELEC", body);
  text(g, "BAT 1", 131, 90.4, 1.3, ink(body)); lcd(g, 137, 88, 14, 5, "28.2"); text(g, "V", 152.4, 90.6, 1.3, CYAN);
  text(g, "BAT 2", 173, 90.4, 1.3, ink(body)); lcd(g, 179, 88, 14, 5, "28.2"); text(g, "V", 194.4, 90.6, 1.3, CYAN);
  row(100, 15.5, 104.6, ["BAT 1", "GEN 1", "APU GEN", "BUS TIE", "AC ESS\nFEED", "EXT PWR", "GEN 2", "BAT 2"]);
  box(g, 96, 118, 128, 32, "AIR COND", body);
  [["CKPT", 118], ["FWD CABIN", 142], ["AFT CABIN", 166]].forEach(([n, x]) => selector(g, x as number, 127, n as string, "", body, 0.2, 2.4));
  selector(g, 200, 127, "PACK FLOW", "", body, 0, 2.4);
  text(g, "COLD      HOT", 142, 131.6, 1.1, ink(body, 0.8));
  row(100, 15.5, 140.4, ["PACK 1", "ENG 1\nBLEED", "APU\nBLEED", "X BLEED", "HOT AIR", "ENG 2\nBLEED", "PACK 2", "RAM AIR"]);

  // nederst i midten: avising, lys ute, APU, skilt
  box(g, 96, 152, 36, 44, "ANTI ICE", body);
  row(100, 10.8, 163, ["WING", "ENG 1", "ENG 2"]);
  pb(g, 110.8, 184, "PROBE/WINDOW\nHEAT", body, ["", AMBER, false], ["ON", CYAN, false]);
  box(g, 134, 152, 46, 44, "EXT LT", body);
  ["STROBE", "BEACON", "WING", "NAV &\nLOGO"].forEach((n, i) => toggle(g, 140 + i * 11, 166, n, body, i !== 2, i === 0 ? ["ON", "AUTO"] : ["ON", "OFF"]));
  ["RWY\nTURN OFF", "LAND L", "LAND R", "NOSE"].forEach((n, i) => toggle(g, 140 + i * 11, 187, n, body, true, i === 3 ? ["T.O", "OFF"] : ["ON", "OFF"]));
  box(g, 182, 152, 13, 44, "APU", body);
  pb(g, 185.3, 164, "MASTER\nSW", body, ["FAULT", AMBER, false], ["ON", CYAN, false]); pb(g, 185.3, 184, "START", body, ["AVAIL", GREEN, false], ["ON", CYAN, false]);
  box(g, 197, 152, 27, 44, "SIGNS", body);
  // SEAT BELTS: styrer linja SIGNS i landingsmemoet. NO SMOKING og nødlysene virker ikke.
  toggle(g, SEAT_BELTS.x, SEAT_BELTS.y, "SEAT\nBELTS", body, game.sys.seatBelts);
  toggle(g, 214, 166, "NO\nSMOKING", body, true, ["ON", "AUTO"]);
  toggle(g, 207.5, 187, "EMER EXIT LT", body, true, ["ARM", "OFF"]);

  // høyre kolonne
  box(g, 228, 4, 70, 16, "FLT CTL", body);
  row(238, 14.6, 10.6, ["ELAC 2", "SEC 2", "SEC 3", "FAC 2"]);
  box(g, 228, 22, 70, 20, "CARGO HEAT", body);
  selector(g, 246, 33, "", "COLD   HOT", body, 0.2, 2.4); pb(g, 262, 30.6, "HOT AIR", body); pb(g, 280, 30.6, "AFT ISOL\nVALVE", body);
  box(g, 228, 44, 70, 24, "CARGO SMOKE", body);
  pb(g, 240, 56, "FWD", body, ["SMOKE", RED, false], ["DISCH", AMBER, false]); pb(g, 259.8, 56, "AFT", body, ["SMOKE", RED, false], ["DISCH", AMBER, false]); pb(g, 279.6, 56, "TEST", body, ["", AMBER, false], ["", WHITE, false]);
  box(g, 228, 70, 70, 20, "VENTILATION", body);
  ["BLOWER", "EXTRACT", "CAB FANS"].forEach((n, i) => pb(g, 240 + i * 19.8, 79.6, n, body, ["FAULT", AMBER, false], ["OVRD", WHITE, false]));
  box(g, 228, 92, 70, 18, "ENG MAN START", body);
  pb(g, 250, 100.2, "1", body, ["", AMBER, false], ["ON", CYAN, false]); pb(g, 270, 100.2, "2", body, ["", AMBER, false], ["ON", CYAN, false]);
  box(g, 228, 112, 70, 36, "INT LT", body);
  toggle(g, 240, 128, "DOME", body, false, ["BRT", "OFF"]); toggle(g, 258, 128, "ANN LT", body, false, ["TEST", "DIM"]);
  selector(g, 282, 128, "OVHD\nINTEG LT", "", body, 1.1, 2.6); toggle(g, 240, 142.4, "", body, true, ["STBY COMPASS", ""]);
  box(g, 228, 150, 70, 46, "WIPER", body);
  selector(g, 278, 174, "", "OFF  SLOW  FAST", body, -0.8, 4); pb(g, 246, 170, "RAIN RPLNT", body, ["", AMBER, false], ["", WHITE, false]);
  g.restore();
}

/** Hva som kan betjenes på overheadpanelet i punktet (lx, ly), eller null. Koordinater som for panelHit. */
export function overheadHit(lx: number, ly: number): PanelControl | null {
  if (lx >= TERR_PB.x - 1 && lx <= TERR_PB.x + PB + 1 && ly >= TERR_PB.y - 1 && ly <= TERR_PB.y + PB + 1) return { kind: "gpwsTerr" };
  if (Math.abs(lx - SEAT_BELTS.x) <= 4.4 && Math.abs(ly - SEAT_BELTS.y) <= 5.4) return { kind: "seatBelts" };
  return null;
}

/* ---------- midtkonsollen ---------- */

// Det som virker på midtkonsollen
const THR = { x: 160, top: 82, bottom: 138 }, SPD = { x: 86, top: 162, bottom: 190 }, FLAP = { x: 232, top: 160, bottom: 190 };
const ECAM = { x: 128.6, y: 39, w: 10, h: 7.4, step: 10.8 }, TCAS_KNOB = { x: 262, y: 139 };
const PARK = { x: 140, y: 190 };
const ECAM_KEYS = [["ENG", "BLEED", "PRESS", "ELEC", "HYD", "FUEL"], ["APU", "COND", "DOOR", "WHEEL", "F/CTL", "ALL"]];

/** Gasstillingen (0-1) for en høyde på skjermen langs sporet på midtkonsollen. */
export const pedestalThrustAt = (ly: number): number => clamp((THR.bottom - ly) / (THR.bottom - THR.top), 0, 1);

/** MCDU: skjerm med flygeplanen, linjetaster og tastatur. SYNTETISK: veipunktene er de samme oppdiktede som på ND. */
function mcdu(g: G2D, x: number, y: number, game: Game, t: Terrain, body: number): void {
  plate(g, x, y, 80, 66, body, 62, 70, 80);
  g.fillStyle = "#020304"; g.fillRect(x + 14, y + 3, 52, 27);
  for (let i = 0; i < 6; i++) for (const kx of [x + 5, x + 69]) { g.fillStyle = "#101216"; g.fillRect(kx, y + 6.2 + i * 4, 6, 2.2); line(g, kx + 1.5, y + 7.3 + i * 4, kx + 4.5, y + 7.3 + i * 4, 0.3, ink(body, 0.8)); }
  const end = game.airport.runways.flatMap((rw) => rw.ends).find((e) => e.ident === game.approach.ident);
  const row = (i: number, left: string, right: string, color: string) => { text(g, left, x + 15, y + 9.2 + i * 4, 2.3, color, "left", MONO, 600); text(g, right, x + 65, y + 9.2 + i * 4, 2.3, color, "right", MONO, 600); };
  text(g, "FROM", x + 15, y + 5.2, 2, WHITE, "left", MONO); text(g, "TFY320", x + 65, y + 5.2, 2.3, WHITE, "right", MONO, 600);
  if (end) {
    const P = game.P, h = (end.headingGridDeg * Math.PI) / 180, nm = NM / t.cell;
    const before = ((end.x - P.x) * Math.sin(h) - (end.y - P.y) * Math.cos(h)) / nm, dist = (Math.hypot(end.x - P.x, end.y - P.y) * t.cell) / NM;
    const eta = new Date(game.time + ((dist * NM) / Math.max(P.spd, 30)) * 1000), hhmm = `${pad(eta.getUTCHours(), 2)}${pad(eta.getUTCMinutes(), 2)}`;
    // veipunktene som ligger foran flyet, det neste i hvitt
    const ahead = [[8, `CF${end.ident}`], [4, `FF${end.ident}`], [0, game.airport.icao + end.ident]].filter(([d]) => before > (d as number) || d === 0) as [number, string][];
    ahead.forEach(([d, name], i) => row(i, name, `${(Math.max(0, before - d)).toFixed(1)} NM`, i === 0 ? WHITE : GREEN));
    row(4, "DEST", "UTC  DIST", WHITE); row(5, game.airport.icao + end.ident, `${hhmm}  ${dist.toFixed(1)}`, GREEN);
  }
  // tastatur: sidetaster, bokstaver og tall
  ["DIR", "PROG", "PERF", "INIT", "DATA", "F-PLN"].forEach((s, i) => key(g, x + 6 + i * 11.6, y + 33, 10, 4.2, s, body, false, 1.3));
  for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) {
    const numeric = c < 3, ch = numeric ? (r < 3 ? String(r * 3 + c + 1) : r === 3 ? [".", "0", "+/-"][c] : ["", "", ""][c]) : "ABCDEFGHIJKLMNOPQRSTUVWXYZ/ <"[r * 6 + c - 3];
    if (ch === undefined || ch === "") continue;
    key(g, x + 6 + c * 7.7 + (numeric ? 0 : 1.6), y + 39.4 + r * 5.1, numeric ? 6.4 : 6, 4.1, ch.trim(), body, false, 1.5);
  }
}

/** Radiopanel: aktiv og ventende frekvens, og valg av radio. Viser streker: spillet har ingen frekvenser. */
function radio(g: G2D, x: number, y: number, body: number): void {
  plate(g, x, y, 80, 24, body, 62, 70, 80);
  text(g, "ACTIVE", x + 18, y + 3, 1.3, ink(body)); text(g, "STBY/CRS", x + 62, y + 3, 1.3, ink(body));
  lcd(g, x + 6, y + 4.6, 24, 6, "---.---"); lcd(g, x + 50, y + 4.6, 24, 6, "---.---");
  key(g, x + 34.6, y + 5, 10.8, 5.2, "<->", body, true, 1.8);
  ["VHF1", "VHF2", "VHF3", "HF1", "HF2", "AM"].forEach((s, i) => key(g, x + 5 + i * 9.6, y + 14.4, 8.4, 4.4, s, body, i === 0, 1.3));
  knob(g, x + 70.4, y + 17, 3, body, 0.5);
}

/** Lydpanel: sendevalg og volum for hver radio. */
function audioPanel(g: G2D, x: number, y: number, body: number): void {
  plate(g, x, y, 80, 22, body, 62, 70, 80);
  ["VHF1", "VHF2", "VHF3", "HF1", "HF2", "INT", "CAB", "PA"].forEach((s, i) => {
    key(g, x + 4 + i * 9.2, y + 3.4, 7.6, 4.4, s, body, i === 0, 1.2);
    knob(g, x + 7.8 + i * 9.2, y + 14.4, 2.2, body, 0.4 + i * 0.3);
  });
}

export function drawPedestal(g: G2D, game: Game, t: Terrain): void {
  const body = panelLight(game), P = game.P, white = ink(body);
  g.save();
  backdrop(g, body);

  mcdu(g, 40, 4, game, t, body); mcdu(g, 200, 4, game, t, body);

  // mellom MCDU-ene: velgerne øverst, og ECAM-kontrollpanelet
  box(g, 124, 4, 72, 18, "SWITCHING", body);
  [["ATT HDG", 136], ["AIR DATA", 152], ["EIS DMC", 168], ["ECAM/ND", 184]].forEach(([n, x]) => selector(g, x as number, 14.4, n as string, "", body, 0, 2));
  box(g, 124, 24, 72, 46, "ECAM", body);
  knob(g, 131, 31.6, 2, body, 0.9); knob(g, 139, 31.6, 2, body, 0.9);
  key(g, 152, 28.6, 13, 5.6, "T.O CONFIG", body, false, 1.2); key(g, 170, 28.6, 13, 5.6, "EMER CANC", body, false, 1.2);
  // Sidetastene: ENG og WHEEL velger side på SD (lyser når de er valgt). Samme tast en gang til gir automatisk valg.
  ECAM_KEYS.forEach((names, r) => names.forEach((s, c) => {
    const page = s === "ENG" ? "eng" : s === "WHEEL" ? "wheel" : "";
    key(g, ECAM.x + c * ECAM.step, ECAM.y + r * 9.4, ECAM.w, ECAM.h, s, body, page !== "" && game.sys.sdPage === page, 1.4);
  }));
  ["CLR", "STS", "RCL", "", "", "CLR"].forEach((s, c) => { if (s) key(g, ECAM.x + c * ECAM.step, ECAM.y + 18.8, ECAM.w, ECAM.h, s, body, false, 1.4); });

  radio(g, 40, 72, body); radio(g, 200, 72, body);
  audioPanel(g, 40, 98, body); audioPanel(g, 200, 98, body);

  // gasshåndtakene, med trimhjulene på hver side
  box(g, 124, 72, 72, 76, "", body);
  for (const wx of [128, 186]) {
    g.fillStyle = "#0c0d10"; g.beginPath(); g.roundRect(wx, 78, 6, 64, 2); g.fill();
    for (let wy = 80; wy < 141; wy += 2.2) line(g, wx + 0.6, wy, wx + 5.4, wy, 0.3, shade(70, 74, 80, Math.max(body, 0.5)));
    line(g, wx, 108, wx + 6, 108, 0.8, WHITE);
    text(g, "UP", wx + 3, 75.6, 1.3, white); text(g, "DN", wx + 3, 144.6, 1.3, white);
  }
  const yAt = (f: number) => THR.bottom - f * (THR.bottom - THR.top), ty = yAt(P.thr);
  for (const [f, name] of [[1, "TO GA"], [0.84, "FLX MCT"], [0.66, "CL"], [0, "0"]] as const) {
    line(g, THR.x - 12, yAt(f), THR.x + 12, yAt(f), 0.3, shade(180, 184, 190, Math.max(body, 0.5)));
    text(g, name, THR.x - 13, yAt(f), 1.8, white, "right"); text(g, name, THR.x + 13, yAt(f), 1.8, white, "left");
  }
  text(g, "A/THR", THR.x, 79.4, 1.3, white);
  for (const s of [-1, 1]) {
    const lx = THR.x + s * 5;
    g.fillStyle = "#06070a"; g.fillRect(lx - 1.4, THR.top - 3, 2.8, THR.bottom - THR.top + 8);
    g.fillStyle = shade(170, 174, 180, Math.max(body, 0.5)); g.fillRect(lx - 0.8, ty, 1.6, THR.bottom + 4 - ty);
    const grip = g.createLinearGradient(0, ty - 4, 0, ty + 4);
    grip.addColorStop(0, shade(104, 106, 112, Math.max(body, 0.5))); grip.addColorStop(1, "#141518");
    g.fillStyle = grip; g.beginPath(); g.roundRect(lx - 4, ty - 4, 8, 8, 2); g.fill();
    g.fillStyle = "#b3261c"; g.beginPath(); g.arc(lx + s * 5, ty, 1, 0, 7); g.fill();
    text(g, s < 0 ? "1" : "2", lx, ty, 2.4, white, "center", SANS, 700);
  }

  // værradar til venstre, transponder og TCAS til høyre
  box(g, 40, 122, 80, 26, "WX RADAR", body);
  toggle(g, 52, 140, "SYS", body, false, ["1", "OFF"]); selector(g, 72, 138, "GAIN", "CAL", body, 0); selector(g, 90, 138, "TILT", "0", body, 0.3); selector(g, 108, 138, "MODE", "WX", body, -0.4);
  box(g, 200, 122, 80, 26, "ATC / TCAS", body);
  lcd(g, 206, 128.4, 15, 5.6, "2000"); toggle(g, 212, 142.4, "", body, true, ["AUTO", "STBY"]);
  selector(g, 238, 139, "ALT RPTG", "ON", body, 0, 2.4);
  // TCAS-velgeren: STBY skjuler trafikken på ND og tier. TA er trafikkvarsel uten unnvikelsesordre.
  selector(g, TCAS_KNOB.x, TCAS_KNOB.y, "TCAS", game.sys.tcasStandby ? "STBY" : "TA", body, game.sys.tcasStandby ? -0.9 : 0, 3);
  text(g, "STBY", TCAS_KNOB.x - 6.4, TCAS_KNOB.y - 3.4, 1.1, ink(body, 0.8)); text(g, "TA", TCAS_KNOB.x, TCAS_KNOB.y - 5, 1.1, ink(body, 0.8)); text(g, "TA/RA", TCAS_KNOB.x + 6.8, TCAS_KNOB.y - 3.4, 1.1, ink(body, 0.8));

  // motorbryterne i midten nederst
  box(g, 124, 150, 72, 28, "ENG", body);
  toggle(g, 138, 166, "MASTER 1", body, true); toggle(g, 182, 166, "MASTER 2", body, true);
  selector(g, 160, 165, "MODE", "NORM", body, 0, 3); text(g, "CRANK", 152.6, 160.4, 1.1, ink(body, 0.8)); text(g, "IGN START", 169.4, 160.4, 1.1, ink(body, 0.8));
  box(g, 124, 180, 72, 17, "", body);
  // Parkeringsbremsen: kan settes når flyet står stille etter landing. Da er turen over.
  text(g, "PARK BRK", 140, 183.4, 1.4, white); knob(g, PARK.x, PARK.y, 3.4, body, P.parked ? 1.2 : -1.2); text(g, "OFF", 132.6, 190, 1.2, ink(body, 0.8)); text(g, "ON", 147.6, 190, 1.2, ink(body, 0.8));
  text(g, "RUD TRIM", 176, 183.4, 1.4, white); lcd(g, 163, 187, 11, 5, "0.0", GREEN); knob(g, 184, 190, 3, body, 0);

  // luftbremsen til venstre: håndtaket armerer bakkespoilerne når det er trukket opp (hvitt bånd), sporet slår luftbremsen ut
  box(g, 40, 150, 80, 47, "SPEED BRAKE", body);
  g.fillStyle = "#06070a"; g.fillRect(SPD.x - 1.6, SPD.top - 2, 3.2, SPD.bottom - SPD.top + 5);
  for (const [f, name] of [[0, "RET"], [0.5, "1/2"], [1, "FULL"]] as const) {
    const sy = SPD.top + f * (SPD.bottom - SPD.top);
    line(g, SPD.x + 3, sy, SPD.x + 7, sy, 0.3, white); text(g, name, SPD.x + 8.4, sy, 1.8, white, "left");
  }
  const sy = SPD.top + P.brake * (SPD.bottom - SPD.top) - (P.spoilersArmed && P.brake < 0.05 ? 2.4 : 0);
  const sg = g.createLinearGradient(0, sy - 3, 0, sy + 3);
  sg.addColorStop(0, shade(150, 154, 160, Math.max(body, 0.5))); sg.addColorStop(1, shade(70, 73, 79, Math.max(body, 0.5)));
  g.fillStyle = sg; g.beginPath(); g.roundRect(SPD.x - 7, sy - 3, 14, 6, 2); g.fill();
  if (P.spoilersArmed) { g.fillStyle = WHITE; g.fillRect(SPD.x - 7, sy + 3, 14, 1); }
  text(g, "GND SPLRS", 60, 164, 1.5, white); text(g, P.spoilersArmed ? "ARMED" : "NOT ARMED", 60, 167.4, 1.6, P.spoilersArmed ? GREEN : AMBER, "center", SANS, 700);

  // klaffspaken til høyre
  box(g, 200, 150, 80, 47, "FLAPS", body);
  g.fillStyle = "#06070a"; g.fillRect(FLAP.x - 1.6, FLAP.top - 2, 3.2, FLAP.bottom - FLAP.top + 4);
  FLAP_NAMES.forEach((n, c) => {
    const fy = FLAP.top + (c / 4) * (FLAP.bottom - FLAP.top);
    line(g, FLAP.x + 3, fy, FLAP.x + 7, fy, 0.3, white); text(g, n, FLAP.x + 8.4, fy, 2, white, "left");
  });
  const fy = FLAP.top + (P.flapCfg / 4) * (FLAP.bottom - FLAP.top), fg = g.createLinearGradient(0, fy - 3, 0, fy + 3);
  fg.addColorStop(0, shade(150, 154, 160, Math.max(body, 0.5))); fg.addColorStop(1, shade(70, 73, 79, Math.max(body, 0.5)));
  g.fillStyle = fg; g.beginPath(); g.roundRect(FLAP.x - 7, fy - 3, 14, 6, 2); g.fill();
  g.restore();
}

/** Hva som kan betjenes på midtkonsollen i punktet (lx, ly), eller null. Koordinater som for panelHit. */
export function pedestalHit(lx: number, ly: number): PanelControl | null {
  for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) {
    const name = ECAM_KEYS[r][c], x = ECAM.x + c * ECAM.step, y = ECAM.y + r * 9.4;
    if ((name === "ENG" || name === "WHEEL") && lx >= x && lx <= x + ECAM.w && ly >= y && ly <= y + ECAM.h) return { kind: "sdPage", page: name === "ENG" ? "eng" : "wheel" };
  }
  if (Math.hypot(lx - TCAS_KNOB.x, ly - TCAS_KNOB.y) <= 4.4) return { kind: "tcasMode" };
  if (Math.hypot(lx - PARK.x, ly - PARK.y) <= 4.6) return { kind: "parkBrake" };
  if (Math.abs(lx - THR.x) <= 11 && ly >= THR.top - 5 && ly <= THR.bottom + 5) return { kind: "thrust", thr: pedestalThrustAt(ly) };
  if (Math.abs(lx - SPD.x) <= 8 && ly >= SPD.top - 6 && ly <= SPD.bottom + 4) {
    // øverst i sporet, der håndtaket står når luftbremsen er inne: armering. Lenger ned: luftbremsen ut eller inn.
    return ly <= SPD.top + 4 ? { kind: "spoilersArm" } : { kind: "speedBrake" };
  }
  if (Math.abs(lx - FLAP.x - 4) <= 12 && ly >= FLAP.top - 4 && ly <= FLAP.bottom + 4) return { kind: "flaps", cfg: Math.round(clamp((ly - FLAP.top) / (FLAP.bottom - FLAP.top), 0, 1) * 4) };
  return null;
}
