/* Terrengvarsel (GPWS), forenklet: ser framover langs banen flyet følger nå, og varsler når den går i terrenget.
 *
 * Ekte: terrenget (høydekartet) og flyets posisjon, fart, stigning og sving.
 * SYNTETISK: reglene. Et ekte EGPWS har flere modi og egne varselkurver. Her er det én regel: flyets bane
 * regnes fram i tid med samme fart, stigning og sving som nå, og sammenlignes med terrenget pluss en klaring.
 * Tidene og klaringen under er valgt for spillet.
 *
 * På eller over en 3°-glidebane til en av banene varsles det ikke, uansett hvor nær terrenget ligger under: ved
 * Mehamn bane 35 går glidebanen bare 9 m over en ås, og en riktig innflyging ville ellers gitt varsel hele veien.
 * (Et ekte EGPWS har tilsvarende unntak for bestemte flyplasser.)
 *
 * Bygninger, bruer og tårn er ikke med: varselet gjelder terrenget, slik det gjør i flyet.
 */
import { glidePathAltitude } from "./guidance";
import { turnRate, verticalSpeed } from "./physics";
import type { Plane } from "./plane";
import type { Airport, Terrain } from "./terrain";

/** Så langt fram ses det (s). Innenfor WARNING_S er varselet rødt («pull up»), ellers gult («terrain ahead»). */
export const CAUTION_S = 45, WARNING_S = 22;
/** Klaringen som kreves over terrenget langt fra en rullebane (m). 45 m er ca. 150 fot. */
const CLEARANCE_M = 45;
/** Nærmere en rullebane enn dette kreves ingen klaring, og derfra øker kravet med avstanden. */
const FREE_M = 600, CLEARANCE_PER_M = 0.03;
/** Kommer banen inn over flyplassen lavere enn dette, regnes det som en landing, og det ses ikke lenger fram. */
const ARRIVING_M = 150;
/** Innflygingskorridoren uten varsel: så langt til siden for forlenget senterlinje, og så langt under glidebanen (m). */
const CORRIDOR_HALF_WIDTH_M = 150, BELOW_GLIDE_M = 15, CORRIDOR_LENGTH_M = 12000;

export type TerrainAlert = { level: "caution" | "warning"; seconds: number };

/** Avstand (m) fra et punkt i rutenettet til nærmeste rullebane, målt til banens senterlinje. */
export function runwayDistance(t: Terrain, airport: Airport, x: number, y: number): number {
  let best = Infinity;
  for (const rw of airport.runways) {
    const [a, b] = rw.ends, dx = b.x - a.x, dy = b.y - a.y;
    const f = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - a.x - f * dx, y - a.y - f * dy) * t.cell);
  }
  return best;
}

/** Klaringen som kreves over terrenget i et punkt (m): full langt fra banene, null nær en bane. */
export const requiredClearance = (t: Terrain, airport: Airport, x: number, y: number): number =>
  Math.min(CLEARANCE_M, Math.max(0, (runwayDistance(t, airport, x, y) - FREE_M) * CLEARANCE_PER_M));

/** Om et punkt i høyden `alt` ligger i innflygingskorridoren til en av banene, på eller over glidebanen. */
export function onApproachPath(t: Terrain, airport: Airport, x: number, y: number, alt: number): boolean {
  for (const rw of airport.runways) for (const end of rw.ends) {
    const h = (end.headingGridDeg * Math.PI) / 180, ex = (x - end.x) * t.cell, ey = (y - end.y) * t.cell;
    const before = -(ex * Math.sin(h) - ey * Math.cos(h)), right = ex * Math.cos(h) + ey * Math.sin(h);
    if (before > 0 && before < CORRIDOR_LENGTH_M && Math.abs(right) < CORRIDOR_HALF_WIDTH_M && alt >= glidePathAltitude(t, end, before) - BELOW_GLIDE_M) return true;
  }
  return false;
}

/** Terrengvarselet som gjelder nå, eller null. `seconds` er tiden til banen går under klaringen. */
export function terrainAlert(P: Plane, t: Terrain, airport: Airport): TerrainAlert | null {
  if (P.state !== "fly") return null;
  const vs = verticalSpeed(P), rate = turnRate(P);
  let x = P.x, y = P.y, hdg = P.hdg;
  for (let s = 1; s <= CAUTION_S; s++) {
    hdg += rate;
    x += (Math.sin(hdg) * P.spd) / t.cell; y -= (Math.cos(hdg) * P.spd) / t.cell;
    if (!t.inBounds(x, y)) return null;
    const alt = P.alt + vs * s, ground = Math.max(0, t.heightAt(x, y));
    if (runwayDistance(t, airport, x, y) < FREE_M) {
      if (alt < ground + ARRIVING_M) return null; // på vei ned til flyplassen
      continue;
    }
    if (alt < ground + requiredClearance(t, airport, x, y) && !onApproachPath(t, airport, x, y, alt)) return { level: s <= WARNING_S ? "warning" : "caution", seconds: s };
  }
  return null;
}
