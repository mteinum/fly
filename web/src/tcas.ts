/* Trafikkvarsel (TCAS), forenklet: hvilke andre fly som er nær nok og på vei mot oss til at flyet sier fra.
 *
 * Ekte: de andre flyenes posisjon, høyde, kurs, fart og stigning (ADS-B, se traffic.ts), og vårt eget fly.
 * SYNTETISK: reglene. Et ekte TCAS spør de andre flyenes transpondere og har følsomhetsnivåer som følger
 * høyden. Her brukes ett sett grenser, i samme størrelsesorden som de flyet bruker lavt: et fly gir
 * trafikkvarsel («traffic, traffic») når det er innen 0,4 NM, eller vil være det innen 30 s med den farten
 * flyene nærmer seg hverandre med nå, og samtidig er innen 850 fot i høyde, eller vil være det innen 30 s.
 * Spillet gir ikke unnvikelsesordre (RA, «climb» / «descend»).
 */

const NM = 1852, FT = 3.28084;
export const ADVISORY_S = 30, ADVISORY_RANGE_M = 0.4 * NM, ADVISORY_ALT_M = 850 / FT;
/** Nær trafikk uten varsel: vises som fylt rombe. */
export const PROXIMATE_RANGE_M = 6 * NM, PROXIMATE_ALT_M = 1200 / FT;

/** «ground» vises ikke på ND. «advisory» er trafikkvarsel (gul sirkel). */
export type TcasLevel = "ground" | "other" | "proximate" | "advisory";

/** Et fly i rutenettet: posisjon i celler, høyde i m, rutenettkurs i radianer, fart og stigning i m/s. */
export interface Mover { x: number; y: number; alt: number; course: number; speed: number; climb: number }

/** Hvordan TCAS ser et annet fly. `cell` er cellestørrelsen i meter. */
export function tcasLevel(own: Mover, other: Mover & { ground: boolean }, cell: number): TcasLevel {
  if (other.ground) return "ground";
  const rx = (other.x - own.x) * cell, ry = (other.y - own.y) * cell, range = Math.hypot(rx, ry), dz = other.alt - own.alt;
  // relativ fart i rutenettet (y øker mot sør), og hvor fort avstanden krymper
  const vx = Math.sin(other.course) * other.speed - Math.sin(own.course) * own.speed;
  const vy = -Math.cos(other.course) * other.speed + Math.cos(own.course) * own.speed;
  const closure = -(rx * vx + ry * vy) / Math.max(range, 1), vz = other.climb - own.climb;
  const close = range <= ADVISORY_RANGE_M || (closure > 0 && (range - ADVISORY_RANGE_M) / closure <= ADVISORY_S);
  const level = Math.abs(dz) <= ADVISORY_ALT_M || (dz * vz < 0 && (Math.abs(dz) - ADVISORY_ALT_M) / Math.abs(vz) <= ADVISORY_S);
  if (close && level) return "advisory";
  return range < PROXIMATE_RANGE_M && Math.abs(dz) < PROXIMATE_ALT_M ? "proximate" : "other";
}
