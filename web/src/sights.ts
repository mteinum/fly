/* Sightseeing: signalbyggene i utsnittet (stedsnavn av typen «landemerke», fra data/landmarks.json) er steder å
 * fly over. Et sted er funnet når flyet passerer nær nok og lavt nok til å se det. Stedene er ekte; grensene
 * for «funnet» er valgt for spillet. */
import type { PlaceName } from "./labels";

export interface Sight { name: string; x: number; y: number; z: number; found: boolean; photographed: boolean }

/** Så nær må flyet være, målt langs bakken (m), og så høyt over stedet kan det høyst være (m). */
export const SIGHT_RADIUS_M = 450, SIGHT_MAX_ABOVE_M = 900;
/** Færre steder enn dette er ikke noe å samle på (Mehamn har ett). */
export const MIN_SIGHTS = 3;

export function sightsFrom(names: PlaceName[]): Sight[] {
  const list = names.filter((n) => n.type === "landemerke").map((n) => ({ name: n.name, x: n.x, y: n.y, z: n.z, found: false, photographed: false }));
  return list.length >= MIN_SIGHTS ? list : [];
}

/** Merk stedene flyet er over nå (rutenettceller, høyde i m) som funnet, og gi tilbake de nye. */
export function visitSights(sights: Sight[], x: number, y: number, alt: number, cell: number): Sight[] {
  const fresh = sights.filter((s) => !s.found && Math.hypot(s.x - x, s.y - y) * cell <= SIGHT_RADIUS_M && alt - s.z <= SIGHT_MAX_ABOVE_M);
  for (const s of fresh) s.found = true;
  return fresh;
}

/** Så nær kameraet må et sted være for å telle som fotografert (m), rammen det må ligge innenfor i bildet (andel av
 *  bredde og høyde: midt i bildet, så det må siktes), og hvor mange steder ett bilde høyst kan gi. VALGT for spillet:
 *  med 3 km og hele bildet ga ett bilde over Oslo sentrum 12 av 17 steder. */
export const PHOTO_RANGE_M = 1500, PHOTO_FRAME = { left: 0.2, right: 0.8, top: 0.15, bottom: 0.78 }, PHOTO_MAX = 2;

/** Stedene som er med i bildet som tas nå, nærmeste først. `project` gir plassen i bildet for et punkt i verden
 *  (m: øst, høyde, sør), eller null utenfor; `clear` sier om det er fri sikt dit fra kameraet. */
export function sightsInPhoto(sights: Sight[], eye: [number, number, number], cell: number,
  project: (wx: number, wy: number, wz: number) => [number, number] | null, clear: (s: Sight) => boolean): Sight[] {
  const F = PHOTO_FRAME, seen: { s: Sight; d: number }[] = [];
  for (const s of sights) {
    const d = Math.hypot(s.x * cell - eye[0], s.z - eye[1], s.y * cell - eye[2]);
    if (d > PHOTO_RANGE_M) continue;
    const at = project(s.x * cell, s.z + 10, s.y * cell);
    if (at && at[0] >= F.left && at[0] <= F.right && at[1] >= F.top && at[1] <= F.bottom && clear(s)) seen.push({ s, d });
  }
  return seen.sort((a, b) => a.d - b.d).slice(0, PHOTO_MAX).map((x) => x.s);
}

/** «Operaen», «Operaen and Munchmuseet», «Operaen, Munchmuseet and 2 more». */
export function namesInPhoto(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** «6:40» */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** Linja på diplomet: «and found all 9 sights in 6:40», «and found 4 of 9 sights», eller tom tekst. */
export const sightsLine = (s: { found: number; total: number; seconds: number | null } | null | undefined): string =>
  !s || s.found === 0 ? "" : s.found === s.total && s.seconds !== null ? `and found all ${s.total} sights in ${clock(s.seconds)}` : `and found ${s.found} of ${s.total} sights`;
