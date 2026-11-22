/* Stedsnavn i lufta: hvilke navn som skal vises fra der flyet er, og i hvilken rekkefølge.
 * Navnene, plassene og typene er ekte (N50, Sentralt stedsnavnregister). Hvor langt unna et navn
 * vises er valgt her, ut fra kartets skriftstørrelse: store navn ses langt, små bare på nært hold. */
import type { Terrain } from "./terrain";

export interface PlaceName {
  name: string;
  x: number; // rutenettceller
  y: number;
  z: number; // m over havet (brunavn ligger på brudekket)
  size: number; // kartets skriftstørrelse i 1:50 000
  type: string; // navneobjekttype, f.eks. «bru», «fjord», «ås»
  group: string; // navneobjekthovedgruppe, f.eks. «sjø», «bebyggelse»
}

/** Hvor langt unna (m) navnet vises. */
export function visibleRange(n: PlaceName): number {
  if (n.type === "flyplass") return 18000;
  const bySize = n.size >= 10 ? 20000 : n.size >= 8.5 ? 11000 : n.size >= 7.2 ? 6500 : n.size >= 6.3 ? 3500 : 2000;
  // bruer er små på kartet, men gode kjennemerker fra lufta
  return n.type === "bru" ? Math.max(bySize, 7000) : bySize;
}

export interface Candidate {
  place: PlaceName;
  distanceM: number;
}

/** Navnene innen rekkevidde av et punkt (rutenettceller, høyde i m), viktigste først. */
export function candidates(t: Terrain, x: number, y: number, alt: number, limit = 70): Candidate[] {
  const out: Candidate[] = [];
  for (const place of t.names) {
    const d = Math.hypot((place.x - x) * t.cell, (place.y - y) * t.cell, place.z - alt);
    if (d <= visibleRange(place) && d > 60) out.push({ place, distanceM: d });
  }
  // viktigst først: stor skrift, og ved lik størrelse det som er nærmest. Bruer regnes som viktige.
  const rank = (c: Candidate) => (c.place.type === "bru" || c.place.type === "flyplass" ? Math.max(c.place.size, 9) : c.place.size);
  return out.sort((a, b) => rank(b) - rank(a) || a.distanceM - b.distanceM).slice(0, limit);
}

/** Er det fri sikt fra øyet til navnet, eller ligger terreng imellom? Prøver langs siktlinja. */
export function inSight(t: Terrain, x: number, y: number, alt: number, place: PlaceName): boolean {
  const STEPS = 12;
  for (let i = 1; i < STEPS; i++) {
    const f = i / STEPS, sx = x + (place.x - x) * f, sy = y + (place.y - y) * f;
    const lineHeight = alt + (place.z + 20 - alt) * f; // navnet «står» 20 m over bakken
    if (Math.max(0, t.heightAt(sx, sy)) > lineHeight + 5) return false;
  }
  return true;
}

export interface Box { x: number; y: number; w: number; h: number }

/** Plasser tekstbokser i prioritert rekkefølge og dropp dem som ville overlappet en som alt står. */
export function declutter<T extends Box>(boxes: T[], max: number): T[] {
  const placed: T[] = [];
  for (const b of boxes) {
    if (placed.length >= max) break;
    const hit = placed.some((p) => b.x < p.x + p.w + 2 && p.x < b.x + b.w + 2 && b.y < p.y + p.h + 1 && p.y < b.y + b.h + 1);
    if (!hit) placed.push(b);
  }
  return placed;
}

/** Farge og skriftstil etter hva slags sted det er. */
export function labelStyle(n: PlaceName): { color: string; italic: boolean } {
  if (n.type === "stand") return { color: "#7dff9a", italic: false }; // standen flyet takser til: samme grønne som ruta
  if (n.type === "fly") return { color: "#ffffff", italic: false }; // andre fly fra ADS-B
  if (n.type === "skip") return { color: "#fff3a6", italic: false }; // skip fra AIS: samme gule som på kartet, dempet
  if (n.type === "bru" || n.type === "flyplass") return { color: "#ffd27a", italic: false };
  if (n.group === "sjø" || n.group === "ferskvann") return { color: "#bfe6ff", italic: true };
  if (n.group === "terreng") return { color: "#d9f0c4", italic: true };
  return { color: "#ffffff", italic: false };
}
