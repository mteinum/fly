/* Jaktkamera: sprite stacking. Stabelen roteres med kursen og forskyves loddrett. */
import { clamp, css } from "./colors";
import type { LayerStack } from "./layers";
import { drawPlane, type Plane } from "./plane";
import { H, W } from "./screen";
import type { Terrain } from "./terrain";

/** Vertikal overdrivelse i jaktkamera. Sørlandsterrenget (0-330 m) blir ellers nesten flatt på 50 m-celler. */
export const VEX = 2.0;
const TILT = 0.6;

export function renderChase(g: CanvasRenderingContext2D, t: Terrain, stack: LayerStack, sprites: HTMLCanvasElement[], P: Plane): void {
  const s = clamp(5 - (P.alt - 30) / 100, 1.6, 5), pxPerM = (s / t.cell) * VEX;
  const planeY = H * 0.74, groundY = planeY + P.alt * pxPerM;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = css(t.seaColor);
  g.fillRect(0, 0, W, H);
  const gh = Math.max(0, t.heightAt(P.x, P.y));
  let pd = false, sd = false;
  const shadow = () => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "rgba(0,0,0,.35)";
    g.beginPath();
    g.ellipse(W / 2, planeY + (P.alt - gh) * pxPerM, 14, 4, 0, 0, 7);
    g.fill();
    sd = true;
  };
  for (const L of stack.layers) {
    if (!sd && L.hk > gh) shadow();
    if (!pd && L.hk > P.alt) { drawPlane(g, sprites, P, planeY, TILT); pd = true; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.translate(W / 2, groundY - L.hk * pxPerM);
    g.scale(s, s * TILT);
    g.rotate(-P.hdg);
    g.translate(L.x0 - P.x, L.y0 - P.y);
    g.drawImage(L.cv, 0, 0);
  }
  if (!sd) shadow();
  if (!pd) drawPlane(g, sprites, P, planeY, TILT);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
