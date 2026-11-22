/* Veien fra rullebanen til en stand: et nett av taksebanene, korteste vei i det, og valg av stand.
 *
 * Ekte: taksebanene, deres navn, standene og numrene (OpenStreetMap, se aeroways.json), og rullebanene (OurAirports).
 * SYNTETISK: hvilken stand flyet får, og ruta dit. Et ekte tårn velger etter trafikk, flytype og faste ruter; her er
 * det korteste vei i nettet, til en av standene nærmest terminalen. Nettet følger kartleggingen: der to taksebaner
 * krysser uten felles punkt i OpenStreetMap, henger de ikke sammen her.
 */
import { onPavement } from "./physics";
import type { Airport, Terrain } from "./terrain";

type XY = [number, number];
interface Edge { to: number; m: number; ref: string }

export interface TaxiGraph {
  /** Punktene i nettet, i rutenettkoordinater. */
  nodes: XY[];
  edges: Edge[][];
  /** Avkjøringene fra hver rullebane: banens navn, og avstanden (m) fra baneende 0 langs senterlinja. */
  exits: { runway: string; alongM: number }[];
  /** Stands som kan nås fra en rullebane: nummeret, stedet, og punktet i nettet. */
  stands: { ref: string; at: XY; node: number }[];
}

export interface TaxiPlan {
  stand: { ref: string; at: XY };
  /** Ruta fra flyet til standen, i rutenettkoordinater. */
  route: XY[];
  /** Taksebanene ruta følger, i rekkefølge, uten gjentakelser («A», «C»). */
  via: string[];
  distanceM: number;
}

const RUNWAY = "RWY";
/** Så langt fra en stand uten innkjøringslinje til nærmeste punkt i nettet kobles den på (m, tvers over flata). */
const STAND_LINK_M = 150;
const TURN_BACK_M = 600;
/** Så langt kan ruta gå rett over en oppstillingsflate i stedet for å følge nettet, ved flyet og ved standen (m). */
const SHORTCUT_M = 250;

/** Bygg nettet for flyplassen, eller null når utsnittet ikke har bakkeanlegg. */
export function buildTaxiGraph(t: Terrain, airport: Airport): TaxiGraph | null {
  const aero = t.aeroways;
  if (!aero) return null;
  const nodes: XY[] = [], edges: Edge[][] = [], index = new Map<string, number>();
  const node = (p: XY): number => {
    const key = `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`; // samme punkt i OpenStreetMap = samme koordinat
    let i = index.get(key);
    if (i === undefined) { i = nodes.length; index.set(key, i); nodes.push(p); edges.push([]); }
    return i;
  };
  const link = (a: number, b: number, ref: string): void => {
    if (a === b) return;
    const m = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]) * t.cell;
    edges[a].push({ to: b, m, ref }); edges[b].push({ to: a, m, ref });
  };
  const chain = (line: XY[], ref: string): void => { for (let i = 1; i < line.length; i++) link(node(line[i - 1]), node(line[i]), ref); };
  for (const tw of aero.taxiways) chain(tw.line, tw.ref);
  for (const st of aero.stands) if (st.line) chain(st.line, "");

  // Rullebanene: punktene i nettet som ligger på en bane kobles til senterlinja, og senterlinja bindes sammen
  const onRunway: number[] = [], exits: TaxiGraph["exits"] = [];
  for (const rw of airport.runways) {
    const [a, b] = rw.ends, dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const along: [number, number][] = [[0, node([a.x, a.y])], [1, node([b.x, b.y])]];
    const count = nodes.length;
    for (let i = 0; i < count; i++) {
      const f = ((nodes[i][0] - a.x) * dx + (nodes[i][1] - a.y) * dy) / len2;
      if (f <= 0 || f >= 1) continue;
      const foot: XY = [a.x + f * dx, a.y + f * dy];
      if (Math.hypot(nodes[i][0] - foot[0], nodes[i][1] - foot[1]) * t.cell > rw.widthM / 2 + 8) continue;
      const n = node(foot);
      link(i, n, RUNWAY);
      along.push([f, n]);
      exits.push({ runway: rw.ident, alongM: f * Math.sqrt(len2) * t.cell });
    }
    along.sort((p, q) => p[0] - q[0]);
    for (let i = 1; i < along.length; i++) link(along[i - 1][1], along[i][1], RUNWAY);
    for (const [, n] of along) onRunway.push(n);
  }

  // Stands uten innkjøringslinje kobles rett til nærmeste punkt i nettet, tvers over oppstillingsflata
  const standNodes = aero.stands.filter((st) => onPavement(t, airport, st.at[0], st.at[1])).map((st) => {
    const key = `${Math.round(st.at[0] * 100)},${Math.round(st.at[1] * 100)}`;
    let n = index.get(key);
    if (n === undefined) {
      // nærmeste punkt som kan nås i rett linje uten å forlate asfalten (prøvd for hver femte meter)
      const paved = (i: number, m: number): boolean => {
        const steps = Math.max(1, Math.ceil(m / 5));
        for (let k = 1; k < steps; k++) if (!onPavement(t, airport, st.at[0] + ((nodes[i][0] - st.at[0]) * k) / steps, st.at[1] + ((nodes[i][1] - st.at[1]) * k) / steps)) return false;
        return true;
      };
      let best = -1, bestM = STAND_LINK_M;
      for (let i = 0; i < nodes.length; i++) {
        const m = Math.hypot(nodes[i][0] - st.at[0], nodes[i][1] - st.at[1]) * t.cell;
        if (m < bestM && paved(i, m)) { bestM = m; best = i; }
      }
      n = node(st.at);
      if (best >= 0) link(n, best, "");
    }
    return { ref: st.ref, at: st.at, node: n };
  });
  const reach = distances(edges, onRunway.map((n) => [n, 0]));
  return { nodes, edges, exits, stands: standNodes.filter((s) => Number.isFinite(reach.dist[s.node])) };
}

/** Hvor langt inne på banen (m fra baneenden det landes fra) den siste avkjøringen ligger, eller null uten avkjøringer. */
export function lastExitM(graph: TaxiGraph, rw: Airport["runways"][number], end: Airport["runways"][number]["ends"][number]): number | null {
  const fromEnd = graph.exits.filter((e) => e.runway === rw.ident).map((e) => (end === rw.ends[0] ? e.alongM : rw.lengthM - e.alongM));
  return fromEnd.length ? Math.max(...fromEnd) : null;
}

/** Korteste avstand (m) fra startpunktene til alle punkter, og forrige punkt på veien dit. */
function distances(edges: Edge[][], starts: [number, number][]): { dist: number[]; prev: number[]; via: string[] } {
  const dist = new Array<number>(edges.length).fill(Infinity), prev = new Array<number>(edges.length).fill(-1), via = new Array<string>(edges.length).fill("");
  // Nettet er lite (noen tusen punkter på det meste): en enkel kø sortert ved uttak holder
  const queue: [number, number][] = [];
  for (const [n, d] of starts) if (d < dist[n]) { dist[n] = d; queue.push([d, n]); }
  while (queue.length) {
    let k = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[k][0]) k = i;
    const [d, n] = queue.splice(k, 1)[0];
    if (d > dist[n]) continue;
    for (const e of edges[n]) {
      const nd = d + e.m;
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = n; via[e.to] = e.ref; queue.push([nd, e.to]); }
    }
  }
  return { dist, prev, via };
}

/** Standen flyet får: en av de (høyst seks) nummererte standene nærmest terminalen, valgt av `pick` så den
 *  varierer mellom innflyginger. Har flyplassen ingen nummererte stands som kan nås, brukes de unummererte. */
export function chooseStand(graph: TaxiGraph, airport: Airport, pick: number): TaxiGraph["stands"][number] | null {
  const numbered = graph.stands.filter((s) => s.ref), pool = numbered.length ? numbered : graph.stands;
  if (!pool.length) return null;
  const terminal = airport.tower ?? airport.arp;
  const near = [...pool].sort((p, q) => Math.hypot(p.at[0] - terminal.x, p.at[1] - terminal.y) - Math.hypot(q.at[0] - terminal.x, q.at[1] - terminal.y)).slice(0, 6);
  return near[((pick % near.length) + near.length) % near.length];
}

/** Ruta fra (x, y) til standen: fra nærmeste sted på nettet og korteste vei derfra. Null når standen ikke kan nås.
 *  Med `heading` (rutenettkurs i radianer) foretrekkes veien forover: å snu på stedet koster som 600 m ekstra, så
 *  flyet ikke bes om å snu på rullebanen for å spare litt vei. */
export function planTaxi(t: Terrain, graph: TaxiGraph, x: number, y: number, stand: TaxiGraph["stands"][number], heading: number | null = null): TaxiPlan | null {
  // nærmeste sted på en kant: derfra kan flyet gå til begge endene av kanten
  let best: { a: number; b: number; foot: XY; m: number } | null = null;
  for (let a = 0; a < graph.nodes.length; a++) for (const e of graph.edges[a]) {
    if (e.to < a) continue;
    const [ax, ay] = graph.nodes[a], [bx, by] = graph.nodes[e.to], dx = bx - ax, dy = by - ay;
    const f = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const foot: XY = [ax + f * dx, ay + f * dy], m = Math.hypot(x - foot[0], y - foot[1]) * t.cell;
    if (!best || m < best.m) best = { a, b: e.to, foot, m };
  }
  if (!best) return null;
  const gap = (n: number) => Math.hypot(graph.nodes[n][0] - best!.foot[0], graph.nodes[n][1] - best!.foot[1]) * t.cell;
  // bak flyet: retningen til punktet peker mot kursen (nord er -y)
  const behind = (n: number) => heading !== null && (graph.nodes[n][0] - best!.foot[0]) * Math.sin(heading) - (graph.nodes[n][1] - best!.foot[1]) * Math.cos(heading) < 0;
  const seed = (n: number): [number, number] => [n, gap(n) + (behind(n) ? TURN_BACK_M : 0)];
  const { dist, prev, via } = distances(graph.edges, [seed(best.a), seed(best.b)]);
  if (!Number.isFinite(dist[stand.node])) return null;
  const route: XY[] = [], names: string[] = [];
  for (let n = stand.node; n >= 0; n = prev[n]) {
    route.push(graph.nodes[n]);
    if (via[n] && via[n] !== RUNWAY && names[names.length - 1] !== via[n]) names.push(via[n]);
  }
  route.push(best.foot, [x, y]);
  route.reverse();
  // På en åpen oppstillingsflate går ruta rett fram: fra flyet til det fjerneste punktet på ruta det kan kjøre rett
  // til uten å forlate flata, og tilsvarende inn til standen. Ellers ville den gått vinkelrett inn på nærmeste
  // linje. På taksebaner og rullebaner følger ruta alltid senterlinja.
  const aprons = t.aeroways?.aprons ?? [];
  const onApron = (px: number, py: number): boolean => aprons.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
  const acrossApron = (p: XY, q: XY): boolean => {
    const steps = Math.max(1, Math.ceil((Math.hypot(q[0] - p[0], q[1] - p[1]) * t.cell) / 4));
    for (let k = 0; k <= steps; k++) if (!onApron(p[0] + ((q[0] - p[0]) * k) / steps, p[1] + ((q[1] - p[1]) * k) / steps)) return false;
    return true;
  };
  const within = (p: XY, q: XY) => Math.hypot(q[0] - p[0], q[1] - p[1]) * t.cell <= SHORTCUT_M;
  let first = 1;
  for (let i = 2; i < route.length && within(route[0], route[i]); i++) if (acrossApron(route[0], route[i])) first = i;
  if (first > 1) route.splice(1, first - 1);
  const end = route.length - 1;
  let last = end - 1;
  for (let i = end - 2; i > 0 && within(route[end], route[i]); i--) if (acrossApron(route[i], route[end])) last = i;
  if (last < end - 1) route.splice(last + 1, end - 1 - last);
  // lengden er veien som faktisk kjøres, uten tillegget for å snu
  let distanceM = 0;
  for (let i = 1; i < route.length; i++) distanceM += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]) * t.cell;
  return { stand: { ref: stand.ref, at: stand.at }, route, via: names.reverse(), distanceM };
}
