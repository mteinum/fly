/* Veiledning på innflyging: hvor flyet er i forhold til senterlinja og en 3° glidebane.
 * Vises på PFD som et ILS-anlegg ville vist det (kursviser og glidebaneviser).
 *
 * SYNTETISK: dette er geometri regnet fra baneendene i OurAirports, ikke flyplassens ILS.
 * Ekte anlegg har egen plassering, frekvens og vinkel, og ikke alle baner har ILS.
 */
import type { Plane } from "./plane";
import type { Runway, RunwayEnd, Terrain } from "./terrain";

export const GLIDE_ANGLE_DEG = 3;
/** Glidebanen treffer banen her, målt fra terskelen (siktepunktmerkene ligger 300 m inne). */
export const AIM_POINT_M = 300;
/** Ett merke på skalaen, i grader. Fullt utslag er to merker. */
export const GLIDE_DOT_DEG = 0.35;
export const COURSE_DOT_DEG = 0.8;
const MAX_RANGE_M = 25 * 1852;
const RAD = Math.PI / 180;

export interface Guidance {
  /** Avvik fra senterlinja i merker: positiv = flyet ligger til HØYRE for linja (viseren står til venstre). */
  courseDots: number;
  /** Avvik fra glidebanen i merker: positiv = flyet ligger OVER banen (viseren står under midten). */
  glideDots: number;
  /** Avstand til siktepunktet i meter. */
  distanceM: number;
}

/** Hvor glidebanen treffer banen: avstand fra baneenden, og høyden der (m over havet). */
export function aimPoint(t: Terrain, end: RunwayEnd): { fromEndM: number; elevationM: number } {
  const h = end.headingGridDeg * RAD, fromEndM = end.displacedThresholdM + AIM_POINT_M;
  return { fromEndM, elevationM: Math.max(0, t.heightAt(end.x + (Math.sin(h) * fromEndM) / t.cell, end.y - (Math.cos(h) * fromEndM) / t.cell)) };
}

/** Høyden (m over havet) glidebanen har `distanceM` før baneenden. */
export function glidePathAltitude(t: Terrain, end: RunwayEnd, distanceM: number): number {
  const aim = aimPoint(t, end);
  return aim.elevationM + (distanceM + aim.fromEndM) * Math.tan(GLIDE_ANGLE_DEG * RAD);
}

/** Veiledning mot baneenden `end`, eller null når flyet er forbi siktepunktet, for langt unna eller bak senderen. */
export function guidance(t: Terrain, rw: Runway, end: RunwayEnd, P: Plane): Guidance | null {
  const h = end.headingGridDeg * RAD, cell = t.cell;
  const ex = (P.x - end.x) * cell, ey = (P.y - end.y) * cell;
  // langs innflygingsretningen (nord = -y), og til høyre for den
  const along = ex * Math.sin(h) - ey * Math.cos(h), right = ex * Math.cos(h) + ey * Math.sin(h);
  const aim = aimPoint(t, end), toAim = aim.fromEndM - along;
  const length = Math.hypot(rw.ends[1].x - rw.ends[0].x, rw.ends[1].y - rw.ends[0].y) * cell;
  // kurssenderen står i den andre enden av banen: avviket er vinkelen sett derfra
  const toFarEnd = length - along;
  if (toAim <= 0 || toAim > MAX_RANGE_M || toFarEnd <= 0) return null;
  const courseDeg = Math.atan2(right, toFarEnd) / RAD;
  if (Math.abs(courseDeg) > 35) return null;
  const glideDeg = Math.atan2(P.alt - aim.elevationM, toAim) / RAD;
  return { courseDots: courseDeg / COURSE_DOT_DEG, glideDots: (glideDeg - GLIDE_ANGLE_DEG) / GLIDE_DOT_DEG, distanceM: toAim };
}
