/* Egne modeller for skip vi kjenner igjen på navnet i AIS (se shipModelKind i ships.ts). Alle andre skip tegnes
 * som to klosser i glRenderer.ts.
 *
 * SYNTETISK: formen er tegnet for hånd etter hvordan skipet ser ut, ikke etter tegninger eller oppmåling. Hovedmålene
 * (lengde 211,3 m, bredde 25,8 m) er skipets egne, og modellen er i sann målestokk, ikke forstørret som morofigurene.
 * På skutesida står rederiets navn og skipets navn fra AIS som vanlig tekst, etter ønske fra eieren av prosjektet.
 * Rederiets logo (merket på skorsteinen) er ikke med (se CLAUDE.md om logoer).
 *
 * Modellene er tegnet i meter med y opp fra vannflata og baugen mot -z, som flyet og de andre skipene.
 */
import * as THREE from "three";
import type { ShipModelKind } from "./ships";

export interface ShipModel {
  obj: THREE.Group;
  /** Lengden modellen er tegnet i (m), så rendereren kan skalere den til lengden skipet selv sender. */
  lengthM: number;
  /** Toppen av masta (m over vannet): der står lanterna om natta. */
  mastM: number;
  /** 0 = dag, 1 = natt: lys i vinduene. */
  night(n: number): void;
  dispose(): void;
}

const WHITE = 0xf3f3ee, NAVY = 0x14306b, GLASS = 0x1b2836, DECK = 0x5f7f78, ORANGE = 0xe8641e, GREY = 0x9aa3ab;

/** Et dekk sett ovenfra: rett hekk, parallelle sider og en baug som rundes inn mot spissen. `fwd` er framover. */
function outline(aft: number, fore: number, beam: number, bow: number, stern = 1): THREE.Shape {
  const h = beam / 2, s = new THREE.Shape(), run = Math.min(12, (fore - aft) / 4);
  s.moveTo(-h * stern, aft);
  s.lineTo(-h, aft + run);
  s.lineTo(-h, fore - bow);
  s.quadraticCurveTo(-h, fore - bow * 0.4, 0, fore);
  s.quadraticCurveTo(h, fore - bow * 0.4, h, fore - bow);
  s.lineTo(h, aft + run);
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
function lettering(text: string, heightM: number, style = "italic bold"): { tex: THREE.CanvasTexture; geo: THREE.PlaneGeometry } {
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d")!, font = `${style} 112px Helvetica, Arial, sans-serif`;
  ctx.font = font;
  cv.width = Math.ceil(ctx.measureText(text).width) + 24; cv.height = 128; // ny størrelse nullstiller tegnetilstanden
  ctx.fillStyle = "#14306b"; ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, cv.width / 2, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, geo: new THREE.PlaneGeometry((heightM * cv.width) / cv.height, heightM) };
}

/** Color Lines SuperSpeed 1 (Kristiansand-Hirtshals) og 2: lang, slank bilferje med høye, glatte sider, blått
 *  undervannsskrog, front som skrår bakover dekk for dekk, bru i full bredde og en stor skorstein akter. */
function superSpeed(name: string): ShipModel {
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

  return {
    obj, lengthM: L, mastM: 40,
    night: (n) => { windows.emissiveIntensity = 0.9 * n; },
    dispose: () => { for (const g of geos) g.dispose(); for (const m of [...mats.values(), windows, text, lineText]) m.dispose(); own.tex.dispose(); line.tex.dispose(); },
  };
}

/** Navnet slik det står på skutesida: AIS sender bare store bokstaver. */
const displayName = (name: string): string => name.trim().replace(/^SUPER\s*SPEED/i, "SuperSpeed").replace(/SuperSpeed(\d)/, "SuperSpeed $1");

export function buildShipModel(kind: ShipModelKind, name: string): ShipModel {
  const models: Record<ShipModelKind, () => ShipModel> = { superspeed: () => superSpeed(displayName(name)) };
  return models[kind]();
}
