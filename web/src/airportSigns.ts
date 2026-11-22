/* Skilt og merking på flyplassen, etter det vanlige mønsteret (ICAO Annex 14, det samme som FAAs hurtigreferanse viser):
 *
 *  - stedsskilt: svart med gul bokstav, taksebanen du står på
 *  - retningsskilt: gult med svart bokstav og pil, taksebanene som tar av i neste kryss
 *  - påbudsskilt: rødt med hvit tekst, rullebanen ved et ventepunkt («03-21»)
 *  - ventepunktmerking tvers over taksebanen: to hele og to stiplede gule linjer, de hele på siden der flyet venter
 *
 * Ekte: hvor taksebanene møtes, hva de heter, og hvor ventepunktene ligger (OpenStreetMap, se aeroways.json).
 * SYNTETISK: at det står et skilt, hvor det står (35 m før et kryss, til venstre; 90 m før en avkjøring fra
 * rullebanen, på avkjøringens side), størrelsen (halvannen gang så høyt som et ekte skilt, for å kunne leses) og
 * hva som står på det. Flyplassenes faktiske skilting er ikke kartlagt.
 */
import * as THREE from "three";
import { buildTaxiGraph } from "./taxiRoute";
import type { Airport, Terrain } from "./terrain";

type XY = [number, number];
/** Ett felt på et skilt. `turn` er svingen i radianer for et retningsfelt (negativ = venstre). */
export type Panel = { kind: "location"; text: string } | { kind: "direction"; text: string; turn: number } | { kind: "mandatory"; text: string };
/** Et skilt: hvor det står (rutenett), kursen flyet har når det leser skiltet (rutenettkurs, rad), og feltene fra venstre. */
export interface Sign { x: number; y: number; heading: number; panels: Panel[] }

const BEFORE_M = 35, RUNWAY_BEFORE_M = 90, SIDE_M = 7;
const SIGN_H = 1.7, SIGN_BASE = 0.4; // m. SYNTETISK: et ekte skilt er ca. 1,1 m høyt
const RUNWAY = "RWY";

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Skiltene på flyplassen: foran kryssene mellom taksebaner, langs rullebanen foran hver avkjøring, og påbudsskilt
 *  ved hvert ventepunkt. Like skilt som ville stått tett (samme kryss kartlagt med flere punkter) slås sammen.
 *  Tom liste uten bakkeanlegg. */
export function airportSigns(t: Terrain, airport: Airport): Sign[] {
  const graph = buildTaxiGraph(t, airport), aero = t.aeroways;
  if (!graph || !aero) return [];
  const out: Sign[] = [], cell = t.cell;
  const widthOf = new Map<string, number>();
  for (const tw of aero.taxiways) if (tw.ref) widthOf.set(tw.ref, Math.max(widthOf.get(tw.ref) ?? 0, tw.width));
  const runwayAt = (x: number, y: number) => airport.runways.map((rw) => {
    const [a, b] = rw.ends, dx = b.x - a.x, dy = b.y - a.y, f = ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy);
    return { rw, f, cross: ((x - a.x) * dy - (y - a.y) * dx) / Math.hypot(dx, dy) * cell }; // cross > 0: til venstre for retningen ende 0 -> ende 1
  });

  // Kryss mellom taksebaner: punkter der minst to forskjellige navn møtes, utenfor rullebanene
  graph.nodes.forEach(([nx, ny], n) => {
    if (runwayAt(nx, ny).some((r) => r.f > 0 && r.f < 1 && Math.abs(r.cross) < r.rw.widthM / 2 + 10)) return;
    const arms = graph.edges[n].filter((e) => e.ref !== "" && e.ref !== RUNWAY).map((e) => {
      const [ox, oy] = graph.nodes[e.to];
      return { ref: e.ref, out: Math.atan2(ox - nx, -(oy - ny)), m: e.m }; // kursen UT av krysset langs armen
    });
    if (new Set(arms.map((a) => a.ref)).size < 2) return;
    for (const arm of arms) {
      const heading = wrap(arm.out + Math.PI); // kursen inn mot krysset
      const others = arms.filter((o) => o.ref !== arm.ref).map((o) => ({ ref: o.ref, turn: wrap(o.out - heading) })).filter((o) => Math.abs(o.turn) < 2.7); // ikke det som ligger rett bak
      if (!others.length) continue;
      // ett felt per navn: den slakeste svingen. Venstresvinger til venstre for stedsskiltet, høyresvinger til høyre.
      const byRef = new Map<string, number>();
      for (const o of others) if (!byRef.has(o.ref) || Math.abs(o.turn) < Math.abs(byRef.get(o.ref)!)) byRef.set(o.ref, o.turn);
      const fields = [...byRef].map(([text, turn]): Panel => ({ kind: "direction", text, turn })).sort((p, q) => (p as { turn: number }).turn - (q as { turn: number }).turn);
      const back = Math.min(BEFORE_M, arm.m * 0.8) / cell, side = ((widthOf.get(arm.ref) ?? 23) / 2 + SIDE_M) / cell;
      // 35 m før krysset, til venstre for kjøreretningen (venstre for kurs h er (-cos h, -sin h) i rutenettet)
      const x = nx - Math.sin(heading) * back - Math.cos(heading) * side, y = ny + Math.cos(heading) * back - Math.sin(heading) * side;
      out.push({ x, y, heading, panels: [...fields.filter((p) => (p as { turn: number }).turn < 0), { kind: "location", text: arm.ref }, ...fields.filter((p) => (p as { turn: number }).turn >= 0)] });
    }
  });

  // Avkjøringene fra rullebanen: for hver taksebane som møter banen, ett skilt 90 m før i hver kjøreretning,
  // på den siden avkjøringen ligger. Siden avgjøres av taksebanens punkter utenfor banekanten.
  for (const rw of airport.runways) {
    const [a, b] = rw.ends, len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, h01 = Math.atan2(ux, -uy);
    const exits = new Map<string, { along: number; left: boolean }>(); // per navn og side: hvor langs banen (celler fra ende 0)
    for (const tw of aero.taxiways) {
      if (!tw.ref) continue;
      const pts = tw.line.map(([x, y]) => runwayAt(x, y).find((r) => r.rw === rw)!);
      const onIt = pts.filter((p) => p.f > 0 && p.f < 1 && Math.abs(p.cross) < rw.widthM / 2 + 8), off = pts.filter((p) => Math.abs(p.cross) > rw.widthM / 2 + 15);
      if (!onIt.length || !off.length) continue;
      const along = (onIt.reduce((sum, p) => sum + p.f, 0) / onIt.length) * len, near = off.reduce((p, q) => (Math.abs(q.f * len - along) < Math.abs(p.f * len - along) ? q : p));
      const left = near.cross > 0, key = `${tw.ref}${left ? "L" : "R"}${Math.round((along * cell) / 150)}`;
      if (!exits.has(key)) exits.set(key, { along, left });
    }
    for (const [key, ex] of exits) {
      const ref = key.replace(/[LR]\d+$/, "");
      for (const dir of [1, -1]) { // kjører fra ende 0 mot ende 1, og motsatt
        const at = ex.along - dir * (RUNWAY_BEFORE_M / cell);
        if (at < 0 || at > len) continue;
        // sett fra kjøreretningen ligger «venstre for 0 -> 1» til venstre når dir = 1, ellers til høyre
        const onLeft = ex.left === (dir > 0), side = ((rw.widthM / 2 + 12) / cell) * (ex.left ? 1 : -1);
        // venstre for retningen 0 -> 1 er (uy, -ux) i rutenettet
        out.push({
          x: a.x + ux * at + uy * side, y: a.y + uy * at - ux * side, heading: dir > 0 ? h01 : wrap(h01 + Math.PI),
          panels: [{ kind: "direction", text: ref, turn: (onLeft ? -1 : 1) * (Math.PI / 4) }],
        });
      }
    }
  }

  // Ventepunkter: påbudsskilt med rullebanens navn, og stedsskilt for taksebanen, vendt mot den som kjører mot banen
  for (const hold of holdingPoints(t, airport)) {
    const side = (hold.width / 2 + SIDE_M) / cell, h = hold.toRunway;
    out.push({
      x: hold.at[0] - Math.cos(h) * side, y: hold.at[1] - Math.sin(h) * side, heading: h,
      panels: [...(hold.ref ? [{ kind: "location", text: hold.ref } as Panel] : []), { kind: "mandatory", text: hold.runway }],
    });
  }

  // Slå sammen like skilt som står tett og vender samme vei: det første flyet møter blir stående
  const kept: Sign[] = [], same = (p: Sign, q: Sign) => p.panels.map((f) => f.kind + f.text).join() === q.panels.map((f) => f.kind + f.text).join();
  const ahead = (s: Sign) => s.x * Math.sin(s.heading) - s.y * Math.cos(s.heading);
  for (const s of [...out].sort((p, q) => ahead(p) - ahead(q))) {
    if (!kept.some((k) => same(k, s) && Math.abs(wrap(k.heading - s.heading)) < 0.8 && Math.hypot(k.x - s.x, k.y - s.y) * cell < 120)) kept.push(s);
  }
  return kept;
}

/** Ventepunktene: stedet, taksebanen de ligger på (navn og bredde), kursen mot rullebanen langs taksebanen, og banens navn. */
export function holdingPoints(t: Terrain, airport: Airport): { at: XY; ref: string; width: number; toRunway: number; runway: string }[] {
  const aero = t.aeroways;
  if (!aero) return [];
  const out: ReturnType<typeof holdingPoints> = [], found: (ReturnType<typeof holdingPoints>[number] & { d: number })[] = [];
  for (const at of aero.holds) {
    // taksebanen ventepunktet ligger på: nærmeste linjestykke
    let best: { d: number; dir: number; ref: string; width: number } | null = null;
    for (const tw of aero.taxiways) for (let i = 1; i < tw.line.length; i++) {
      const [ax, ay] = tw.line[i - 1], [bx, by] = tw.line[i], dx = bx - ax, dy = by - ay;
      const f = Math.min(1, Math.max(0, ((at[0] - ax) * dx + (at[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(at[0] - ax - f * dx, at[1] - ay - f * dy) * t.cell;
      if (!best || d < best.d) best = { d, dir: Math.atan2(dx, -dy), ref: tw.ref, width: tw.width };
    }
    if (!best || best.d > 15) continue;
    // nærmeste rullebane, og hvilken vei langs taksebanen som fører dit
    let rwy: { d: number; bearing: number; name: string; edge: number } | null = null;
    for (const rw of airport.runways) {
      const [a, b] = rw.ends, dx = b.x - a.x, dy = b.y - a.y;
      const f = Math.min(1, Math.max(0, ((at[0] - a.x) * dx + (at[1] - a.y) * dy) / (dx * dx + dy * dy)));
      const fx = a.x + f * dx - at[0], fy = a.y + f * dy - at[1], d = Math.hypot(fx, fy) * t.cell;
      if (!rwy || d < rwy.d) rwy = { d, bearing: Math.atan2(fx, -fy), name: [a.ident, b.ident].sort().join("-"), edge: rw.widthM / 2 };
    }
    // Bare ventepunkter foran en rullebane: 20-180 m fra banekanten. OpenStreetMap har også ventepunkter mellom
    // taksebaner og flere per innkjøring (for ulike værforhold); de ville gitt merking og skilt oppå hverandre.
    if (!rwy || rwy.d < rwy.edge + 20 || rwy.d > rwy.edge + 180) continue;
    const toRunway = Math.cos(wrap(best.dir - rwy.bearing)) >= 0 ? best.dir : wrap(best.dir + Math.PI);
    found.push({ at, ref: best.ref, width: best.width, toRunway, runway: rwy.name, d: rwy.d });
  }
  // Ett ventepunkt per innkjøring: av dem som ligger nærmere hverandre enn 80 m beholdes det nærmest banen
  for (const h of found.sort((p, q) => p.d - q.d)) {
    if (!out.some((k) => Math.hypot(k.at[0] - h.at[0], k.at[1] - h.at[1]) * t.cell < 80)) out.push(h);
  }
  return out;
}

/** Ventepunktmerkingen som linjer til maling (meter, x øst og z sør): fire striper tvers over taksebanen. Sett fra
 *  flyet som kjører mot rullebanen kommer først to hele linjer, så to stiplede. Hver linje er [punkter, bredde]. */
export function holdMarkings(t: Terrain, airport: Airport): { line: XY[]; width: number }[] {
  const out: { line: XY[]; width: number }[] = [], STRIPE = 0.45, GAP = 0.9, DASH = 1.5;
  for (const hold of holdingPoints(t, airport)) {
    const h = hold.toRunway, fx = Math.sin(h), fz = -Math.cos(h), sx = Math.cos(h), sz = Math.sin(h); // forover og til høyre
    const cx = hold.at[0] * t.cell, cz = hold.at[1] * t.cell, half = hold.width / 2 - 1;
    for (let i = 0; i < 4; i++) {
      const ox = cx + fx * (i - 1.5) * GAP, oz = cz + fz * (i - 1.5) * GAP;
      if (i < 2) out.push({ line: [[ox - sx * half, oz - sz * half], [ox + sx * half, oz + sz * half]], width: STRIPE });
      else for (let s = -half; s < half - DASH / 2; s += DASH * 2) out.push({ line: [[ox + sx * s, oz + sz * s], [ox + sx * (s + DASH), oz + sz * (s + DASH)]], width: STRIPE });
    }
  }
  return out;
}

/* ---------- tegning ---------- */

const CELL_W = 384, CELL_H = 64, COLS = 5, ROWS = 64; // 320 ulike skilt i en tekstur på 1920 x 4096
const PANEL_PAD = 14, ARROW_W = 46;

/** Bredden et skilt trenger i tekstur-piksler (høyden er CELL_H). */
function signWidth(g: CanvasRenderingContext2D, panels: Panel[]): number {
  g.font = "bold 44px Helvetica, Arial, sans-serif";
  return panels.reduce((w, p) => w + g.measureText(p.text).width + PANEL_PAD * 2 + (p.kind === "direction" ? ARROW_W : 0), 0);
}

function drawSign(g: CanvasRenderingContext2D, x0: number, y0: number, panels: Panel[], scale: number): void {
  g.save();
  g.translate(x0, y0); g.scale(scale, 1);
  g.font = "bold 44px Helvetica, Arial, sans-serif"; g.textBaseline = "middle"; g.textAlign = "left";
  let x = 0;
  for (const p of panels) {
    const tw = g.measureText(p.text).width, w = tw + PANEL_PAD * 2 + (p.kind === "direction" ? ARROW_W : 0);
    const [bg, fg] = p.kind === "location" ? ["#111111", "#f2c61c"] : p.kind === "direction" ? ["#f2c61c", "#111111"] : ["#c81e1e", "#ffffff"];
    g.fillStyle = bg; g.fillRect(x, 0, w, CELL_H);
    g.strokeStyle = p.kind === "location" ? "#f2c61c" : "#111111"; g.lineWidth = 3; g.strokeRect(x + 2.5, 2.5, w - 5, CELL_H - 5);
    g.fillStyle = fg;
    const leftArrow = p.kind === "direction" && p.turn < 0, tx = x + PANEL_PAD + (leftArrow ? ARROW_W : 0);
    g.fillText(p.text, tx, CELL_H / 2 + 2);
    if (p.kind === "direction") {
      // pila peker dit taksebanen går: opp er rett fram, i hele 45 grader
      const a = Math.round(p.turn / (Math.PI / 4)) * (Math.PI / 4), ax = leftArrow ? x + PANEL_PAD + ARROW_W / 2 - 4 : x + w - PANEL_PAD - ARROW_W / 2 + 4;
      g.save();
      g.translate(ax, CELL_H / 2); g.rotate(a);
      g.strokeStyle = fg; g.lineWidth = 6; g.lineCap = "round"; g.lineJoin = "round";
      g.beginPath(); g.moveTo(0, 16); g.lineTo(0, -16); g.moveTo(-11, -5); g.lineTo(0, -16); g.lineTo(11, -5); g.stroke();
      g.restore();
    }
    x += w;
  }
  g.restore();
}

/** Skiltene som to flater: forsidene med tekst (én tekstur for alle), og mørke baksider. */
export function buildSigns(t: Terrain, signs: Sign[]): THREE.Object3D[] {
  if (!signs.length) return [];
  const cv = document.createElement("canvas");
  cv.width = CELL_W * COLS; cv.height = CELL_H * ROWS;
  const g = cv.getContext("2d")!, cells = new Map<string, { col: number; row: number; w: number; aspect: number }>();
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], backPos: number[] = [], backIdx: number[] = [];
  for (const s of signs) {
    const key = s.panels.map((p) => `${p.kind[0]}${p.text}${p.kind === "direction" ? Math.round(p.turn / (Math.PI / 4)) : ""}`).join("|");
    let c = cells.get(key);
    if (!c) {
      if (cells.size >= COLS * ROWS) continue; // flere ulike skilt enn teksturen har plass til: resten står uskiltet
      const need = signWidth(g, s.panels), scale = Math.min(1, CELL_W / need);
      c = { col: cells.size % COLS, row: Math.floor(cells.size / COLS), w: need * scale, aspect: need / CELL_H };
      drawSign(g, c.col * CELL_W, c.row * CELL_H, s.panels, scale);
      cells.set(key, c);
    }
    // Loddrett flate med forsiden mot flyet som kommer: til høyre for kursen ligger skiltets høyre kant
    const half = (SIGN_H * c.aspect) / 2, x = s.x * t.cell, z = s.y * t.cell, y = Math.max(0, t.heightAt(s.x, s.y)) + SIGN_BASE;
    const rx = Math.cos(s.heading), rz = Math.sin(s.heading), u0 = (c.col * CELL_W) / cv.width, u1 = (c.col * CELL_W + c.w) / cv.width;
    const v1 = 1 - (c.row * CELL_H) / cv.height, v0 = 1 - ((c.row + 1) * CELL_H) / cv.height, base = pos.length / 3;
    const corners = [[x - rx * half, y, z - rz * half], [x + rx * half, y, z + rz * half], [x + rx * half, y + SIGN_H, z + rz * half], [x - rx * half, y + SIGN_H, z - rz * half]];
    for (const [px, py, pz] of corners) { pos.push(px, py, pz); backPos.push(px, py, pz); }
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    backIdx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const front = new THREE.BufferGeometry();
  front.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  front.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  front.setIndex(idx);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const back = new THREE.BufferGeometry();
  back.setAttribute("position", new THREE.Float32BufferAttribute(backPos, 3));
  back.setIndex(backIdx);
  // skiltene lyser innenfra: samme farge dag og natt
  return [new THREE.Mesh(front, new THREE.MeshBasicMaterial({ map: tex })), new THREE.Mesh(back, new THREE.MeshBasicMaterial({ color: 0x23262b }))];
}
