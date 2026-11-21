/* Instrumentpanel for cockpit: Airbus A320 hovedinstrumentpanel (glasscockpit), forenklet.
 *
 *   [ FCU på blendingsskjermen ]
 *   PFD  ND   reserve/klokke   E/WD   understell   ND  PFD
 *                          gasshåndtak
 *
 * Tegnes i 320 x 200 logiske enheter (main.ts skalerer). Hver skjerm tegnes i egne 100 x 100 enheter.
 *
 * Ekte verdier: fart, høyde, stigning, kurs, stilling, radiohøyde, avstand og peiling til ENCN,
 * terrenget på ND (fra høydekartet), klokke.
 * klaffer og understell med varsler og landingsmemo.
 * Syntetisk: motorverdiene (regnet rett fra gasshåndtaket), memolinjene SIGNS/CABIN/SPLRS, drivstoffmengde,
 * ALT-vinduet på FCU (høyden innflygingen startet i, ikke en klarert høyde).
 */
import { osloTime } from "./clock";
import type { Game } from "./game";
import { FLAP_NAMES, speedLimit, stallSpeed, verticalSpeed, warnings } from "./physics";
import type { Plane } from "./plane";
import { guidance, type Guidance } from "./guidance";
import { H, OX, PANEL_TOP, TOP, W } from "./screen";
import type { Terrain } from "./terrain";

const KT = 1.943844, FT = 3.28084, NM = 1852, DEG = 180 / Math.PI;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const DU = 46; // skjermstørrelse i logiske enheter
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

/** Flydata i de enhetene skjermene bruker. */
interface Data {
  kt: number; altFt: number; vsFpm: number; pitch: number; roll: number; hdg: number; raFt: number;
  thr: number; arpNm: number; arpBearing: number;
  stallKt: number; limitKt: number; plane: Plane;
  /** Kurs- og glidebaneavvik mot banen det flys mot, eller null utenfor dekning. */
  ils: Guidance | null; runway: string;
  /** Røde varsler som gjelder nå. */
  warnings: string[];
}

/** Åpner en skjerm: ramme, svart flate, og koordinater 0-100 klippet til skjermen. */
function beginDisplay(g: G2D, x: number, y: number, size: number, body: number): void {
  g.fillStyle = shade(34, 38, 44, Math.max(body, 0.45));
  g.beginPath(); g.roundRect(x - 1.6, y - 1.6, size + 3.2, size + 3.2, 1.4); g.fill();
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

  // FMA: fem kolonner, tomme fordi verken autopilot, autothrust eller flight director finnes
  for (const fx of [20, 40, 60, 80]) line(g, fx, 2, fx, 14, 0.4, WHITE);

  attitudeBall(g, 46, CY, 21, 25, d, 1.9);
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
  g.fillStyle = AMBER; g.fillRect(19.6, ys(stall * 1.13), 0.8, ys(stall) - ys(stall * 1.13)); // laveste valgbare fart
  for (let v = vmax; v < vmax + 80; v += 3) { g.fillStyle = (v / 3) % 2 < 1 ? RED : "#000"; g.fillRect(19.6, ys(v + 3), 1.8, ys(v) - ys(v + 3)); } // over maksfart
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
  g.restore();
  line(g, 72, TOP, 88, TOP, 0.5, WHITE); line(g, 72, BOT, 88, BOT, 0.5, WHITE);
  g.fillStyle = "#000"; g.fillRect(69.5, CY - 5, 20.5, 10);
  g.strokeStyle = YELLOW; g.lineWidth = 0.6; g.strokeRect(69.5, CY - 5, 20.5, 10);
  text(g, String(Math.round(d.altFt / 20) * 20), 88.6, CY + 0.2, 6.6, GREEN, "right", SANS, 600);
  text(g, "QNH", 74, 84.5, 4, WHITE, "left"); text(g, "1013", 83, 84.5, 4.6, CYAN, "left");

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

  // Terreng som på et EGPWS-bilde: farge etter høyde i forhold til flyet
  const STEP = 2.5, altM = P.alt;
  for (let sy = 18; sy < AY + 6; sy += STEP) for (let sx = 0; sx < 100; sx += STEP) {
    const rx = sx + STEP / 2 - AX, fy = AY - (sy + STEP / 2);
    if (rx * rx + fy * fy > R * R) continue;
    const [gx, gy] = toGrid(rx, fy);
    if (!t.inBounds(gx, gy)) continue;
    let c: string;
    if (t.isWater(gx, gy)) c = "#0b3f5c";
    else {
      const rel = (t.heightAt(gx, gy) - altM) * FT;
      if (rel > 2000) c = "#c01818"; else if (rel > -500) c = "#b98a12"; else if (rel > -2000) c = "#1d7a2c"; else continue;
    }
    g.fillStyle = c; g.fillRect(sx + 0.25, sy + 0.25, STEP - 0.5, STEP - 0.5);
  }

  // avstandsbuer
  g.setLineDash([2, 2]);
  for (const f of [0.25, 0.5, 0.75]) { g.strokeStyle = WHITE; g.lineWidth = 0.35; g.beginPath(); g.arc(AX, AY, R * f, Math.PI * 1.13, Math.PI * 1.87); g.stroke(); }
  g.setLineDash([]);
  text(g, String(ND_RANGE_NM / 2), AX - R * 0.5 * 0.86, AY - R * 0.5 * 0.42, 4, CYAN);
  // kompassbue
  g.strokeStyle = WHITE; g.lineWidth = 0.6; g.beginPath(); g.arc(AX, AY, R, Math.PI * 1.13, Math.PI * 1.87); g.stroke();
  for (let h = Math.floor(d.hdg / 5) * 5 - 60; h <= d.hdg + 60; h += 5) {
    const rel = h - d.hdg;
    if (Math.abs(rel) > 62) continue;
    const a = ((rel - 90) * Math.PI) / 180, n = ((h % 360) + 360) % 360, len = n % 10 === 0 ? 3 : 1.6;
    line(g, AX + Math.cos(a) * R, AY + Math.sin(a) * R, AX + Math.cos(a) * (R + len), AY + Math.sin(a) * (R + len), 0.5, WHITE);
    if (n % 30 === 0) text(g, String(n / 10), AX + Math.cos(a) * (R + 7), AY + Math.sin(a) * (R + 7), 4.6, WHITE);
  }
  line(g, AX, AY - R - 4, AX, AY - R + 2, 0.9, YELLOW);

  // forlenget senterlinje for banen det flys mot: 10 NM ut fra baneenden, stiplet, med et merke per NM
  const end = game.airport.runways.flatMap((rw) => rw.ends).find((e) => e.ident === game.approach.ident);
  if (end) {
    const h = (end.headingGridDeg * Math.PI) / 180, nm = NM / t.cell;
    const out = (d: number, side = 0): [number, number] => toScreen(end.x - Math.sin(h) * d * nm + Math.cos(h) * side * nm, end.y + Math.cos(h) * d * nm + Math.sin(h) * side * nm);
    g.setLineDash([1.6, 1.6]);
    line(g, ...out(0), ...out(10), 0.5, CYAN);
    g.setLineDash([]);
    for (let d = 1; d <= 10; d++) line(g, ...out(d, -0.12), ...out(d, 0.12), 0.5, CYAN);
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
  g.restore();
}

/* ---------- E/WD: motor- og varseldisplay ---------- */

function arcGauge(g: G2D, cx: number, cy: number, r: number, frac: number, redFrom: number): void {
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.2, ang = (f: number) => a0 + sweep * f;
  g.strokeStyle = WHITE; g.lineWidth = 0.6; g.beginPath(); g.arc(cx, cy, r, ang(0), ang(redFrom)); g.stroke();
  g.strokeStyle = RED; g.lineWidth = 1.1; g.beginPath(); g.arc(cx, cy, r, ang(redFrom), ang(1)); g.stroke();
  for (const f of [0, 0.25, 0.5, 0.75]) line(g, cx + Math.cos(ang(f)) * (r - 1.6), cy + Math.sin(ang(f)) * (r - 1.6), cx + Math.cos(ang(f)) * r, cy + Math.sin(ang(f)) * r, 0.5, WHITE);
  const a = ang(clamp(frac, 0, 1));
  line(g, cx, cy, cx + Math.cos(a) * (r + 1.4), cy + Math.sin(a) * (r + 1.4), 0.9, GREEN);
}

function ewd(g: G2D, x: number, y: number, d: Data, body: number): void {
  beginDisplay(g, x, y, DU, body);
  // Syntetisk: alle motorverdier er regnet rett fra gasshåndtaket, like for begge motorer
  const n1 = 19.5 + d.thr * 80.5, egt = 390 + d.thr * 520, n2 = 59 + d.thr * 41, ff = 320 + d.thr * 2700;
  for (const cx of [25, 59]) {
    arcGauge(g, cx, 17, 11, n1 / 110, 0.92);
    g.strokeStyle = "#8a8f96"; g.lineWidth = 0.4; g.strokeRect(cx + 0.5, 17.5, 15, 7);
    text(g, n1.toFixed(1), cx + 14.6, 21.2, 5.4, GREEN, "right", SANS, 600);
    arcGauge(g, cx, 44, 7.5, egt / 1000, 0.9);
    text(g, String(Math.round(egt)), cx + 9, 48.5, 5, GREEN, "right", SANS, 600);
    text(g, n2.toFixed(1), cx + 9, 58, 5, GREEN, "right", SANS, 600);
    text(g, String(Math.round(ff / 10) * 10), cx + 9, 66, 5, GREEN, "right", SANS, 600);
  }
  text(g, "N1", 42, 10, 4, WHITE); text(g, "%", 42, 14.4, 3.4, CYAN);
  text(g, "EGT", 42, 40, 4, WHITE); text(g, "°C", 42, 44.4, 3.4, CYAN);
  text(g, "N2", 42, 56.6, 4, WHITE); text(g, "%", 42, 60.4, 3.2, CYAN);
  text(g, "FF", 42, 64.6, 4, WHITE); text(g, "KG/H", 42, 68.4, 2.8, CYAN);
  // høyre kolonne: klaffstilling. Blå mens klaffene går, grønn når de står der spaken er.
  const P = d.plane, moving = Math.abs(P.flaps - P.flapCfg) > 0.02, fc = moving ? CYAN : GREEN;
  text(g, "FLAP", 86, 34, 3.8, WHITE);
  line(g, 76, 41, 84, 41, 0.6, WHITE);
  for (let i = 1; i <= 4; i++) g.fillStyle = WHITE, g.fillRect(84 + i * 2.8, 41.6 + i * 1.5, 0.9, 0.9);
  const fx = 84 + P.flaps * 2.8, fy = 41 + P.flaps * 1.5;
  line(g, 84, 41, fx + 2, fy + 1.1, 0.7, fc);
  g.fillStyle = fc; g.beginPath(); g.moveTo(fx + 3.4, fy + 1.9); g.lineTo(fx + 0.4, fy + 1.9); g.lineTo(fx + 2.4, fy - 0.6); g.closePath(); g.fill();
  text(g, FLAP_NAMES[P.flapCfg], 87, 54, 4.2, fc);
  text(g, "FOB", 80, 62, 3.6, WHITE); text(g, "5400", 96, 66.6, 4.6, GREEN, "right"); text(g, "KG", 98, 62.2, 3, CYAN, "right");
  line(g, 2, 73, 98, 73, 0.4, WHITE); line(g, 62, 74, 62, 99, 0.4, WHITE);
  if (d.warnings.length) {
    d.warnings.forEach((m, i) => text(g, m, 3, 77.6 + i * 4.8, 3.9, RED, "left", MONO, 700));
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
    text(g, "LDG", 3, 77.6, 3.9, GREEN, "left", MONO);
    if (P.brake > 0.05) text(g, "SPEED BRK", 64, 77.6, 3.9, GREEN, "left", MONO); // som på flyet: grønn melding når de er ute
    memo.forEach(([done, todo, ok], i) => text(g, ok ? done : todo, 14, 77.6 + i * 4.8, 3.9, ok ? GREEN : CYAN, "left", MONO));
  }
  g.restore();
}

/* ---------- mindre utstyr ---------- */

/** Reserveinstrument: horisont med fart og høyde som tall. */
function standby(g: G2D, x: number, y: number, size: number, d: Data, body: number): void {
  beginDisplay(g, x, y, size, body);
  attitudeBall(g, 50, 52, 30, 34, d, 1.5);
  g.fillStyle = "rgba(0,0,0,.75)"; g.fillRect(0, 0, 100, 16);
  text(g, String(Math.round(d.kt)), 4, 8.5, 12, GREEN, "left", SANS, 600);
  text(g, String(Math.round(d.altFt / 10) * 10), 96, 8.5, 12, GREEN, "right", SANS, 600);
  g.restore();
}

function lcd(g: G2D, x: number, y: number, w: number, h: number, caption: string, value: string, color: string, body: number): void {
  g.fillStyle = shade(30, 33, 38, Math.max(body, 0.45)); g.beginPath(); g.roundRect(x - 0.8, y - 0.8, w + 1.6, h + 1.6, 0.8); g.fill();
  g.fillStyle = "#07090a"; g.fillRect(x, y, w, h);
  text(g, caption, x + 1, y + 1.7, 1.9, "#9aa3ad", "left");
  text(g, value, x + w - 1, y + h / 2 + 1, h * 0.58, color, "right", MONO, 600);
}

/** FCU: streker med prikk betyr at flyet styrer verdien selv («managed»), som på flyet. Når autopiloten (A) flyr,
 *  viser SPD og HDG det den holder. ALT viser alltid et tall, slik vinduet gjør i flyet: her høyden innflygingen
 *  startet i (SYNTETISK: spillet har ingen klarert høyde). V/S er streker fordi nedstigningen følger glidebanen. */
function fcu(g: G2D, body: number, game: Game): void {
  const x = 106, y = 109, w = 108, h = 11.5;
  g.fillStyle = shade(52, 60, 70, body); g.beginPath(); g.roundRect(x, y, w, h, 1.2); g.fill();
  g.strokeStyle = shade(20, 23, 28, body); g.lineWidth = 0.4; g.stroke();
  const win = (wx: number, ww: number, label: string, value: string) => {
    g.fillStyle = "#06080a"; g.fillRect(wx, y + 3.4, ww, 6);
    text(g, label, wx + 0.8, y + 1.9, 2, WHITE, "left");
    text(g, value, wx + ww - 1, y + 6.6, 4.4, "#ffb347", "right", MONO, 600);
  };
  const ap = game.apTarget;
  win(x + 5, 19, "SPD", ap ? String(Math.round(ap.speedKt)) : "---●");
  win(x + 29, 19, "HDG", ap ? String(Math.round(ap.courseTrueDeg) % 360).padStart(3, "0") : "---●");
  win(x + 56, 24, "ALT", `${game.approach.platformFt}${ap ? "●" : ""}`);
  win(x + 84, 19, "V/S", "-----");
  if (ap) text(g, "AP1", x + 52.5, y + 2, 2, GREEN, "center", SANS, 700);
  // EFIS-kontrollpanel på hver side: trykkinnstilling
  for (const ex of [x - 30, x + w + 4]) {
    g.fillStyle = shade(52, 60, 70, body); g.beginPath(); g.roundRect(ex, y + 1, 26, h - 2, 1); g.fill();
    g.fillStyle = "#06080a"; g.fillRect(ex + 9, y + 4, 14, 5);
    text(g, "QNH", ex + 1.2, y + 6.6, 2.2, WHITE, "left"); text(g, "1013", ex + 22, y + 6.6, 3.8, "#ffb347", "right", MONO, 600);
  }
}

/** Understellspanel: grønn trekant = nede og låst, rød UNLK = i bevegelse, mørkt = oppe. */
function gearPanel(g: G2D, x: number, y: number, P: Plane, body: number): void {
  const ink = shade(235, 235, 235, Math.max(body, 0.6));
  g.fillStyle = shade(86, 100, 114, body); g.beginPath(); g.roundRect(x, y, 22, DU, 1); g.fill();
  text(g, "LDG GEAR", x + 11, y + 3, 2.2, ink);
  for (const gx of [x + 4.5, x + 11, x + 17.5]) {
    g.fillStyle = "#07090a"; g.fillRect(gx - 2.6, y + 5.4, 5.2, 6.4);
    if (P.gear >= 1) { g.fillStyle = GREEN; g.beginPath(); g.moveTo(gx - 1.8, y + 8.6); g.lineTo(gx + 1.8, y + 8.6); g.lineTo(gx, y + 11.2); g.closePath(); g.fill(); }
    else if (P.gear > 0) text(g, "UNLK", gx, y + 7.2, 1.7, RED, "center", SANS, 700);
  }
  text(g, "AUTO/BRK", x + 11, y + 15.4, 2.1, ink);
  ["LO", "MED", "MAX"].forEach((s, i) => {
    g.fillStyle = "#101316"; g.fillRect(x + 1.6 + i * 6.6, y + 17.4, 5.6, 5.2);
    text(g, s, x + 4.4 + i * 6.6, y + 20.1, 2, shade(210, 214, 220, Math.max(body, 0.6)));
  });
  // spake med hjulformet knott
  const ly = P.gearDown ? y + 40.4 : y + 29;
  g.fillStyle = "#07090a"; g.beginPath(); g.roundRect(x + 9.4, y + 26, 3.2, 17, 1.6); g.fill();
  g.fillStyle = shade(200, 204, 210, Math.max(body, 0.5)); g.fillRect(x + 10.3, Math.min(ly, y + 34.5), 1.4, Math.abs(ly - (y + 34.5)));
  g.fillStyle = shade(40, 42, 46, 1); g.beginPath(); g.arc(x + 11, ly, 2.6, 0, 7); g.fill();
  text(g, "UP", x + 5, y + 28.4, 2, ink); text(g, "DOWN", x + 4.4, y + 40.6, 2, ink);
}

/** Klaffspake med fem hakk. */
function flapLever(g: G2D, cx: number, top: number, P: Plane, body: number): void {
  const bottom = H - 1.5, ink = shade(235, 235, 235, Math.max(body, 0.6)), yAt = (c: number) => top + 3 + (c / 4) * (bottom - top - 6);
  g.fillStyle = shade(40, 44, 50, Math.max(body, 0.4)); g.beginPath(); g.roundRect(cx - 9, top - 1.5, 21, bottom - top + 3, 1.4); g.fill();
  g.fillStyle = "#06070a"; g.fillRect(cx - 1, top, 2, bottom - top);
  FLAP_NAMES.forEach((n, c) => { line(g, cx + 2, yAt(c), cx + 4, yAt(c), 0.3, ink); text(g, n, cx + 5, yAt(c), 2.1, ink, "left"); });
  text(g, "FLAPS", cx - 5, top + 2, 1.9, ink);
  g.fillStyle = shade(120, 124, 130, Math.max(body, 0.5)); g.beginPath(); g.roundRect(cx - 4, yAt(P.flapCfg) - 1.8, 8, 3.6, 1.2); g.fill();
}

/** Gasshåndtak med Airbus-sperrene. Stillingen følger gassen trinnløst. */
function thrustLevers(g: G2D, cx: number, top: number, thr: number, body: number): void {
  const bottom = H - 1.5, y = bottom - 3 - thr * (bottom - top - 7);
  g.fillStyle = shade(40, 44, 50, Math.max(body, 0.4)); g.beginPath(); g.roundRect(cx - 21, top - 1.5, 42, bottom - top + 3, 1.4); g.fill();
  for (const [f, label] of [[1, "TO GA"], [0.84, "FLX MCT"], [0.66, "CL"], [0, "0"]] as const) {
    const ly = bottom - 3 - f * (bottom - top - 7);
    line(g, cx - 8, ly, cx + 8, ly, 0.3, shade(180, 184, 190, Math.max(body, 0.5)));
    text(g, label, cx - 9.4, ly, 2.1, shade(235, 235, 235, Math.max(body, 0.6)), "right");
  }
  for (const s of [-1, 1]) {
    g.fillStyle = "#06070a"; g.fillRect(cx + s * 3.4 - 1, top, 2, bottom - top);
    g.fillStyle = shade(170, 174, 180, Math.max(body, 0.5)); g.fillRect(cx + s * 3.4 - 0.6, y, 1.2, bottom - y);
    const knob = g.createLinearGradient(0, y - 2.4, 0, y + 2.4);
    knob.addColorStop(0, shade(96, 98, 104, Math.max(body, 0.5))); knob.addColorStop(1, "#141518");
    g.fillStyle = knob; g.beginPath(); g.roundRect(cx + s * 3.4 - 3, y - 2.4, 6, 4.8, 1.4); g.fill();
  }
}

export function drawPanel(g: G2D, t: Terrain, game: Game): void {
  const P = game.P, body = 1 - 0.8 * game.env.sky.night, arp = game.airport.arp;
  const d: Data = {
    kt: P.spd * KT,
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
  };
  const target = game.airport.runways.find((rw) => rw.ends.some((e) => e.ident === game.approach.ident));
  if (target && P.state === "fly") d.ils = guidance(t, target, target.ends.find((e) => e.ident === game.approach.ident)!, P);
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
  const plate = g.createLinearGradient(0, PANEL_TOP, 0, H);
  plate.addColorStop(0, shade(104, 122, 138, body));
  plate.addColorStop(1, shade(78, 92, 106, body));
  g.fillStyle = plate; g.fillRect(0, PANEL_TOP, W, H - PANEL_TOP);
  // blendingsskjerm
  g.fillStyle = shade(20, 22, 26, Math.max(body, 0.5));
  g.beginPath(); g.moveTo(0, PANEL_TOP + 4); g.quadraticCurveTo(W / 2, PANEL_TOP - 6, W, PANEL_TOP + 4); g.lineTo(W, PANEL_TOP + 16); g.lineTo(0, PANEL_TOP + 16); g.closePath(); g.fill();
  const shadow = g.createLinearGradient(0, PANEL_TOP + 16, 0, PANEL_TOP + 22);
  shadow.addColorStop(0, "rgba(0,0,0,.5)"); shadow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = shadow; g.fillRect(0, PANEL_TOP + 16, W, 6);
  g.translate(OX, 0); // instrumentene har fast oppsett og står midt på panelet
  fcu(g, body, game);

  pfd(g, 10, ROW, d, body);
  nd(g, 60, ROW, d, t, game, body);
  standby(g, 111, ROW, 22, d, body);
  const utc = new Date(game.time), lt = osloTime(game.time);
  lcd(g, 111, ROW + 26, 22, 8, "UTC", `${pad(utc.getUTCHours(), 2)}:${pad(utc.getUTCMinutes(), 2)}`, GREEN, body);
  lcd(g, 111, ROW + 37, 22, 8, "LOCAL", `${pad(lt.hour, 2)}:${pad(lt.minute, 2)}`, GREEN, body);
  ewd(g, 137, ROW, d, body);
  gearPanel(g, 187, ROW, P, body);
  nd(g, 214, ROW, d, t, game, body);
  pfd(g, 264, ROW, d, body);
  thrustLevers(g, 152, ROW + DU + 6, P.thr, body);
  flapLever(g, 186, ROW + DU + 6, P, body);

  g.restore();
}
