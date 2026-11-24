/* Modellene skipene tegnes med. Hvert skip fra AIS får en modell etter typen det sender (shipModelKind i ships.ts):
 * fiskebåt, passasjerskip, tankskip, hurtigbåt, lasteskip, slepebåt, mudringsfartøy, losbåt, dykkerfartøy, seilskip
 * eller arbeidsbåt (alt annet). Modellen bygges i meter ut fra lengden og bredden skipet selv oppgir: hus, master og
 * vinduer har vanlig størrelse, og et lengre skip får flere luker, kraner, dekk eller master, ikke bare lengre deler.
 * Color Lines SuperSpeed, som kjennes igjen på navnet, har sin egen modell.
 *
 * Ekte: skipets type, lengde og bredde (fra AIS). SYNTETISK: alt annet. Formen er et mønster for typen, ikke det
 * enkelte skipet; fargene er valgt etter typen, og der typen har flere vanlige farger eller lastemåter (lasteskip,
 * fiskebåter, passasjerskip) er valget trukket fast fra skipets AIS-nummer. Modellene er i sann målestokk, ikke
 * forstørret som morofigurene. SuperSpeed er tegnet for hånd etter hvordan skipet ser ut, ikke etter tegninger.
 * På skutesida der står rederiets navn og skipets navn fra AIS som vanlig tekst, etter ønske fra eieren av
 * prosjektet. Rederiets logo (merket på skorsteinen) er ikke med (se CLAUDE.md om logoer).
 *
 * Modellene er tegnet i meter med y opp fra vannflata og baugen mot -z, som flyet.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ShipModelKind } from "./ships";

export interface ShipModel {
  obj: THREE.Object3D;
  /** Der lanterna står om natta: meter framover fra midtskips, og meter over vannet (toppen av masta). */
  lantern: [fwd: number, y: number];
  /** 0 = dag, 1 = natt: lys i vinduene (bare der modellen har det). */
  night(n: number): void;
  dispose(): void;
}

/** Det modellen bygges av: det skipet har sendt, og fargen typen har i spillet (shipColor). */
export interface ShipSpec { id: number; name: string; lengthM: number; beamM: number; color: number }

const WHITE = 0xf3f3ee, NAVY = 0x14306b, GLASS = 0x1b2836, DECK = 0x5f7f78, ORANGE = 0xe8641e, GREY = 0x9aa3ab;
const BLACK = 0x1c1e22, STEEL = 0x6f767d, OXIDE = 0x8a3a2c, YELLOW = 0xd9b032, SAND = 0xb89b6a, SAIL = 0xeee8d8, WOOD = 0x9a7446;

/** Et dekk sett ovenfra: rett hekk, parallelle sider og en baug som rundes inn mot spissen. `fwd` er framover.
 *  `stern` < 1 smalner hekken, og `round` (0-1) gjør baugen butt i stedet for spiss. */
function outline(aft: number, fore: number, beam: number, bow: number, stern = 1, round = 0): THREE.Shape {
  const h = beam / 2, s = new THREE.Shape(), run = stern === 1 ? 0 : Math.min(12, (fore - aft) / 4);
  const cx = h * (1 - 0.25 * round), cy = fore - bow * 0.4 * (1 - round);
  s.moveTo(-h * stern, aft);
  if (run) s.lineTo(-h, aft + run);
  s.lineTo(-h, fore - bow);
  s.quadraticCurveTo(-cx, cy, 0, fore);
  s.quadraticCurveTo(cx, cy, h, fore - bow);
  if (run) s.lineTo(h, aft + run);
  s.lineTo(h * stern, aft);
  s.closePath();
  return s;
}

/** Omrisset trukket opp fra y0 til y1. Omrissets «framover» blir -z. */
const slab = (shape: THREE.Shape, y0: number, y1: number): THREE.BufferGeometry =>
  new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 10 }).rotateX(-Math.PI / 2).translate(0, y0, 0);

/** En profil sett fra siden ([framover, opp]-punkter) trukket ut til bredden `width`, midt i skipet. */
function profile(points: [number, number][], width: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  points.forEach(([u, v], i) => (i ? s.lineTo(u, v) : s.moveTo(u, v)));
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-width / 2, 0, 0);
}

/** Tekst på skutesida, som tekstur, og en flate med høyden `heightM` som passer til den. */
function lettering(text: string, heightM: number, style = "italic bold", color = "#14306b"): { tex: THREE.CanvasTexture; geo: THREE.PlaneGeometry } {
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d")!, font = `${style} 112px Helvetica, Arial, sans-serif`;
  ctx.font = font;
  cv.width = Math.ceil(ctx.measureText(text).width) + 24; cv.height = 128; // ny størrelse nullstiller tegnetilstanden
  ctx.fillStyle = color; ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, cv.width / 2, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, geo: new THREE.PlaneGeometry((heightM * cv.width) / cv.height, heightM) };
}

/** Color Lines SuperSpeed 1 (Kristiansand-Hirtshals) og 2: lang, slank bilferje med høye, glatte sider, blått
 *  undervannsskrog, front som skrår bakover dekk for dekk, bru i full bredde og en stor skorstein akter. */
function superSpeed(name: string, lengthM: number): ShipModel {
  const L = 211.3, B = 25.8, A = -L / 2, F = L / 2;
  const obj = new THREE.Group(), mats = new Map<number, THREE.MeshLambertMaterial>(), geos: THREE.BufferGeometry[] = [];
  const mat = (c: number): THREE.MeshLambertMaterial => {
    let m = mats.get(c);
    if (!m) mats.set(c, (m = new THREE.MeshLambertMaterial({ color: c })));
    return m;
  };
  /** Legg til en del. `fwd` er meter framover fra midtskips. */
  const add = (geo: THREE.BufferGeometry, c: number | THREE.Material, x = 0, y = 0, fwd = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, typeof c === "number" ? mat(c) : c);
    m.position.set(x, y, -fwd);
    geos.push(geo);
    obj.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const windows = new THREE.MeshLambertMaterial({ color: GLASS, emissive: 0xffd9a0, emissiveIntensity: 0 });

  // skroget: blått nederst, hvitt opp til øverste bildekk
  const hull = outline(A, F, B, 58, 0.9);
  add(slab(hull, 0, 4.6), NAVY);
  add(slab(hull, 4.6, 15.5), WHITE);
  add(slab(outline(A + 0.5, F - 3, B - 1, 56, 0.9), 15.5, 15.7), DECK); // værdekket, synlig på bakken og akter
  add(box(15, 7, 0.5), GREY, 0, 9, A + 0.1); // hekkporten til bildekket

  // overbygget: tre dekkshus som blir kortere oppover, så fronten skrår bakover og akterenden blir terrasser
  const houses: [aft: number, fore: number, y0: number, y1: number, bow: number, rows: number[]][] = [
    [A + 7, 73, 15.7, 21.6, 15, [17.4, 19.9]],
    [A + 15, 67, 21.6, 27.2, 13, [23.2, 25.6]],
    [A + 36, 61, 27.2, 30.6, 9, [28.9]],
  ];
  for (const [aft, fore, y0, y1, bow, rows] of houses) {
    add(slab(outline(aft, fore, B, bow), y0, y1), WHITE);
    add(slab(outline(aft + 0.6, fore - 1.5, B - 1.2, bow), y1, y1 + 0.15), DECK);
    // vindusrekkene: mørke bånd som stikker så vidt ut av de rette sidene
    const from = aft + 5, to = fore - bow - 2;
    for (const y of rows) add(box(B + 0.3, 1.3, to - from), windows, 0, y, (from + to) / 2);
  }
  // brua: full bredde med vinger, og vinduer hele veien rundt
  add(box(B + 5, 2.9, 6), WHITE, 0, 29.1, 55);
  add(box(B + 5.3, 1.2, 6.3), windows, 0, 29.4, 55);
  add(box(B + 5.4, 0.3, 6.6), WHITE, 0, 30.7, 55);
  // øverste hus, med mast, radar og radomer
  add(slab(outline(-48, 30, 15, 6), 30.75, 33.4), WHITE);
  add(new THREE.CylinderGeometry(0.5, 0.8, 9, 8), WHITE, 0, 35.2, 52);
  add(box(6, 0.35, 0.6), WHITE, 0, 37.2, 52);
  add(box(1.6, 0.5, 0.5), GREY, 0, 39.9, 52);
  for (const [x, fwd] of [[-4.5, 18], [4.5, 18], [0, -20]]) add(new THREE.SphereGeometry(1.9, 12, 8), WHITE, x, 34.9, fwd);

  // skorsteinen: stor og blå, helt akter på øverste dekk, med bakoverlent forkant
  add(profile([[-96, 27.35], [-76, 27.35], [-83, 42.5], [-97.5, 42.5]], 10), NAVY);
  add(profile([[-96.5, 42.5], [-83.5, 42.5], [-84.5, 43.6], [-96.5, 43.6]], 6), GLASS);

  // livbåter i nisjer langs siden
  for (const s of [-1, 1]) for (const fwd of [-22, -36, -50]) add(box(3, 2.8, 10), ORANGE, s * (B / 2 - 0.9), 18.4, fwd);

  // på det hvite feltet under vinduene: rederiets navn stort midtskips, og skipets navn foran det
  const line = lettering("Color Line", 9.5, "bold"), own = lettering(name, 6.5);
  const lineText = new THREE.MeshLambertMaterial({ map: line.tex, transparent: true }), text = new THREE.MeshLambertMaterial({ map: own.tex, transparent: true });
  for (const s of [-1, 1]) {
    add(line.geo, lineText, s * (B / 2 + 0.12), 10.3, -40).rotation.y = (s * Math.PI) / 2;
    add(own.geo, text, s * (B / 2 + 0.12), 10.3, 20).rotation.y = (s * Math.PI) / 2;
  }

  // et skip som ikke har sendt målene sine (28 m som standard) tegnes i modellens egen størrelse
  const k = lengthM > L / 2 ? lengthM / L : 1;
  obj.scale.setScalar(k);
  return {
    obj, lantern: [52 * k, 42 * k],
    night: (n) => { windows.emissiveIntensity = 0.9 * n; },
    dispose: () => { for (const g of geos) g.dispose(); for (const m of [...mats.values(), windows, text, lineText]) m.dispose(); own.tex.dispose(); line.tex.dispose(); },
  };
}


/* ---------- modeller per type ---------- */

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
/** Et fast, «tilfeldig» valg per skip: samme skip får alltid samme farge og last. */
const pick = <T>(list: T[], id: number, salt = 0): T => list[(Math.imul(id + salt * 7919, 2654435761) >>> 8) % list.length];

/** Ett materiale for alle typemodellene: fargen ligger i hjørnene. Tosidig for seilenes skyld. */
const painted = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

/** Samler delene til ett skip og slår dem sammen til én flate, så hvert skip er ett tegnekall. */
class Parts {
  private geos: THREE.BufferGeometry[] = [];

  /** Legg til en del. `fwd` er meter framover fra midtskips. */
  add(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, fwd = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.translate(x, y, -fwd);
    const c = new THREE.Color().setHex(color, THREE.SRGBColorSpace), n = g.getAttribute("position").count, rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
    this.geos.push(g);
    return this;
  }
  /** En kloss med bunnen i y0. */
  box(color: number, w: number, h: number, d: number, x: number, y0: number, fwd: number): this { return this.add(new THREE.BoxGeometry(w, h, d), color, x, y0 + h / 2, fwd); }
  /** En stående sylinder med bunnen i y0. */
  cyl(color: number, r: number, h: number, x: number, y0: number, fwd: number, rTop = r): this { return this.add(new THREE.CylinderGeometry(rTop, r, h, 8), color, x, y0 + h / 2, fwd); }
  /** En liggende sylinder: på tvers av skipet, eller langs det. */
  drum(color: number, r: number, len: number, x: number, y: number, fwd: number, along = false): this {
    const g = new THREE.CylinderGeometry(r, r, len, 10);
    return this.add(along ? g.rotateX(Math.PI / 2) : g.rotateZ(Math.PI / 2), color, x, y, fwd);
  }
  slab(color: number, shape: THREE.Shape, y0: number, y1: number): this { return this.add(slab(shape, y0, y1), color); }
  /** En flat trekant (seil) i skipets lengdeplan, gitt som [framover, opp]-punkter. */
  tri(color: number, pts: [number, number][], x = 0): this {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap(([u, v]) => [x, v, -u]), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    g.computeVertexNormals();
    return this.add(g, color);
  }
  /** Et hus med vindusbånd rundt i høydene `bands` (m over husets bunn). */
  house(color: number, w: number, h: number, d: number, x: number, y0: number, fwd: number, bands: number[] = []): this {
    this.box(color, w, h, d, x, y0, fwd);
    for (const b of bands) this.box(GLASS, w + 0.16, 0.8, d + 0.16, x, y0 + b, fwd);
    return this;
  }
  /** Mast med radarbjelke. Gir høyden på toppen. */
  mast(x: number, y0: number, fwd: number, h: number): number {
    this.cyl(WHITE, 0.22, h, x, y0, fwd, 0.12);
    this.box(WHITE, Math.min(2.4, h * 0.5), 0.25, 0.35, x, y0 + h * 0.55, fwd);
    return y0 + h;
  }

  mesh(): THREE.Mesh {
    const merged = mergeGeometries(this.geos);
    if (!merged) throw new Error("skipsmodellen lot seg ikke slå sammen");
    for (const g of this.geos) g.dispose();
    return new THREE.Mesh(merged, painted);
  }
}

interface Hull { L: number; B: number; A: number; F: number; fb: number; bow: number }

/** Skroget: en mørk stripe i vannlinja, skutesida opp til `fb` og dekket oppå. `raised` (m) gir en bakk over
 *  hele baugpartiet, eller fra `raisedFrom` (meter framover fra midtskips). */
function hull(p: Parts, s: ShipSpec, o: { fb: number; bow: number; color: number; deck: number; boot?: number; stern?: number; round?: number; raised?: number; raisedFrom?: number }): Hull {
  const L = s.lengthM, B = s.beamM, A = -L / 2, F = L / 2, bow = L * o.bow, boot = Math.min(0.9, o.fb * 0.3);
  const shape = outline(A, F, B, bow, o.stern ?? 0.92, o.round ?? 0);
  p.slab(o.boot ?? 0x7a2420, shape, 0, boot).slab(o.color, shape, boot, o.fb);
  p.slab(o.deck, outline(A + 0.25, F - bow * 0.06 - 0.3, B - 0.5, bow, o.stern ?? 0.92, o.round ?? 0), o.fb, o.fb + 0.12);
  if (o.raised) {
    const from = Math.min(o.raisedFrom ?? F - bow, F - bow);
    p.slab(o.color, outline(from, F, B, bow, 1, o.round ?? 0), o.fb, o.fb + o.raised);
    p.slab(o.deck, outline(from + 0.25, F - bow * 0.06 - 0.3, B - 0.5, bow, 1, o.round ?? 0), o.fb + o.raised, o.fb + o.raised + 0.12);
  }
  return { L, B, A, F, fb: o.fb, bow };
}

/** Hus akter, som på laste- og tankskip: dekk etter lengden, bru i full bredde, skorstein og mast. */
function aftHouse(p: Parts, h: Hull, funnel: number): { front: number; lantern: [number, number] } {
  const { L, B, fb } = h, len = clamp(L * 0.12, 4, 24), decks = clamp(Math.round(L / 32), 1, 5), high = decks * 2.8;
  const aft = h.A + clamp(L * 0.05, 1.2, 10), mid = aft + len / 2;
  p.house(WHITE, B * 0.84, high, len, 0, fb, mid, Array.from({ length: decks }, (_, i) => i * 2.8 + 1.5));
  p.house(WHITE, B * 0.98, 2.7, len * 0.55, 0, fb + high, aft + len * 0.72, [1.4]);
  const stack = clamp(L * 0.035, 1.5, 7) + 2.7;
  p.box(funnel, B * 0.24, stack, len * 0.3, 0, fb + high, aft + len * 0.2).box(BLACK, B * 0.25, 0.6, len * 0.31, 0, fb + high + stack, aft + len * 0.2);
  const top = p.mast(0, fb + high + 2.7, aft + len * 0.72, clamp(L * 0.04, 2.5, 8));
  return { front: aft + len, lantern: [aft + len * 0.72, top] };
}

type Built = { p: Parts; lantern: [number, number]; extras?: THREE.Object3D[] };

/** Lasteskip: hus akter, bakk i baugen, og lasterom med luker og kraner, eller containere på dekk. */
function cargo(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM;
  const color = pick([s.color, 0x1f3a5f, 0x2b2f36, 0x2f5a3a, 0x8a2a22], s.id);
  const h = hull(p, s, { fb: clamp(L * 0.055, 1.8, 10), bow: 0.18, color, deck: pick([OXIDE, 0x3f6b50], s.id, 1), raised: clamp(L * 0.015, 0.8, 2.5) });
  const house = aftHouse(p, h, color), from = house.front + clamp(L * 0.02, 1, 4), to = h.F - h.bow - 1, room = to - from;
  if (L > 95 && pick([true, false, false], s.id, 2)) {
    // containere: båser på 12,2 m (40 fot), tre stabler i bredden, ulik høyde
    const bays = Math.floor(room / 13.4), w = (B * 0.9) / 3, colors = [0x9c3b2e, 0x2f5f8f, 0x3f7f5a, 0xc98a2b, 0x8d9299, 0x7a2f4f];
    for (let i = 0; i < bays; i++) for (let k = 0; k < 3; k++) {
      const tiers = 1 + ((Math.imul(s.id + i * 3 + k, 2654435761) >>> 12) % clamp(Math.round(L / 55), 2, 5));
      p.box(pick(colors, s.id, i * 3 + k + 5), w - 0.3, tiers * 2.6, 12.2, (k - 1) * w, h.fb + 0.12, from + (i + 0.5) * (room / bays));
    }
  } else {
    // lukedeksler, og kraner mellom dem på skip som er store nok til å ha egne
    const n = Math.max(1, Math.round(room / 24)), seg = room / n, crane = clamp(L * 0.07, 5, 11);
    for (let i = 0; i < n; i++) p.box(STEEL, B * 0.72, 1.3, seg * 0.82, 0, h.fb + 0.12, from + (i + 0.5) * seg);
    if (L > 80) for (let i = 1; i < n; i += n > 4 ? 2 : 1) {
      const at = from + i * seg;
      p.cyl(YELLOW, 0.9, crane, 0, h.fb, at).box(YELLOW, 2.4, 2.2, 2.6, 0, h.fb + crane, at).box(YELLOW, 0.7, 0.7, seg * 0.78, 0, h.fb + crane + 1.6, at + seg * 0.42);
    }
  }
  p.mast(0, h.fb + clamp(L * 0.015, 0.8, 2.5), h.F - h.bow * 0.45, clamp(L * 0.035, 2, 7));
  return { p, lantern: house.lantern };
}

/** Tankskip: lavt, mørkt skrog, rødt dekk, rørgate midt på dekket, manifold og slangekran midtskips, hus akter. */
function tanker(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM;
  const h = hull(p, s, { fb: clamp(L * 0.05, 1.6, 9), bow: 0.16, color: s.color, deck: OXIDE, round: 0.4, raised: clamp(L * 0.014, 0.8, 2.4) });
  const house = aftHouse(p, h, s.color), from = house.front + clamp(L * 0.02, 1, 4), to = h.F - h.bow - 1, mid = (from + to) / 2, y = h.fb + 0.12;
  p.box(GREY, clamp(B * 0.12, 0.8, 4), 1.1, to - from, 0, y, mid); // rørgata
  p.box(WHITE, clamp(B * 0.05, 0.4, 1.2), 0.3, to - from, clamp(B * 0.12, 0.8, 4) * 0.5 + 0.6, y + 1.2, mid); // gangbrua
  p.box(GREY, B * 0.92, 1.2, clamp(L * 0.03, 1.5, 5), 0, y, mid); // manifolden
  const crane = clamp(L * 0.05, 3, 8);
  p.cyl(YELLOW, 0.6, crane, B * 0.2, y, mid + clamp(L * 0.03, 2, 6)).box(YELLOW, B * 0.55, 0.6, 0.6, 0, y + crane, mid + clamp(L * 0.03, 2, 6));
  // tankluker langs dekket
  const n = clamp(Math.round((to - from) / 18), 2, 12);
  for (let i = 0; i < n; i++) for (const side of [-1, 1]) p.cyl(GREY, 0.7, 0.9, side * B * 0.28, y, from + (i + 0.5) * ((to - from) / n));
  p.mast(0, h.fb + clamp(L * 0.014, 0.8, 2.4), h.F - h.bow * 0.45, clamp(L * 0.035, 2, 7));
  return { p, lantern: house.lantern };
}

/** Passasjerskip. Under 45 m: rutebåt med salong og styrhus. Over: ferje eller cruiseskip med dekk som blir
 *  kortere oppover, bru med vinger, skorstein og (på de store) livbåter. */
function passenger(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM, accent = pick([NAVY, 0xa3262a, 0x1c1e22, 0x1f6b54, 0x1f4f9a], s.id);
  if (L < 45) {
    const h = hull(p, s, { fb: clamp(L * 0.07, 1.1, 3), bow: 0.3, color: s.color, deck: DECK, boot: accent });
    const aft = h.A + L * 0.14, fore = h.F - L * 0.3;
    p.slab(WHITE, outline(aft, fore, B * 0.86, L * 0.08), h.fb, h.fb + 2.5);
    p.box(GLASS, B * 0.86 + 0.16, 0.9, fore - aft - L * 0.1, 0, h.fb + 1.1, (aft + fore) / 2 - L * 0.03);
    const wheel = clamp(L * 0.16, 2.5, 6), at = fore - L * 0.08 - wheel / 2;
    p.house(WHITE, B * 0.55, 2.3, wheel, 0, h.fb + 2.5, at, [1.1]);
    if (L > 22) p.box(accent, B * 0.2, 2, wheel * 0.5, 0, h.fb + 2.5, at - wheel * 1.1);
    return { p, lantern: [at, p.mast(0, h.fb + 4.8, at, clamp(L * 0.12, 2, 4.5))] };
  }
  const fb = clamp(L * 0.06, 3, 13), h = hull(p, s, { fb, bow: 0.26, color: s.color, deck: DECK, boot: accent });
  p.slab(accent, outline(h.A, h.F, B + 0.1, h.bow, 0.92), 0.3, fb * 0.3); // farget bånd nederst på skutesida
  const decks = clamp(Math.round(L / 30), 2, 6);
  let y = fb + 0.12, aft = h.A, fore = h.F;
  for (let i = 0; i < decks; i++) {
    aft = h.A + L * (0.04 + 0.03 * i); fore = h.F - L * (0.17 + 0.035 * i);
    const bow = B * 0.55;
    p.slab(WHITE, outline(aft, fore, B, bow), y, y + 2.9);
    p.box(GLASS, B + 0.16, 0.9, fore - bow - aft - 3, 0, y + 1.3, (aft + 3 + fore - bow) / 2);
    y += 2.9;
  }
  p.slab(DECK, outline(aft + 0.4, fore - 1, B - 1, B * 0.55), y, y + 0.12);
  const bridge = fore - B * 0.3 - 2.5;
  p.house(WHITE, B + clamp(L * 0.02, 1, 4), 2.7, 5, 0, y, bridge, [1.4]);
  const stack = clamp(L * 0.05, 3, 11), at = h.A + L * 0.3;
  p.add(profile([[at - L * 0.035, y], [at + L * 0.035, y], [at + L * 0.015, y + stack], [at - L * 0.045, y + stack]], B * 0.34), accent);
  if (L > 90) for (const side of [-1, 1]) for (let i = 0; i < clamp(Math.floor(L / 45), 2, 5); i++) p.box(ORANGE, 2.8, 2.5, 8.5, side * (B / 2 - 1.7), y + 0.12, bridge - 14 - i * 12);
  return { p, lantern: [bridge - 4, p.mast(0, y + 2.7, bridge - 4, clamp(L * 0.05, 4, 10))] };
}

/** Hurtigbåt: lavt og spisst skrog, lang strømlinjet salong med vindusbånd, og styrhus oppå. */
function highSpeed(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM;
  const h = hull(p, s, { fb: clamp(L * 0.055, 1, 3.6), bow: 0.36, color: s.color, deck: GREY, boot: 0x1f4f9a, stern: 1 });
  const aft = h.A + L * 0.08, fore = h.F - L * 0.2, y = h.fb + 0.12, high = L > 30 ? 3 : 2.3;
  p.slab(WHITE, outline(aft, fore, B * 0.92, L * 0.2), y, y + high);
  p.box(GLASS, B * 0.92 + 0.16, 0.9, fore - L * 0.2 - aft - 1, 0, y + high - 1.5, (aft + fore - L * 0.2) / 2);
  p.box(0x1f4f9a, B * 0.92 + 0.14, 0.35, fore - L * 0.2 - aft - 1, 0, y + 0.25, (aft + fore - L * 0.2) / 2);
  const wheel = clamp(L * 0.16, 2.5, 8), at = fore - L * 0.2 - wheel * 0.2;
  p.slab(WHITE, outline(at - wheel / 2, at + wheel / 2 + 2, B * 0.6, 3), y + high, y + high + 2.2);
  p.box(GLASS, B * 0.6 + 0.16, 0.8, wheel - 1.5, 0, y + high + 1, at - 0.5);
  return { p, lantern: [at - 1, p.mast(0, y + high + 2.2, at - 1, clamp(L * 0.08, 1.8, 4))] };
}

/** Fiskebåt: høy baug med shelterdekk, styrhus forut, arbeidsdekk akter med nottrommel, kran og galge i hekken. */
function fishing(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM, color = pick([s.color, 0xa3262a, 0x1f4a8a, 0x2d6a4a, 0x23272c], s.id);
  const up = clamp(L * 0.05, 1.2, 2.6);
  const h = hull(p, s, { fb: clamp(L * 0.07, 1.4, 5), bow: 0.26, color, deck: 0x7d6a55, raised: up, raisedFrom: L * 0.02 });
  const y = h.fb + up + 0.12, levels = L > 38 ? 2 : 1, wheel = clamp(L * 0.16, 3, 11), at = L * 0.12;
  p.house(WHITE, B * 0.78, 2.5 * levels, wheel, 0, y, at, [2.5 * levels - 1.3]);
  const top = p.mast(0, y + 2.5 * levels, at, clamp(L * 0.12, 2.5, 8));
  if (L > 28) for (const side of [-1, 1]) p.cyl(BLACK, 0.35, 2.8, side * B * 0.3, y + 2.5 * levels - 1, at - wheel * 0.55);
  // arbeidsdekket: trommel, kran med bom, og galge i hekken
  const deck = h.fb + 0.12, r = clamp(L * 0.03, 0.6, 1.9);
  p.drum(STEEL, r, B * 0.5, 0, deck + r + 0.3, h.A + L * 0.22);
  p.box(ORANGE, B * 0.5, r * 0.9, r * 1.2, 0, deck + r * 1.6, h.A + L * 0.22); // nota med flottører
  const post = clamp(L * 0.11, 2.5, 7), gy = h.A + clamp(L * 0.04, 0.8, 3);
  for (const side of [-1, 1]) p.cyl(YELLOW, 0.3, post, side * B * 0.4, deck, gy);
  p.box(YELLOW, B * 0.8 + 0.6, 0.45, 0.45, 0, deck + post, gy);
  const crane = clamp(L * 0.09, 2, 6);
  p.cyl(YELLOW, 0.4, crane, B * 0.25, deck, h.A + L * 0.36).box(YELLOW, 0.4, 0.4, L * 0.2, B * 0.25, deck + crane, h.A + L * 0.28);
  return { p, lantern: [at, top] };
}

/** Slepebåt: kort og bred med butt baug, fenderlist, stort styrhus forut, to skorsteiner og vinsj på akterdekket. */
function tug(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM;
  const h = hull(p, s, { fb: clamp(L * 0.09, 1.4, 4), bow: 0.34, color: BLACK, deck: 0x6b3a2a, round: 0.7, raised: clamp(L * 0.03, 0.6, 1.4), raisedFrom: -L * 0.05 });
  p.slab(BLACK, outline(h.A - 0.2, h.F + 0.25, B + 0.6, h.bow, 0.92, 0.7), h.fb - 0.7, h.fb - 0.1); // fenderlista
  const y = h.fb + clamp(L * 0.03, 0.6, 1.4) + 0.12, len = clamp(L * 0.3, 4, 12), at = L * 0.1;
  p.house(s.color, B * 0.7, 2.6, len, 0, y, at, [1.4]);
  p.house(WHITE, B * 0.5, 2.5, len * 0.55, 0, y + 2.6, at + len * 0.12, [1.3]);
  for (const side of [-1, 1]) p.cyl(s.color, B * 0.06, 3.6, side * B * 0.22, y + 2.6, at - len * 0.4).cyl(BLACK, B * 0.065, 0.5, side * B * 0.22, y + 6.2, at - len * 0.4);
  const top = p.mast(0, y + 5.1, at + len * 0.12, clamp(L * 0.16, 3, 7));
  const deck = h.fb + 0.12;
  p.drum(STEEL, clamp(L * 0.03, 0.5, 1.2), B * 0.4, 0, deck + 1, h.A + L * 0.3).box(STEEL, B * 0.5, 0.9, 0.4, 0, deck, h.A + L * 0.14);
  return { p, lantern: [at + len * 0.12, top] };
}

/** Mudringsfartøy (slepesuger): lasterom med masse midt i skipet, portaler over det, sugerør langs sida, hus akter. */
function dredger(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM;
  const h = hull(p, s, { fb: clamp(L * 0.05, 1.5, 7), bow: 0.18, color: 0x27496d, deck: 0x4f6f52, round: 0.5, raised: clamp(L * 0.015, 0.8, 2.2) });
  const house = aftHouse(p, h, YELLOW), from = house.front + clamp(L * 0.03, 1, 5), to = h.F - h.bow - clamp(L * 0.03, 1, 5), mid = (from + to) / 2, y = h.fb + 0.12;
  p.box(STEEL, B * 0.8, 1.4, to - from, 0, y, mid).box(SAND, B * 0.72, 0.25, to - from - 0.8, 0, y + 1.4, mid);
  const n = clamp(Math.round((to - from) / 22), 2, 5), post = clamp(L * 0.06, 3, 8);
  for (let i = 0; i < n; i++) {
    const at = from + (i + 0.5) * ((to - from) / n);
    for (const side of [-1, 1]) p.cyl(YELLOW, 0.35, post, side * B * 0.46, y, at);
    p.box(YELLOW, B * 0.92 + 0.7, 0.6, 0.6, 0, y + post, at);
  }
  const r = clamp(B * 0.04, 0.35, 1);
  p.drum(BLACK, r, (to - from) * 0.9, -(B / 2 + r + 0.15), h.fb + 0.4, mid, true);
  p.box(BLACK, r * 2.6, r * 1.6, r * 3.5, -(B / 2 + r + 0.15), h.fb + 0.4 - r * 0.8, mid - (to - from) * 0.45);
  return { p, lantern: house.lantern };
}

/** Losbåt (Kystverkets heter «LOS» og et nummer): liten og rask, oransje, med lavt styrhus og rekkverk rundt. */
function pilot(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM;
  const h = hull(p, s, { fb: clamp(L * 0.09, 1.1, 2.6), bow: 0.4, color: ORANGE, deck: 0x4a5058, boot: BLACK, stern: 1 });
  p.slab(BLACK, outline(h.A - 0.1, h.F + 0.15, B + 0.35, h.bow, 1), h.fb - 0.45, h.fb - 0.05); // fenderlista
  const y = h.fb + 0.12, len = clamp(L * 0.34, 3, 9), at = L * 0.04;
  p.slab(ORANGE, outline(at - len / 2, at + len / 2 + 1.5, B * 0.7, 2.5), y, y + 2.2);
  p.box(GLASS, B * 0.7 + 0.16, 0.8, len - 1, 0, y + 1.05, at - 0.3).box(GLASS, B * 0.5, 0.8, 0.3, 0, y + 1.05, at + len / 2 + 0.75);
  p.box(WHITE, B * 0.72, 0.18, len + 0.6, 0, y + 2.2, at);
  const top = p.mast(0, y + 2.38, at - len * 0.15, clamp(L * 0.18, 2, 4));
  // «PILOT» på styrhuset, som på de ekte
  const text = lettering("PILOT", 0.9, "bold", "#18181c"), mat = new THREE.MeshLambertMaterial({ map: text.tex, transparent: true });
  const signs = [-1, 1].map((side) => {
    const m = new THREE.Mesh(text.geo, mat);
    m.position.set(side * (B * 0.35 + 0.1), y + 0.42, -(at - 0.3));
    m.rotation.y = (side * Math.PI) / 2;
    m.userData.dispose = () => { text.geo.dispose(); mat.dispose(); text.tex.dispose(); };
    return m;
  });
  return { p, lantern: [at - len * 0.15, top], extras: signs };
}

/** Dykkerfartøy: styrhus forut, åpent arbeidsdekk akter med kran og galge, og dykkerflagget (signalflagg A,
 *  hvitt og blått) i masta. */
function diving(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM;
  const h = hull(p, s, { fb: clamp(L * 0.08, 1.2, 4.5), bow: 0.28, color: 0x1f4f9a, deck: 0x7d6a55, raised: clamp(L * 0.03, 0.6, 2), raisedFrom: L * 0.1 });
  const y = h.fb + clamp(L * 0.03, 0.6, 2) + 0.12, levels = L > 35 ? 2 : 1, len = clamp(L * 0.2, 3, 12), at = L * 0.2;
  p.house(WHITE, B * 0.78, 2.5 * levels, len, 0, y, at, [2.5 * levels - 1.3]);
  const mastH = clamp(L * 0.16, 3, 8), top = p.mast(0, y + 2.5 * levels, at, mastH);
  // flagget: hvit halvdel ved masta, blå ytterst
  const fl = clamp(L * 0.05, 1, 2.2);
  p.box(WHITE, 0.08, fl, fl * 0.7, 0, top - fl - 0.3, at - fl * 0.35).box(0x1f4f9a, 0.08, fl, fl * 0.7, 0, top - fl - 0.3, at - fl * 1.05);
  const deck = h.fb + 0.12, crane = clamp(L * 0.1, 2.5, 7), post = clamp(L * 0.1, 2.5, 6), gy = h.A + clamp(L * 0.04, 0.8, 3);
  p.cyl(YELLOW, 0.45, crane, -B * 0.28, deck, h.A + L * 0.4).box(YELLOW, 0.45, 0.45, L * 0.22, -B * 0.28, deck + crane, h.A + L * 0.3);
  for (const side of [-1, 1]) p.cyl(YELLOW, 0.3, post, side * B * 0.4, deck, gy);
  p.box(YELLOW, B * 0.8 + 0.6, 0.45, 0.45, 0, deck + post, gy);
  p.box(WHITE, B * 0.3, 1.8, clamp(L * 0.08, 1.5, 4), B * 0.2, deck, h.A + L * 0.25); // dykkerkammeret
  p.box(ORANGE, B * 0.22, 0.9, clamp(L * 0.1, 1.5, 4), -B * 0.1, deck, h.A + L * 0.14); // lettbåten
  return { p, lantern: [at, top] };
}

/** Seilskip. Under 35 m: seilbåt med én mast, storseil og fokk. Over: skute med to eller tre master, rær med
 *  råseil, baugspryd og klyver. */
function sailing(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM;
  if (L < 35) {
    const h = hull(p, s, { fb: clamp(L * 0.07, 0.8, 2.2), bow: 0.45, color: WHITE, deck: WOOD, boot: NAVY, stern: 0.6 });
    const y = h.fb + 0.12, mastAt = L * 0.08, high = L * 1.15;
    p.slab(WHITE, outline(h.A + L * 0.3, mastAt + L * 0.12, B * 0.6, L * 0.1), y, y + clamp(L * 0.05, 0.5, 1.2));
    p.cyl(GREY, 0.12 + L * 0.004, high, 0, y, mastAt, 0.06);
    p.box(GREY, 0.14, 0.14, L * 0.42, 0, y + L * 0.12, mastAt - L * 0.21); // bommen
    p.tri(SAIL, [[mastAt - 0.1, y + L * 0.13], [mastAt - L * 0.41, y + L * 0.13], [mastAt - 0.1, y + high * 0.97]]);
    p.tri(SAIL, [[mastAt + 0.2, y + high * 0.85], [h.F - 0.4, y + 0.3], [mastAt + L * 0.02, y + 0.6]], 0.05);
    return { p, lantern: [mastAt, y + high] };
  }
  const h = hull(p, s, { fb: clamp(L * 0.06, 2, 5), bow: 0.3, color: pick([WHITE, BLACK, 0x1f3a5f], s.id), deck: WOOD, boot: 0x7a2420, stern: 0.7 });
  const y = h.fb + 0.12, masts = L > 55 ? 3 : 2, high = clamp(L * 0.62, 20, 52);
  p.house(WHITE, B * 0.5, 2.3, clamp(L * 0.1, 3, 8), 0, y, h.A + L * 0.16, [1.2]);
  p.box(WOOD, 0.35, 0.35, L * 0.16, 0, y + 1.2, h.F + L * 0.05); // baugsprydet
  let tallest = 0, tallestAt = 0, ahead: number | null = null;
  for (let i = 0; i < masts; i++) {
    const at = h.F - L * 0.24 - (i * L * 0.52) / Math.max(1, masts - 1) * (masts === 2 ? 0.8 : 1), mh = high * (i === masts - 1 && masts === 3 ? 0.82 : i === 0 ? 0.92 : 1);
    p.cyl(WOOD, 0.4, mh, 0, y, at, 0.16);
    if (mh > tallest) { tallest = mh; tallestAt = at; }
    // stagseil mellom mastene, og mesan (gaffelseil) bak den akterste: det som synes når skuta ses fra siden
    if (ahead !== null) p.tri(SAIL, [[ahead - 0.6, y + mh * 0.3], [at + 0.6, y + mh * 0.78], [at + 0.6, y + mh * 0.22]], 0.3);
    if (i === masts - 1) p.tri(SAIL, [[at - 0.5, y + mh * 0.16], [at - L * 0.16, y + mh * 0.2], [at - 0.5, y + mh * 0.62]]).box(WOOD, 0.3, 0.3, L * 0.17, 0, y + mh * 0.15, at - L * 0.085);
    ahead = at;
    const sails = clamp(Math.round(mh / 9), 2, 5), step = (mh * 0.82) / sails;
    for (let k = 0; k < sails; k++) {
      const w = B * (2.1 - 0.28 * k), base = y + mh * 0.12 + k * step;
      p.box(WOOD, w, 0.28, 0.28, 0, base + step * 0.9, at + 0.5); // råa
      p.box(SAIL, w * 0.94, step * 0.8, 0.12, 0, base + step * 0.08, at + 0.75);
    }
  }
  p.tri(SAIL, [[h.F + L * 0.12, y + 1.6], [h.F - L * 0.22, y + high * 0.7], [h.F - L * 0.2, y + 3]]);
  return { p, lantern: [tallestAt, y + tallest] };
}

/** Arbeidsbåt: alt som ikke har en egen type (redningsskøyter, havnebåter, ukjente). Skrog, styrhus forut og mast. */
function workboat(s: ShipSpec): Built {
  const p = new Parts(), L = s.lengthM, B = s.beamM;
  const h = hull(p, s, { fb: clamp(L * 0.075, 1, 5), bow: 0.3, color: s.color, deck: 0x4a5058, raised: clamp(L * 0.025, 0.4, 1.8) });
  const y = h.fb + 0.12, levels = L > 32 ? 2 : 1, len = clamp(L * 0.28, 2.5, 14), at = L * 0.06;
  p.house(WHITE, B * 0.76, 2.5 * levels, len, 0, y, at, [2.5 * levels - 1.3]);
  if (L > 18) p.box(s.color, B * 0.2, 2.2, len * 0.3, 0, y + 2.5 * levels, at - len * 0.3);
  if (L > 40) p.cyl(YELLOW, 0.4, 5, B * 0.25, y, h.A + L * 0.25).box(YELLOW, 0.4, 0.4, L * 0.15, B * 0.25, y + 5, h.A + L * 0.19);
  return { p, lantern: [at, p.mast(0, y + 2.5 * levels, at + len * 0.15, clamp(L * 0.14, 2, 7))] };
}

const TYPES: Record<Exclude<ShipModelKind, "superspeed">, (s: ShipSpec) => Built> = { cargo, tanker, passenger, highSpeed, fishing, tug, dredger, pilot, diving, sailing, workboat };

/** Navnet slik det står på skutesida: AIS sender bare store bokstaver. */
const displayName = (name: string): string => name.trim().replace(/^SUPER\s*SPEED/i, "SuperSpeed").replace(/SuperSpeed(\d)/, "SuperSpeed $1");

export function buildShipModel(kind: ShipModelKind, s: ShipSpec): ShipModel {
  if (kind === "superspeed") return superSpeed(displayName(s.name), s.lengthM);
  const { p, lantern, extras = [] } = TYPES[kind](s), mesh = p.mesh(), obj = new THREE.Group();
  obj.add(mesh, ...extras);
  return { obj, lantern, night: () => {}, dispose: () => { mesh.geometry.dispose(); for (const e of extras) (e.userData.dispose as (() => void) | undefined)?.(); } };
}
