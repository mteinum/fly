/* Tårnkameraet: du står i kontrolltårnet og følger flyet med blikket.
 * Felles geometri for 3D-bildet (glRenderer) og interiøret som tegnes oppå (towerPanel). */
import type { Plane } from "./plane";
import { ASPECT, W } from "./screen";
import type { Terrain } from "./terrain";

/** Loddrett synsvinkel for utsikten gjennom vinduene (grader). */
export const TOWER_FOV = 50;
/** Forstørrelsene kikkerten har. 1 er uten kikkert. */
export const TOWER_ZOOMS = [1, 2, 4, 8];
/** Loddrett synsvinkel (grader) med en gitt forstørrelse. */
export const towerFov = (zoom: number): number => (2 * Math.atan(Math.tan((TOWER_FOV * Math.PI) / 360) / zoom) * 180) / Math.PI;
/** Skjermen på benken som viser flyet gjennom kikkertkameraet (logiske enheter). */
export const SCOPE = { x: 126, y: 150, w: 68, h: 42 };

export interface TowerView {
  /** Øyets posisjon i verden (m): øst, høyde, sør. */
  eye: [number, number, number];
  /** Blikkretning mot flyet: rutenettkurs (rad) og vinkel over horisonten (rad). */
  yaw: number;
  pitch: number;
  /** Blikkets faktiske helning: hodet følger flyet opp, men ikke ned i benken. */
  headPitch: number;
  distanceM: number;
  /** Synsvinkel for kikkertkameraet (grader), valgt så flyet fyller omtrent en firedel av bildet. */
  scopeFov: number;
}

/** `zoom` er kikkertens forstørrelse: med kikkert følger blikket flyet helt, også ned mot bakken. */
export function towerView(t: Terrain, P: Plane, zoom = 1): TowerView {
  const tw = t.meta.airports[0].tower, cell = t.cell;
  const dx = (P.x - tw.x) * cell, dz = (P.y - tw.y) * cell, dy = P.alt + 3.6 - tw.eyeM;
  const ground = Math.hypot(dx, dz), dist = Math.hypot(ground, dy);
  const pitch = Math.atan2(dy, ground);
  return {
    eye: [tw.x * cell, tw.eyeM, tw.y * cell],
    yaw: Math.atan2(dx, -dz), // nord er -Z
    pitch,
    headPitch: zoom > 1 ? pitch : Math.min(Math.max(pitch, -0.1), 0.45),
    distanceM: dist,
    scopeFov: Math.min(Math.max(((4 * 38) / Math.max(dist, 1)) * (180 / Math.PI) * (SCOPE.h / SCOPE.w), 1.2), 30),
  };
}

/** Skjerm-x (logisk) for noe som står i rutenettretning `azimuth`, sett med blikket i retning `yaw`. */
export function azimuthToScreenX(azimuth: number, yaw: number, zoom = 1): number | null {
  let d = azimuth - yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  if (Math.abs(d) > 1.2) return null;
  const halfH = (Math.tan((TOWER_FOV * Math.PI) / 360) / zoom) * ASPECT;
  return W / 2 + (Math.tan(d) / halfH) * (W / 2);
}
