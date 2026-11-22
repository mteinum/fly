/* Morofigurer: en sjimpanse over dyreparken, en krone over Slottet, nordlys i nord og så videre.
 *
 * ALT HER ER SYNTETISK. Stedene er ekte (koordinater fra Sentralt stedsnavnregister, UTM 33), men figurene er
 * oppdiktet, sterkt forstørret og plassert for å synes fra lufta. De kan slås av med L.
 * Denne fila er ren geometri uten three.js, så plasseringen kan testes. Modellene ligger i figureModels.ts.
 */
import type { Terrain } from "./terrain";

export type FigureKind =
  | "chimp" | "pirateShip" | "cannon" | "crown" | "skiJumper" | "vikingShip" | "sinnataggen" | "dancer" | "umbrella" | "funicular"
  | "lobsterFisher" | "swords" | "oilPlatform" | "polarBear" | "maelstrom" | "santa" | "puffins" | "moose" | "balloon" | "whale" | "flags";

interface FigureSpec {
  kind: FigureKind;
  /** UTM 33 (m). */
  east: number;
  north: number;
  /** Flytt til nærmeste åpne vann (skip, hval), nærmeste vann uansett bredde (et trangt sund) eller nærmeste land. */
  snap?: "water" | "anyWater" | "land";
  /** Endepunktet for noe som går fram og tilbake (Fløibanen). */
  to?: [number, number];
  /** Hvor stedet er hentet fra. */
  where: string;
}

/** Figurene per flyplass. Stedsnummer viser til Sentralt stedsnavnregister (Kartverket), lest 2026-11-22. */
export const FIGURES: Record<string, FigureSpec[]> = {
  ENCN: [
    { kind: "chimp", east: 97434, north: 6469764, where: "Kristiansand dyrepark, stedsnummer 571313" },
    { kind: "pirateShip", east: 97434, north: 6469764, snap: "water", where: "nærmeste åpne vann fra Kristiansand dyrepark" },
    { kind: "cannon", east: 88669, north: 6464919, where: "Odderøya, stedsnummer 850220" },
    { kind: "whale", east: 90000, north: 6462500, snap: "water", where: "sjøen sør for Odderøya, valgt for hånd" },
    { kind: "lobsterFisher", east: 86869, north: 6457887, snap: "water", where: "nærmeste åpne vann fra Flekkerøya (N50 stedsnavn)" },
  ],
  ENKJ: [
    { kind: "crown", east: 261212, north: 6649891, where: "Det kongelige slott, stedsnummer 429090" },
    { kind: "skiJumper", east: 258127, north: 6655375, where: "Holmenkollbakken, stedsnummer 145836" },
    { kind: "vikingShip", east: 259644, north: 6648492, snap: "water", where: "Bygdøynes, stedsnummer 732865" },
    { kind: "sinnataggen", east: 259683, north: 6651152, where: "Vigelandsanlegget (N50 stedsnavn)" },
    { kind: "dancer", east: 262565, north: 6648729, where: "Operaen i Bjørvika: 59,9075° N 10,7531° Ø, omtrentlig" },
  ],
  ENBR: [
    { kind: "umbrella", east: -31955, north: 6734396, where: "Bergen sentrum (N50 stedsnavn)" },
    { kind: "funicular", east: -31800, north: 6734640, to: [-30912, 6734378], where: "Vetrlidsallmenningen til Fløyen (rett linje, ikke banens trasé)" },
    { kind: "whale", east: -45000, north: 6724000, snap: "water", where: "sjøen vest for Flesland, valgt for hånd" },
  ],
  ENZV: [
    { kind: "swords", east: -35851, north: 6570970, snap: "land", where: "Møllebukta i Hafrsfjord (Sverd i fjell)" },
    { kind: "oilPlatform", east: -47500, north: 6564100, snap: "water", where: "sjøen 9 km vest for Sola, valgt for hånd. Det står ingen plattform der" },
    { kind: "whale", east: -44000, north: 6569000, snap: "water", where: "sjøen nordvest for Sola, valgt for hånd" },
  ],
  ENTC: [
    { kind: "polarBear", east: 652147, north: 7733697, where: "Tromsøya, stedsnummer 868425" },
    { kind: "whale", east: 649500, north: 7733500, snap: "water", where: "Sandnessundet, valgt for hånd" },
  ],
  ENBO: [
    { kind: "maelstrom", east: 483429, north: 7456854, snap: "anyWater", where: "Saltstraumen, stedsnummer 623012" },
    { kind: "whale", east: 469500, north: 7459500, snap: "water", where: "Saltfjorden, valgt for hånd" },
  ],
  ENMH: [
    { kind: "santa", east: 962903, north: 7931360, where: "Mehamn (N50 stedsnavn). Bare i desember" },
    { kind: "whale", east: 963182, north: 7933826, snap: "water", where: "Mehamnfjorden (N50 stedsnavn)" },
  ],
  ENAL: [
    { kind: "puffins", east: 37850, north: 6961593, snap: "water", where: "Giskesundet (N50 stedsnavn)" },
    { kind: "whale", east: 41500, north: 6958500, snap: "water", where: "sjøen vest for Ålesund, valgt for hånd" },
  ],
  ENGM: [
    { kind: "moose", east: 286500, north: 6680600, snap: "land", where: "øst for rullebanene på Gardermoen, valgt for hånd" },
  ],
};

/** Flyplassene der nordlyset vises om natta. */
export const AURORA_AIRPORTS = ["ENTC", "ENBO", "ENMH"];

export interface PlacedFigure {
  kind: FigureKind;
  /** Rutenettkoordinater, og bakkens høyde der (0 på vann). */
  x: number;
  y: number;
  groundM: number;
  /** Endepunkt for noe som beveger seg mellom to steder (Fløibanen, skihopperen). */
  to?: { x: number; y: number; groundM: number };
  /** Retning i rutenettet (radianer) for noe som står på rekke (flaggene). */
  heading?: number;
}

const OPEN_WATER_M = 300; // et skip eller en hval trenger så mye vann rundt seg
const SNAP_MAX_M = 6000;

/** Nærmeste sted fra (x, y) der `ok` holder, lett utover i ringer. Null når ingenting finnes innen SNAP_MAX_M. */
function nearest(t: Terrain, x: number, y: number, ok: (x: number, y: number) => boolean): [number, number] | null {
  if (ok(x, y)) return [x, y];
  for (let r = 100; r <= SNAP_MAX_M; r += 100) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, px = x + (Math.cos(a) * r) / t.cell, py = y + (Math.sin(a) * r) / t.cell;
      if (t.inBounds(px, py) && ok(px, py)) return [px, py];
    }
  }
  return null;
}

const openWater = (t: Terrain) => (x: number, y: number): boolean => {
  if (!t.isWater(x, y)) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    for (const r of [OPEN_WATER_M / 2, OPEN_WATER_M]) if (!t.isWater(x + (Math.cos(a) * r) / t.cell, y + (Math.sin(a) * r) / t.cell)) return false;
  }
  return true;
};

/** Figurene for utsnittet, plassert i rutenettet. Det som ikke får plass (utenfor kartet, ikke vann i nærheten) utelates. */
export function placeFigures(t: Terrain): PlacedFigure[] {
  const airport = t.meta.airports[0], out: PlacedFigure[] = [];
  const ground = (x: number, y: number) => (t.isWater(x, y) ? 0 : t.heightAt(x, y));
  for (const spec of FIGURES[airport.icao] ?? []) {
    let [x, y] = t.utmToGrid(spec.east, spec.north);
    if (!t.inBounds(x, y)) continue;
    if (spec.snap) {
      const at = nearest(t, x, y, spec.snap === "water" ? openWater(t) : spec.snap === "anyWater" ? (px, py) => t.isWater(px, py) : (px, py) => !t.isWater(px, py));
      if (!at) continue;
      [x, y] = at;
    }
    const fig: PlacedFigure = { kind: spec.kind, x, y, groundM: ground(x, y) };
    if (spec.to) {
      const [tx, ty] = t.utmToGrid(spec.to[0], spec.to[1]);
      if (!t.inBounds(tx, ty)) continue;
      fig.to = { x: tx, y: ty, groundM: ground(tx, ty) };
    }
    if (spec.kind === "skiJumper") {
      // hopperen svever dit bakken faller mest: det laveste punktet 260 m unna
      let best: PlacedFigure["to"];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, px = x + (Math.cos(a) * 260) / t.cell, py = y + (Math.sin(a) * 260) / t.cell;
        if (t.inBounds(px, py) && (!best || ground(px, py) < best.groundM)) best = { x: px, y: py, groundM: ground(px, py) };
      }
      fig.to = best;
    }
    out.push(fig);
  }
  // Luftballongen: 2,5 km til side for første rullebane, så den ikke står i innflygingen
  const rw = airport.runways[0], [a, b] = rw.ends, len = Math.hypot(b.x - a.x, b.y - a.y);
  const side = (m: number): [number, number] => [(a.x + b.x) / 2 - ((b.y - a.y) / len) * (m / t.cell), (a.y + b.y) / 2 + ((b.x - a.x) / len) * (m / t.cell)];
  for (const m of [2500, -2500]) {
    const [x, y] = side(m);
    if (t.inBounds(x, y)) { out.push({ kind: "balloon", x, y, groundM: ground(x, y) }); break; }
  }
  // 17. mai-flaggene: en rekke ved tårnet, langs banen
  const tw = airport.tower;
  out.push({ kind: "flags", x: tw.x, y: tw.y, groundM: tw.groundM, heading: Math.atan2(b.x - a.x, -(b.y - a.y)) });
  return out;
}

/** Noen figurer hører til en bestemt tid på året: nissen i desember, flaggene 17. mai. `month` er 1-12. */
export function inSeason(kind: FigureKind, month: number, day: number): boolean {
  if (kind === "santa") return month === 12;
  if (kind === "flags") return month === 5 && day === 17;
  return true;
}
