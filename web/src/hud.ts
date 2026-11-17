/* Skjermtekst for utvendig kamera: flydata, kart og meldinger.
 * Alt tegnes i 320 x 200 logiske enheter; main.ts skalerer konteksten til skjermoppløsningen. */
import { formatOslo } from "./clock";
import type { Game } from "./game";
import { H, W } from "./screen";
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
  g.translate(x + P.x * k, y + P.y * k);
  g.rotate(P.hdg); // kartet er rutenett-nord opp, så rutenettkursen brukes direkte
  g.fillStyle = "#ff4a3d"; g.strokeStyle = "#fff"; g.lineWidth = 0.4;
  g.beginPath(); g.moveTo(0, -3.2); g.lineTo(2.2, 2.4); g.lineTo(0, 1.2); g.lineTo(-2.2, 2.4); g.closePath();
  g.fill(); g.stroke();
  g.restore();
}

export function drawMessage(g: CanvasRenderingContext2D, game: Game, y: number): void {
  if (game.msg.t <= 0) return;
  g.save();
  g.font = `bold 8px ${FONT}`; g.textAlign = "center";
  const w = g.measureText(game.msg.text).width + 12;
  g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(W / 2 - w / 2, y - 8.5, w, 12);
  g.fillStyle = "#ffd27a"; g.fillText(game.msg.text, W / 2, y);
  g.restore();
}

export function drawHud(g: CanvasRenderingContext2D, t: Terrain, map: CanvasImageSource, game: Game): void {
  const P = game.P, airport = game.airport;
  const gh = Math.max(0, t.heightAt(P.x, P.y));
  const dist = (Math.hypot(airport.arp.x - P.x, airport.arp.y - P.y) * t.cell) / 1000;
  const lines = [
    `ALT ${Math.round(P.alt)} m  AGL ${Math.round(P.alt - gh)}`,
    `FART ${Math.round(P.spd * 1.944)} kt  GASS ${Math.round(P.thr * 100)}%`,
    `${airport.icao} ${dist.toFixed(1)} km  KURS ${pad3(t.trueHeadingDeg(P.hdg))}`,
    `KL ${formatOslo(game.time)}`,
  ];
  g.save();
  g.font = `7px ${FONT}`; g.textAlign = "left";
  g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(3, 3, 112, 6 + lines.length * 9);
  g.fillStyle = "#ffe9b0";
  lines.forEach((l, i) => g.fillText(l, 6, 12 + i * 9));
  const m = 52, mx = W - m - 4, my = 4;
  g.fillStyle = "#000"; g.fillRect(mx - 1, my - 1, m + 2, m + 2);
  drawMap(g, t, map, game, mx, my, m);
  g.restore();
  drawMessage(g, game, H * 0.24);
}
