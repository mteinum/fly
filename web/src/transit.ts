/* Kollektivtrafikk: ekte busser og tog fra Entur (åpne data, NLOD), hentet via /transit/ på serveren (web/public/transit).
 *
 * Ekte: hvilke kjøretøy som er ute, hvor de var da de sist meldte seg, linjenummeret og (for de fleste) retningen.
 * Dekningen er det selskapene sender til Entur: Ruter i Oslo og Bybanen i Bergen mangler.
 * SYNTETISK: formen og fargen (lik for alle av samme slag), størrelsen (busser tegnes 2,5 ganger for store, ellers
 * synes de ikke fra et fly) og bevegelsen mellom to meldinger: kjøretøyet glir i rett linje fra der det sto til
 * den nye posisjonen, og kan derfor kutte et sving over et jorde. Tog i tunnel tegnes oppå bakken.
 */
import type { Terrain } from "./terrain";

export type TransitMode = "bus" | "coach" | "rail" | "tram" | "metro";

/** Ett kjøretøy slik serveren sender det (se transit_parse i web/public/transit/lib.php). */
export interface TransitReport { id: string; mode: TransitMode; line: string; e: number; n: number; bearing: number | null; age: number }

export interface Vehicle {
  id: string; mode: TransitMode; line: string;
  /** Der kjøretøyet ble tegnet da siste melding kom, og der meldingen sier det er (rutenett). */
  fromX: number; fromY: number; toX: number; toY: number;
  /** Spillets klokke (s) da meldingen kom. */
  at: number;
  /** Rutenettkurs (rad). */
  heading: number;
}

/** Så lang tid bruker et kjøretøy på å gli til en ny posisjon: som tiden mellom to oppslag. */
export const GLIDE_S = 20;
const RAD = Math.PI / 180;
/** Lengre hopp enn dette er ikke kjøring, men en ny tur eller en rettet feil: da flyttes kjøretøyet rett dit. */
const MAX_GLIDE_M = 1500;
/** Kortere flytt enn dette endrer ikke retningen (GPS-støy på en buss som står). */
const TURN_MIN_M = 8;

/** Mål (m) og farge kjøretøyet tegnes med. SYNTETISK: ikke selskapenes farger. */
export function vehicleShape(mode: TransitMode): { lengthM: number; widthM: number; heightM: number; color: number } {
  switch (mode) {
    case "rail": return { lengthM: 110, widthM: 7, heightM: 9, color: 0x9a2a2a };
    case "metro": return { lengthM: 90, widthM: 7, heightM: 8.5, color: 0xf08a1c };
    case "tram": return { lengthM: 34, widthM: 6.5, heightM: 8.5, color: 0x3f8fd6 };
    case "coach": return { lengthM: 33, widthM: 6.5, heightM: 9, color: 0xf2f2ee };
    default: return { lengthM: 30, widthM: 6.5, heightM: 8, color: 0xd83a2e };
  }
}

/** Hvor kjøretøyet er nå: [x, y] i rutenettet. */
export function vehiclePosition(v: Vehicle, now: number): [number, number] {
  const k = Math.min(1, Math.max(0, (now - v.at) / GLIDE_S));
  return [v.fromX + (v.toX - v.fromX) * k, v.fromY + (v.toY - v.fromY) * k];
}

/** Kjøretøyene rundt flyplassen, holdt i jevn bevegelse mellom oppslagene. */
export class Transit {
  private vehicles = new Map<string, Vehicle>();

  update(list: TransitReport[], t: Terrain, now: number): void {
    const next = new Map<string, Vehicle>();
    for (const r of list) {
      if (!Number.isFinite(r.e) || !Number.isFinite(r.n)) continue;
      const [x, y] = t.utmToGrid(r.e, r.n);
      if (!t.inBounds(x, y)) continue;
      // sann -> rutenett: rutenett = sann - meridiankonvergens
      const reported = r.bearing === null ? null : (r.bearing - t.meta.gridConvergenceDeg) * RAD;
      const old = this.vehicles.get(r.id);
      let fromX = x, fromY = y, heading = reported ?? old?.heading ?? 0;
      if (old) {
        const [ox, oy] = vehiclePosition(old, now), moved = Math.hypot(x - ox, y - oy) * t.cell;
        if (moved <= MAX_GLIDE_M) {
          fromX = ox; fromY = oy;
          // retningen er dit kjøretøyet faktisk flytter seg; står det stille, det kilden sier eller det som var
          heading = moved >= TURN_MIN_M ? Math.atan2(x - ox, -(y - oy)) : reported ?? old.heading;
        }
      }
      next.set(r.id, { id: r.id, mode: r.mode, line: r.line, fromX, fromY, toX: x, toY: y, at: now, heading });
    }
    this.vehicles = next;
  }

  get list(): Vehicle[] { return [...this.vehicles.values()]; }
}
