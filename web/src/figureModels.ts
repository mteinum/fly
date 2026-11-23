/* Modellene til morofigurene (se figures.ts): satt sammen av klosser, kuler og sylindere, som resten av spillet.
 * SYNTETISK alt sammen, og sterkt forstørret: en sjimpanse på 60 m synes fra et fly, en på 1,5 m gjør det ikke.
 * Modellene er tegnet med y opp og forsiden mot -z, som flyet.
 */
import * as THREE from "three";
import { AURORA_AIRPORTS, inSeason, placeFigures, type FigureKind, type PlacedFigure } from "./figures";
import type { Terrain } from "./terrain";

/** Det figurene trenger å vite for hvert bilde. Posisjoner er i verden (m): x øst, y opp, z sør. */
export interface FigureFrame {
  /** Sekunder, løpende. */
  now: number;
  plane: THREE.Vector3;
  /** 0 = dag, 1 = natt. */
  night: number;
  /** Vinden i rutenettet (m/s), dit den blåser. */
  wind: { east: number; north: number };
  /** Dato i norsk tid. */
  month: number;
  day: number;
}

type Tick = (f: FigureFrame) => void;
interface Model { obj: THREE.Object3D; tick?: Tick }

const mats = new Map<number, THREE.MeshLambertMaterial>();
/** Ett materiale per farge. Litt egenglød, så figurene ikke blir svarte om natta. */
const mat = (c: number): THREE.MeshLambertMaterial => {
  let m = mats.get(c);
  if (!m) mats.set(c, (m = new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.08, side: THREE.DoubleSide })));
  return m;
};
const glow = (c: number, opacity = 1): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: c, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide });

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const sph = (r: number) => new THREE.SphereGeometry(r, 14, 10);
const cyl = (rt: number, rb: number, h: number, n = 12) => new THREE.CylinderGeometry(rt, rb, h, n);
const cone = (r: number, h: number, n = 8) => new THREE.ConeGeometry(r, h, n);

function part(g: THREE.Object3D, geo: THREE.BufferGeometry, c: number | THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, typeof c === "number" ? mat(c) : c);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}
const group = (parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
};
/** Vri modellen (forside mot -z) så den ser mot flyet. */
const facePlane = (obj: THREE.Object3D, f: FigureFrame): void => { obj.rotation.y = -Math.atan2(f.plane.x - obj.position.x, -(f.plane.z - obj.position.z)); };
/** Sett kurs (rutenett, radianer med klokka fra nord). */
const setHeading = (obj: THREE.Object3D, hdg: number): void => { obj.rotation.y = -hdg; };

const BROWN = 0x5a3a22, TAN = 0xd8b48a, BLACK = 0x18181c, WHITE = 0xf4f4f0, RED = 0xc8202a, GOLD = 0xe2b93b, SKIN = 0xf0c8a8;

/* ---------- Kristiansand ---------- */

function chimp(): Model {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    part(g, cyl(0.7, 0.7, 3), BROWN, s, 1.5, 0);
    part(g, sph(0.7), TAN, s * 1.8, 8.9, 0); // ører
    part(g, sph(0.18), BLACK, s * 0.45, 8.8, -1.55);
  }
  part(g, sph(2.4), BROWN, 0, 5, 0).scale.set(1, 1.25, 0.9);
  part(g, sph(1.6), TAN, 0, 4.8, -1.2).scale.set(1, 1, 0.6);
  part(g, sph(1.7), BROWN, 0, 8.6, 0);
  part(g, sph(1.2), TAN, 0, 8.2, -0.8);
  part(g, cyl(0.5, 0.5, 4), BROWN, -2.7, 4.6, 0, 0, 0, -0.3);
  const arm = group(g, 2.2, 6.6, 0); // vinkearmen
  part(arm, cyl(0.5, 0.5, 4), BROWN, 0, 2, 0);
  part(arm, sph(0.7), TAN, 0, 4.2, 0);
  g.scale.setScalar(6);
  const y0 = 110;
  return { obj: g, tick: (f) => { g.position.y = y0 + Math.sin(f.now * 1.2) * 6; arm.rotation.z = -0.5 + Math.sin(f.now * 5) * 0.5; facePlane(g, f); } };
}

function pirateShip(): Model {
  const g = new THREE.Group(), ship = group(g);
  part(ship, box(8, 4, 26), 0x4a2f1b, 0, 1, 0);
  part(ship, cone(4, 8, 4), 0x4a2f1b, 0, 1, -17, -Math.PI / 2, Math.PI / 4);
  part(ship, box(8, 4, 7), 0x4a2f1b, 0, 5, 10);
  part(ship, box(8.2, 0.6, 26), 0xa02020, 0, 2.6, 0);
  for (const [z, h, w] of [[-5, 24, 13], [5, 20, 11]]) {
    part(ship, cyl(0.4, 0.4, h), 0x6b4a2a, 0, h / 2 + 2, z);
    part(ship, box(w, 8, 0.3), 0x1a1a1a, 0, h * 0.55 + 2, z - 0.4);
    part(ship, box(w * 0.7, 5, 0.3), 0x1a1a1a, 0, h * 0.9, z - 0.4);
  }
  const flag = group(ship, 0, 27.5, -5);
  part(flag, box(0.2, 2.6, 4.4), 0x101010, 0, 0, 2.2);
  part(flag, sph(0.7), WHITE, 0.15, 0.1, 2.2);
  ship.scale.setScalar(3);
  // seiler i ring, 200 m i radius
  return { obj: g, tick: (f) => { const a = f.now * 0.03; ship.position.set(Math.cos(a) * 200, Math.sin(f.now * 0.8) * 0.8, Math.sin(a) * 200); setHeading(ship, a + Math.PI); ship.rotation.z = Math.sin(f.now * 0.7) * 0.06; } };
}

function cannon(): Model {
  const g = new THREE.Group(), gun = group(g);
  for (const s of [-1, 1]) part(gun, cyl(2.2, 2.2, 0.6, 14), 0x6b4a2a, s * 2, 2.2, 0, 0, 0, Math.PI / 2);
  part(gun, box(3.4, 1.2, 5), 0x6b4a2a, 0, 2.4, 0.6);
  const barrel = group(gun, 0, 3.4, 0);
  part(barrel, cyl(0.9, 1.25, 8, 14), 0x1c1c1c, 0, 0, -2, -Math.PI / 2);
  const ELEVATION = 0.45;
  barrel.rotation.x = ELEVATION;
  gun.scale.setScalar(4);
  // Kruttrøyk: tre kuler som vokser og blekner. Kanonen fyrer når flyet er innen 3 km, hvert sjette sekund.
  const smoke = glow(0xf2f2f2, 0.9), puff = group(g);
  for (const [x, y, z, r] of [[0, 0, 0, 7], [5, 3, -2, 5], [-4, 2, 3, 5.5]]) part(puff, sph(r), smoke, x, y, z);
  puff.visible = false;
  let firedAt = -1e9;
  return {
    obj: g,
    tick: (f) => {
      facePlane(gun, f);
      const age = f.now - firedAt;
      if (age > 6 && f.plane.distanceTo(g.position) < 3000) firedAt = f.now;
      puff.visible = age < 3.5;
      if (puff.visible) {
        const h = -gun.rotation.y, out = 40 + age * 28;
        puff.position.set(Math.sin(h) * Math.cos(ELEVATION) * out, 14 + Math.sin(ELEVATION) * out + age * 6, -Math.cos(h) * Math.cos(ELEVATION) * out);
        puff.scale.setScalar(1 + age * 2.2);
        smoke.opacity = 0.9 * (1 - age / 3.5);
      }
    },
  };
}

/** Hummerfiskeren ved Flekkerøy: en sjark, en fisker i gult oljehyre som holder opp en hummer, teiner og blåser. */
function lobsterFisher(): Model {
  const g = new THREE.Group(), boat = group(g), HULL = 0xf2f2ee, WOOD = 0x8a5a2e, YELLOW = 0xf2c21a, LOBSTER = 0xd8281e;
  part(boat, box(7, 3, 20), HULL, 0, 0.8, 0);
  part(boat, cone(3.5, 6, 4), HULL, 0, 0.8, -12.6, -Math.PI / 2, Math.PI / 4);
  part(boat, box(7.2, 0.5, 20), 0x1f5fa8, 0, 2.3, 0); // blå ripe
  part(boat, box(4.4, 3.6, 5), HULL, 0, 4.1, -4); // styrhuset
  part(boat, box(4.5, 1.2, 4), 0x1c2733, 0, 4.8, -4.4);
  part(boat, box(4.8, 0.4, 5.6), WOOD, 0, 6.1, -4);
  // teinene: trekasser med nett, stablet akter
  for (const [x, y, z] of [[-1.6, 3, 7], [1.6, 3, 7], [0, 4.6, 7]]) {
    part(boat, box(2.8, 1.5, 3.6), WOOD, x, y, z);
    part(boat, box(2.9, 1.1, 3.2), 0x2f6b3f, x, y, z);
  }
  const man = group(boat, 0, 2.4, 2);
  for (const s of [-1, 1]) part(man, cyl(0.5, 0.5, 2.6), YELLOW, s * 0.6, 1.3, 0);
  part(man, cyl(1, 1.2, 3), YELLOW, 0, 4, 0);
  part(man, sph(0.8), SKIN, 0, 6.2, 0);
  part(man, cyl(1.5, 1.5, 0.25, 12), YELLOW, 0, 6.8, 0.2); // sydvesten
  part(man, sph(0.8), YELLOW, 0, 6.9, 0).scale.y = 0.6;
  part(man, sph(0.55), WHITE, 0, 5.8, -0.6); // skjegget
  part(man, cyl(0.4, 0.4, 2.6), YELLOW, -1.4, 4, 0, 0, 0, -0.3);
  const arm = group(man, 1.2, 5, 0); // armen som holder hummeren opp
  part(arm, cyl(0.4, 0.4, 3), YELLOW, 0, 1.5, 0);
  const lobster = group(arm, 0, 3.6, 0);
  part(lobster, sph(0.7), LOBSTER, 0, 0, 0).scale.set(1, 1.9, 1);
  for (let k = 0; k < 3; k++) part(lobster, sph(0.5 - k * 0.08), LOBSTER, 0, -1.4 - k * 0.6, 0.1 * k); // halen
  part(lobster, box(1.6, 0.25, 0.8), LOBSTER, 0, -3.1, 0.2);
  const claws: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const claw = group(lobster, s * 0.5, 1, 0);
    part(claw, cyl(0.18, 0.18, 1.4), LOBSTER, s * 0.5, 0.6, 0, 0, 0, s * -0.6);
    part(claw, sph(0.55), LOBSTER, s * 1, 1.5, 0).scale.set(0.8, 1.5, 0.6);
    part(lobster, cyl(0.05, 0.05, 2.2, 4), LOBSTER, s * 0.3, 2.3, 0, 0, 0, s * -0.25); // følehorn
    claws.push(claw);
  }
  boat.scale.setScalar(4);
  // blåsene som merker teinene, i en rekke bortover sjøen
  const buoys: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) buoys.push(part(g, sph(5), i % 2 ? 0xf07818 : 0xd8281e, 90 + i * 55, 1, -40 + (i % 2) * 30));
  return {
    obj: g,
    tick: (f) => {
      boat.position.y = Math.sin(f.now * 0.9) * 1.2;
      boat.rotation.z = Math.sin(f.now * 0.7) * 0.07;
      boat.rotation.x = Math.sin(f.now * 0.5) * 0.03;
      arm.rotation.z = Math.sin(f.now * 2) * 0.15;
      claws.forEach((claw, i) => { claw.rotation.z = (i ? -1 : 1) * Math.max(0, Math.sin(f.now * 4 + i)) * 0.5; });
      buoys.forEach((b, i) => { b.position.y = 1 + Math.sin(f.now * 1.3 + i * 1.7) * 1.5; });
    },
  };
}

/** Kystvakta, som jevnlig kontrollerer hummerfisket: et grått skip med skråstriper i rødt, hvitt og blått
 *  som ligger i farvannet. */
function coastGuard(): Model {
  const g = new THREE.Group(), ship = group(g), GREY = 0x9aa3ab, LIGHT = 0xc9cfd4, DECK = 0x4a5058;
  part(ship, box(8, 4, 36), GREY, 0, 1, 0);
  const bow = group(ship, 0, 1, -23);
  part(bow, cone(5.66, 10, 4), GREY, 0, 0, 0, -Math.PI / 2, Math.PI / 4);
  bow.scale.y = 0.5; // like høy som skroget
  for (const [k, c] of [RED, WHITE, 0x00205b].entries()) part(ship, box(8.3, 4, 1.1), c, 0, 1, -13.25 + k * 1.25, -0.5);
  // skipssidas «KYSTVAKT», som på de ekte skipene
  const cv = document.createElement("canvas");
  cv.width = 512; cv.height = 80;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#18181c"; ctx.font = "bold 76px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("KYSTVAKT", 256, 44, 500);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const lettering = new THREE.MeshLambertMaterial({ map: tex, transparent: true });
  for (const s of [-1, 1]) part(ship, new THREE.PlaneGeometry(13, 2), lettering, s * 4.15, 1.7, -1, 0, s * Math.PI / 2);
  part(ship, box(7, 3.5, 12), LIGHT, 0, 4.75, -4);
  part(ship, box(6.4, 2.4, 6), LIGHT, 0, 7.7, -6); // brua
  part(ship, box(6.5, 0.9, 5), 0x1c2733, 0, 8, -6.6);
  part(ship, cyl(0.25, 0.35, 7, 8), GREY, 0, 12.4, -5);
  const blue = part(ship, sph(0.6), glow(0x2a6cff), 0, 16.2, -5);
  part(ship, cyl(0.2, 0.2, 1.2, 6), GREY, 0, 9.5, -7.5);
  const radar = part(ship, box(3.4, 0.4, 0.5), WHITE, 0, 10.2, -7.5);
  part(ship, box(3, 3.5, 3), GREY, 0, 8.25, 0.5); // skorsteinen
  part(ship, box(3.1, 0.6, 3.1), BLACK, 0, 10, 0.5);
  part(ship, box(8, 0.4, 11), DECK, 0, 3.2, 12.5); // helikopterdekket
  part(ship, cyl(3, 3, 0.1, 20), WHITE, 0, 3.45, 12.5);
  part(ship, box(1.8, 1.2, 1.8), DECK, 0, 3.6, -15.5); // kanonen på bakken
  part(ship, cyl(0.15, 0.15, 3, 6), DECK, 0, 3.9, -17.5, Math.PI / 2);
  ship.scale.setScalar(4);
  return {
    obj: g,
    tick: (f) => {
      ship.position.y = Math.sin(f.now * 0.5) * 0.6;
      ship.rotation.z = Math.sin(f.now * 0.4) * 0.02;
      radar.rotation.y = f.now * 2;
      blue.visible = f.now % 1 < 0.15 || (f.now % 1 > 0.3 && f.now % 1 < 0.45);
    },
  };
}

/* ---------- Oslo ---------- */

function crown(): Model {
  const g = new THREE.Group();
  part(g, cyl(5, 4.6, 3, 20), GOLD, 0, 1.5, 0);
  part(g, cyl(5.1, 5.1, 0.9, 20), WHITE, 0, 0.2, 0); // røyskattkant
  part(g, sph(4.3), 0xa01525, 0, 3.2, 0).scale.set(1, 0.85, 1); // fløyelslua
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, x = Math.cos(a) * 4.6, z = Math.sin(a) * 4.6;
    part(g, cone(0.9, 3.4, 4), GOLD, x, 4.6, z);
    part(g, sph(0.5), k % 2 ? 0x2a4fd0 : 0xd0202a, x, 6.5, z);
    part(g, sph(0.42), k % 2 ? 0xd0202a : 0x30b060, Math.cos(a + 0.39) * 4.95, 1.6, Math.sin(a + 0.39) * 4.95);
  }
  for (let k = 0; k < 4; k++) part(g, new THREE.TorusGeometry(4.4, 0.35, 6, 14, Math.PI), GOLD, 0, 3.4, 0, 0, (k * Math.PI) / 4, 0); // bøylene
  part(g, sph(0.95), GOLD, 0, 8.2, 0);
  part(g, box(0.35, 2.2, 0.35), GOLD, 0, 9.8, 0);
  part(g, box(1.4, 0.35, 0.35), GOLD, 0, 10.1, 0);
  g.scale.setScalar(6);
  return { obj: g, tick: (f) => { g.position.y = 70 + Math.sin(f.now) * 5; g.rotation.y = f.now * 0.5; } };
}

function skiJumper(fig: PlacedFigure, cell: number): Model {
  const g = new THREE.Group(), to = fig.to ?? { x: fig.x, y: fig.y + 26, groundM: fig.groundM };
  const dx = (to.x - fig.x) * cell, dz = (to.y - fig.y) * cell, hdg = Math.atan2(dx, -dz);
  // Tilløpet: en hvit rampe bak hoppet
  const ramp = group(g);
  setHeading(ramp, hdg);
  part(ramp, box(9, 2, 100), WHITE, 0, 48, 42, 0.55);
  part(ramp, cyl(2.5, 3.5, 70, 8), 0xb8bec6, 0, 35, 74);
  const man = group(g), body = group(man);
  body.rotation.x = -1.0; // lent framover over skiene
  part(body, box(1, 3, 0.7), 0x2a4fd0, 0, 1.5, 0);
  part(body, box(1.2, 3, 0.8), RED, 0, 4.5, 0);
  part(body, sph(0.75), WHITE, 0, 6.7, 0);
  for (const s of [-1, 1]) {
    part(body, box(0.3, 2.6, 0.3), RED, s * 0.85, 4.2, 0.2);
    part(man, box(0.4, 0.15, 9), 0xf2c21a, s * 1.1, 0, -2.5, 0.2, s * -0.22, 0); // skiene i V
  }
  man.scale.setScalar(5);
  setHeading(man, hdg);
  return {
    obj: g,
    tick: (f) => {
      const u = (f.now % 7) / 7;
      man.visible = u < 0.9; // en kort pause mellom hoppene
      const k = Math.min(1, u / 0.9);
      man.position.set(dx * k, 28 + (to.groundM - fig.groundM + 12 - 28) * k + Math.sin(Math.PI * k) * 30, dz * k);
      man.rotation.x = -0.25 + k * 0.5;
    },
  };
}

function vikingShip(): Model {
  const g = new THREE.Group(), ship = group(g);
  part(ship, box(5, 2.2, 24), 0x6b4423, 0, 0.6, 0);
  for (const s of [-1, 1]) {
    part(ship, cyl(0.5, 0.9, 8, 8), 0x6b4423, 0, 4, s * 13, s * 0.35);
    for (let i = 0; i < 6; i++) part(ship, cyl(0.95, 0.95, 0.25, 12), [0xc02020, 0xe0b020, 0x2a4fa0][i % 3], s * 2.65, 1.7, -9 + i * 3.6, 0, 0, Math.PI / 2); // skjold
  }
  part(ship, sph(1), GOLD, 0, 8.2, -14.6); // dragehodet
  part(ship, cyl(0.35, 0.35, 15, 8), 0x6b4a2a, 0, 8.5, 0);
  part(ship, box(11, 0.35, 0.35), 0x6b4a2a, 0, 14.5, 0);
  for (let i = 0; i < 5; i++) part(ship, box(2.2, 9, 0.2), i % 2 ? WHITE : 0xb22222, -4.4 + i * 2.2, 9.8, -0.3);
  ship.scale.setScalar(3.5);
  return { obj: g, tick: (f) => { const a = f.now * 0.04; ship.position.set(Math.cos(a) * 110, Math.sin(f.now * 0.9) * 0.7, Math.sin(a) * 110); setHeading(ship, a + Math.PI); ship.rotation.z = Math.sin(f.now * 0.6) * 0.05; } };
}

function sinnataggen(): Model {
  const g = new THREE.Group(), BRONZE = 0xc08a3e, DARK = 0x2a2014;
  part(g, box(5, 1.4, 5), 0x8d9399, 0, -0.7, 0); // sokkelen
  const boy = group(g);
  part(boy, sph(2.3), BRONZE, 0, 8, 0);
  part(boy, sph(2), BRONZE, 0, 4.6, 0).scale.set(1, 1.3, 0.9);
  for (const s of [-1, 1]) {
    part(boy, cyl(0.55, 0.55, 3.4), BRONZE, s * 2.4, 4.6, 0, 0, 0, s * 0.25);
    part(boy, sph(0.78), BRONZE, s * 2.95, 2.9, 0); // knyttnever
    part(boy, box(1.15, 0.28, 0.25), DARK, s * 0.8, 8.8, -2.05, 0, 0, s * 0.45); // sinte øyenbryn
    part(boy, sph(0.24), DARK, s * 0.8, 8.25, -2.1);
  }
  part(boy, box(1.4, 0.95, 0.25), DARK, 0, 7.05, -2.1); // skrikende munn
  part(boy, cyl(0.7, 0.7, 2.6), BRONZE, -0.9, 1.3, 0);
  const leg = group(boy, 0.9, 2.8, 0); // foten som tramper
  part(leg, cyl(0.7, 0.7, 2.6), BRONZE, 0, -1.3, 0);
  g.scale.setScalar(8);
  return { obj: g, tick: (f) => { const stomp = Math.max(0, Math.sin(f.now * 6)); leg.rotation.x = -0.9 * stomp; boy.position.x = Math.sin(f.now * 31) * 0.12 * (1 - stomp); g.position.y = 60 + Math.sin(f.now * 1.1) * 4; facePlane(g, f); } };
}

function dancer(): Model {
  const g = new THREE.Group(), PINK = 0xf6d8dc;
  part(g, cyl(0.3, 0.3, 5), SKIN, 0, 2.5, 0);
  const leg = group(g, 0, 5, 0); // løftet bein, rett bakover
  part(leg, cyl(0.3, 0.3, 5), SKIN, 0, -2.5, 0);
  leg.rotation.x = -1.35;
  part(g, cyl(3.4, 3.4, 0.35, 18), PINK, 0, 5.2, 0); // tutu
  part(g, cyl(2.6, 2.6, 0.3, 18), WHITE, 0, 5.5, 0);
  part(g, cyl(0.7, 0.9, 2.6), WHITE, 0, 6.7, 0);
  part(g, sph(0.75), SKIN, 0, 8.7, 0);
  part(g, sph(0.38), 0x3a2414, 0, 9.4, 0.35);
  part(g, new THREE.TorusGeometry(1.6, 0.18, 6, 12, Math.PI), SKIN, 0, 8.6, 0); // armene i bue over hodet
  g.scale.setScalar(9);
  return { obj: g, tick: (f) => { g.rotation.y = f.now * 2.6; g.position.y = 40 + Math.abs(Math.sin(f.now * 2.6)) * 3; } };
}

/* ---------- Bergen ---------- */

function umbrella(): Model {
  const g = new THREE.Group(), brolly = group(g);
  part(brolly, cone(7, 3.4, 8), RED, 0, 9.2, 0);
  part(brolly, sph(0.45), WHITE, 0, 11.1, 0);
  part(brolly, cyl(0.2, 0.2, 10, 6), 0x2b2b2b, 0, 4.5, 0);
  part(brolly, new THREE.TorusGeometry(0.9, 0.2, 6, 10, Math.PI), 0x2b2b2b, 0.9, -0.5, 0, 0, 0, Math.PI);
  brolly.scale.setScalar(9);
  brolly.position.y = 90;
  // Skya som alltid henger der, og regnet under den
  const cloud = group(g, 0, 420, 0), grey = new THREE.MeshLambertMaterial({ color: 0x8b9199, emissive: 0x8b9199, emissiveIntensity: 0.1 });
  for (const [x, y, z, r] of [[0, 0, 0, 90], [95, -10, 20, 70], [-100, -5, -10, 75], [30, 25, -55, 65], [-40, 20, 50, 60]]) part(cloud, sph(r), grey, x, y, z).scale.y = 0.6;
  const N = 220, pos = new Float32Array(N * 6), drops: number[] = [];
  for (let i = 0; i < N; i++) { const a = i * 2.399, r = 30 + ((i * 37) % 130); drops.push(Math.cos(a) * r, (i * 53) % 330, Math.sin(a) * r); }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xbfd6ee, transparent: true, opacity: 0.7 }));
  rain.frustumCulled = false;
  g.add(rain);
  return {
    obj: g,
    tick: (f) => {
      brolly.rotation.z = Math.sin(f.now * 0.9) * 0.12;
      brolly.rotation.y = f.now * 0.3;
      for (let i = 0; i < N; i++) {
        const y = 400 - ((drops[i * 3 + 1] + f.now * 140) % 330);
        pos.set([drops[i * 3], y, drops[i * 3 + 2], drops[i * 3], y - 14, drops[i * 3 + 2]], i * 6);
      }
      rainGeo.attributes.position.needsUpdate = true;
    },
  };
}

function funicular(fig: PlacedFigure, t: Terrain): Model {
  const g = new THREE.Group(), car = group(g), to = fig.to!;
  part(car, box(4, 3.6, 14), 0xc8102e);
  part(car, box(4.1, 1.4, 12), 0x1c2733, 0, 0.6, 0);
  part(car, box(4.2, 0.3, 14.2), WHITE, 0, 1.95, 0);
  car.scale.setScalar(3);
  const dx = (to.x - fig.x) * t.cell, dz = (to.y - fig.y) * t.cell, len = Math.hypot(dx, dz), hdg = Math.atan2(dx, -dz);
  car.rotation.order = "YXZ";
  return {
    obj: g,
    tick: (f) => {
      // opp og ned på 80 s, med en pause i hver ende
      const u = Math.min(1, Math.max(0, 0.5 - 0.6 * Math.cos((f.now / 80) * Math.PI * 2)));
      const h = (k: number) => t.heightAt(fig.x + (to.x - fig.x) * k, fig.y + (to.y - fig.y) * k);
      car.position.set(dx * u, h(u) - fig.groundM + 8, dz * u);
      car.rotation.set(Math.atan2(h(Math.min(1, u + 0.03)) - h(Math.max(0, u - 0.03)), len * 0.06), -hdg, 0);
    },
  };
}

/* ---------- Stavanger ---------- */

function swords(): Model {
  const g = new THREE.Group();
  for (const [x, z, h, tilt] of [[0, 0, 90, 0.02], [42, 10, 70, -0.05], [-40, 12, 70, 0.06]]) {
    const s = group(g, x, 0, z);
    s.rotation.z = tilt;
    part(s, box(8, h * 0.72, 2.4), 0xc9ced4, 0, h * 0.36, 0);
    part(s, box(26, 3.6, 4.4), 0xa87a3a, 0, h * 0.74, 0);
    part(s, cyl(2.4, 2.4, h * 0.16), 0x5a4326, 0, h * 0.83, 0);
    part(s, sph(4.6), 0xa87a3a, 0, h * 0.93, 0);
  }
  return { obj: g };
}

function oilPlatform(): Model {
  const g = new THREE.Group(), YELLOW = 0xe0b020, STEEL = 0x8d9399;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, cyl(5, 5, 80), YELLOW, sx * 30, 10, sz * 30);
  part(g, box(90, 10, 90), STEEL, 0, 55, 0);
  part(g, box(30, 18, 40), WHITE, -22, 69, 12);
  part(g, box(24, 12, 24), 0xd96a1e, 22, 66, 26);
  part(g, cone(14, 80, 4), 0x555d66, 16, 100, -18, 0, Math.PI / 4); // boretårnet
  part(g, cyl(17, 17, 2, 14), 0x2f6b3f, -44, 62, -44); // helikopterdekket
  part(g, box(10, 0.4, 2.4), WHITE, -44, 63.2, -44);
  const boom = group(g, 44, 60, 30);
  boom.rotation.z = 0.5;
  part(boom, box(70, 3, 3), RED, 35, 0, 0);
  const flame = part(boom, cone(5, 18, 7), glow(0xff8a1e), 73, 6, 0, 0, 0, -0.5);
  return { obj: g, tick: (f) => { flame.scale.set(1 + Math.sin(f.now * 17) * 0.15, 1 + Math.sin(f.now * 23) * 0.3, 1); } };
}

/* ---------- Nord-Norge ---------- */

function polarBear(): Model {
  const g = new THREE.Group(), FUR = 0xf6f6f0;
  part(g, sph(3), FUR, 0, 4.2, 0).scale.set(1, 0.9, 1.6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) part(g, cyl(0.9, 0.9, 3.2), FUR, sx * 1.5, 1.6, sz * 2.6);
    part(g, sph(0.45), FUR, sx, 7.6, -4.3);
    part(g, sph(0.18), BLACK, sx * 0.6, 6.7, -5.9);
  }
  part(g, sph(1.6), FUR, 0, 6.2, -4.6);
  part(g, sph(0.8), FUR, 0, 5.9, -6).scale.z = 1.4;
  part(g, sph(0.32), BLACK, 0, 6, -7.1);
  part(g, sph(0.5), FUR, 0, 4.8, 4.8);
  part(g, new THREE.TorusGeometry(1.55, 0.42, 6, 14), RED, 0, 5.3, -3.5, Math.PI / 2 - 0.6); // skjerfet
  const end = part(g, box(0.8, 2.8, 0.3), RED, 1.3, 3.9, -3.9);
  g.scale.setScalar(7);
  return { obj: g, tick: (f) => { facePlane(g, f); end.rotation.z = Math.sin(f.now * 3) * 0.3; } };
}

function maelstrom(): Model {
  const g = new THREE.Group(), rings: THREE.Mesh[] = [];
  part(g, new THREE.CircleGeometry(22, 20).rotateX(-Math.PI / 2), glow(0x0b2a3a, 0.8), 0, 1.4, 0);
  for (const [i, r] of [34, 66, 100, 138].entries()) {
    const ring = part(g, new THREE.RingGeometry(r, r + 11, 48, 1, i * 1.3, 4.4).rotateX(-Math.PI / 2), glow(0xffffff, 0.6), 0, 1.5 + i * 0.1, 0);
    rings.push(ring);
  }
  return { obj: g, tick: (f) => rings.forEach((ring, i) => { ring.rotation.y = -f.now * (1.3 - i * 0.28); }) };
}

function santa(): Model {
  const g = new THREE.Group(), team = group(g);
  part(team, box(4, 2, 8), RED, 0, 1.5, 0);
  for (const s of [-1, 1]) part(team, box(0.3, 0.3, 10.5), GOLD, s * 1.8, 0.15, 0);
  part(team, sph(1.6), 0x7a5230, 0, 3.3, 2.6); // sekken
  part(team, sph(1.5), RED, 0, 3.4, -1);
  part(team, sph(0.8), SKIN, 0, 5.1, -1);
  part(team, sph(0.75), WHITE, 0, 4.6, -1.55);
  part(team, cone(0.8, 1.7, 8), RED, 0, 6.2, -1);
  part(team, sph(0.3), WHITE, 0, 7.1, -1);
  part(team, box(0.12, 0.12, 22), 0x3a2414, 0, 3, -13); // tømmene
  const legs: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const deer = group(team, 0, 0, -9 - i * 6.5);
    part(deer, box(1.4, 1.6, 4.5), 0x7a5230, 0, 2.6, 0);
    part(deer, box(0.9, 2.2, 0.9), 0x7a5230, 0, 4, -2.2, 0.4);
    part(deer, box(0.9, 0.9, 1.9), 0x7a5230, 0, 5, -3.2);
    part(deer, sph(0.32), i === 2 ? glow(0xff2a1a) : mat(BLACK), 0, 5, -4.3); // den fremste har rød nese
    for (const sx of [-1, 1]) {
      part(deer, box(0.15, 1.8, 0.15), 0xcdbb95, sx * 0.6, 6.2, -2.8, 0, 0, sx * -0.5);
      part(deer, box(0.15, 0.9, 0.15), 0xcdbb95, sx * 1.1, 6.6, -2.8, 0, 0, sx * 0.4);
      for (const sz of [-1, 1]) legs.push(part(deer, box(0.35, 2, 0.35), 0x5a3a22, sx * 0.5, 1, sz * 1.7));
    }
  }
  team.scale.setScalar(4);
  // flyr i ring over Mehamn, 1 km i radius
  return {
    obj: g,
    tick: (f) => {
      const a = f.now * 0.05;
      team.position.set(Math.cos(a) * 1000, 300 + Math.sin(f.now * 0.5) * 30, Math.sin(a) * 1000);
      team.rotation.order = "YXZ";
      team.rotation.set(Math.cos(f.now * 0.5) * 0.12, -(a + Math.PI), 0);
      legs.forEach((leg, i) => { leg.rotation.x = Math.sin(f.now * 9 + i * 1.7) * 0.7; });
    },
  };
}

/* ---------- Ålesund og Gardermoen ---------- */

function puffins(): Model {
  const g = new THREE.Group(), birds: { bird: THREE.Group; wings: THREE.Group[] }[] = [], ORANGE = 0xf07818;
  for (let i = 0; i < 14; i++) {
    const bird = group(g), wings: THREE.Group[] = [];
    part(bird, sph(1), BLACK, 0, 0, 0).scale.set(1, 1, 1.6);
    part(bird, sph(0.86), WHITE, 0, -0.28, -0.1).scale.set(1, 1, 1.4);
    part(bird, sph(0.7), BLACK, 0, 0.5, -1.5);
    part(bird, cone(0.42, 1.2, 4), ORANGE, 0, 0.35, -2.4, -Math.PI / 2);
    for (const s of [-1, 1]) {
      part(bird, sph(0.5), WHITE, s * 0.36, 0.45, -1.7);
      part(bird, box(0.25, 0.1, 0.7), ORANGE, s * 0.4, -0.9, 1.4);
      const wing = group(bird, s * 0.9, 0.3, 0);
      part(wing, box(3, 0.15, 1.1), BLACK, s * 1.5, 0, 0);
      wings.push(wing);
    }
    bird.scale.setScalar(5);
    birds.push({ bird, wings });
  }
  return {
    obj: g,
    tick: (f) => birds.forEach(({ bird, wings }, i) => {
      const a = f.now * 0.2 + i * 0.16 + (i % 3) * 0.05, r = 330 + (i % 4) * 22;
      bird.position.set(Math.cos(a) * r, 70 + (i % 5) * 9 + Math.sin(f.now * 0.7 + i) * 6, Math.sin(a) * r);
      setHeading(bird, a + Math.PI);
      const flap = Math.sin(f.now * 16 + i * 1.3) * 0.75;
      wings[0].rotation.z = flap; wings[1].rotation.z = -flap;
    }),
  };
}

function moose(): Model {
  const g = new THREE.Group(), FUR = 0x5a3d26, LEG = 0x8a7560, HORN = 0xcdbb95;
  part(g, box(2.6, 3, 6.5), FUR, 0, 6.5, 0);
  part(g, box(2.4, 1.2, 2.4), FUR, 0, 8.3, -2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, box(0.7, 5, 0.7), LEG, sx * 0.9, 2.5, sz * 2.6);
  part(g, box(1.4, 3, 1.6), FUR, 0, 8.6, -3.6, 0.5);
  const head = group(g, 0, 9.8, -4.4);
  part(head, box(1.3, 1.4, 3.6), FUR, 0, 0, -1.6);
  part(head, sph(0.9), FUR, 0, -0.2, -3.4);
  part(head, box(0.3, 1.3, 0.3), FUR, 0, -1.2, -1.2); // skjegget
  for (const s of [-1, 1]) {
    part(head, box(0.3, 0.9, 0.5), FUR, s * 0.7, 1, -0.2);
    part(head, box(2.8, 0.25, 1.7), HORN, s * 2.1, 1.3, -0.4, 0, 0, s * 0.45);
    for (let k = 0; k < 4; k++) part(head, box(0.25, 1, 0.25), HORN, s * (1.4 + k * 0.55), 1.7 + k * 0.28, -0.4, 0, 0, s * -0.2);
  }
  g.scale.setScalar(7);
  return {
    obj: g,
    tick: (f) => {
      facePlane(g, f);
      // hodet følger flyet opp, men nakken har grenser
      const up = Math.atan2(f.plane.y - g.position.y - 70, Math.hypot(f.plane.x - g.position.x, f.plane.z - g.position.z));
      head.rotation.x = Math.min(0.9, Math.max(-0.1, up));
    },
  };
}

/* ---------- alle flyplassene ---------- */

function balloon(): Model {
  const g = new THREE.Group(), b = group(g);
  const colors = [0xd0202a, 0xf2c21a, 0x2a4fd0, WHITE];
  for (let k = 0; k < 8; k++) part(b, new THREE.SphereGeometry(22, 3, 12, (k * Math.PI) / 4, Math.PI / 4), colors[k % 4], 0, 42, 0).scale.y = 1.15;
  part(b, cyl(9, 3.5, 10, 8), 0xd0202a, 0, 14, 0);
  part(b, box(5, 4, 5), 0x7a5230, 0, 2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(b, cyl(0.15, 0.15, 7, 4), 0x3a2414, sx * 2.4, 7, sz * 2.4);
  const flame = part(b, cone(1.4, 4, 6), glow(0xffa030), 0, 7, 0);
  b.scale.setScalar(2.2);
  const SPAN = 6000; // ballongen driver 6 km med vinden og begynner så på nytt
  return {
    obj: g,
    tick: (f) => {
      let { east, north } = f.wind;
      if (Math.hypot(east, north) < 1.5) { east = 1.5; north = 0; } // i stille vær siger den sakte østover
      const speed = Math.hypot(east, north), d = ((f.now * speed) % SPAN) - SPAN / 2;
      b.position.set((east / speed) * d, 350 + Math.sin(f.now * 0.3) * 15, (-north / speed) * d);
      flame.visible = f.now % 5 < 1.6;
    },
  };
}

function whale(): Model {
  const g = new THREE.Group(), w = group(g), SKINC = 0x2d3e50;
  part(w, sph(1), SKINC, 0, -1.5, 0).scale.set(6, 4, 20);
  part(w, sph(1), 0xb8c2cc, 0, -3.2, -4).scale.set(5, 2.5, 14);
  const tail = group(w, 0, -0.5, 19);
  for (const s of [-1, 1]) part(tail, sph(1), SKINC, s * 4, 0, 3).scale.set(4.5, 0.6, 2.6);
  part(tail, sph(1), SKINC, 0, 0, 0).scale.set(1.6, 1.4, 4);
  const blow = part(w, cone(3, 16, 8), glow(0xffffff, 0.75), 0, 10.5, -11, Math.PI);
  w.scale.setScalar(2.2);
  return {
    obj: g,
    tick: (f) => {
      const u = (f.now % 16) / 16; // oppe, blåser, ruller framover og dykker med halen i været
      w.position.y = u < 0.6 ? Math.sin((u / 0.6) * Math.PI) * 6 - 2 : -2 - Math.sin(((u - 0.6) / 0.4) * Math.PI) * 14;
      w.rotation.x = u < 0.6 ? 0 : -Math.sin(((u - 0.6) / 0.4) * Math.PI) * 0.5;
      tail.rotation.x = u > 0.55 && u < 0.85 ? -Math.sin(((u - 0.55) / 0.3) * Math.PI) * 1.1 : 0;
      blow.visible = u > 0.2 && u < 0.36;
      blow.scale.y = 0.4 + Math.sin(((u - 0.2) / 0.16) * Math.PI) * 0.9;
      w.position.z = -u * 60;
    },
  };
}

/** Det norske flagget (22 x 16 deler) på en stang. */
function flags(fig: PlacedFigure): Model {
  const g = new THREE.Group(), cloths: THREE.Group[] = [], u = 0.8, hdg = fig.heading ?? 0;
  for (let i = 0; i < 10; i++) {
    const d = 60 + i * 45, pole = group(g, Math.sin(hdg) * d, 0, -Math.cos(hdg) * d);
    part(pole, cyl(0.6, 0.8, 36, 8), WHITE, 0, 18, 0);
    part(pole, sph(1.1), GOLD, 0, 36.6, 0);
    const cloth = group(pole, 0.6, 29, 0);
    part(cloth, box(22 * u, 16 * u, 0.3), 0xba0c2f, 11 * u, 0, 0);
    part(cloth, box(4 * u, 16 * u, 0.36), WHITE, 8 * u, 0, 0);
    part(cloth, box(22 * u, 4 * u, 0.36), WHITE, 11 * u, 0, 0);
    part(cloth, box(2 * u, 16 * u, 0.42), 0x00205b, 8 * u, 0, 0);
    part(cloth, box(22 * u, 2 * u, 0.42), 0x00205b, 11 * u, 0, 0);
    cloths.push(cloth);
  }
  return {
    obj: g,
    tick: (f) => {
      // flagget står med vinden
      const calm = Math.hypot(f.wind.east, f.wind.north) < 0.5, dir = calm ? 0 : Math.atan2(-f.wind.north, f.wind.east);
      cloths.forEach((cloth, i) => { cloth.rotation.y = -dir + Math.sin(f.now * 3 + i) * 0.18; });
    },
  };
}

/* ---------- nordlys ---------- */

/** Nordlys: tre bånd på nordhimmelen som følger kameraet. Grønt nederst, fiolett øverst, og striper som vandrer. */
function aurora(): { mesh: THREE.Mesh; uniforms: { time: { value: number }; strength: { value: number } } } {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], SEG = 80;
  for (const [band, [radius, base, height, from, to]] of [[42000, 9000, 15000, -1.1, 0.9], [50000, 15000, 17000, -0.6, 1.3], [36000, 6000, 10000, -1.5, 0.1]].entries()) {
    const start = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG, a = from + (to - from) * s, r = radius * (1 + 0.1 * Math.sin(s * 9 + band * 2) + 0.05 * Math.sin(s * 23 + band));
      // nord er -z; a = 0 er rett nord
      for (const top of [0, 1]) { pos.push(Math.sin(a) * r, base + top * height, -Math.cos(a) * r); uv.push(s * (3 + band), top); }
      if (i < SEG) { const k = start + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const uniforms = { time: { value: 0 }, strength: { value: 0 } };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `
      uniform float time; uniform float strength; varying vec2 vUv;
      void main(){
        float rays = 0.55 + 0.45 * sin(vUv.x * 70.0 + time * 0.7) * sin(vUv.x * 23.0 - time * 0.4);
        float sweep = 0.6 + 0.4 * sin(vUv.x * 4.0 + time * 0.25);
        float fade = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 1.6);
        vec3 col = mix(vec3(0.15, 1.0, 0.45), vec3(0.55, 0.2, 0.9), smoothstep(0.25, 1.0, vUv.y));
        gl_FragColor = vec4(col * rays * sweep * fade * strength, 1.0);
      }`,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // etter himmelen, før alt annet
  return { mesh, uniforms };
}

/* ---------- samlet ---------- */

function build(fig: PlacedFigure, t: Terrain): Model {
  const models: Record<FigureKind, () => Model> = {
    chimp, pirateShip, cannon, lobsterFisher, coastGuard, crown, skiJumper: () => skiJumper(fig, t.cell), vikingShip, sinnataggen, dancer, umbrella, funicular: () => funicular(fig, t),
    swords, oilPlatform, polarBear, maelstrom, santa, puffins, moose, balloon, whale, flags: () => flags(fig),
  };
  return models[fig.kind]();
}

/** Alle figurene for utsnittet. Legg `group` i scenen og kall `update` for hvert bilde. */
export class Figures {
  readonly group = new THREE.Group();
  private items: { kind: FigureKind; root: THREE.Group; model: Model }[] = [];
  private lights: ReturnType<typeof aurora> | null = null;

  constructor(t: Terrain) {
    for (const fig of placeFigures(t)) {
      const model = build(fig, t), root = new THREE.Group();
      // hver figur har origo på bakken (eller havflata) der den står; modellene regner høyder derfra
      root.position.set(fig.x * t.cell, fig.groundM, fig.y * t.cell);
      root.add(model.obj);
      this.group.add(root);
      this.items.push({ kind: fig.kind, root, model });
    }
    if (AURORA_AIRPORTS.includes(t.meta.airports[0].icao)) {
      this.lights = aurora();
      this.group.add(this.lights.mesh);
    }
  }

  /** `on` er spillerens valg (L). `camera` er der bildet ses fra: nordlyset følger det. */
  update(on: boolean, f: FigureFrame, camera: THREE.Vector3): void {
    this.group.visible = on;
    if (!on) return;
    for (const m of mats.values()) m.emissiveIntensity = 0.08 + 0.3 * f.night;
    const local = { ...f, plane: new THREE.Vector3() };
    for (const { kind, root, model } of this.items) {
      root.visible = inSeason(kind, f.month, f.day);
      if (!root.visible || !model.tick) continue;
      // modellene regner i egne koordinater: flyet sett fra figurens fot
      local.plane.copy(f.plane).sub(root.position);
      model.tick(local);
    }
    if (this.lights) {
      const strength = Math.max(0, f.night * 2.5 - 1.5); // som stjernene: først når det er skikkelig mørkt
      this.lights.mesh.visible = strength > 0;
      this.lights.mesh.position.copy(camera);
      this.lights.uniforms.time.value = f.now;
      this.lights.uniforms.strength.value = strength * 0.9;
    }
  }
}
