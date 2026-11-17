/* Instrumentpanel for cockpit: klassisk «six-pack» med kartskjerm, klokke, effektmåler og gasshåndtak.
 *
 *   fartsmåler      kunstig horisont   høydemåler
 *   svingindikator  kursgyro           variometer
 *
 * Tegnes i 320 x 200 logiske enheter (main.ts skalerer). Enheter som i et ekte fly:
 * knop, fot og fot per minutt. Kursgyroen viser sann kurs, ikke magnetisk.
 */
import { formatOslo } from "./clock";
import type { Game } from "./game";
import { drawMap } from "./hud";
import { MAX_LANDING_SPEED, MAX_SPEED, STALL_SPEED, turnRate, verticalSpeed } from "./physics";
import { H, W } from "./screen";
import type { Terrain } from "./terrain";

/** Øvre kant av panelet (logisk y). Over dette er frontruta. */
export const PANEL_TOP = 114;

const KT = 1.943844, FT = 3.28084, DEG = 180 / Math.PI;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const R = 19; // instrumentradius
const COLS = [118, 160, 202], ROWS = [137, 178];

type G2D = CanvasRenderingContext2D;

interface Look {
  /** Lys på selve panelet: 1 om dagen, lavt om natta. */
  body: number;
  /** Farge på skalaer og tall: hvitt om dagen, varmt instrumentlys om natta. */
  ink: string;
  dim: string;
  night: number;
}

const rad = (deg: number): number => ((deg - 90) * Math.PI) / 180; // 0° = klokka 12, med klokka
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const shade = (r: number, g: number, b: number, f: number): string => `rgb(${(r * f) | 0},${(g * f) | 0},${(b * f) | 0})`;

function tick(g: G2D, cx: number, cy: number, deg: number, r0: number, r1: number, width: number, color: string): void {
  const a = rad(deg), c = Math.cos(a), s = Math.sin(a);
  g.strokeStyle = color; g.lineWidth = width;
  g.beginPath(); g.moveTo(cx + c * r0, cy + s * r0); g.lineTo(cx + c * r1, cy + s * r1); g.stroke();
}

function text(g: G2D, str: string, x: number, y: number, size: number, color: string, weight = 600): void {
  g.font = `${weight} ${size}px ${SANS}`; g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(str, x, y);
}

function dialText(g: G2D, str: string, cx: number, cy: number, deg: number, r: number, size: number, color: string): void {
  const a = rad(deg);
  text(g, str, cx + Math.cos(a) * r, cy + Math.sin(a) * r, size, color);
}

function arc(g: G2D, cx: number, cy: number, r: number, deg0: number, deg1: number, width: number, color: string): void {
  g.strokeStyle = color; g.lineWidth = width;
  g.beginPath(); g.arc(cx, cy, r, rad(deg0), rad(deg1)); g.stroke();
}

/** Viser: smal trekant fra navet, med kort hale. */
function needle(g: G2D, cx: number, cy: number, deg: number, len: number, width: number, color: string, tail = 3): void {
  g.save();
  g.translate(cx, cy); g.rotate(rad(deg) + Math.PI / 2);
  g.fillStyle = color;
  g.beginPath(); g.moveTo(-width / 2, tail); g.lineTo(-width / 2, -len * 0.55); g.lineTo(0, -len); g.lineTo(width / 2, -len * 0.55); g.lineTo(width / 2, tail);
  g.closePath(); g.fill();
  g.restore();
}

function hub(g: G2D, cx: number, cy: number, r = 1.6): void {
  g.fillStyle = "#16181c"; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  g.strokeStyle = "#3a3e46"; g.lineWidth = 0.3; g.stroke();
}

/** Ramme med fire skruer og svart skive. */
function bezel(g: G2D, cx: number, cy: number, r: number, look: Look): void {
  for (const d of [45, 135, 225, 315]) {
    const a = rad(d), x = cx + Math.cos(a) * (r + 3.6), y = cy + Math.sin(a) * (r + 3.6);
    g.fillStyle = shade(120, 124, 132, look.body); g.beginPath(); g.arc(x, y, 0.9, 0, 7); g.fill();
    g.strokeStyle = shade(30, 32, 36, look.body); g.lineWidth = 0.25;
    g.beginPath(); g.moveTo(x - 0.6, y - 0.3); g.lineTo(x + 0.6, y + 0.3); g.stroke();
  }
  const ring = g.createLinearGradient(cx, cy - r - 2, cx, cy + r + 2);
  ring.addColorStop(0, shade(104, 108, 118, look.body));
  ring.addColorStop(1, shade(22, 24, 28, look.body));
  g.fillStyle = ring; g.beginPath(); g.arc(cx, cy, r + 2, 0, 7); g.fill();
  g.fillStyle = "#07080a"; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
}

/** Svak refleks i glasset, bare synlig i dagslys. */
function glass(g: G2D, cx: number, cy: number, r: number, look: Look): void {
  const a = 0.1 * (1 - look.night);
  if (a < 0.01) return;
  const grad = g.createLinearGradient(cx - r, cy - r, cx + r * 0.3, cy + r * 0.3);
  grad.addColorStop(0, `rgba(255,255,255,${a})`);
  grad.addColorStop(0.5, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
}

/* ---------- de seks instrumentene ---------- */

function airspeed(g: G2D, cx: number, cy: number, kt: number, look: Look): void {
  const MAX = 450, deg = (v: number) => 20 + (clamp(v, 0, MAX) / MAX) * 320;
  bezel(g, cx, cy, R, look);
  const stall = STALL_SPEED * KT, land = MAX_LANDING_SPEED * KT, vmax = MAX_SPEED * KT;
  arc(g, cx, cy, R - 1.2, deg(stall), deg(vmax * 0.7), 1.3, "#2f9e44"); // normalområde
  arc(g, cx, cy, R - 1.2, deg(vmax * 0.7), deg(vmax), 1.3, "#e0b020"); // varsomhet
  arc(g, cx, cy, R - 2.8, deg(stall), deg(land), 1.1, "#e8e8e8"); // landingsområde
  tick(g, cx, cy, deg(vmax), R - 4, R, 0.9, "#e03131"); // aldri over
  for (let v = 0; v <= MAX; v += 10) tick(g, cx, cy, deg(v), v % 50 ? R - 2 : R - 3.6, R - 0.3, v % 50 ? 0.25 : 0.5, look.ink);
  for (let v = 50; v <= MAX; v += 50) dialText(g, String(v), cx, cy, deg(v), R - 6.6, 3, look.ink);
  text(g, "KNOP", cx, cy + 6, 2.2, look.dim, 500);
  needle(g, cx, cy, deg(kt), R - 3, 1.5, "#f4f4f0");
  hub(g, cx, cy);
  glass(g, cx, cy, R, look);
}

function attitude(g: G2D, cx: number, cy: number, pitch: number, roll: number, look: Look): void {
  const PX = R / 26; // enheter per grad stigning
  bezel(g, cx, cy, R, look);
  g.save();
  g.beginPath(); g.arc(cx, cy, R - 0.4, 0, 7); g.clip();
  g.translate(cx, cy); g.rotate(-roll);
  g.save();
  g.translate(0, pitch * DEG * PX); // nese opp: horisonten synker
  g.fillStyle = "#3f8fd6"; g.fillRect(-3 * R, -6 * R, 6 * R, 6 * R);
  g.fillStyle = "#7b5330"; g.fillRect(-3 * R, 0, 6 * R, 6 * R);
  g.strokeStyle = "#fff"; g.lineWidth = 0.45;
  g.beginPath(); g.moveTo(-3 * R, 0); g.lineTo(3 * R, 0); g.stroke();
  for (const p of [-20, -15, -10, -5, 5, 10, 15, 20]) {
    const w = p % 10 ? 2.4 : 5, y = -p * PX;
    g.lineWidth = 0.35;
    g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
    if (p % 10 === 0) { text(g, String(Math.abs(p)), -w - 2.6, y, 2.4, "#fff"); text(g, String(Math.abs(p)), w + 2.6, y, 2.4, "#fff"); }
  }
  g.restore();
  // krengeskala følger horisonten
  for (const b of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) tick(g, 0, 0, b, R - (b % 30 ? 2.2 : 3.6), R - 0.6, 0.4, "#fff");
  g.restore();
  // fast: krengepeker og flysymbol
  g.fillStyle = "#ffb020";
  g.beginPath(); g.moveTo(cx, cy - R + 3.8); g.lineTo(cx - 1.5, cy - R + 6.4); g.lineTo(cx + 1.5, cy - R + 6.4); g.closePath(); g.fill();
  g.strokeStyle = "#ffb020"; g.lineWidth = 1; g.lineCap = "round";
  g.beginPath(); g.moveTo(cx - 10, cy); g.lineTo(cx - 4, cy); g.lineTo(cx - 4, cy + 1.6); g.moveTo(cx + 10, cy); g.lineTo(cx + 4, cy); g.lineTo(cx + 4, cy + 1.6); g.stroke();
  g.lineCap = "butt";
  g.fillStyle = "#ffb020"; g.beginPath(); g.arc(cx, cy, 0.8, 0, 7); g.fill();
  glass(g, cx, cy, R, look);
}

function altimeter(g: G2D, cx: number, cy: number, feet: number, look: Look): void {
  bezel(g, cx, cy, R, look);
  for (let i = 0; i < 50; i++) tick(g, cx, cy, i * 7.2, i % 5 ? R - 2 : R - 3.6, R - 0.3, i % 5 ? 0.25 : 0.5, look.ink);
  for (let n = 0; n < 10; n++) dialText(g, String(n), cx, cy, n * 36, R - 6.4, 3.4, look.ink);
  text(g, "100 FOT", cx, cy - 6.2, 2, look.dim, 500);
  // trykkinnstilling (fast: standardatmosfære)
  g.fillStyle = "#101216"; g.fillRect(cx + 5.2, cy - 1.7, 8.2, 3.4);
  g.strokeStyle = "#3a3e46"; g.lineWidth = 0.25; g.strokeRect(cx + 5.2, cy - 1.7, 8.2, 3.4);
  text(g, "1013", cx + 9.3, cy + 0.1, 2.5, look.ink, 500);
  needle(g, cx, cy, (feet / 10000) * 360, R - 9, 2.2, "#f4f4f0", 2); // tusen fot
  needle(g, cx, cy, ((feet % 1000) / 1000) * 360, R - 3, 1.3, "#f4f4f0"); // hundre fot
  hub(g, cx, cy);
  glass(g, cx, cy, R, look);
}

function turnCoordinator(g: G2D, cx: number, cy: number, rateDegS: number, look: Look): void {
  bezel(g, cx, cy, R, look);
  // merker for vinger i vater og for standardsving (3°/s = 360° på 2 min)
  for (const d of [90, 110, 270, 250]) tick(g, cx, cy, d, R - 4.4, R - 0.8, 1, look.ink);
  text(g, "V", cx - 12.5, cy + 8.2, 2.8, look.ink);
  text(g, "H", cx + 12.5, cy + 8.2, 2.8, look.ink);
  text(g, "2 MIN", cx, cy + 15.8, 2, look.dim, 500);
  g.save();
  g.translate(cx, cy - 1); g.rotate((clamp(rateDegS / 3, -2, 2) * 20) / DEG);
  g.strokeStyle = "#f4f4f0"; g.fillStyle = "#f4f4f0"; g.lineCap = "round";
  g.lineWidth = 1.3; g.beginPath(); g.moveTo(-13, 0); g.lineTo(13, 0); g.stroke();
  g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -4.4); g.moveTo(-3.4, -2.6); g.lineTo(3.4, -2.6); g.stroke();
  g.beginPath(); g.arc(0, 0, 2, 0, 7); g.fill();
  g.lineCap = "butt";
  g.restore();
  // kule: flymodellen svinger alltid koordinert, så den ligger i midten
  const by = cy + 10.2;
  g.fillStyle = shade(214, 212, 196, 1 - 0.45 * look.night);
  g.beginPath(); g.roundRect(cx - 8, by - 2.2, 16, 4.4, 2.2); g.fill();
  g.strokeStyle = "#111"; g.lineWidth = 0.35;
  g.beginPath(); g.moveTo(cx - 2.5, by - 2.2); g.lineTo(cx - 2.5, by + 2.2); g.moveTo(cx + 2.5, by - 2.2); g.lineTo(cx + 2.5, by + 2.2); g.stroke();
  g.fillStyle = "#0a0a0a"; g.beginPath(); g.arc(cx, by, 1.9, 0, 7); g.fill();
  glass(g, cx, cy, R, look);
}

function headingIndicator(g: G2D, cx: number, cy: number, hdgDeg: number, look: Look): void {
  bezel(g, cx, cy, R, look);
  g.save();
  g.beginPath(); g.arc(cx, cy, R - 0.3, 0, 7); g.clip();
  g.translate(cx, cy); g.rotate(-hdgDeg / DEG); // skiva dreier, flyet står stille
  for (let d = 0; d < 360; d += 5) tick(g, 0, 0, d, d % 10 ? R - 2 : R - 3.4, R - 0.3, d % 10 ? 0.25 : 0.45, look.ink);
  for (let d = 0; d < 360; d += 30) {
    g.save();
    g.rotate(d / DEG);
    const cardinal = d % 90 === 0;
    text(g, cardinal ? "NØSV"[d / 90] : String(d / 10), 0, -(R - 6.6), cardinal ? 3.8 : 3, look.ink);
    g.restore();
  }
  g.restore();
  for (const d of [45, 90, 135, 180, 225, 270, 315]) tick(g, cx, cy, d, R - 0.2, R + 1.4, 0.4, look.dim);
  g.fillStyle = "#ffb020";
  g.beginPath(); g.moveTo(cx, cy - R + 0.4); g.lineTo(cx - 1.4, cy - R - 1.8); g.lineTo(cx + 1.4, cy - R - 1.8); g.closePath(); g.fill();
  // flysilhuett sett ovenfra
  g.strokeStyle = "#ffb020"; g.lineWidth = 0.7; g.lineCap = "round";
  g.beginPath();
  g.moveTo(cx, cy - 6.5); g.lineTo(cx, cy + 5.5);
  g.moveTo(cx - 5.5, cy - 0.6); g.lineTo(cx + 5.5, cy - 0.6);
  g.moveTo(cx - 2.2, cy + 4.6); g.lineTo(cx + 2.2, cy + 4.6);
  g.stroke();
  g.lineCap = "butt";
  glass(g, cx, cy, R, look);
}

function verticalSpeedIndicator(g: G2D, cx: number, cy: number, fpm: number, look: Look): void {
  const MAX = 6, deg = (v: number) => 270 + (clamp(v, -MAX, MAX) / MAX) * 172; // 0 står klokka 9
  bezel(g, cx, cy, R, look);
  for (let v = -MAX; v <= MAX + 1e-9; v += 0.5) tick(g, cx, cy, deg(v), Number.isInteger(v) ? R - 3.6 : R - 2, R - 0.3, Number.isInteger(v) ? 0.5 : 0.25, look.ink);
  for (const v of [-6, -4, -2, 0, 2, 4, 6]) dialText(g, String(Math.abs(v)), cx, cy, deg(v), R - 6.6, 3.2, look.ink);
  text(g, "OPP", cx - 6, cy - 5.4, 2, look.dim, 500);
  text(g, "NED", cx - 6, cy + 5.6, 2, look.dim, 500);
  text(g, "1000 FOT/MIN", cx + 5.4, cy + 4.4, 1.6, look.dim, 500);
  needle(g, cx, cy, deg(fpm / 1000), R - 3, 1.5, "#f4f4f0");
  hub(g, cx, cy);
  glass(g, cx, cy, R, look);
}

/* ---------- utstyr rundt ---------- */

function powerGauge(g: G2D, cx: number, cy: number, thr: number, look: Look): void {
  const r = 14, deg = (v: number) => 225 + clamp(v, 0, 1) * 270;
  bezel(g, cx, cy, r, look);
  arc(g, cx, cy, r - 1.1, deg(0.2), deg(0.9), 1.1, "#2f9e44");
  arc(g, cx, cy, r - 1.1, deg(0.9), deg(1), 1.1, "#e03131");
  for (let v = 0; v <= 10; v++) tick(g, cx, cy, deg(v / 10), v % 2 ? r - 1.8 : r - 3.2, r - 0.3, v % 2 ? 0.25 : 0.45, look.ink);
  for (const v of [0, 20, 40, 60, 80, 100]) dialText(g, String(v), cx, cy, deg(v / 100), r - 5.6, 2.5, look.ink);
  text(g, "EFFEKT %", cx, cy - 4.6, 1.9, look.dim, 500);
  needle(g, cx, cy, deg(thr), r - 2.6, 1.3, "#f4f4f0");
  hub(g, cx, cy, 1.3);
  glass(g, cx, cy, r, look);
}

function throttleLever(g: G2D, x: number, top: number, bottom: number, thr: number, look: Look): void {
  g.fillStyle = "#06070a"; g.beginPath(); g.roundRect(x - 1.6, top, 3.2, bottom - top, 1.6); g.fill();
  g.strokeStyle = shade(96, 100, 110, look.body); g.lineWidth = 0.3; g.stroke();
  const y = bottom - 4 - thr * (bottom - top - 8);
  g.fillStyle = shade(150, 152, 158, look.body); g.fillRect(x - 0.7, y, 1.4, bottom - y - 1.5);
  const knob = g.createLinearGradient(x - 5, y - 4, x + 5, y + 4);
  knob.addColorStop(0, shade(70, 72, 78, Math.max(look.body, 0.45)));
  knob.addColorStop(1, shade(12, 12, 14, 1));
  g.fillStyle = knob; g.beginPath(); g.roundRect(x - 5, y - 3.4, 10, 6.8, 2.2); g.fill();
  text(g, "GASS", x, top - 3, 1.9, look.dim, 500);
}

function lcd(g: G2D, x: number, y: number, w: number, h: number, value: string, caption: string, look: Look): void {
  g.fillStyle = shade(26, 28, 32, look.body); g.beginPath(); g.roundRect(x - 1, y - 1, w + 2, h + 2, 1.2); g.fill();
  g.fillStyle = "#0c1410"; g.fillRect(x, y, w, h);
  g.font = `600 ${h * 0.72}px ui-monospace, Menlo, Consolas, monospace`;
  g.fillStyle = "#7dffa0"; g.textAlign = "right"; g.textBaseline = "middle";
  g.fillText(value, x + w - 2, y + h / 2 + 0.2);
  g.font = `500 2px ${SANS}`; g.fillStyle = "#4f9f66"; g.textAlign = "left";
  g.fillText(caption, x + 1.6, y + h / 2 + 0.2);
}

export function drawPanel(g: G2D, t: Terrain, map: CanvasImageSource, game: Game): void {
  const P = game.P, night = game.env.sky.night;
  const look: Look = {
    night,
    body: 1 - 0.8 * night,
    ink: night > 0.5 ? "#ffd9a0" : "#f0f0ea",
    dim: night > 0.5 ? "#c9a878" : "#b9bcc2",
  };
  g.save();

  // stolper på hver side av frontruta
  g.fillStyle = shade(30, 33, 40, look.body);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(9, 0); g.lineTo(22, PANEL_TOP + 2); g.lineTo(0, PANEL_TOP + 2); g.fill();
  g.beginPath(); g.moveTo(W, 0); g.lineTo(W - 9, 0); g.lineTo(W - 22, PANEL_TOP + 2); g.lineTo(W, PANEL_TOP + 2); g.fill();
  g.fillRect(0, 0, W, 3);

  // panelplate
  const plate = g.createLinearGradient(0, PANEL_TOP, 0, H);
  plate.addColorStop(0, shade(62, 66, 76, look.body));
  plate.addColorStop(1, shade(40, 43, 50, look.body));
  g.fillStyle = plate; g.fillRect(0, PANEL_TOP, W, H - PANEL_TOP);
  // blendingsskjerm: mørk, svakt buet kant som kaster skygge på panelet
  const shadow = g.createLinearGradient(0, PANEL_TOP, 0, PANEL_TOP + 9);
  shadow.addColorStop(0, "rgba(0,0,0,.55)"); shadow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = shadow; g.fillRect(0, PANEL_TOP, W, 9);
  g.fillStyle = shade(18, 19, 23, Math.max(look.body, 0.5));
  g.beginPath(); g.moveTo(0, PANEL_TOP + 3); g.quadraticCurveTo(W / 2, PANEL_TOP - 7, W, PANEL_TOP + 3); g.lineTo(W, PANEL_TOP + 5.5);
  g.quadraticCurveTo(W / 2, PANEL_TOP - 3.5, 0, PANEL_TOP + 5.5); g.closePath(); g.fill();

  airspeed(g, COLS[0], ROWS[0], P.spd * KT, look);
  attitude(g, COLS[1], ROWS[0], P.pitch, P.roll, look);
  altimeter(g, COLS[2], ROWS[0], Math.max(0, P.alt * FT), look);
  turnCoordinator(g, COLS[0], ROWS[1], turnRate(P) * DEG, look);
  headingIndicator(g, COLS[1], ROWS[1], t.trueHeadingDeg(P.hdg), look);
  verticalSpeedIndicator(g, COLS[2], ROWS[1], verticalSpeed(P) * FT * 60, look);

  // kartskjerm til venstre
  const mx = 26, my = 124, ms = 50;
  g.fillStyle = shade(22, 24, 28, Math.max(look.body, 0.5)); g.beginPath(); g.roundRect(mx - 3, my - 3, ms + 6, ms + 6, 2); g.fill();
  g.fillStyle = "#000"; g.fillRect(mx, my, ms, ms);
  g.globalAlpha = 1 - 0.3 * night; // skjermen dempes om natta
  drawMap(g, t, map, game, mx, my, ms);
  g.globalAlpha = 1;
  const dist = (Math.hypot(game.airport.arp.x - P.x, game.airport.arp.y - P.y) * t.cell) / 1852;
  lcd(g, mx - 2, my + ms + 6, 26, 7, dist.toFixed(1), `${game.airport.icao} NM`, look);
  lcd(g, mx + 28, my + ms + 6, 24, 7, formatOslo(game.time), "KL", look);

  powerGauge(g, 252, 134, P.thr, look);
  throttleLever(g, 291, 126, 192, P.thr, look);
  lcd(g, 236, 158, 32, 7, String(Math.round(P.alt)), "ALT M", look);
  lcd(g, 236, 170, 32, 7, String(Math.round(Math.max(0, P.alt - Math.max(0, t.heightAt(P.x, P.y))))), "RADAR M", look);

  g.restore();
}
