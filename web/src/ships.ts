/* Skipstrafikk: ekte skip fra Kystverkets åpne AIS-data, hentet via /ais/ på serveren (web/public/ais).
 *
 * Ekte: hvilke skip som er der, hvor de er, kurs, fart, navn, type og mål (det skipet selv sender).
 * Fiskefartøy under 15 m og fritidsfartøy under 45 m er ikke med i de åpne dataene.
 * SYNTETISK: formen og fargen skipet tegnes med, og bevegelsen mellom to meldinger (rett fram med samme fart).
 *
 * Ren regning uten three.js, så den kan testes uten nettleser. Serveren har alt gjort lengde/bredde om til
 * UTM 33; her gjøres bare UTM -> rutenett og sann kurs -> rutenettkurs, som for alt annet i spillet.
 */
import type { Terrain } from "./terrain";

const KT = 1.943844, RAD = Math.PI / 180;
/** Eldre meldinger enn dette vises ikke (s). Skip i ro sender bare hvert tredje minutt. */
export const MAX_AGE_S = 600;
/** Lenger enn dette flyttes ikke et skip fram fra siste melding (s): da vet vi ikke lenger hvor det er. */
const MAX_COAST_S = 150;
/** Så fort hentes et hopp inn når en ny melding sier at skipet er et annet sted enn vi trodde (per sekund). */
const BLEND_RATE = 0.5;

/** Ett skip slik serveren sender det (se ais_ships i web/public/ais/lib.php). */
export interface AisShip {
  id: number; e: number; n: number;
  sog: number | null; cog: number | null; hdg: number | null;
  age: number; name: string; type: number; len: number | null; beam: number | null;
}

export interface Ship {
  id: number; name: string; type: number;
  /** Posisjon i rutenettet da meldingen ble sendt, og spillets klokke (s) da. */
  x: number; y: number; at: number;
  /** Rutenettkurs skipet beveger seg i (rad), og baugens retning (rad). Fart i m/s. */
  course: number; heading: number; speed: number;
  lengthM: number; beamM: number;
  /** Avvik som hentes inn gradvis etter en ny melding (celler), og når det ble målt. */
  dx: number; dy: number; blendAt: number;
}

/** AIS-skipstype (0-99) -> skrogfarge. Grupper etter første siffer, som i AIS-standarden. */
export function shipColor(type: number): number {
  if (type >= 80 && type <= 89) return 0x2b2f36; // tankskip: mørkt skrog
  if (type >= 70 && type <= 79) return 0x6e2f2a; // lasteskip: rødbrunt
  if (type >= 60 && type <= 69) return 0xf2f2ee; // passasjer: hvitt
  if (type >= 40 && type <= 49) return 0xe6ecf2; // hurtigbåt: lyst
  if (type === 30) return 0x2f5d6b; // fiske: blågrønt
  if (type === 51 || type === 50 || type === 58) return 0xd9482b; // redning, los, ambulanse: rødt
  if (type === 52 || type === 31 || type === 32) return 0xc98a2b; // slepebåt og slep: oransje
  return 0x70767e;
}

/** Mål når skipet ikke har sendt dem: et lite fartøy. Reelle mål holdes innenfor det rimelige. */
const size = (len: number | null, beam: number | null): [number, number] => {
  const l = Math.min(Math.max(len ?? 28, 8), 400);
  return [l, Math.min(Math.max(beam ?? l / 5, 3), 65)];
};

/** Gjør serverens liste om til skip i rutenettet. `now` er spillets klokke i sekunder. Skip utenfor kartet,
 *  med for gamle meldinger eller på land (feil posisjon, eller i dokk) tas ikke med. */
export function fromAis(list: AisShip[], t: Terrain, now: number): Ship[] {
  const out: Ship[] = [];
  for (const s of list) {
    if (!(s.age >= 0 && s.age <= MAX_AGE_S) || !Number.isFinite(s.e) || !Number.isFinite(s.n)) continue;
    const [x, y] = t.utmToGrid(s.e, s.n);
    if (!t.inBounds(x, y) || t.heightAt(x, y) > 3) continue;
    const speed = s.sog !== null && s.sog >= 0.5 ? s.sog / KT : 0;
    // sann -> rutenett: rutenett = sann - meridiankonvergens
    const grid = (deg: number) => (deg - t.meta.gridConvergenceDeg) * RAD;
    const course = s.cog !== null ? grid(s.cog) : s.hdg !== null ? grid(s.hdg) : 0;
    // baugen: kompasset hvis skipet har det, ellers kursen når det er i fart, ellers en fast retning per skip
    const heading = s.hdg !== null ? grid(s.hdg) : speed > 0 ? course : ((s.id % 360) * RAD);
    const [lengthM, beamM] = size(s.len, s.beam);
    out.push({ id: s.id, name: s.name, type: s.type, x, y, at: now - s.age, course, heading, speed, lengthM, beamM, dx: 0, dy: 0, blendAt: now });
  }
  return out;
}

/** Hvor skipet er nå: siste melding flyttet rett fram med farten det hadde, pluss det som gjenstår av hoppet
 *  fra forrige anslag. */
export function position(s: Ship, t: Terrain, now: number): [number, number] {
  const dt = Math.min(Math.max(now - s.at, 0), MAX_COAST_S), d = (s.speed * dt) / t.cell;
  const fade = Math.exp(-BLEND_RATE * Math.max(now - s.blendAt, 0));
  return [s.x + Math.sin(s.course) * d + s.dx * fade, s.y - Math.cos(s.course) * d + s.dy * fade];
}

/** Flåten: tar imot nye lister og holder skipene i jevn bevegelse mellom dem. */
export class Fleet {
  private ships = new Map<number, Ship>();

  /** Ny liste fra serveren. Skip som var der fra før fortsetter fra der de ble tegnet, uten hopp. */
  update(list: AisShip[], t: Terrain, now: number): void {
    const next = new Map<number, Ship>();
    for (const s of fromAis(list, t, now)) {
      const old = this.ships.get(s.id);
      if (old) {
        const [ox, oy] = position(old, t, now), [nx, ny] = position(s, t, now);
        // store sprang (over 500 m) er ikke en korreksjon, men en ny posisjon: da flyttes skipet rett dit
        if (Math.hypot(ox - nx, oy - ny) * t.cell < 500) { s.dx = ox - nx; s.dy = oy - ny; }
      }
      next.set(s.id, s);
    }
    this.ships = next;
  }

  get list(): Ship[] { return [...this.ships.values()]; }
}
