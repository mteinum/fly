/* Instrumentpanel for cockpit: Airbus A320 hovedinstrumentpanel (glasscockpit), forenklet.
 *
 *   varsellys  EFIS  [ FCU på blendingsskjermen ]  EFIS  varsellys
 *   PFD  ND   reserve/klokke   E/WD   understell   ND  PFD
 *   bord og luftrister   luftbrems, gass   SD   klaff   bord og luftrister
 *
 * Tegnes i 320 x 200 logiske enheter (main.ts skalerer). Hver skjerm tegnes i egne 100 x 100 enheter.
 * Oppsettet følger hovedpanelet i flyet, med to avvik: de to ECAM-skjermene i midten er mindre enn PFD og ND
 * (i flyet er alle seks like store), og spakene fra midtkonsollen står på hver side av den nedre, fordi
 * konsollen ellers ikke ville vært i bildet. All grafikk er tegnet her, ingenting er hentet fra bilder.
 *
 * Ekte verdier: fart, høyde, stigning, kurs, stilling, radiohøyde, avstand og peiling til flyplassen,
 * terrenget på ND (fra høydekartet), andre fly på ND (ADS-B, se traffic.ts), klokke, fartstrend,
 * klaffer, understell og luftbremser med varsler og landingsmemo, bakken på høydebåndet, og terrenget
 * som terrengvarselet (gpws.ts) reagerer på.
 * Syntetisk: motorverdiene (regnet fra gasshåndtaket, med et etterslep som er valgt, ikke målt), skyvegrensen,
 * memolinjene SIGNS/CABIN/SPLRS, drivstoffmengde, QNH, bremsetrykk, bremsetemperatur, vekt og lufttemperatur på SD, ALT-vinduet på FCU (høyden innflygingen
 * startet i, ikke en klarert høyde), og fartsmerkene VLS og alfa-vern (faste forhold til steilefarten).
 * Brytere og knapper uten funksjon i spillet er tegnet for at panelet skal ligne, og kan ikke betjenes.
 */
import { osloTime } from "./clock";
import type { Game } from "./game";
import { FLAP_NAMES, speedLimit, stallSpeed, verticalSpeed, warnings } from "./physics";
import type { Plane } from "./plane";
import { CAUTION_S, onApproachPath, requiredClearance, terrainAlert, type TerrainAlert, WARNING_S } from "./gpws";
import { guidance, type Guidance } from "./guidance";
import { H, OX, PANEL_TOP, TOP, W } from "./screen";
import type { Terrain } from "./terrain";

const KT = 1.943844, FT = 3.28084, NM = 1852, DEG = 180 / Math.PI;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const DU = 46; // skjermstørrelse i logiske enheter
const ECAM = 35.5; // de to ECAM-skjermene i midten er mindre, så begge får plass over hverandre
const ROW = 124;
const ND_RANGE_NM = 10;

// Airbus-fargene på skjermene
const GREEN = "#2fe04a", CYAN = "#35d6f0", AMBER = "#ffa218", MAGENTA = "#ff5cf4", YELLOW = "#ffe93b", RED = "#ff3030", WHITE = "#f2f2f2";
const TAPE = "#4d5157", SKY = "#2f93e0", EARTH = "#8a5a2c";

type G2D = CanvasRenderingContext2D;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const shade = (r: number, g: number, b: number, f: number): string => `rgb(${(r * f) | 0},${(g * f) | 0},${(b * f) | 0})`;
const pad = (v: number, n: number): string => String(Math.round(v)).padStart(n, "0");

function text(g: G2D, str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "center", font = SANS, weight = 500): void {
  g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = "middle";
  g.fillText(str, x, y);
}

function line(g: G2D, x0: number, y0: number, x1: number, y1: number, width: number, color: string): void {
  g.strokeStyle = color; g.lineWidth = width;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}

/** Hvor mørkt det er ute (0-1), satt av drawPanel. Om natta lyser teksten på panelet, som i flyet. */
let night = 0;
const ink = (body: number, f = 1): string => shade(235 * f, 235 * f, 235 * f, Math.max(body, 0.6 + 0.35 * night));
/** Tekst på blendingsskjermen: hvit om dagen, oransje lys om natta. */
const glareInk = (body: number): string => shade(235 + 20 * night, 235 - 60 * night, 235 - 170 * night, Math.max(body, 0.6 + 0.4 * night));
const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Skrue i panelplata. */
function screw(g: G2D, x: number, y: number, body: number): void {
  g.fillStyle = shade(58, 66, 76, body); g.beginPath(); g.arc(x, y, 0.55, 0, 7); g.fill();
  line(g, x - 0.35, y - 0.2, x + 0.35, y + 0.2, 0.15, shade(20, 22, 26, body));
}

/** Panelplate: egen flate med fuge rundt og skruer i hjørnene. */
function plate(g: G2D, x: number, y: number, w: number, h: number, body: number, r = 98, gr = 115, b = 131): void {
  g.fillStyle = shade(r, gr, b, body); g.beginPath(); g.roundRect(x, y, w, h, 1); g.fill();
  g.strokeStyle = shade(44, 52, 60, body); g.lineWidth = 0.3; g.stroke();
  for (const sx of [x + 1.3, x + w - 1.3]) for (const sy of [y + 1.3, y + h - 1.3]) screw(g, sx, sy, body);
}

/** Dreieknapp sett forfra, med viser (vinkel i radianer, 0 = rett opp). */
function knob(g: G2D, x: number, y: number, r: number, body: number, angle = 0, ring = false): void {
  const lum = Math.max(body, 0.5), k = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  k.addColorStop(0, shade(150, 154, 160, lum)); k.addColorStop(1, shade(46, 48, 54, lum));
  g.fillStyle = "#0a0b0d"; g.beginPath(); g.arc(x, y, r + 0.35, 0, 7); g.fill();
  g.fillStyle = k; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  line(g, x, y, x + Math.sin(angle) * r, y - Math.cos(angle) * r, 0.35, ink(body));
  // lysring rundt knappene på blendingsskjermen om natta
  if (ring && night > 0.05) { g.strokeStyle = `rgba(255,172,64,${0.85 * night})`; g.lineWidth = 0.3; g.beginPath(); g.arc(x, y, r + 0.8, Math.PI * 0.75, Math.PI * 2.25); g.stroke(); }
}

/** Trykknapp med tekst. `lit` tenner lysstripa øverst. */
function key(g: G2D, x: number, y: number, w: number, h: number, label: string, body: number, lit = false, size = 1.5, color = ink(body, 0.9)): void {
  g.fillStyle = "#0b0c0f"; g.beginPath(); g.roundRect(x, y, w, h, 0.4); g.fill();
  g.strokeStyle = shade(70, 76, 84, Math.max(body, 0.5)); g.lineWidth = 0.2; g.stroke();
  if (lit) { g.fillStyle = GREEN; g.fillRect(x + 0.8, y + 0.5, w - 1.6, 0.4); }
  text(g, label, x + w / 2, y + h / 2 + 0.3, size, color);
}

/** Varsellampe med tekst på én eller to linjer: lyser i fargen når den er på, ellers svakt. */
function lamp(g: G2D, x: number, y: number, w: number, h: number, label: string, color: string, on: boolean, size = 1.5): void {
  g.fillStyle = on ? color : "#0b0c0f"; g.beginPath(); g.roundRect(x, y, w, h, 0.4); g.fill();
  g.strokeStyle = "#3a3f47"; g.lineWidth = 0.2; g.stroke();
  const rows = label.split("\n");
  g.globalAlpha = on ? 1 : 0.45;
  rows.forEach((r, i) => text(g, r, x + w / 2, y + h / 2 + (i - (rows.length - 1) / 2) * size * 1.1 + 0.1, size, on ? "#000" : color, "center", SANS, 700));
  g.globalAlpha = 1;
}

/** Luftrist: mørk åpning med lameller. */
function grille(g: G2D, x: number, y: number, w: number, h: number, body: number): void {
  g.fillStyle = shade(24, 27, 32, Math.max(body, 0.4)); g.beginPath(); g.roundRect(x, y, w, h, 0.8); g.fill();
  for (let ly = y + 1.4; ly < y + h - 0.6; ly += 1.5) line(g, x + 1, ly, x + w - 1, ly, 0.45, shade(74, 86, 98, body));
}

/** Flydata i de enhetene skjermene bruker. */
interface Data {
  kt: number; altFt: number; vsFpm: number; pitch: number; roll: number; hdg: number; raFt: number;
  thr: number; arpNm: number; arpBearing: number;
  stallKt: number; limitKt: number; plane: Plane;
  /** Kurs- og glidebaneavvik mot banen det flys mot, eller null utenfor dekning. */
  ils: Guidance | null; runway: string;
  /** Røde varsler som gjelder nå. */
  warnings: string[];
  /** Det autopiloten holder, eller null når den er av. */
  ap: Game["apTarget"];
  /** Sann kurs for banen det flys mot (ILS-kursen på kursbåndet). */
  courseDeg: number;
  /** Høyden i ALT-vinduet på FCU (fot). */
  selAltFt: number;
  /** Farten om 10 s hvis akselerasjonen holder seg, som endring fra nå (kt). */
  trendKt: number;
  /** Motorenes turtall som andel 0-1. SYNTETISK: følger gasshåndtaket med etterslep. */
  eng: number;
  /** Høyeste tillatte fart i neste klaffstilling (kt), eller null med full klaff. */
  nextFlapKt: number | null;
  /** Stillingen flight director ber om (rad), eller null når den er av eller ikke har noe å vise. */
  fd: Game["fd"];
  /** Terrengvarselet som gjelder nå (se gpws.ts). */
  gpws: TerrainAlert | null;
}

/** Åpner en skjerm: ramme, svart flate, og koordinater 0-100 klippet til skjermen. */
function beginDisplay(g: G2D, x: number, y: number, size: number, body: number): void {
  g.fillStyle = shade(34, 38, 44, Math.max(body, 0.45));
  g.beginPath(); g.roundRect(x - 1.6, y - 1.6, size + 3.2, size + 3.2, 1.4); g.fill();
  g.strokeStyle = shade(120, 130, 142, body); g.lineWidth = 0.2; g.stroke();
  g.save();
  g.translate(x, y); g.scale(size / 100, size / 100);
  g.beginPath(); g.rect(0, 0, 100, 100); g.clip();
  g.fillStyle = "#020304"; g.fillRect(0, 0, 100, 100);
}

/* ---------- PFD: primært flygedisplay ---------- */

function attitudeBall(g: G2D, cx: number, cy: number, hw: number, r: number, d: Data, px: number): void {
  g.save();
  // Airbus-formen: sirkel kuttet rett av på sidene
  g.beginPath(); g.rect(cx - hw, cy - r, 2 * hw, 2 * r); g.clip();
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip();
  g.translate(cx, cy); g.rotate(-d.roll);
  g.save();
  g.translate(0, d.pitch * DEG * px); // nese opp: horisonten synker
  g.fillStyle = SKY; g.fillRect(-200, -400, 400, 400);
  g.fillStyle = EARTH; g.fillRect(-200, 0, 400, 400);
  line(g, -200, 0, 200, 0, 0.7, WHITE);
  // kursmerker på horisonten, ett per 10°
  for (let k = -4; k <= 4; k++) { const hx = ((Math.round(d.hdg / 10) + k) * 10 - d.hdg) * px; line(g, hx, 0, hx, 1.8, 0.5, WHITE); }
  for (let p = -30; p <= 30; p += 2.5) {
    if (p === 0) continue;
    const w = p % 10 === 0 ? 8 : p % 5 === 0 ? 4 : 2, y = -p * px;
    line(g, -w, y, w, y, 0.5, WHITE);
    if (p % 10 === 0) { text(g, String(Math.abs(p)), -w - 4, y, 4.4, WHITE); text(g, String(Math.abs(p)), w + 4, y, 4.4, WHITE); }
  }
  g.restore();
  // krengeindeks følger horisonten
  g.fillStyle = YELLOW;
  g.beginPath(); g.moveTo(0, -r + 3.2); g.lineTo(-2.4, -r + 7.2); g.lineTo(2.4, -r + 7.2); g.closePath(); g.fill();
  // sideglidning: står alltid i midten, flymodellen har ingen
  g.strokeStyle = YELLOW; g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(-2.7, -r + 7.9); g.lineTo(2.7, -r + 7.9); g.lineTo(3.4, -r + 9.6); g.lineTo(-3.4, -r + 9.6); g.closePath(); g.stroke();
  g.restore();
  // fast krengeskala
  for (const b of [-45, -30, -20, -10, 10, 20, 30, 45]) {
    const a = ((b - 90) * Math.PI) / 180, r0 = r - (Math.abs(b) % 30 === 0 ? 0 : 0.4), r1 = r + (Math.abs(b) === 30 || Math.abs(b) === 45 ? 3.4 : 2);
    line(g, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, 0.6, WHITE);
  }
  g.fillStyle = YELLOW;
  g.beginPath(); g.moveTo(cx, cy - r + 0.2); g.lineTo(cx - 2.2, cy - r - 3.4); g.lineTo(cx + 2.2, cy - r - 3.4); g.closePath(); g.fill();
  // fast flysymbol: svart med gul kant
  g.lineJoin = "miter";
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(cx + s * 19, cy - 1); g.lineTo(cx + s * 8, cy - 1); g.lineTo(cx + s * 8, cy + 4); g.lineTo(cx + s * 10, cy + 4); g.lineTo(cx + s * 10, cy + 1); g.lineTo(cx + s * 19, cy + 1); g.closePath();
    g.fillStyle = "#000"; g.fill(); g.strokeStyle = YELLOW; g.lineWidth = 0.6; g.stroke();
  }
  g.fillStyle = "#000"; g.fillRect(cx - 1.1, cy - 1.1, 2.2, 2.2); g.strokeStyle = YELLOW; g.lineWidth = 0.5; g.strokeRect(cx - 1.1, cy - 1.1, 2.2, 2.2);
}

function pfd(g: G2D, x: number, y: number, d: Data, body: number): void {
  beginDisplay(g, x, y, DU, body);
  const CY = 52, TOP = 26, BOT = 78;

  // FMA: fem kolonner, som i flyet. Med flight director (D) står modiene den veileder etter, med autopiloten (A)
  // også SPEED, AP1 og A/THR. Uten noen av dem er feltet tomt.
  const guided = d.ap !== null || d.fd !== null, land = guided && d.raFt < 400;
  for (const fx of [20, 40, 60, 80]) if (!(land && fx === 40)) line(g, fx, 2, fx, 16, 0.4, WHITE);
  if (guided) {
    if (land) text(g, d.raFt < 40 ? "FLARE" : "LAND", 40, 5.2, 4, GREEN);
    else { text(g, "G/S", 30, 5.2, 4, GREEN); text(g, "LOC", 50, 5.2, 4, GREEN); }
  }
  if (d.ap) { text(g, "SPEED", 10, 5.2, 4, GREEN); text(g, "AP1", 90, 4.6, 3.8, WHITE); text(g, "A/THR", 90, 13.6, 3.6, WHITE); }
  if (d.fd) text(g, "1FD2", 90, 9.1, 3.6, WHITE);

  attitudeBall(g, 46, CY, 21, 25, d, 1.9);
  // Flight director: to grønne streker som viser stillingen autopiloten ville holdt. Fly så de krysser midt i flysymbolet.
  // Den vannrette går opp når nesa skal opp, den loddrette til høyre når flyet skal krenge mer mot høyre.
  if (d.fd) {
    const fy = CY - clamp((d.fd.pitch - d.pitch) * DEG * 1.9, -15, 15), fx = 46 + clamp((d.fd.bank - d.roll) * DEG * 0.55, -15, 15);
    line(g, 33, fy, 59, fy, 0.9, GREEN); line(g, fx, CY - 13, fx, CY + 13, 0.9, GREEN);
  }
  if (d.raFt < 2500) text(g, String(Math.round(d.raFt / (d.raFt < 50 ? 1 : 10)) * (d.raFt < 50 ? 1 : 10)), 46, 74.6, 5.6, d.raFt < 400 ? AMBER : GREEN, "center", SANS, 600);

  // Kurs- og glidebaneviser (magenta rombe) mot faste merker: fly MOT romben.
  // Syntetisk: regnet fra banegeometrien, se guidance.ts.
  const DOT = 6.2, gx = 69.2, ly = 80.2;
  g.fillStyle = WHITE;
  for (const k of [-2, -1, 1, 2]) {
    g.beginPath(); g.arc(gx, CY + k * DOT, 0.75, 0, 7); g.fill();
    g.beginPath(); g.arc(46 + k * DOT, ly, 0.75, 0, 7); g.fill();
  }
  line(g, gx - 1.6, CY, gx + 1.6, CY, 0.7, YELLOW);
  line(g, 46, ly - 1.6, 46, ly + 1.6, 0.7, YELLOW);
  if (d.ils) {
    const diamond = (x: number, y: number, pegged: boolean) => {
      g.beginPath(); g.moveTo(x, y - 2.3); g.lineTo(x + 1.7, y); g.lineTo(x, y + 2.3); g.lineTo(x - 1.7, y); g.closePath();
      g.strokeStyle = MAGENTA; g.lineWidth = 0.6;
      if (pegged) g.stroke(); else { g.fillStyle = MAGENTA; g.fill(); } // hul rombe = utenfor skalaen
    };
    // over glidebanen: romben står under midten. Til høyre for linja: romben står til venstre.
    diamond(gx, CY + clamp(d.ils.glideDots, -2.2, 2.2) * DOT, Math.abs(d.ils.glideDots) > 2.2);
    diamond(46 - clamp(d.ils.courseDots, -2.2, 2.2) * DOT, ly, Math.abs(d.ils.courseDots) > 2.2);
    text(g, `RWY ${d.runway}`, 2, 86.5, 3.8, MAGENTA, "left");
    text(g, `${(d.ils.distanceM / NM).toFixed(1)} NM`, 2, 91.5, 3.8, MAGENTA, "left");
  }

  // fartsbånd
  g.save();
  g.beginPath(); g.rect(2, TOP, 22, BOT - TOP); g.clip();
  g.fillStyle = TAPE; g.fillRect(4, TOP, 15, BOT - TOP);
  const kpx = 0.62, ys = (v: number) => CY - (v - d.kt) * kpx;
  for (let v = Math.max(30, Math.floor((d.kt - 45) / 10) * 10); v <= d.kt + 45; v += 10) {
    line(g, 16, ys(v), 19, ys(v), 0.5, WHITE);
    if (v % 20 === 0) text(g, String(v), 15, ys(v), 5.4, WHITE, "right");
  }
  const stall = d.stallKt, vmax = d.limitKt;
  g.fillStyle = RED; g.fillRect(19.6, ys(stall), 1.8, 200); // under steilefart
  // SYNTETISK: VLS (laveste valgbare fart) og alfa-vern som faste forhold til steilefarten
  const vls = stall * 1.23, prot = stall * 1.1;
  g.strokeStyle = AMBER; g.lineWidth = 0.4; g.strokeRect(19.8, ys(vls), 0.9, ys(prot) - ys(vls));
  for (let v = stall; v < prot; v += 1.5) { g.fillStyle = Math.round((v - stall) / 1.5) % 2 ? "#000" : AMBER; g.fillRect(19.6, ys(Math.min(v + 1.5, prot)), 1.8, ys(v) - ys(Math.min(v + 1.5, prot))); }
  for (let v = vmax; v < vmax + 80; v += 3) { g.fillStyle = (v / 3) % 2 < 1 ? RED : "#000"; g.fillRect(19.6, ys(v + 3), 1.8, ys(v) - ys(v + 3)); } // over maksfart
  // grensen for neste klaffstilling: to gule streker
  if (d.nextFlapKt !== null) for (const o of [-0.6, 0.6]) line(g, 19.6, ys(d.nextFlapKt) + o, 22.6, ys(d.nextFlapKt) + o, 0.4, AMBER);
  // fartstrend: pil til farten om 10 s
  if (Math.abs(d.trendKt) > 2) {
    const ty = ys(d.kt + d.trendKt), s = Math.sign(CY - ty);
    line(g, 17.6, CY, 17.6, ty + s * 1.6, 0.6, YELLOW);
    g.fillStyle = YELLOW; g.beginPath(); g.moveTo(17.6, ty); g.lineTo(16.5, ty + s * 2); g.lineTo(18.7, ty + s * 2); g.closePath(); g.fill();
  }
  // farten autopiloten holder: magenta trekant
  if (d.ap) { const ty = clamp(ys(d.ap.speedKt), TOP + 1, BOT - 1); g.fillStyle = MAGENTA; g.beginPath(); g.moveTo(19.6, ty); g.lineTo(23.6, ty - 2); g.lineTo(23.6, ty + 2); g.closePath(); g.fill(); }
  g.restore();
  line(g, 4, TOP, 21, TOP, 0.5, WHITE); line(g, 4, BOT, 21, BOT, 0.5, WHITE);
  line(g, 2, CY, 21, CY, 0.8, YELLOW);
  g.fillStyle = YELLOW; g.beginPath(); g.moveTo(21, CY); g.lineTo(24, CY - 1.8); g.lineTo(24, CY + 1.8); g.closePath(); g.fill();

  // høydebånd
  g.save();
  g.beginPath(); g.rect(72, TOP, 16, BOT - TOP); g.clip();
  g.fillStyle = TAPE; g.fillRect(72, TOP, 14, BOT - TOP);
  const fpx = 0.026, ya = (a: number) => CY - (a - d.altFt) * fpx;
  for (let a = Math.floor((d.altFt - 1100) / 100) * 100; a <= d.altFt + 1100; a += 100) {
    line(g, 72, ya(a), 74.2, ya(a), 0.5, WHITE);
    if (a % 500 === 0) text(g, pad(Math.abs(a) / 100, 3), 85, ya(a), 4.8, WHITE, "right");
  }
  // bakken under flyet, fra radiohøyden: rødt bånd langs kanten
  if (d.raFt < 570) { g.fillStyle = RED; g.fillRect(86, ya(d.altFt - d.raFt), 1.6, 200); }
  // høyden i ALT-vinduet på FCU: blå ramme på båndet, eller tallet over/under når den er utenfor
  const sy = ya(d.selAltFt);
  g.strokeStyle = CYAN; g.lineWidth = 0.6; g.strokeRect(72.4, sy - 6.4, 13.4, 12.8);
  g.restore();
  line(g, 72, TOP, 88, TOP, 0.5, WHITE); line(g, 72, BOT, 88, BOT, 0.5, WHITE);
  if (sy < TOP || sy > BOT) text(g, String(d.selAltFt), 88, sy < TOP ? TOP - 3 : BOT + 3, 4.2, CYAN, "right");
  // avlesning: hundrere stort, de to siste sifrene i eget, høyere felt til høyre
  const a20 = Math.round(d.altFt / 20) * 20;
  g.beginPath(); g.moveTo(69.5, CY - 4.6); g.lineTo(82.6, CY - 4.6); g.lineTo(82.6, CY - 7); g.lineTo(90.4, CY - 7); g.lineTo(90.4, CY + 7); g.lineTo(82.6, CY + 7); g.lineTo(82.6, CY + 4.6); g.lineTo(69.5, CY + 4.6); g.closePath();
  g.fillStyle = "#000"; g.fill(); g.strokeStyle = YELLOW; g.lineWidth = 0.6; g.stroke();
  text(g, `${a20 < 0 ? "-" : ""}${Math.floor(Math.abs(a20) / 100)}`, 82.4, CY + 0.2, 6.6, GREEN, "right", SANS, 600);
  text(g, pad(Math.abs(a20) % 100, 2), 90, CY + 0.3, 4.8, GREEN, "right", SANS, 600);
  text(g, "QNH", 73, 90, 3.8, WHITE, "left"); text(g, "1013", 82, 90, 4.4, CYAN, "left");

  // variometer
  g.fillStyle = TAPE; g.beginPath(); g.moveTo(91.5, 30); g.lineTo(95.5, 30); g.lineTo(99, 40); g.lineTo(99, 64); g.lineTo(95.5, 74); g.lineTo(91.5, 74); g.closePath(); g.fill();
  for (const v of [-2, -1, 1, 2]) { line(g, 91.5, CY - v * 9.5, 93.6, CY - v * 9.5, 0.5, WHITE); text(g, String(Math.abs(v)), 90.4, CY - v * 9.5, 3.4, WHITE, "right"); }
  line(g, 91.5, CY, 94.5, CY, 0.8, YELLOW);
  const vy = CY - clamp(d.vsFpm / 1000, -2.3, 2.3) * 9.5;
  line(g, 99.5, CY, 92.4, vy, 0.9, GREEN);
  if (Math.abs(d.vsFpm) > 200) {
    g.fillStyle = "#000"; g.fillRect(92.6, vy + (d.vsFpm > 0 ? -6.4 : 1.6), 7, 4.8);
    text(g, pad(Math.abs(d.vsFpm) / 100, 2), 96.1, vy + (d.vsFpm > 0 ? -4 : 4), 4.2, Math.abs(d.vsFpm) > 6000 ? AMBER : GREEN);
  }

  // kursbånd
  g.save();
  g.beginPath(); g.rect(22, 86, 48, 11); g.clip();
  g.fillStyle = TAPE; g.fillRect(22, 88, 48, 9);
  const hpx = 1.15;
  for (let h = Math.floor(d.hdg / 5) * 5 - 25; h <= d.hdg + 25; h += 5) {
    const hx = 46 + (h - d.hdg) * hpx, n = ((h % 360) + 360) % 360;
    line(g, hx, 88, hx, n % 10 === 0 ? 90.6 : 89.4, 0.5, WHITE);
    if (n % 10 === 0) text(g, String(n / 10), hx, 93.8, n % 30 === 0 ? 5 : 4, WHITE);
  }
  g.restore();
  line(g, 22, 88, 70, 88, 0.5, WHITE);
  line(g, 46, 83.5, 46, 89.5, 0.9, YELLOW);
  // banens kurs (ILS-kursen): magenta dolk på båndet, eller tallet i kanten når den er utenfor
  if (d.ils) {
    const rel = wrap180(d.courseDeg - d.hdg), cx = 46 + rel * hpx;
    if (Math.abs(rel) < 20) { line(g, cx, 84.4, cx, 89.6, 0.6, MAGENTA); line(g, cx - 1.5, 86, cx + 1.5, 86, 0.6, MAGENTA); }
    else text(g, pad(d.courseDeg, 3), rel < 0 ? 26.5 : 65.5, 85.6, 3.4, MAGENTA);
  }
  g.restore();
}

/* ---------- ND: navigasjonsdisplay i buemodus med terreng ---------- */

function nd(g: G2D, x: number, y: number, d: Data, t: Terrain, game: Game, body: number): void {
  beginDisplay(g, x, y, DU, body);
  const AX = 50, AY = 84, R = 64; // flyets plass og radius for ytterste bue (= ND_RANGE_NM)
  const P = game.P, sinH = Math.sin(P.hdg), cosH = Math.cos(P.hdg), unit = (ND_RANGE_NM * NM) / R / t.cell; // celler per skjermenhet
  // skjerm (til høyre, forover) -> rutenett. Kartet er rutenettkurs opp; forskjellen fra sann kurs er 6° og ses ikke her.
  const toGrid = (rx: number, fy: number): [number, number] => [P.x + (rx * cosH + fy * sinH) * unit, P.y - (-rx * sinH + fy * cosH) * unit];
  const toScreen = (gx: number, gy: number): [number, number] => {
    const e = (gx - P.x) / unit, n = -(gy - P.y) / unit;
    return [AX + e * cosH - n * sinH, AY - (e * sinH + n * cosH)];
  };

  // Terreng slik EGPWS tegner det: prikker på svart, tettere jo høyere terrenget er i forhold til flyet.
  // Tett rødt: mer enn 2000 fot over flyet. Tett gult: 1000-2000 over. Spredt gult: fra 500 fot under (250 med
  // understellet nede) til 1000 over. Tett grønt: ned til 1000 under. Spredt grønt: 1000-2000 under.
  // Lavere terreng vises ikke. Sjøen er spredte blå prikker. Prikkene står fast på skjermen; terrenget flytter seg under.
  const STEP = 1.6, altM = P.alt, vs = verticalSpeed(P), near = P.gear >= 1 ? -250 : -500;
  for (let sy = 18, row = 0; sy < AY + 6; sy += STEP, row++) for (let sx = 0, col = 0; sx < 100; sx += STEP, col++) {
    const rx = sx + STEP / 2 - AX, fy = AY - (sy + STEP / 2);
    if (rx * rx + fy * fy > R * R) continue;
    const [gx, gy] = toGrid(rx, fy);
    if (!t.inBounds(gx, gy)) continue;
    // Terrengvarsel: terrenget foran som flyets bane går for nær, er helfarget. Gult først, rødt når det haster.
    if (d.gpws && fy > 0 && Math.abs(rx) < 4 + 0.12 * fy) {
      const s = (fy * unit * t.cell) / P.spd, ground = Math.max(0, t.heightAt(gx, gy));
      if (s <= CAUTION_S && altM + vs * s < ground + requiredClearance(t, game.airport, gx, gy) && !onApproachPath(t, game.airport, gx, gy, altM + vs * s)) {
        g.fillStyle = s <= WARNING_S ? "#ff2a2a" : "#ffb300"; g.fillRect(sx, sy, STEP, STEP);
        continue;
      }
    }
    let c: string, dense = true;
    if (t.isWater(gx, gy)) { c = "#157a9c"; dense = false; }
    else {
      const rel = (t.heightAt(gx, gy) - altM) * FT;
      if (rel > 2000) c = "#c82020"; else if (rel > 1000) c = "#b8960f"; else if (rel > near) { c = "#b8960f"; dense = false; }
      else if (rel > -1000) c = "#1e8a34"; else if (rel > -2000) { c = "#1e8a34"; dense = false; } else continue;
    }
    if (!dense && (row + col) % 2) continue;
    g.fillStyle = c; g.fillRect(sx + 0.45, sy + 0.45, 0.7, 0.7);
  }

  // avstandsbuer
  g.setLineDash([2, 2]);
  for (const f of [0.25, 0.5, 0.75]) { g.strokeStyle = WHITE; g.lineWidth = 0.35; g.beginPath(); g.arc(AX, AY, R * f, Math.PI * 1.13, Math.PI * 1.87); g.stroke(); }
  g.setLineDash([]);
  for (const s of [-1, 1]) text(g, String(ND_RANGE_NM / 2), AX + s * R * 0.5 * 0.86, AY - R * 0.5 * 0.42, 4, CYAN);
  // kompassbue
  g.strokeStyle = WHITE; g.lineWidth = 0.6; g.beginPath(); g.arc(AX, AY, R, Math.PI * 1.13, Math.PI * 1.87); g.stroke();
  for (let h = Math.floor(d.hdg / 5) * 5 - 60; h <= d.hdg + 60; h += 5) {
    const rel = h - d.hdg;
    if (Math.abs(rel) > 62) continue;
    const a = ((rel - 90) * Math.PI) / 180, n = ((h % 360) + 360) % 360, len = n % 10 === 0 ? 3 : 1.6;
    line(g, AX + Math.cos(a) * R, AY + Math.sin(a) * R, AX + Math.cos(a) * (R + len), AY + Math.sin(a) * (R + len), 0.5, WHITE);
    if (n % 10 === 0) text(g, String(n / 10), AX + Math.cos(a) * (R + 6.6), AY + Math.sin(a) * (R + 6.6), n % 30 === 0 ? 4.6 : 3.2, WHITE);
  }
  line(g, AX, AY - R - 4, AX, AY - R + 2, 0.9, YELLOW);

  // Innflygingen tegnet som en flygeplan: grønn linje langs forlenget senterlinje, 10 NM ut fra baneenden,
  // med et merke per NM. SYNTETISK: veipunktene CF og FF (8 og 4 NM ute) er satt her for at bildet skal ligne;
  // de finnes ikke i noen prosedyre for flyplassen.
  const end = game.airport.runways.flatMap((rw) => rw.ends).find((e) => e.ident === game.approach.ident);
  if (end) {
    const h = (end.headingGridDeg * Math.PI) / 180, nm = NM / t.cell;
    const out = (d: number, side = 0): [number, number] => toScreen(end.x - Math.sin(h) * d * nm + Math.cos(h) * side * nm, end.y + Math.cos(h) * d * nm + Math.sin(h) * side * nm);
    line(g, ...out(0), ...out(10), 0.6, GREEN);
    for (let d = 1; d <= 10; d++) line(g, ...out(d, -0.1), ...out(d, 0.1), 0.4, GREEN);
    for (const [dist, name] of [[8, "CF"], [4, "FF"]] as const) {
      const [wx, wy] = out(dist);
      g.fillStyle = "#020304"; g.strokeStyle = GREEN; g.lineWidth = 0.5;
      g.beginPath(); g.moveTo(wx, wy - 2); g.lineTo(wx + 2, wy); g.lineTo(wx, wy + 2); g.lineTo(wx - 2, wy); g.closePath(); g.fill(); g.stroke();
      text(g, name + end.ident, wx + 3, wy - 2.4, 3.6, GREEN, "left");
    }
  }

  // flyplass og rullebane
  for (const rw of game.airport.runways) {
    const [ax, ay] = toScreen(rw.ends[0].x, rw.ends[0].y), [bx, by] = toScreen(rw.ends[1].x, rw.ends[1].y);
    line(g, ax, ay, bx, by, 1.6, WHITE); line(g, ax, ay, bx, by, 0.7, "#000");
  }
  const [px, py] = toScreen(game.airport.arp.x, game.airport.arp.y);
  if (Math.hypot(px - AX, py - AY) < R) {
    g.strokeStyle = MAGENTA; g.lineWidth = 0.6;
    g.beginPath(); for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 4; g.moveTo(px - Math.cos(a) * 2.4, py - Math.sin(a) * 2.4); g.lineTo(px + Math.cos(a) * 2.4, py + Math.sin(a) * 2.4); } g.stroke();
    text(g, game.airport.icao, px + 4, py - 3.4, 4, MAGENTA, "left");
  }

  // Andre fly, slik TCAS viser dem: rombe med høydeforskjell i hundre fot. Fylt når flyet er nær
  // (innen 6 NM og 1200 fot). Posisjonene er ekte (ADS-B); spillet gir ingen trafikkvarsler.
  for (const a of game.traffic) {
    const [tx, ty] = toScreen(a.x, a.y), rel = (a.alt - altM) * FT;
    if (Math.hypot(tx - AX, ty - AY) > R || ty < 16 || Math.abs(rel) > 9900) continue;
    g.beginPath(); g.moveTo(tx, ty - 2.2); g.lineTo(tx + 1.7, ty); g.lineTo(tx, ty + 2.2); g.lineTo(tx - 1.7, ty); g.closePath();
    g.strokeStyle = WHITE; g.lineWidth = 0.5; g.stroke();
    if (Math.hypot(a.x - P.x, a.y - P.y) * t.cell < 6 * NM && Math.abs(rel) < 1200) { g.fillStyle = WHITE; g.fill(); }
    text(g, `${rel < 0 ? "-" : "+"}${pad(Math.abs(rel) / 100, 2)}`, tx, ty + (rel < 0 ? 4.6 : -4.4), 3.2, WHITE);
  }

  // flysymbol
  line(g, AX, AY - 4, AX, AY + 5, 0.9, YELLOW); line(g, AX - 5, AY, AX + 5, AY, 0.9, YELLOW); line(g, AX - 2, AY + 4, AX + 2, AY + 4, 0.9, YELLOW);

  // datafelt
  g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(0, 0, 100, 13);
  text(g, "GS", 2, 4, 3.8, WHITE, "left"); text(g, String(Math.round(d.kt)), 9, 4, 4.6, GREEN, "left");
  text(g, "TAS", 19, 4, 3.8, WHITE, "left"); text(g, String(Math.round(d.kt)), 28, 4, 4.6, GREEN, "left");
  text(g, "---°/---", 2, 9.6, 4, GREEN, "left"); // vind: flymodellen har ingen
  text(g, game.airport.icao, 98, 4, 4.4, WHITE, "right");
  text(g, `${pad(d.arpBearing, 3)}°`, 78, 9.6, 4.4, GREEN, "right");
  text(g, d.arpNm.toFixed(1), 93, 9.6, 4.4, GREEN, "right"); text(g, "NM", 98, 9.8, 3.2, CYAN, "right");
  text(g, "TERR", 98, 96, 3.6, CYAN, "right");
  if (d.gpws) text(g, "TERR AHEAD", 98, 90.6, 4.4, d.gpws.level === "warning" ? RED : AMBER, "right", SANS, 700);
  g.restore();
}

/* ---------- E/WD: motor- og varseldisplay ---------- */

/** Rundt instrument med grønn viser. `marks` er tall langs skalaen, `cmd` (0-1) en blå ring der gasshåndtaket ber om å være. */
function arcGauge(g: G2D, cx: number, cy: number, r: number, frac: number, redFrom: number, marks: [number, string][] = [], cmd: number | null = null): void {
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.2, ang = (f: number) => a0 + sweep * f;
  g.strokeStyle = WHITE; g.lineWidth = 0.6; g.beginPath(); g.arc(cx, cy, r, ang(0), ang(redFrom)); g.stroke();
  g.strokeStyle = RED; g.lineWidth = 1.1; g.beginPath(); g.arc(cx, cy, r, ang(redFrom), ang(1)); g.stroke();
  for (const f of [0, 0.25, 0.5, 0.75]) line(g, cx + Math.cos(ang(f)) * (r - 1.6), cy + Math.sin(ang(f)) * (r - 1.6), cx + Math.cos(ang(f)) * r, cy + Math.sin(ang(f)) * r, 0.5, WHITE);
  for (const [f, s] of marks) text(g, s, cx + Math.cos(ang(f)) * (r - 3.6), cy + Math.sin(ang(f)) * (r - 3.6), 3.2, WHITE);
  if (cmd !== null) { g.strokeStyle = CYAN; g.lineWidth = 0.5; g.beginPath(); g.arc(cx + Math.cos(ang(cmd)) * (r + 1.5), cy + Math.sin(ang(cmd)) * (r + 1.5), 1, 0, 7); g.stroke(); }
  const a = ang(clamp(frac, 0, 1));
  line(g, cx, cy, cx + Math.cos(a) * (r + 1.4), cy + Math.sin(a) * (r + 1.4), 0.9, GREEN);
}

/** N1 (%) for en gasstilling 0-1. SYNTETISK. */
const n1At = (f: number): number => 19.5 + f * 80.5;

function ewd(g: G2D, x: number, y: number, size: number, d: Data, body: number): void {
  beginDisplay(g, x, y, size, body);
  // Syntetisk: alle motorverdier er regnet fra gasshåndtaket (med etterslep), like for begge motorer
  const e = d.eng, n1 = n1At(e), egt = 390 + e * 520, n2 = 59 + e * 41, ff = 320 + e * 2700;
  for (const cx of [22, 54]) {
    arcGauge(g, cx, 17, 11, n1 / 110, 0.92, [[50 / 110, "5"], [100 / 110, "10"]], n1At(d.thr) / 110);
    g.fillStyle = "#020304"; g.fillRect(cx + 0.5, 17.5, 15, 7);
    g.strokeStyle = "#8a8f96"; g.lineWidth = 0.4; g.strokeRect(cx + 0.5, 17.5, 15, 7);
    text(g, n1.toFixed(1), cx + 14.6, 21.2, 5.4, GREEN, "right", SANS, 600);
    arcGauge(g, cx, 44, 7.5, egt / 1000, 0.9);
    text(g, String(Math.round(egt)), cx + 9, 48.5, 5, GREEN, "right", SANS, 600);
    text(g, n2.toFixed(1), cx + 9, 58, 5, GREEN, "right", SANS, 600);
    text(g, String(Math.round(ff / 10) * 10), cx + 9, 66, 5, GREEN, "right", SANS, 600);
  }
  text(g, "N1", 39, 10, 4, WHITE); text(g, "%", 39, 14.4, 3.4, CYAN);
  text(g, "EGT", 39, 40, 4, WHITE); text(g, "°C", 39, 44.4, 3.4, CYAN);
  text(g, "N2", 39, 56.6, 4, WHITE); text(g, "%", 39, 60.4, 3.2, CYAN);
  text(g, "FF", 39, 64.6, 4, WHITE); text(g, "KG/H", 39, 68.4, 2.8, CYAN);
  for (const [ly, w] of [[58, 5], [66, 6]] as const) for (const s of [-1, 1]) line(g, 39 + s * w, ly, 39 + s * (w + 4), ly, 0.4, "#8a8f96");
  // Skyvegrense oppe til høyre: sperren gasshåndtaket står i eller under, og N1 der. SYNTETISK.
  const [mode, lim] = d.thr > 0.84 ? ["TOGA", 1] : d.thr > 0.66 ? ["MCT", 0.84] : ["CL", 0.66];
  text(g, mode, 74, 6, 4.4, CYAN, "left"); text(g, n1At(lim).toFixed(1), 97, 12, 4.6, GREEN, "right"); text(g, "%", 99.4, 12.2, 3, CYAN, "right");
  text(g, "FOB", 73, 27, 3.6, WHITE, "left"); text(g, "5400", 95, 27, 4.6, GREEN, "right"); text(g, "KG", 99.4, 27.3, 2.8, CYAN, "right");
  // Forkant- og bakkantklaffer: vingen i midten, S til venstre og F til høyre, hvite merker for stillingene.
  // Blå mens klaffene går, grønn når de står der spaken er.
  const P = d.plane, moving = Math.abs(P.flaps - P.flapCfg) > 0.02, fc = moving ? CYAN : GREEN;
  const slat = P.flaps <= 2 ? P.flaps : P.flaps <= 3 ? 2 : P.flaps - 1; // forkantklaffene har tre stillinger: 1, 2 = 3, FULL
  const WX = 82, WY = 43;
  text(g, "FLAP", WX + 1, WY - 6.4, 3.6, WHITE); text(g, "S", WX - 9, WY - 1.4, 3.4, WHITE); text(g, "F", WX + 12, WY - 1.4, 3.4, WHITE);
  g.fillStyle = "#8a8f96"; g.beginPath(); g.moveTo(WX - 2, WY - 1); g.lineTo(WX + 3.6, WY - 1); g.lineTo(WX + 4.4, WY + 1.2); g.lineTo(WX - 2.6, WY + 1.2); g.closePath(); g.fill();
  for (let i = 1; i <= 3; i++) g.fillStyle = WHITE, g.fillRect(WX - 3.4 - i * 2.6, WY + 1 + i * 1.5, 0.9, 0.9);
  for (let i = 1; i <= 4; i++) g.fillStyle = WHITE, g.fillRect(WX + 4.6 + i * 2.6, WY + 1 + i * 1.5, 0.9, 0.9);
  const sx = WX - 3 - slat * 2.6, sy = WY + 0.6 + slat * 1.5, fx = WX + 5 + P.flaps * 2.6, fy = WY + 0.6 + P.flaps * 1.5;
  line(g, WX - 2.6, WY + 0.2, sx, sy, 0.7, fc); line(g, WX + 4.4, WY + 0.2, fx, fy, 0.7, fc);
  g.fillStyle = fc;
  g.beginPath(); g.moveTo(sx - 1.8, sy + 1.8); g.lineTo(sx + 1.2, sy + 1.8); g.lineTo(sx - 0.8, sy - 0.8); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(fx + 1.8, fy + 1.8); g.lineTo(fx - 1.2, fy + 1.8); g.lineTo(fx + 0.8, fy - 0.8); g.closePath(); g.fill();
  if (P.flapCfg > 0) text(g, P.flapCfg === 1 ? "1+F" : FLAP_NAMES[P.flapCfg], WX + 1, WY + 12, 4, fc);
  // Memo og varsler har større skrift enn resten: skjermen er liten, og dette er det som må kunne leses
  const MY = 75.8, MS = 5.1, MF = 4.9;
  line(g, 2, 72, 98, 72, 0.4, WHITE); line(g, 66, 73, 66, 99, 0.4, WHITE);
  if (d.warnings.length) {
    d.warnings.forEach((m, i) => text(g, m, 3, MY + i * MS, MF, RED, "left", MONO, 700));
  } else {
    // Landingsmemo som i flyet: blå linje med prikker til punktet er gjort, så grønn.
    // SIGNS, CABIN og SPLRS finnes ikke i modellen og står alltid som gjort.
    const memo: [string, string, boolean][] = [
      ["LDG GEAR DN", "LDG GEAR......DN", P.gear >= 1],
      ["SIGNS ON", "", true],
      ["CABIN READY", "", true],
      ["SPLRS ARM", "", true],
      ["FLAPS FULL", "FLAPS.......FULL", P.flaps >= 3.98],
    ];
    text(g, "LDG", 3, MY, MF, GREEN, "left", MONO);
    line(g, 3, MY + 2.7, 11.8, MY + 2.7, 0.3, GREEN);
    if (P.brake > 0.05) text(g, "SPEED BRK", 68, MY, MF, GREEN, "left", MONO); // som på flyet: grønn melding når de er ute
    memo.forEach(([done, todo, ok], i) => text(g, ok ? done : todo, 14.5, MY + i * MS, MF, ok ? GREEN : CYAN, "left", MONO));
  }
  g.restore();
}

/* ---------- SD: systemdisplay (nedre ECAM), WHEEL-siden ---------- */

/** WHEEL-siden, som flyet viser under innflyging: luftbremsene, understellet og bremsene, og faste data nederst.
 *  Ekte: luftbremser (spoiler 2-4 på hver vinge, som på flyet), understellets stilling, klokke.
 *  SYNTETISK: bremsetemperaturene, vekten, og lufttemperaturene (standardatmosfære fra høyden; TAT fra farten). */
function sd(g: G2D, x: number, y: number, size: number, d: Data, game: Game, body: number): void {
  beginDisplay(g, x, y, size, body);
  const P = d.plane;
  text(g, "WHEEL", 4, 6, 5, WHITE, "left"); line(g, 4, 9.6, 21.5, 9.6, 0.4, WHITE);
  // luftbremser: grønn strek når de ligger inne, pil opp når de er ute
  for (const s of [-1, 1]) for (let i = 1; i <= 5; i++) {
    const sx = 50 + s * (6 + i * 7.6), sy = 21 - i * 0.7, out = P.brake > 0.05 && i >= 2 && i <= 4;
    line(g, sx - 2.4, sy, sx + 2.4, sy, 0.7, GREEN);
    if (out) {
      line(g, sx, sy, sx, sy - 4, 0.7, GREEN);
      g.fillStyle = GREEN; g.beginPath(); g.moveTo(sx, sy - 7); g.lineTo(sx - 1.8, sy - 4); g.lineTo(sx + 1.8, sy - 4); g.closePath(); g.fill();
    }
  }
  // understell: to trekanter per bein (ett per system). Grønn = nede og låst, rød = i bevegelse, ingenting = oppe.
  // Lukene: grønn strek når de er lukket, gule og åpne mens understellet går.
  const moving = P.gear > 0 && P.gear < 1;
  for (const [gx, gy] of [[22, 37], [50, 31], [78, 37]]) {
    for (const s of [-1, 1]) {
      if (moving) line(g, gx + s * 8.6, gy - 3, gx + s * 7.4, gy + 2.6, 0.7, AMBER);
      else line(g, gx + s * 3.2, gy - 3, gx + s * 8.6, gy - 3, 0.7, GREEN);
      if (P.gear <= 0) continue;
      g.strokeStyle = moving ? RED : GREEN; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(gx + s * 0.5, gy - 1.6); g.lineTo(gx + s * 5.5, gy - 1.6); g.lineTo(gx + s * 3, gy + 3.4); g.closePath(); g.stroke();
    }
  }
  // bremser: temperatur per hjul over en bue, hjulnummer under
  [14, 30, 70, 86].forEach((wx, i) => {
    text(g, "45", wx, 56, 5, GREEN, "center", SANS, 600);
    g.strokeStyle = WHITE; g.lineWidth = 0.5; g.beginPath(); g.arc(wx, 68, 6, Math.PI * 1.2, Math.PI * 1.8); g.stroke();
    text(g, String(i + 1), wx, 67.6, 3.8, WHITE);
  });
  text(g, "°C", 50, 56, 3.6, CYAN); text(g, "REL", 22, 73.6, 3.2, WHITE); text(g, "REL", 78, 73.6, 3.2, WHITE);
  // faste data nederst
  line(g, 2, 81, 98, 81, 0.4, WHITE); line(g, 35, 82, 35, 99, 0.4, WHITE); line(g, 63, 82, 63, 99, 0.4, WHITE);
  const satK = 288.15 - 0.0019812 * d.altFt, mach = d.kt / KT / (20.05 * Math.sqrt(satK)), tatK = satK * (1 + 0.2 * mach * mach);
  const deg = (k: number): string => `${k >= 273.15 ? "+" : "-"}${Math.abs(Math.round(k - 273.15))}`;
  for (const [ly, name, v] of [[86.6, "TAT", tatK], [94.2, "SAT", satK]] as const) {
    text(g, name, 3, ly, 3.8, WHITE, "left"); text(g, deg(v), 26, ly, 4.4, GREEN, "right"); text(g, "°C", 27, ly + 0.2, 3, CYAN, "left");
  }
  const utc = new Date(game.time);
  text(g, pad(utc.getUTCHours(), 2), 45.5, 90.6, 4.8, GREEN, "right"); text(g, "H", 49, 90.8, 3.2, CYAN); text(g, pad(utc.getUTCMinutes(), 2), 52.5, 90.6, 4.8, GREEN, "left");
  text(g, "GW", 66, 86.6, 3.8, WHITE, "left"); text(g, "60000", 93, 94.2, 4.6, GREEN, "right"); text(g, "KG", 99, 94.4, 3, CYAN, "right");
  g.restore();
}

/* ---------- mindre utstyr ---------- */

/** Reserveinstrument (ISIS): horisont med fartsbånd til venstre, høydebånd til høyre og trykkinnstilling nederst. */
function standby(g: G2D, x: number, y: number, size: number, d: Data, body: number): void {
  beginDisplay(g, x, y, size, body);
  const CY = 54;
  attitudeBall(g, 50, CY, 50, 40, d, 1.5);
  g.fillStyle = "rgba(38,41,46,.92)"; g.fillRect(0, 14, 24, 80); g.fillRect(74, 14, 26, 80);
  g.save(); g.beginPath(); g.rect(0, 14, 100, 80); g.clip();
  for (let v = Math.max(40, Math.floor(d.kt / 20) * 20 - 40); v <= d.kt + 40; v += 20) {
    const ty = CY - (v - d.kt) * 1.1;
    line(g, 20, ty, 24, ty, 1, WHITE); text(g, String(v), 19, ty, 8, WHITE, "right");
  }
  for (let a = Math.floor(d.altFt / 100) * 100 - 400; a <= d.altFt + 400; a += 100) {
    const ty = CY - (a - d.altFt) * 0.11;
    line(g, 74, ty, a % 500 === 0 ? 79 : 77, ty, 1, WHITE);
    if (a % 500 === 0) text(g, pad(Math.abs(a) / 100, 3), 99, ty, 8, WHITE, "right");
  }
  g.restore();
  g.fillStyle = "#000"; g.fillRect(0, CY - 7, 26, 14); g.fillRect(64, CY - 7, 36, 14);
  g.strokeStyle = YELLOW; g.lineWidth = 1; g.strokeRect(0.5, CY - 7, 25.5, 14); g.strokeRect(64, CY - 7, 35.5, 14);
  text(g, String(Math.round(d.kt)), 24, CY + 0.6, 11, GREEN, "right", SANS, 600);
  text(g, String(Math.round(d.altFt / 10) * 10), 98, CY + 0.6, 11, GREEN, "right", SANS, 600);
  g.fillStyle = "#000"; g.fillRect(0, 0, 100, 14); g.fillRect(0, 88, 100, 12);
  text(g, "1013", 50, 94.4, 8.4, CYAN);
  g.restore();
}

/** Klokke: CHR-vinduet er tomt (ingen stoppeklokke), UTC, og norsk tid der flyet har medgått tid (ET). */
function clock(g: G2D, x: number, y: number, game: Game, body: number): void {
  const utc = new Date(game.time), lt = osloTime(game.time);
  g.fillStyle = shade(30, 33, 38, Math.max(body, 0.45)); g.beginPath(); g.roundRect(x, y, 22, 22, 1.2); g.fill();
  g.strokeStyle = shade(120, 130, 142, body); g.lineWidth = 0.2; g.stroke();
  const win = (wy: number, h: number, caption: string, big: string, small: string) => {
    g.fillStyle = "#07090a"; g.fillRect(x + 4.4, wy, 13.2, h);
    text(g, caption, x + 11, wy - 0.9, 1.5, "#9aa3ad");
    text(g, big, x + (small ? 13.6 : 16.8), wy + h / 2 + 0.2, h * 0.74, GREEN, "right", MONO, 600);
    if (small) text(g, small, x + 17, wy + h / 2 + 0.5, h * 0.46, GREEN, "right", MONO, 600);
  };
  win(y + 2.2, 3.4, "CHR", "", "");
  win(y + 7.8, 5, "UTC", `${pad(utc.getUTCHours(), 2)}:${pad(utc.getUTCMinutes(), 2)}`, pad(utc.getUTCSeconds(), 2));
  win(y + 15.2, 5, "LOCAL", `${pad(lt.hour, 2)}:${pad(lt.minute, 2)}`, "");
  for (const [kx, ky] of [[2.2, 4], [19.8, 4], [2.2, 17.6], [19.8, 17.6]]) knob(g, x + kx, y + ky, 1.3, body);
}

/** FCU: streker med prikk betyr at flyet styrer verdien selv («managed»), som på flyet. Når autopiloten (A) flyr,
 *  viser SPD og HDG det den holder. ALT viser alltid et tall, slik vinduet gjør i flyet: her høyden innflygingen
 *  startet i (SYNTETISK: spillet har ingen klarert høyde). V/S er streker fordi nedstigningen følger glidebanen.
 *  AP1, A/THR og APPR lyser når autopiloten flyr. Knapper og dreieknapper kan ikke betjenes. */
function fcu(g: G2D, body: number, game: Game): void {
  const x = 106, y = 108.4, w = 108, h = 13.2, LCD = "#ffb347";
  g.fillStyle = shade(52, 60, 70, body); g.beginPath(); g.roundRect(x, y, w, h, 1.2); g.fill();
  g.strokeStyle = shade(20, 23, 28, body); g.lineWidth = 0.4; g.stroke();
  const win = (wx: number, ww: number, label: string, value: string) => {
    g.fillStyle = "#06080a"; g.fillRect(wx, y + 1, ww, 6.2);
    text(g, label, wx + 0.8, y + 2.1, 1.5, LCD, "left");
    text(g, value, wx + ww - 1, y + 5, 3.7, LCD, "right", MONO, 600);
  };
  const ap = game.apTarget;
  win(x + 4, 17, "SPD", ap ? String(Math.round(ap.speedKt)) : "---●");
  win(x + 25, 17, "HDG        LAT", ap ? String(Math.round(ap.courseTrueDeg) % 360).padStart(3, "0") : "---●");
  g.fillStyle = "#06080a"; g.fillRect(x + 45.5, y + 1, 15, 6.2);
  text(g, "HDG  V/S", x + 53, y + 2.8, 1.5, LCD); text(g, "TRK  FPA", x + 53, y + 5.4, 1.5, "#5b4526");
  win(x + 64, 20, "ALT    LVL/CH", `${game.approach.platformFt}${ap ? "●" : ""}`);
  win(x + 87, 17, "V/S", "-----");
  for (const kx of [12.5, 33.5, 74, 95.5]) knob(g, x + kx, y + 10.1, 2, body, 0, true);
  const ky = y + 8.3;
  key(g, x + 38.4, ky, 4.4, 3.7, "LOC", body, false, 1.5, glareInk(body));
  key(g, x + 45.6, ky, 4.6, 3.7, "AP1", body, !!ap, 1.5, glareInk(body)); key(g, x + 50.7, ky, 4.6, 3.7, "AP2", body, false, 1.5, glareInk(body)); key(g, x + 55.8, ky, 4.8, 3.7, "A/THR", body, !!ap, 1.3, glareInk(body));
  key(g, x + 79.5, ky, 5, 3.7, "EXPED", body, false, 1.3, glareInk(body)); key(g, x + 100.6, ky, 5, 3.7, "APPR", body, !!ap, 1.5, glareInk(body));
}

/** EFIS-kontrollpanel ved siden av FCU: trykkinnstilling, FD og LS, og velgere for ND (modus og rekkevidde).
 *  `dir` = 1 for venstre sete, -1 for høyre (speilvendt). FD-knappen lyser når flight director er på (D).
 *  SYNTETISK: QNH står alltid på 1013. */
function efis(g: G2D, x0: number, dir: number, body: number, fd: boolean): void {
  const y = 108.4, w = 33, at = (o: number, ww = 0): number => (dir > 0 ? x0 + o : x0 + w - o - ww);
  g.fillStyle = shade(52, 60, 70, body); g.beginPath(); g.roundRect(x0, y, w, 13.2, 1.2); g.fill();
  g.strokeStyle = shade(20, 23, 28, body); g.lineWidth = 0.4; g.stroke();
  g.fillStyle = "#06080a"; g.fillRect(at(1.2, 11), y + 1, 11, 5);
  text(g, "QNH", at(1.2, 11) + 0.6, y + 2, 1.4, "#ffb347", "left"); text(g, "1013", at(1.2, 11) + 10.4, y + 4.1, 3.2, "#ffb347", "right", MONO, 600);
  knob(g, at(4), y + 9.7, 2, body, 0, true);
  key(g, at(7.6, 4.4), y + 7, 4.4, 2.6, "FD", body, fd, 1.4, glareInk(body)); key(g, at(7.6, 4.4), y + 10, 4.4, 2.6, "LS", body, true, 1.4, glareInk(body));
  ["CSTR", "WPT", "VOR.D", "NDB", "ARPT"].forEach((s, i) => key(g, at(13.4 + i * 3.9, 3.6), y + 0.9, 3.6, 2.7, s, body, false, 1.05, glareInk(body)));
  // ND-velgerne står på ARC og 10 NM, som er det skjermen viser
  knob(g, at(18.6), y + 8.9, 2.3, body, 0.6 * dir, true); knob(g, at(27.6), y + 8.9, 2.3, body, -1.2 * dir, true);
  text(g, "ARC", at(18.6), y + 12.2, 1.3, glareInk(body)); text(g, "10", at(27.6), y + 12.2, 1.3, glareInk(body));
}

/** Varsellysene ytterst på blendingsskjermen. MASTER WARN blinker rødt mens et rødt varsel står på E/WD;
 *  de andre lampene har ingen funksjon i spillet og er alltid slukket. */
function glareLights(g: G2D, x0: number, dir: number, d: Data): void {
  const y = 108.8, at = (o: number, ww: number): number => (dir > 0 ? x0 + o : x0 + 30 - o - ww);
  lamp(g, at(0, 6.4), y + 3, 6.4, 6, "SIDE STICK\nPRIORITY", RED, false, 1.1);
  lamp(g, at(8, 5.4), y + 3.6, 5.4, 4.8, "CHRONO", WHITE, false, 1.2);
  lamp(g, at(15, 8), y, 8, 5.9, "MASTER\nWARN", RED, d.warnings.length > 0 && Math.floor(performance.now() / 250) % 2 === 0, 1.6);
  lamp(g, at(15, 8), y + 6.5, 8, 5.9, "MASTER\nCAUT", AMBER, false, 1.6);
  lamp(g, at(24.6, 5.4), y + 3.6, 5.4, 4.8, "AUTO\nLAND", RED, false, 1.2);
}

/** Understellspanel: grønn trekant = nede og låst, rød UNLK = i bevegelse, mørkt = oppe.
 *  SYNTETISK: bremsetrykket (akkumulatoren full, ingen bremsing). AUTO BRK og A/SKID kan ikke betjenes. */
function gearPanel(g: G2D, x: number, y: number, P: Plane, body: number): void {
  const label = ink(body);
  plate(g, x, y, 22, DU, body, 86, 100, 114);
  text(g, "LDG GEAR", x + 11, y + 2.9, 2, label);
  for (const gx of [x + 4.7, x + 11, x + 17.3]) {
    g.fillStyle = "#07090a"; g.fillRect(gx - 2.7, y + 4.6, 5.4, 7.4);
    line(g, gx - 2.7, y + 8, gx + 2.7, y + 8, 0.2, "#30343a");
    if (P.gear >= 1) { g.strokeStyle = GREEN; g.lineWidth = 0.5; g.beginPath(); g.moveTo(gx - 2, y + 8.8); g.lineTo(gx + 2, y + 8.8); g.lineTo(gx, y + 11.4); g.closePath(); g.stroke(); }
    else if (P.gear > 0) text(g, "UNLK", gx, y + 6.4, 1.7, RED, "center", SANS, 700);
  }
  text(g, "AUTO BRK", x + 11, y + 14.8, 2, label);
  ["LO", "MED", "MAX"].forEach((s, i) => {
    key(g, x + 1.5 + i * 6.5, y + 16.6, 5.8, 5.6, "", body);
    text(g, s, x + 4.4 + i * 6.5, y + 15.9 + 2.6, 1.9, ink(body, 0.9));
    text(g, "ON", x + 4.4 + i * 6.5, y + 20.8, 1.3, "#27456b");
  });
  // vippebryter for A/SKID og nesehjulstyring
  text(g, "A/SKID &", x + 6.4, y + 24.8, 1.5, label); text(g, "N/W STRG", x + 6.4, y + 26.5, 1.5, label);
  g.fillStyle = "#0a0b0d"; g.beginPath(); g.arc(x + 6.4, y + 30, 1.5, 0, 7); g.fill();
  line(g, x + 6.4, y + 30, x + 6.4, y + 27.9, 0.8, shade(200, 204, 210, Math.max(body, 0.5)));
  // trippelindikator: akkumulatortrykk øverst, bremsetrykk venstre og høyre nederst
  const cx = x + 6.6, cy = y + 38.8;
  g.fillStyle = shade(30, 33, 38, Math.max(body, 0.45)); g.beginPath(); g.arc(cx, cy, 5.6, 0, 7); g.fill();
  g.fillStyle = "#07090a"; g.beginPath(); g.arc(cx, cy, 4.9, 0, 7); g.fill();
  g.strokeStyle = GREEN; g.lineWidth = 0.5; g.beginPath(); g.arc(cx, cy, 4.2, -Math.PI * 0.72, -Math.PI * 0.28); g.stroke();
  for (const s of [-1, 1]) { g.strokeStyle = WHITE; g.lineWidth = 0.3; g.beginPath(); g.arc(cx + s * 2.2, cy + 1.6, 2.1, s > 0 ? -0.5 : Math.PI * 0.5, s > 0 ? Math.PI * 0.5 : Math.PI + 0.5); g.stroke(); }
  line(g, cx, cy - 0.6, cx + 1.3, cy - 4, 0.45, WHITE);
  for (const s of [-1, 1]) line(g, cx + s * 2.2, cy + 1.6, cx + s * 2.2, cy + 3.6, 0.45, WHITE);
  text(g, "ACCU", cx, cy - 1.9, 1.1, WHITE); text(g, "BRAKES", cx, cy + 0.2, 1.1, WHITE);
  // spake med hjulformet knott, og piler for retningen
  const lx = x + 14.6, ly = P.gearDown ? y + 40.4 : y + 28.6;
  g.fillStyle = "#07090a"; g.beginPath(); g.roundRect(lx - 1.6, y + 25.4, 3.2, 18.4, 1.6); g.fill();
  g.fillStyle = shade(200, 204, 210, Math.max(body, 0.5)); g.fillRect(lx - 0.7, Math.min(ly, y + 34.5), 1.4, Math.abs(ly - (y + 34.5)));
  const wheel = g.createLinearGradient(0, ly - 2.6, 0, ly + 2.6);
  wheel.addColorStop(0, shade(84, 86, 92, Math.max(body, 0.5))); wheel.addColorStop(1, "#141518");
  g.fillStyle = wheel; g.beginPath(); g.roundRect(lx - 2.2, ly - 2.7, 4.4, 5.4, 1.4); g.fill();
  for (let k = -1.6; k <= 1.7; k += 0.8) line(g, lx - 2, ly + k, lx + 2, ly + k, 0.15, "#000");
  const ax = x + 19.4;
  text(g, "UP", ax, y + 25.6, 1.6, label); text(g, "DOWN", ax - 0.3, y + 44.3, 1.5, label);
  g.strokeStyle = label; g.lineWidth = 0.3;
  g.beginPath(); g.moveTo(ax, y + 27); g.lineTo(ax + 1.3, y + 28.8); g.lineTo(ax + 0.5, y + 28.8); g.lineTo(ax + 0.5, y + 32.6); g.lineTo(ax - 0.5, y + 32.6); g.lineTo(ax - 0.5, y + 28.8); g.lineTo(ax - 1.3, y + 28.8); g.closePath(); g.stroke();
  g.fillStyle = "#d0261c";
  g.beginPath(); g.moveTo(ax, y + 42.8); g.lineTo(ax + 1.3, y + 41); g.lineTo(ax + 0.5, y + 41); g.lineTo(ax + 0.5, y + 34.4); g.lineTo(ax - 0.5, y + 34.4); g.lineTo(ax - 0.5, y + 41); g.lineTo(ax - 1.3, y + 41); g.closePath(); g.fill();
}

/* ---------- midtkonsollen: spakene ---------- */

/** Spor med merker og et håndtak som står i `pos` (0 = øverst, 1 = nederst). */
function leverSlot(g: G2D, cx: number, top: number, title: string, stops: [number, string][], pos: number, body: number): void {
  const bottom = H - 2.5, label = ink(body), yAt = (f: number) => top + 4.4 + f * (bottom - top - 6.4);
  g.fillStyle = "#06070a"; g.fillRect(cx - 1, top + 2.6, 2, bottom - top - 2.6);
  for (const [f, n] of stops) { line(g, cx + 2, yAt(f), cx + 4, yAt(f), 0.3, label); text(g, n, cx + 5, yAt(f), 1.9, label, "left"); }
  text(g, title, cx + 3, top + 0.7, 1.6, label);
  const grip = g.createLinearGradient(0, yAt(pos) - 1.8, 0, yAt(pos) + 1.8);
  grip.addColorStop(0, shade(150, 154, 160, Math.max(body, 0.5))); grip.addColorStop(1, shade(70, 73, 79, Math.max(body, 0.5)));
  g.fillStyle = grip; g.beginPath(); g.roundRect(cx - 3.6, yAt(pos) - 1.8, 7.2, 3.6, 1.2); g.fill();
}

/** Gasshåndtak med Airbus-sperrene. Stillingen følger gassen trinnløst. */
function thrustLevers(g: G2D, cx: number, top: number, thr: number, body: number): void {
  const bottom = H - 2.5, yAt = (f: number) => bottom - 2.6 - f * (bottom - top - 6.4), y = yAt(thr);
  for (const [f, label] of [[1, "TOGA"], [0.84, "MCT"], [0.66, "CL"], [0, "0"]] as const) {
    line(g, cx - 4.4, yAt(f), cx + 5.2, yAt(f), 0.3, shade(180, 184, 190, Math.max(body, 0.5)));
    text(g, label, cx + 5.8, yAt(f), 1.7, ink(body), "left");
  }
  text(g, "THR", cx, top + 0.7, 1.6, ink(body));
  for (const s of [-1, 1]) {
    g.fillStyle = "#06070a"; g.fillRect(cx + s * 2.1 - 0.8, top + 2.6, 1.6, bottom - top - 2.6);
    g.fillStyle = shade(170, 174, 180, Math.max(body, 0.5)); g.fillRect(cx + s * 2.1 - 0.5, y, 1, bottom - y);
    const grip = g.createLinearGradient(0, y - 2.2, 0, y + 2.2);
    grip.addColorStop(0, shade(96, 98, 104, Math.max(body, 0.5))); grip.addColorStop(1, "#141518");
    g.fillStyle = grip; g.beginPath(); g.roundRect(cx + s * 2.1 - 1.9, y - 2.2, 3.8, 4.4, 1.2); g.fill();
    // rød knapp på utsiden av hvert håndtak (kobler ut autothrust i flyet)
    g.fillStyle = "#b3261c"; g.beginPath(); g.arc(cx + s * 4.4, y, 0.6, 0, 7); g.fill();
  }
}

/** Bordkant og luftrister under skjermene på hver side, slik panelet er bygget under PFD og ND. */
function lowerPanel(g: G2D, x: number, body: number): void {
  plate(g, x, ROW + DU + 3.2, 100, H - ROW - DU - 2.2, body, 92, 108, 124);
  // uttrekksbordet: kant med grep
  g.fillStyle = shade(60, 70, 80, body); g.beginPath(); g.roundRect(x + 6, ROW + DU + 5.4, 88, 3.4, 0.8); g.fill();
  g.fillStyle = shade(30, 34, 40, Math.max(body, 0.4)); g.beginPath(); g.roundRect(x + 41, ROW + DU + 6.2, 18, 1.8, 0.9); g.fill();
  grille(g, x + 6, ROW + DU + 11.4, 30, 13.6, body);
  grille(g, x + 64, ROW + DU + 11.4, 30, 13.6, body);
  g.fillStyle = shade(70, 82, 94, body); g.beginPath(); g.roundRect(x + 40, ROW + DU + 12.4, 20, 11.6, 1); g.fill();
  g.strokeStyle = shade(44, 52, 60, body); g.lineWidth = 0.3; g.stroke();
}

/** Sidepanel utenfor PFD: lysstyrkeknapper og høyttaler. Ses bare når vinduet er bredere enn 16:10. */
function sidePanel(g: G2D, x: number, dir: number, body: number, pullUp: boolean): void {
  const at = (o: number): number => x + dir * o, left = dir > 0 ? x : x - 34;
  plate(g, left, ROW - 1.6, 34, DU + 3.2, body);
  for (const [o, s] of [[12, "PFD"], [24, "ND"]] as const) { knob(g, at(o), ROW + 12, 2.6, body, -0.8); text(g, s, at(o), ROW + 6.6, 1.8, ink(body)); }
  knob(g, at(12), ROW + 30, 2.6, body, 0.9); text(g, "LOUD SPEAKER", at(15), ROW + 24.4, 1.6, ink(body));
  // lyser rødt ved rødt terrengvarsel
  lamp(g, at(24) - 3.4, ROW + 27.2, 6.8, 5.6, "PULL UP\nGPWS", RED, pullUp, 1.3);
  // høyttaler: hullet plate
  const cx = at(17), cy = ROW + DU + 16;
  g.fillStyle = shade(24, 27, 32, Math.max(body, 0.4)); g.beginPath(); g.arc(cx, cy, 8.4, 0, 7); g.fill();
  g.fillStyle = shade(70, 82, 94, body);
  for (let hy = -7; hy <= 7; hy += 1.4) for (let hx = -7; hx <= 7; hx += 1.4) if (hx * hx + hy * hy < 56) g.fillRect(cx + hx - 0.25, cy + hy - 0.25, 0.5, 0.5);
}

/** Minne mellom to bilder: fartstrend og motorenes etterslep. Tegningen er ellers uten tilstand. */
const anim = { at: 0, kt: 0, trend: 0, eng: -1 };
const SPOOL_S = 1.6; // SYNTETISK: tidskonstant for motorenes turtall etter gasshåndtaket

export function drawPanel(g: G2D, t: Terrain, game: Game): void {
  night = game.env.sky.night;
  // Om natta er panelet opplyst av flomlyset under blendingsskjermen, så det blir ikke helt mørkt
  const P = game.P, body = 1 - 0.6 * night, arp = game.airport.arp;
  const end = game.airport.runways.flatMap((rw) => rw.ends).find((e) => e.ident === game.approach.ident);
  const kt = P.spd * KT, now = performance.now() / 1000, dt = clamp(now - anim.at, 0, 0.5);
  if (anim.eng < 0 || P.state !== "fly") { anim.trend = 0; anim.eng = P.thr; }
  else if (dt > 0) {
    // akselerasjonen er begrenset til 5 kt/s, så et hopp i farten (ny innflyging) ikke gir en pil over hele båndet
    anim.trend += (clamp((kt - anim.kt) / dt, -5, 5) * 10 - anim.trend) * Math.min(1, dt * 2);
    anim.eng += (P.thr - anim.eng) * Math.min(1, dt / SPOOL_S);
  }
  anim.at = now; anim.kt = kt;
  const d: Data = {
    kt,
    altFt: P.alt * FT,
    vsFpm: verticalSpeed(P) * FT * 60,
    pitch: P.pitch, roll: P.roll,
    hdg: t.trueHeadingDeg(P.hdg),
    raFt: Math.max(0, P.alt - Math.max(0, t.heightAt(P.x, P.y))) * FT,
    thr: P.thr,
    stallKt: stallSpeed(P) * KT,
    limitKt: speedLimit(P) * KT,
    plane: P,
    ils: null, runway: game.approach.ident,
    warnings: [],
    arpNm: (Math.hypot(arp.x - P.x, arp.y - P.y) * t.cell) / NM,
    // peiling i rutenettet + meridiankonvergens = sann peiling
    arpBearing: (((Math.atan2(arp.x - P.x, -(arp.y - P.y)) * DEG + t.meta.gridConvergenceDeg) % 360) + 360) % 360,
    ap: game.apTarget,
    courseDeg: end ? end.headingTrueDeg : 0,
    selAltFt: game.approach.platformFt,
    trendKt: anim.trend,
    eng: anim.eng,
    // klaffgrensen alene: som speedLimit for neste stilling, med understellet oppe
    fd: game.fd,
    gpws: terrainAlert(P, t, game.airport),
    nextFlapKt: P.flapCfg < 4 ? speedLimit({ ...P, flapCfg: P.flapCfg + 1, flaps: P.flapCfg + 1, gear: 0, gearDown: false }) * KT : null,
  };
  const target = game.airport.runways.find((rw) => rw.ends.some((e) => e.ident === game.approach.ident));
  if (target && end && P.state === "fly") d.ils = guidance(t, target, end, P);
  const w = warnings(P, d.raFt);
  if (w.overspeed) d.warnings.push("OVERSPEED", ` MAX ${Math.round(d.limitKt)} KT`);
  if (w.stall) d.warnings.push("STALL");
  if (w.gearNotDown) d.warnings.push("L/G GEAR NOT DOWN");
  g.save();

  // stolper på hver side av frontruta
  g.fillStyle = shade(30, 33, 40, body);
  g.beginPath(); g.moveTo(0, TOP); g.lineTo(8, TOP); g.lineTo(18, PANEL_TOP + 2); g.lineTo(0, PANEL_TOP + 2); g.fill();
  g.beginPath(); g.moveTo(W, TOP); g.lineTo(W - 8, TOP); g.lineTo(W - 18, PANEL_TOP + 2); g.lineTo(W, PANEL_TOP + 2); g.fill();
  g.fillRect(0, TOP, W, 2.5);
  // Ingen midtstolpe: kameraet står i flyets midtlinje, og en stolpe der ville skjult rullebanen

  // panelplate i Airbus-blågrått
  const base = g.createLinearGradient(0, PANEL_TOP, 0, H);
  base.addColorStop(0, shade(104, 122, 138, body));
  base.addColorStop(1, shade(78, 92, 106, body));
  g.fillStyle = base; g.fillRect(0, PANEL_TOP, W, H - PANEL_TOP);
  // blendingsskjerm
  g.fillStyle = shade(20, 22, 26, Math.max(body, 0.5));
  g.beginPath(); g.moveTo(0, PANEL_TOP + 4); g.quadraticCurveTo(W / 2, PANEL_TOP - 6, W, PANEL_TOP + 4); g.lineTo(W, PANEL_TOP + 16); g.lineTo(0, PANEL_TOP + 16); g.closePath(); g.fill();
  const shadow = g.createLinearGradient(0, PANEL_TOP + 16, 0, PANEL_TOP + 22);
  shadow.addColorStop(0, "rgba(0,0,0,.5)"); shadow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = shadow; g.fillRect(0, PANEL_TOP + 16, W, 6);
  g.translate(OX, 0); // instrumentene har fast oppsett og står midt på panelet

  // platene panelet er satt sammen av: venstre sete, midten, høyre sete
  plate(g, 6, ROW - 1.6, 102, DU + 3.2, body);
  plate(g, 109, ROW - 1.6, 102, DU + 3.2, body);
  plate(g, 212, ROW - 1.6, 102, DU + 3.2, body);
  const pullUp = d.gpws?.level === "warning";
  sidePanel(g, 5, -1, body, pullUp); sidePanel(g, 315, 1, body, pullUp);
  lowerPanel(g, 7, body); lowerPanel(g, 213, body);
  plate(g, 109, ROW + DU + 3.2, 102, H - ROW - DU - 2.2, body);
  // Spakene fra midtkonsollen står på hver side av nedre ECAM-skjerm. I flyet sitter de lenger bak, utenfor bildet.
  plate(g, 110.4, ROW + DU + 4.4, 29.6, H - ROW - DU - 5, body, 58, 66, 76);
  plate(g, 180, ROW + DU + 4.4, 29.6, H - ROW - DU - 5, body, 58, 66, 76);

  // flomlyset: sterkest rett under blendingsskjermen, svakere nedover
  if (night > 0.05) {
    const flood = g.createLinearGradient(0, PANEL_TOP + 16, 0, H);
    flood.addColorStop(0, `rgba(255,236,200,${0.16 * night})`); flood.addColorStop(1, "rgba(255,236,200,0)");
    g.fillStyle = flood; g.fillRect(-OX, PANEL_TOP + 16, W, H - PANEL_TOP - 16);
  }

  fcu(g, body, game);
  efis(g, 70, 1, body, game.flightDirector); efis(g, 217, -1, body, game.flightDirector);
  glareLights(g, 37, 1, d); glareLights(g, 253, -1, d);

  pfd(g, 10, ROW, d, body);
  nd(g, 60, ROW, d, t, game, body);
  standby(g, 114, ROW, 22, d, body);
  clock(g, 114, ROW + 24, game, body);
  ewd(g, 160 - ECAM / 2, ROW, ECAM, d, body);
  sd(g, 160 - ECAM / 2, H - 1.7 - ECAM, ECAM, d, game, body);
  gearPanel(g, 184, ROW, P, body);
  nd(g, 214, ROW, d, t, game, body);
  pfd(g, 264, ROW, d, body);
  const LT = ROW + DU + 7;
  leverSlot(g, 115.6, LT, "SPD BRK", [[0, "RET"], [1, "FULL"]], P.brake, body);
  thrustLevers(g, 129.6, LT, P.thr, body);
  leverSlot(g, 190, LT, "FLAPS", FLAP_NAMES.map((n, c) => [c / 4, n]), P.flapCfg / 4, body);

  g.restore();
}
