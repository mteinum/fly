/* Rullebanen som egen skarp flate oppå terrenget, med merking.
 *
 * Ekte: banens ender, bredde og forskjøvne terskler (OurAirports).
 * Syntetisk: selve merkingen er tegnet etter vanlig mønster (terskelstriper, banenummer,
 * siktepunkt, midtlinje, kantlinjer), ikke etter ENCNs faktiske oppmerking.
 */
import * as THREE from "three";
import type { Runway, Terrain } from "./terrain";

const TEX_W = 128, TEX_L = 4096;
const STEP = 20; // m mellom tverrsnitt langs banen
const LIFT = 0.3; // m over terrenget

function markings(rw: Runway, length: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = TEX_W;
  cv.height = TEX_L;
  const g = cv.getContext("2d")!, W = rw.widthM;
  // Tegn i meter: x på tvers (0 = HØYRE kant sett fra ende 0 mot ende 1), y langs banen fra ende 0
  g.scale(TEX_W / W, TEX_L / length);
  g.fillStyle = "#3c3e44"; g.fillRect(0, 0, W, length);
  // slitt asfalt: tilfeldige flekker, og gummi i landingssonene
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,255,255"},${0.02 + rnd() * 0.04})`;
    g.fillRect(rnd() * W, rnd() * length, 2 + rnd() * 10, 4 + rnd() * 40);
  }
  const [a, b] = rw.ends, tA = a.displacedThresholdM, tB = length - b.displacedThresholdM;
  for (const y of [tA + 300, tB - 300]) {
    const rubber = g.createRadialGradient(W / 2, y, 2, W / 2, y, 260);
    rubber.addColorStop(0, "rgba(0,0,0,.28)"); rubber.addColorStop(1, "rgba(0,0,0,0)");
    g.save(); g.translate(W / 2, y); g.scale(0.07, 1); g.translate(-W / 2, -y);
    g.fillStyle = rubber; g.fillRect(-W * 8, y - 260, W * 17, 520); g.restore();
  }
  g.fillStyle = "#e9e9e4";
  g.fillRect(1.5, 0, 0.9, length); g.fillRect(W - 2.4, 0, 0.9, length); // kantlinjer
  for (let y = tA + 90; y < tB - 90; y += 50) g.fillRect(W / 2 - 0.45, y, 0.9, 30); // midtlinje

  // dir = +1 for ende 0 (leses når man flyr mot økende y), -1 for ende 1
  const end = (y0: number, dir: number, ident: string) => {
    g.fillRect(3, y0 - 0.9, W - 6, 1.8); // terskellinje
    for (let i = 0; i < 6; i++) for (const side of [-1, 1]) { // terskelstriper
      const x = W / 2 + side * (3 + i * 3.2) - (side < 0 ? 1.8 : 0);
      g.fillRect(x, dir > 0 ? y0 + 6 : y0 - 36, 1.8, 30);
    }
    for (const side of [-1, 1]) g.fillRect(W / 2 + side * 9 - (side < 0 ? 6 : 0), dir > 0 ? y0 + 300 : y0 - 345, 6, 45); // siktepunkt
    g.save();
    g.translate(W / 2, y0 + dir * 52);
    // Teksturen ses «ovenfra» med x speilet (0 = høyre), så tallet for ende 0 må snus en halv omdreining
    if (dir > 0) g.rotate(Math.PI);
    g.font = "bold 15px Helvetica, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(ident, 0, 0);
    g.restore();
  };
  end(tA, 1, a.ident);
  end(tB, -1, b.ident);
  return cv;
}

export function buildRunwayDecal(t: Terrain, rw: Runway, anisotropy: number): THREE.Mesh {
  const { cell } = t, [a, b] = rw.ends;
  const ax = a.x * cell, az = a.y * cell, bx = b.x * cell, bz = b.y * cell;
  const length = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / length, uz = (bz - az) / length;
  const rx = -uz, rz = ux; // til høyre for kjøreretningen (nord -> øst)
  const half = rw.widthM / 2, n = Math.ceil(length / STEP);
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * length, cx = ax + ux * d, cz = az + uz * d;
    for (const side of [1, -1]) { // høyre (u = 0), så venstre (u = 1)
      const x = cx + rx * half * side, z = cz + rz * half * side;
      pos.push(x, Math.max(0, t.heightAt(x / cell, z / cell)) + LIFT, z);
      uv.push(side > 0 ? 0 : 1, i / n);
      nor.push(0, 1, 0);
    }
    if (i > 0) { const p = (i - 1) * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  const tex = new THREE.CanvasTexture(markings(rw, length));
  tex.flipY = false; // rad 0 = ende 0
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: tex, roughness: 1, metalness: 0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, // foran terrenget der de ligger tett
  }));
}
