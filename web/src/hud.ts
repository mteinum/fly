/* HUD, minikart og cockpitramme med instrumenter. */
import { clamp } from "./colors";
import type { LayerStack } from "./layers";
import { MAX_ALT } from "./physics";
import type { Plane } from "./plane";
import { H, W } from "./screen";
import type { Airport, Terrain } from "./terrain";
import { HORIZON } from "./voxelRenderer";

export type Camera = "chase" | "cockpit";

export interface Message {
  text: string;
  t: number;
}

const pad3 = (deg: number): string => String(Math.round(deg) % 360).padStart(3, "0");

function gauge(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, v: number, label: string): void {
  g.fillStyle = "#0e1015";
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  g.strokeStyle = "#59606c"; g.lineWidth = 1; g.stroke();
  const a = -Math.PI * 1.25 + clamp(v, 0, 1) * Math.PI * 1.5;
  g.strokeStyle = "#ffd27a";
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); g.stroke();
  g.fillStyle = "#8c93a0"; g.font = "6px monospace"; g.textAlign = "center";
  g.fillText(label, cx, cy + r + 6);
}

export function drawCockpitFrame(g: CanvasRenderingContext2D, t: Terrain, P: Plane): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#1b1f27";
  g.beginPath(); g.moveTo(0, 0); g.lineTo(12, 0); g.lineTo(34, H - 44); g.lineTo(0, H - 44); g.fill();
  g.beginPath(); g.moveTo(W, 0); g.lineTo(W - 12, 0); g.lineTo(W - 34, H - 44); g.lineTo(W, H - 44); g.fill();
  g.fillRect(0, 0, W, 5);
  g.fillStyle = "#2b313b"; g.fillRect(0, H - 44, W, 44);
  g.fillStyle = "#3b4250"; g.fillRect(0, H - 44, W, 2);
  gauge(g, 70, H - 24, 13, P.spd / 220, "FART");
  gauge(g, 250, H - 24, 13, P.alt / MAX_ALT, "HØYDE");
  gauge(g, 282, H - 24, 10, P.thr, "GASS");
  // kunstig horisont
  const cx = W / 2, cy = H - 24, r = 15;
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip();
  g.translate(cx, cy); g.rotate(-P.roll);
  g.fillStyle = "#4a8fd0"; g.fillRect(-30, -30, 60, 30 + P.pitch * 40);
  g.fillStyle = "#8a5a32"; g.fillRect(-30, P.pitch * 40, 60, 40);
  g.restore();
  g.strokeStyle = "#59606c"; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  g.strokeStyle = "#ffd27a";
  g.beginPath(); g.moveTo(cx - 9, cy); g.lineTo(cx - 3, cy); g.moveTo(cx + 3, cy); g.lineTo(cx + 9, cy); g.stroke();
  // kompass (sann kurs)
  g.fillStyle = "#0e1015"; g.fillRect(100, H - 34, 36, 12);
  g.fillStyle = "#9fffa0"; g.font = "8px monospace"; g.textAlign = "center";
  g.fillText(pad3(t.trueHeadingDeg(P.hdg)), 118, H - 25);
  g.fillStyle = "#8c93a0"; g.font = "6px monospace"; g.fillText("KURS", 118, H - 14);
  // HUD-sikte
  g.strokeStyle = "rgba(140,255,160,.8)";
  g.beginPath(); g.arc(W / 2, HORIZON, 3, 0, 7);
  g.moveTo(W / 2 - 10, HORIZON); g.lineTo(W / 2 - 4, HORIZON); g.moveTo(W / 2 + 4, HORIZON); g.lineTo(W / 2 + 10, HORIZON);
  g.stroke();
}

export function drawHud(g: CanvasRenderingContext2D, t: Terrain, stack: LayerStack, airport: Airport, P: Plane, cam: Camera, msg: Message): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.textAlign = "left"; g.font = "8px monospace";
  const gh = Math.max(0, t.heightAt(P.x, P.y));
  const dist = (Math.hypot(airport.arp.x - P.x, airport.arp.y - P.y) * t.cell) / 1000;
  const lines = [
    `ALT ${Math.round(P.alt)} m  AGL ${Math.round(P.alt - gh)}`,
    `FART ${Math.round(P.spd * 1.944)} kt  GASS ${Math.round(P.thr * 100)}%`,
    `${airport.icao} ${dist.toFixed(1)} km  KURS ${pad3(t.trueHeadingDeg(P.hdg))}`,
  ];
  g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(2, 2, 128, 32);
  g.fillStyle = "#ffe9b0";
  lines.forEach((l, i) => g.fillText(l, 5, 11 + i * 10));
  // minikart: nord opp
  const m = 56, mx = W - m - 3, my = 3, k = m / t.width;
  g.fillStyle = "#000"; g.fillRect(mx - 1, my - 1, m + 2, m + 2);
  g.drawImage(stack.minimap, mx, my, m, m);
  g.strokeStyle = "#fff"; g.lineWidth = 1;
  for (const rw of airport.runways) {
    g.beginPath();
    g.moveTo(mx + rw.ends[0].x * k, my + rw.ends[0].y * k);
    g.lineTo(mx + rw.ends[1].x * k, my + rw.ends[1].y * k);
    g.stroke();
  }
  g.fillStyle = "#ff3b3b"; g.fillRect(mx + P.x * k - 1, my + P.y * k - 1, 3, 3);
  g.fillStyle = "#9fd0ff"; g.font = "7px monospace";
  g.fillText(cam === "chase" ? "JAKT · sprite stack" : "COCKPIT · voxel space", 4, H - (cam === "chase" ? 4 : 47));
  if (msg.t > 0) {
    g.font = "bold 9px monospace"; g.textAlign = "center";
    const w = g.measureText(msg.text).width + 12;
    g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(W / 2 - w / 2, H * 0.22 - 9, w, 13);
    g.fillStyle = "#ffd27a"; g.fillText(msg.text, W / 2, H * 0.22);
    g.textAlign = "left";
  }
}
