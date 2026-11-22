/* Sightseeing: signalbyggene i utsnittet (stedsnavn av typen «landemerke», fra data/landmarks.json) er steder å
 * fly over. Et sted er funnet når flyet passerer nær nok og lavt nok til å se det. Stedene er ekte; grensene
 * for «funnet» er valgt for spillet. */
import type { PlaceName } from "./labels";

export interface Sight { name: string; x: number; y: number; z: number; found: boolean }

/** Så nær må flyet være, målt langs bakken (m), og så høyt over stedet kan det høyst være (m). */
export const SIGHT_RADIUS_M = 450, SIGHT_MAX_ABOVE_M = 900;
/** Færre steder enn dette er ikke noe å samle på (Mehamn har ett). */
export const MIN_SIGHTS = 3;

export function sightsFrom(names: PlaceName[]): Sight[] {
  const list = names.filter((n) => n.type === "landemerke").map((n) => ({ name: n.name, x: n.x, y: n.y, z: n.z, found: false }));
  return list.length >= MIN_SIGHTS ? list : [];
}

/** Merk stedene flyet er over nå (rutenettceller, høyde i m) som funnet, og gi tilbake de nye. */
export function visitSights(sights: Sight[], x: number, y: number, alt: number, cell: number): Sight[] {
  const fresh = sights.filter((s) => !s.found && Math.hypot(s.x - x, s.y - y) * cell <= SIGHT_RADIUS_M && alt - s.z <= SIGHT_MAX_ABOVE_M);
  for (const s of fresh) s.found = true;
  return fresh;
}

/** «6:40» */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** Linja på diplomet: «and found all 9 sights in 6:40», «and found 4 of 9 sights», eller tom tekst. */
export const sightsLine = (s: { found: number; total: number; seconds: number | null } | null | undefined): string =>
  !s || s.found === 0 ? "" : s.found === s.total && s.seconds !== null ? `and found all ${s.total} sights in ${clock(s.seconds)}` : `and found ${s.found} of ${s.total} sights`;
