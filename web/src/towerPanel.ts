/* Interiøret i kontrolltårnet: vindussprosser, og en benk langs vinduet med utstyr.
 * Tegnes i 320 x 200 logiske enheter oppå 3D-bildet.
 *
 * Ekte: radarbildet (flyets posisjon, høyde og fart, rullebanen, kystlinja fra fargekartet),
 * klokka, bane i bruk, flyets tilstand på stripa.
 * Syntetisk: kallesignal, vind (flymodellen har ingen, så det står vindstille), QNH, lyspanelet
 * og hele innredningen. Slik tårnet på Kjevik faktisk ser ut innvendig er ikke undersøkt.
 */
import type { Game } from "./game";
import { FLAP_NAMES } from "./physics";
import { H, W } from "./screen";
import type { Terrain } from "./terrain";
import { azimuthToScreenX, SCOPE, type TowerView } from "./tower";

const SILL = 136; // overkant av benken
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const NM = 1852, KT = 1.943844, FT = 3.28084;
const CALLSIGN = "TFY320"; // oppdiktet
const RADAR_NM = 7;
const TRAIL_INTERVAL = 4000, TRAIL_LENGTH = 8;

type G2D = CanvasRenderingContext2D;
const shade = (r: number, g: number, b: number, f: number): string => `rgb(${(r * f) | 0},${(g * f) | 0},${(b * f) | 0})`;
const pad = (v: number, n: number): string => String(Math.round(v)).padStart(n, "0");

function text(g: G2D, str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "left", font = SANS, weight = 500): void {
  g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = "middle";
  g.fillText(str, x, y);
}

// Radarekko fra de siste omløpene: [rutenett-x, rutenett-y]
const trail: [number, number][] = [];
let lastEcho = 0;

function radar(g: G2D, cx: number, cy: number, r: number, t: Terrain, map: CanvasImageSource, game: Game, body: number): void {
  const P = game.P, tw = game.airport.tower, cellsPerUnit = (RADAR_NM * NM) / t.cell / r;
  const sx = (gx: number) => cx + (gx - tw.x) / cellsPerUnit, sy = (gy: number) => cy + (gy - tw.y) / cellsPerUnit;
  const now = performance.now();
  if (P.state === "fly" && now - lastEcho > TRAIL_INTERVAL) { trail.push([P.x, P.y]); if (trail.length > TRAIL_LENGTH) trail.shift(); lastEcho = now; }
  if (P.state !== "fly") trail.length = 0;

  g.fillStyle = shade(26, 28, 32, Math.max(body, 0.5)); g.beginPath(); g.arc(cx, cy, r + 3, 0, 7); g.fill();
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip();
  g.fillStyle = "#020a06"; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  // videokart: fargekartet svakt i bakgrunnen, nord opp (rutenett-nord)
  g.globalAlpha = 0.22;
  g.drawImage(map, sx(0), sy(0), t.width / cellsPerUnit, t.height / cellsPerUnit);
  g.globalAlpha = 1;
  g.fillStyle = "rgba(0,40,16,.45)"; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  g.strokeStyle = "#1f8a4a"; g.lineWidth = 0.3;
  for (let nm = 2; nm <= RADAR_NM; nm += 2) { g.beginPath(); g.arc(cx, cy, (nm / RADAR_NM) * r, 0, 7); g.stroke(); text(g, String(nm), cx + (nm / RADAR_NM) * r - 0.6, cy - 1.6, 2.2, "#2fae62", "right"); }
  // rullebane og forlengede senterlinjer med merke for hver nautiske mil
  for (const rw of game.airport.runways) {
    const [a, b] = rw.ends, ux = (b.x - a.x), uy = (b.y - a.y), len = Math.hypot(ux, uy), nmCells = NM / t.cell;
    g.strokeStyle = "#2fae62"; g.lineWidth = 0.25; g.setLineDash([1.2, 1.2]);
    g.beginPath(); g.moveTo(sx(a.x - (ux / len) * 7 * nmCells), sy(a.y - (uy / len) * 7 * nmCells)); g.lineTo(sx(b.x + (ux / len) * 7 * nmCells), sy(b.y + (uy / len) * 7 * nmCells)); g.stroke();
    g.setLineDash([]);
    for (const [e, dir] of [[a, -1], [b, 1]] as const) for (let n = 1; n <= 6; n++) {
      const px = e.x + dir * (ux / len) * n * nmCells, py = e.y + dir * (uy / len) * n * nmCells;
      g.beginPath(); g.moveTo(sx(px - (uy / len) * 12), sy(py + (ux / len) * 12)); g.lineTo(sx(px + (uy / len) * 12), sy(py - (ux / len) * 12)); g.stroke();
    }
    g.strokeStyle = "#e8fff0"; g.lineWidth = 0.9;
    g.beginPath(); g.moveTo(sx(a.x), sy(a.y)); g.lineTo(sx(b.x), sy(b.y)); g.stroke();
  }
  // sveip
  const sweep = ((now / 4000) % 1) * Math.PI * 2;
  const grad = g.createConicGradient(sweep - Math.PI / 2, cx, cy);
  grad.addColorStop(0, "rgba(80,255,150,0)"); grad.addColorStop(0.88, "rgba(80,255,150,0)"); grad.addColorStop(1, "rgba(80,255,150,.28)");
  g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  // ekko og merkelapp
  trail.forEach(([tx, ty], i) => { g.fillStyle = `rgba(120,255,170,${0.15 + (0.5 * i) / TRAIL_LENGTH})`; g.fillRect(sx(tx) - 0.5, sy(ty) - 0.5, 1, 1); });
  if (P.state === "fly" || P.state === "landed") {
    const bx = sx(P.x), by = sy(P.y);
    g.strokeStyle = "#d8ffe4"; g.lineWidth = 0.5; g.strokeRect(bx - 1.3, by - 1.3, 2.6, 2.6);
    // fartsvektor: hvor flyet er om ett minutt
    const lead = (P.spd * 60) / t.cell / cellsPerUnit;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.sin(P.hdg) * lead, by - Math.cos(P.hdg) * lead); g.stroke();
    const left = bx > cx + r * 0.3, lx = bx + (left ? -4 : 4), align = left ? "right" : "left";
    g.beginPath(); g.moveTo(bx + (left ? -1.3 : 1.3), by - 1.3); g.lineTo(lx, by - 5); g.stroke();
    text(g, CALLSIGN, lx, by - 7.6, 2.8, "#d8ffe4", align, MONO, 600);
    // høyde i hundre fot, fart i ti knop
    text(g, `${pad((P.alt * FT) / 100, 3)} ${pad((P.spd * KT) / 10, 2)}`, lx, by - 4.6, 2.8, "#d8ffe4", align, MONO, 600);
  }
  g.restore();
  text(g, `RADAR ${RADAR_NM} NM`, cx, cy + r + 5.4, 2.2, shade(200, 206, 214, Math.max(body, 0.55)), "center");
}

function display(g: G2D, x: number, y: number, w: number, h: number, label: string, value: string, body: number, color = "#ffb347"): void {
  g.fillStyle = shade(30, 33, 38, Math.max(body, 0.45)); g.beginPath(); g.roundRect(x - 0.8, y - 0.8, w + 1.6, h + 1.6, 0.8); g.fill();
  g.fillStyle = "#07090a"; g.fillRect(x, y, w, h);
  text(g, label, x + 1.2, y + 2, 2, "#9aa3ad");
  text(g, value, x + w - 1.4, y + h / 2 + 1.2, h * 0.52, color, "right", MONO, 600);
}

function strip(g: G2D, x: number, y: number, game: Game): void {
  const P = game.P, state = P.state === "landed" ? "LANDET" : P.state === "crash" ? "HAVARI" : P.gear >= 1 ? "HJUL NEDE" : "HJUL OPPE";
  const rwy = game.airport.runways[0].ends.reduce((a, b) => (Math.hypot(a.x - P.x, a.y - P.y) < Math.hypot(b.x - P.x, b.y - P.y) ? a : b)).ident;
  g.fillStyle = "#2b2f36"; g.fillRect(x - 1.5, y - 1.5, 49, 15);
  g.fillStyle = "#f1e9a8"; g.fillRect(x, y, 46, 12); // gul stripe = ankomst
  g.strokeStyle = "#7a7450"; g.lineWidth = 0.25;
  for (const lx of [16, 31]) { g.beginPath(); g.moveTo(x + lx, y); g.lineTo(x + lx, y + 12); g.stroke(); }
  text(g, CALLSIGN, x + 1.2, y + 3.4, 3.2, "#111", "left", MONO, 700);
  text(g, "A320  M", x + 1.2, y + 8.6, 2.4, "#333", "left", MONO);
  text(g, "ENCN", x + 17.2, y + 3.4, 2.8, "#111", "left", MONO, 600);
  text(g, `RWY ${rwy}`, x + 17.2, y + 8.6, 2.6, "#111", "left", MONO, 600);
  text(g, state, x + 32, y + 3.4, 2.2, P.state === "crash" ? "#b00000" : "#111", "left", MONO, 600);
  text(g, `KLAFF ${FLAP_NAMES[P.flapCfg]}`, x + 32, y + 8.6, 2.2, "#333", "left", MONO);
}

export function drawTower(g: G2D, t: Terrain, map: CanvasImageSource, game: Game, view: TowerView): void {
  const night = game.env.sky.night, body = 1 - 0.78 * night, frame = shade(44, 48, 56, body);
  g.save();

  // Vinduer: sprosser står fast i tårnet og glir forbi når blikket følger flyet
  g.fillStyle = frame;
  for (let k = 0; k < 16; k++) {
    const x = azimuthToScreenX((k * Math.PI) / 8 + 0.2, view.yaw);
    if (x === null) continue;
    g.beginPath(); g.moveTo(x - 2.2, 0); g.lineTo(x + 2.2, 0); g.lineTo(x + 3.2, SILL); g.lineTo(x - 3.2, SILL); g.closePath(); g.fill();
  }
  g.fillRect(0, 0, W, 7); // overkarm
  const blind = g.createLinearGradient(0, 7, 0, 16);
  blind.addColorStop(0, "rgba(0,0,0,.35)"); blind.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = blind; g.fillRect(0, 7, W, 9); // solskjerm

  // benk langs vinduet
  g.fillStyle = frame; g.fillRect(0, SILL - 3, W, 4);
  const top = g.createLinearGradient(0, SILL, 0, H);
  top.addColorStop(0, shade(70, 74, 82, body)); top.addColorStop(1, shade(46, 49, 56, body));
  g.fillStyle = top; g.fillRect(0, SILL + 1, W, H - SILL);
  g.fillStyle = "rgba(0,0,0,.3)"; g.fillRect(0, SILL + 1, W, 3);

  const ink = shade(214, 220, 228, Math.max(body, 0.55)), P = game.P, utc = new Date(game.time);
  radar(g, 40, 166, 24, t, map, game, body);

  // stripeholder
  strip(g, 72, 146, game);
  text(g, "ANKOMST", 72, 142.4, 2.2, ink);

  // kikkertkameraets skjerm: selve bildet tegnes av 3D-rendereren i dette rektangelet
  g.clearRect(SCOPE.x, SCOPE.y, SCOPE.w, SCOPE.h); // benken er tegnet over: åpne et hull ned til 3D-bildet
  g.fillStyle = shade(24, 26, 30, Math.max(body, 0.5));
  g.beginPath();
  g.roundRect(SCOPE.x - 3, SCOPE.y - 3, SCOPE.w + 6, SCOPE.h + 6, 1.6);
  g.rect(SCOPE.x + SCOPE.w, SCOPE.y, -SCOPE.w, SCOPE.h); // hull: her skal 3D-bildet synes
  g.fill("evenodd");
  g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = 0.25;
  const mx = SCOPE.x + SCOPE.w / 2, my = SCOPE.y + SCOPE.h / 2;
  g.beginPath(); g.moveTo(mx - 5, my); g.lineTo(mx - 1.5, my); g.moveTo(mx + 1.5, my); g.lineTo(mx + 5, my); g.moveTo(mx, my - 5); g.lineTo(mx, my - 1.5); g.moveTo(mx, my + 1.5); g.lineTo(mx, my + 5); g.stroke();
  text(g, `KAMERA  ${(view.distanceM / NM).toFixed(1)} NM  ${Math.round(50 / view.scopeFov)}x`, SCOPE.x + 1.2, SCOPE.y + 2.6, 2.4, "#e8ffe8", "left", MONO, 600);
  text(g, `${Math.round(P.alt * FT)} FT  ${Math.round(P.spd * KT)} KT`, SCOPE.x + SCOPE.w - 1.2, SCOPE.y + SCOPE.h - 2.6, 2.4, "#e8ffe8", "right", MONO, 600);

  // værpanel og klokke til høyre
  display(g, 204, 146, 34, 10, "VIND", "000/00KT", body); // vindstille: flymodellen har ingen vind
  display(g, 204, 160, 34, 10, "QNH", "1013", body);
  display(g, 204, 174, 34, 10, "UTC", `${pad(utc.getUTCHours(), 2)}:${pad(utc.getUTCMinutes(), 2)}:${pad(utc.getUTCSeconds(), 2)}`, body, "#7dffa0");

  // lyspanel: knappene lyser når banelysene står på fullt
  text(g, "BANELYS", 246, 142.4, 2.2, ink);
  ["KANT", "TERSKEL", "INNFL", "PAPI", "TAKSE", "FLOM"].forEach((s, i) => {
    const bx = 246 + (i % 3) * 14, by = 146 + ((i / 3) | 0) * 12, on = i < 3 || night > 0.3;
    g.fillStyle = on ? (i < 3 ? "#1f7a3a" : "#8a6a12") : "#17191c";
    g.beginPath(); g.roundRect(bx, by, 12, 9, 1); g.fill();
    text(g, s, bx + 6, by + 4.7, 2, on ? "#eaffea" : "#7c838c", "center", SANS, 600);
  });
  display(g, 246, 174, 40, 10, "BANE I BRUK", game.airport.runways[0].ends.reduce((a, b) => (Math.hypot(a.x - P.x, a.y - P.y) < Math.hypot(b.x - P.x, b.y - P.y) ? a : b)).ident, body, "#7dffa0");

  // kikkert og kaffekopp
  g.fillStyle = "#101214"; g.beginPath(); g.roundRect(294, 150, 8, 15, 2); g.roundRect(304, 150, 8, 15, 2); g.fill(); g.fillRect(300, 154, 6, 3);
  g.fillStyle = shade(230, 230, 224, Math.max(body, 0.5)); g.beginPath(); g.ellipse(303, 184, 5.5, 3, 0, 0, 7); g.fill();
  g.fillStyle = "#3a2414"; g.beginPath(); g.ellipse(303, 184, 4.2, 2.1, 0, 0, 7); g.fill();
  g.restore();
}
