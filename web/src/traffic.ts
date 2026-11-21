/* Flytrafikk: ekte fly fra adsb.lol (åpne ADS-B-data, ODbL), hentet via /traffic/ på serveren (web/public/traffic).
 *
 * Ekte: hvilke fly som er der, posisjon, høyde, kurs, fart, stigning, kallesignal og flytype, slik flyet sender det.
 * Dekningen kommer fra frivillige mottakere: fly kan mangle, særlig lavt og langt fra byene.
 * SYNTETISK: formen flyet tegnes med, og bevegelsen mellom to oppdateringer (rett fram med samme fart og
 * stigning). Fly i sving og under landing avviker derfor litt fra der de egentlig er.
 *
 * Serveren har gjort lengde/bredde om til UTM 33 og GPS-høyde om til høyde over havet. Her gjøres bare
 * UTM -> rutenett og sann kurs -> rutenettkurs.
 */
import type { Terrain } from "./terrain";

const KT = 1.943844, RAD = Math.PI / 180, FPM = 0.00508; // fot per minutt -> m/s
/** Lenger enn dette flyttes ikke et fly fram fra siste posisjon (s). */
const MAX_COAST_S = 90;
const BLEND_RATE = 0.4;

/** Ett fly slik serveren sender det (se traffic_parse i web/public/traffic/lib.php). */
export interface AdsbAircraft {
  id: string; e: number; n: number;
  altM: number | null; alt: "geom" | "baro" | null; ground: boolean;
  gs: number | null; track: number | null; vr: number | null;
  age: number; flight: string; type: string; cat: string;
}

export interface Aircraft {
  id: string; flight: string; type: string; cat: string; ground: boolean;
  /** Posisjon i rutenettet og høyde (m over havet) da posisjonen ble sendt, og spillets klokke (s) da. */
  x: number; y: number; alt: number; at: number;
  /** Rutenettkurs (rad), fart over bakken (m/s) og stigning (m/s). */
  course: number; speed: number; climb: number;
  dx: number; dy: number; dz: number; blendAt: number;
}

/** Lengde og vingespenn (m) etter ADS-B-kategorien flyet sender. A7 er helikopter. Ukjent: som et mellomstort fly. */
export function aircraftSize(cat: string): { lengthM: number; spanM: number; rotor: boolean } {
  const sizes: Record<string, [number, number]> = { A1: [9, 11], A2: [18, 20], A3: [38, 35], A4: [47, 38], A5: [65, 60], A6: [16, 10], A7: [13, 11], B1: [7, 15], B4: [6, 9] };
  const [lengthM, spanM] = sizes[cat] ?? [30, 28];
  return { lengthM, spanM, rotor: cat === "A7" };
}

/** Gjør serverens liste om til fly i rutenettet. `now` er spillets klokke i sekunder. */
export function fromAdsb(list: AdsbAircraft[], t: Terrain, now: number): Aircraft[] {
  const out: Aircraft[] = [];
  for (const a of list) {
    if (!Number.isFinite(a.e) || !Number.isFinite(a.n) || !(a.age >= 0)) continue;
    // kategori C er kjøretøy og hindre på bakken (brøytebiler, følgebiler med sender), ikke fly
    if (a.cat.startsWith("C")) continue;
    const [x, y] = t.utmToGrid(a.e, a.n);
    if (!t.inBounds(x, y)) continue;
    const terrain = Math.max(0, t.heightAt(x, y));
    // på bakken: på terrenget. I lufta: aldri under terrenget (trykkhøyde kan være hundre meter feil)
    const alt = a.ground || a.altM === null ? terrain : Math.max(a.altM, terrain + 5);
    out.push({
      id: a.id, flight: a.flight, type: a.type, cat: a.cat, ground: a.ground,
      x, y, alt, at: now - a.age,
      // sann -> rutenett: rutenett = sann - meridiankonvergens
      course: ((a.track ?? 0) - t.meta.gridConvergenceDeg) * RAD,
      speed: a.gs !== null && a.gs > 1 ? a.gs / KT : 0,
      climb: a.ground || a.vr === null ? 0 : a.vr * FPM,
      dx: 0, dy: 0, dz: 0, blendAt: now,
    });
  }
  return out;
}

/** Hvor flyet er nå: [x, y, høyde]. Siste posisjon flyttet rett fram, pluss det som gjenstår av hoppet fra
 *  forrige anslag. Flyet synker aldri under terrenget. */
export function locate(a: Aircraft, t: Terrain, now: number): [number, number, number] {
  const dt = Math.min(Math.max(now - a.at, 0), MAX_COAST_S), d = (a.speed * dt) / t.cell;
  const fade = Math.exp(-BLEND_RATE * Math.max(now - a.blendAt, 0));
  const x = a.x + Math.sin(a.course) * d + a.dx * fade, y = a.y - Math.cos(a.course) * d + a.dy * fade;
  const floor = t.inBounds(x, y) ? Math.max(0, t.heightAt(x, y)) : 0;
  return [x, y, a.ground ? floor : Math.max(a.alt + a.climb * dt + a.dz * fade, floor + 5)];
}

/** Flyene rundt flyplassen, holdt i jevn bevegelse mellom oppdateringene. */
export class Traffic {
  private aircraft = new Map<string, Aircraft>();

  update(list: AdsbAircraft[], t: Terrain, now: number): void {
    const next = new Map<string, Aircraft>();
    for (const a of fromAdsb(list, t, now)) {
      const old = this.aircraft.get(a.id);
      if (old) {
        const [ox, oy, oz] = locate(old, t, now), [nx, ny, nz] = locate(a, t, now);
        // et fly kan ha flyttet seg langt på 45 s uten at det er feil: jevn ut opptil 3 km, ellers flytt rett dit
        if (Math.hypot(ox - nx, oy - ny) * t.cell < 3000) { a.dx = ox - nx; a.dy = oy - ny; a.dz = oz - nz; }
      }
      next.set(a.id, a);
    }
    this.aircraft = next;
  }

  get list(): Aircraft[] { return [...this.aircraft.values()]; }
}
