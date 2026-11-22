/* Skjermtekst for utvendig kamera: flydata, kart og meldinger.
 * Alt tegnes i 320 x 200 logiske enheter; main.ts skalerer konteksten til skjermoppløsningen. */
import { formatOslo } from "./clock";
import type { Game } from "./game";
import { FLAP_NAMES } from "./physics";
import { TOP, W } from "./screen";
import type { Terrain } from "./terrain";

const pad3 = (deg: number): string => String(Math.round(deg) % 360).padStart(3, "0");
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Kart med nord opp: rullebaner og flyets posisjon og kurs. */
export function drawMap(g: CanvasRenderingContext2D, t: Terrain, map: CanvasImageSource, game: Game, x: number, y: number, size: number): void {
  const k = size / t.width, P = game.P;
  g.save();
  g.beginPath(); g.rect(x, y, size, size); g.clip();
  g.drawImage(map, x, y, size, size);
  g.strokeStyle = "#fff"; g.lineWidth = 0.8;
  for (const rw of game.airport.runways) {
    g.beginPath();
    g.moveTo(x + rw.ends[0].x * k, y + rw.ends[0].y * k);
    g.lineTo(x + rw.ends[1].x * k, y + rw.ends[1].y * k);
    g.stroke();
  }
  // Sightseeing: stedene som gjenstår som gule ruter, de som er funnet som grønne
  g.strokeStyle = "rgba(0,0,0,.75)"; g.lineWidth = 0.25;
  for (const s of game.sights.list) {
    g.fillStyle = s.found ? "#3ddc6a" : "#ffb000";
    g.beginPath(); g.rect(x + s.x * k - 0.9, y + s.y * k - 0.9, 1.8, 1.8); g.fill(); g.stroke();
    // fotografert: en hvit prikk i ruta
    if (s.photographed) { g.fillStyle = "#fff"; g.fillRect(x + s.x * k - 0.35, y + s.y * k - 0.35, 0.7, 0.7); }
  }
  // Skip (fra AIS): en liten gul kile i fartsretningen når skipet går, en prikk når det ligger stille
  g.fillStyle = "#ffe14d"; g.strokeStyle = "rgba(0,0,0,.7)"; g.lineWidth = 0.25;
  for (const s of game.ships) {
    g.save();
    g.translate(x + s.x * k, y + s.y * k);
    g.beginPath();
    if (s.speed > 1) { g.rotate(s.heading); g.moveTo(0, -1.5); g.lineTo(0.9, 1); g.lineTo(-0.9, 1); g.closePath(); }
    else g.arc(0, 0, 0.6, 0, Math.PI * 2);
    g.fill(); g.stroke();
    g.restore();
  }
  // Andre fly (fra ADS-B): en liten hvit pil i fartsretningen
  g.fillStyle = "#ffffff"; g.strokeStyle = "rgba(0,0,0,.75)"; g.lineWidth = 0.25;
  for (const a of game.traffic) {
    g.save();
    g.translate(x + a.x * k, y + a.y * k);
    g.rotate(a.heading);
    g.beginPath(); g.moveTo(0, -1.8); g.lineTo(1.3, 1.3); g.lineTo(0, 0.6); g.lineTo(-1.3, 1.3); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }
  // Punktet spilleren har trykket på: stiplet linje fra flyet og et kryss
  if (game.directTo) {
    const tx = x + game.directTo.x * k, ty = y + game.directTo.y * k;
    g.strokeStyle = "#ff4a3d"; g.lineWidth = 0.5;
    g.setLineDash([1.5, 1.2]); g.beginPath(); g.moveTo(x + P.x * k, y + P.y * k); g.lineTo(tx, ty); g.stroke(); g.setLineDash([]);
    g.strokeStyle = "#fff"; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(tx - 1.6, ty - 1.6); g.lineTo(tx + 1.6, ty + 1.6); g.moveTo(tx + 1.6, ty - 1.6); g.lineTo(tx - 1.6, ty + 1.6); g.stroke();
  }
  g.translate(x + P.x * k, y + P.y * k);
  g.rotate(P.hdg); // kartet er rutenett-nord opp, så rutenettkursen brukes direkte
  g.fillStyle = "#ff4a3d"; g.strokeStyle = "#fff"; g.lineWidth = 0.4;
  g.beginPath(); g.moveTo(0, -3.2); g.lineTo(2.2, 2.4); g.lineTo(0, 1.2); g.lineTo(-2.2, 2.4); g.closePath();
  g.fill(); g.stroke();
  g.restore();
}

/** Flyplasskart under taksing: rullebaner, taksebaner og oppstillingsflater, ruta til standen i grønt, og flyet.
 *  Rutenett-nord opp. Utsnittet følger ruta: alt fra flyet til standen er med, og minst 500 m på hver led. */
function drawGroundMap(g: CanvasRenderingContext2D, t: Terrain, game: Game, x: number, y: number, m: number): void {
  const plan = game.taxiPlan!, P = game.P, aero = t.aeroways;
  let x0 = P.x, x1 = P.x, y0 = P.y, y1 = P.y;
  for (const [px, py] of plan.route) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  const span = Math.max(x1 - x0, y1 - y0, 500 / t.cell) + 160 / t.cell, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, k = m / span;
  const sx = (px: number) => x + m / 2 + (px - cx) * k, sy = (py: number) => y + m / 2 + (py - cy) * k;
  const path = (pts: [number, number][], close = false) => { g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(sx(px), sy(py)) : g.moveTo(sx(px), sy(py)))); if (close) g.closePath(); };
  g.save();
  g.beginPath(); g.rect(x, y, m, m); g.clip();
  g.fillStyle = "#1d2b1f"; g.fillRect(x, y, m, m);
  g.lineCap = "round"; g.lineJoin = "round";
  if (aero) {
    g.fillStyle = "#565a60";
    for (const ring of aero.aprons) { path(ring, true); g.fill(); }
    g.strokeStyle = "#6c7077";
    for (const tw of aero.taxiways) { g.lineWidth = Math.max(0.5, (tw.width / t.cell) * k); path(tw.line); g.stroke(); }
  }
  g.strokeStyle = "#a9adb4";
  for (const rw of game.airport.runways) { g.lineWidth = Math.max(0.8, (rw.widthM / t.cell) * k); path([[rw.ends[0].x, rw.ends[0].y], [rw.ends[1].x, rw.ends[1].y]]); g.stroke(); }
  g.strokeStyle = "#2fe04a"; g.lineWidth = 0.8; path(plan.route); g.stroke();
  const [stx, sty] = plan.stand.at;
  g.fillStyle = "#2fe04a"; g.beginPath(); g.arc(sx(stx), sy(sty), 1.6, 0, Math.PI * 2); g.fill();
  g.font = `bold 4px ${FONT}`; g.textAlign = "center"; g.fillStyle = "#d8ffe0";
  g.fillText(plan.stand.ref || "APRON", sx(stx), sy(sty) - 2.6);
  g.translate(sx(P.x), sy(P.y));
  g.rotate(P.hdg);
  g.fillStyle = "#ff4a3d"; g.strokeStyle = "#fff"; g.lineWidth = 0.4;
  g.beginPath(); g.moveTo(0, -3.2); g.lineTo(2.2, 2.4); g.lineTo(0, 1.2); g.lineTo(-2.2, 2.4); g.closePath();
  g.fill(); g.stroke();
  g.restore();
}

const CORNER_MAP = 52;

/** Punktet i rutenettet under (lx, ly) i oversiktskartet, eller null utenfor det. Logiske enheter fra venstre
 *  vinduskant; `inset` som i drawCornerMap. Under taksing viser hjørnet flyplasskartet, og da er det ingenting å treffe. */
export function cornerMapPoint(lx: number, ly: number, t: Terrain, game: Game, inset: number): [number, number] | null {
  if (game.P.state !== "fly") return null;
  const u = (lx - (W - CORNER_MAP - inset)) / CORNER_MAP, v = (ly - (TOP + 4)) / CORNER_MAP;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [u * t.width, v * t.height] : null;
}

/** Oversiktskartet oppe i høyre hjørne. `inset` er avstanden fra høyre kant (i cockpit står vindusstolpen der). */
export function drawCornerMap(g: CanvasRenderingContext2D, t: Terrain, map: CanvasImageSource, game: Game, inset: number): void {
  const m = CORNER_MAP, mx = W - m - inset, my = TOP + 4;
  g.save();
  g.fillStyle = "#000"; g.fillRect(mx - 1, my - 1, m + 2, m + 2);
  if (game.taxiPlan && game.P.state === "landed") drawGroundMap(g, t, game, mx, my, m);
  else drawMap(g, t, map, game, mx, my, m);
  g.restore();
}

/** Sightseeing-telleren under oversiktskartet (cockpit, der skjermteksten ikke vises). */
export function drawSightsCount(g: CanvasRenderingContext2D, game: Game, inset: number): void {
  if (!game.sights.list.length || game.P.state !== "fly") return;
  g.save();
  g.font = `5px ${FONT}`; g.textAlign = "right";
  g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(W - inset - CORNER_MAP, TOP + 4 + CORNER_MAP + 1.5, CORNER_MAP, 7);
  g.fillStyle = "#ffe9b0"; g.fillText(`SIGHTS ${game.sights.found}/${game.sights.list.length} PHOTOS ${game.sights.photos}`, W - inset - 1.5, TOP + 4 + CORNER_MAP + 6.8);
  g.restore();
}

/** Del en tekst i linjer som hver er høyst `max` brede, ved ordskiller. `width` måler en tekst. */
export function wrapText(text: string, max: number, width: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > max) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function drawMessage(g: CanvasRenderingContext2D, game: Game, y: number): void {
  if (game.msg.t <= 0) return;
  g.save();
  g.font = `bold 8px ${FONT}`; g.textAlign = "center";
  // En lang melding brytes over flere linjer ved ordskiller, så den aldri går ut over vinduskanten
  // bredden er det som er fritt mellom hjørnekartet til høyre og samme avstand til venstre (teksten er midtstilt)
  const lines = wrapText(game.msg.text, W - 2 * (CORNER_MAP + 22), (s) => g.measureText(s).width);
  const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 12;
  g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(W / 2 - w / 2, y - 8.5, w, 2 + lines.length * 10);
  g.fillStyle = "#ffd27a";
  lines.forEach((l, i) => g.fillText(l, W / 2, y + i * 10));
  g.restore();
}

export function drawHud(g: CanvasRenderingContext2D, t: Terrain, map: CanvasImageSource, game: Game): void {
  const P = game.P, airport = game.airport;
  const gh = Math.max(0, t.heightAt(P.x, P.y));
  const dist = (Math.hypot(airport.arp.x - P.x, airport.arp.y - P.y) * t.cell) / 1000;
  const lines = [
    `ALT ${Math.round(P.alt)} m  AGL ${Math.round(P.alt - gh)}`,
    `SPD ${Math.round(P.spd * 1.944)} kt  THR ${Math.round(P.thr * 100)}%`,
    `${airport.icao} ${dist.toFixed(1)} km  HDG ${pad3(t.trueHeadingDeg(P.hdg))}`,
    `FLAPS ${FLAP_NAMES[P.flapCfg]}  GEAR ${P.gear >= 1 ? "DOWN" : P.gear <= 0 ? "UP" : "..."}${P.brake > 0.05 ? "  SPD BRK" : ""}  ${formatOslo(game.time)} LT`,
  ];
  if (game.sights.list.length) lines.push(`SIGHTS ${game.sights.found}/${game.sights.list.length}  PHOTOS ${game.sights.photos}/${game.sights.list.length}`);
  // På bakken: en linje om bremsene, så det synes at mellomrom og Enter virker
  if (P.state === "landed") lines.push(P.parked ? "PARKING BRAKE SET" : `${P.taxi ? "TAXI" : "ROLLOUT"}  BRAKES ${P.wheelBrake > 0.02 ? `${Math.round(P.wheelBrake * 100)}%` : "OFF"}`);
  g.save();
  g.font = `7px ${FONT}`; g.textAlign = "left";
  g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(3, TOP + 3, 138, 6 + lines.length * 9);
  g.fillStyle = "#ffe9b0";
  lines.forEach((l, i) => g.fillText(l, 6, TOP + 12 + i * 9));
  g.restore();
  drawCornerMap(g, t, map, game, 4);
  drawMessage(g, game, TOP + 60);
}
