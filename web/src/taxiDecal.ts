/* Flyplassens bakkeanlegg som egne skarpe flater oppå terrenget: taksebaner og oppstillingsflater i asfalt,
 * gule senterlinjer, og nummeret malt ved hver stand.
 *
 * Ekte: hvor taksebanene, flatene og standene ligger, og numrene (OpenStreetMap, ODbL; se aeroways.json).
 * Syntetisk: bredden der OpenStreetMap ikke har den (23 m for taksebaner, 15 m mellom oppstillingsplasser),
 * fargene, og merkingen. Senterlinja er tegnet 0,5 m bred for å synes (den ekte er 0,15 m), og tallene er malt
 * etter et fast mønster, ikke etter flyplassens faktiske oppmerking.
 */
import * as THREE from "three";
import { STAND_LANE_M } from "./physics";
import type { Terrain } from "./terrain";

const LIFT = 0.22; // m over terrenget. Lavere enn rullebanen (0,3), som dermed ligger øverst der de møtes
const STEP = 12; // m mellom tverrsnitt langs en taksebane, så den følger terrenget
const LINE_W = 0.5;

type XZ = [number, number];

/** Del opp en linje så ingen biter er lengre enn `step`. */
export function resample(points: XZ[], step: number): XZ[] {
  const out: XZ[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Kantene på et bånd med bredden `width` langs linja: [venstre, høyre] for hvert punkt. I svinger deler
 *  naboene kant (gjæring), så båndet ikke får sprekker. Skarpe knekk begrenses til tre ganger halve bredden. */
export function ribbon(points: XZ[], width: number): [XZ, XZ][] {
  const half = width / 2, n = points.length;
  const dir = (i: number): XZ => {
    const [ax, az] = points[Math.max(0, i - 1)], [bx, bz] = points[Math.min(n - 1, i + 1)], len = Math.hypot(bx - ax, bz - az) || 1;
    return [(bx - ax) / len, (bz - az) / len];
  };
  return points.map(([x, z], i) => {
    const [dx, dz] = dir(i);
    // gjæring: der linja knekker må kanten ut med 1 / cos(halve knekkvinkelen) for å holde bredden
    let k = 1;
    if (i > 0 && i < n - 1) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i + 1];
      const l0 = Math.hypot(x - ax, z - az) || 1, l1 = Math.hypot(bx - x, bz - z) || 1;
      const cos = ((x - ax) / l0) * dx + ((z - az) / l0) * dz;
      k = Math.min(3, 1 / Math.max(0.2, cos)) * (l1 > 0 ? 1 : 1);
    }
    const ox = -dz * half * k, oz = dx * half * k; // til venstre for retningen (x øst, z sør)
    return [[x - ox, z - oz], [x + ox, z + oz]];
  });
}

/** Samler trekanter med høyden lagt på terrenget. */
class Builder {
  pos: number[] = [];
  idx: number[] = [];
  constructor(private t: Terrain, private lift: number) {}
  vertex(x: number, z: number): number {
    const { cell } = this.t;
    this.pos.push(x, Math.max(0, this.t.heightAt(x / cell, z / cell)) + this.lift, z);
    return this.pos.length / 3 - 1;
  }
  strip(points: XZ[], width: number): void {
    const edges = ribbon(resample(points, STEP), width);
    let prev: [number, number] | null = null;
    for (const [l, r] of edges) {
      const cur: [number, number] = [this.vertex(l[0], l[1]), this.vertex(r[0], r[1])];
      if (prev) this.idx.push(prev[0], prev[1], cur[0], prev[1], cur[1], cur[0]);
      prev = cur;
    }
  }
  polygon(ring: XZ[]): void {
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const base = this.pos.length / 3;
    for (const [x, z] of ring) this.vertex(x, z);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) this.idx.push(base + a, base + b, base + c);
  }
  mesh(color: number, offset: number): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(this.idx);
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color, roughness: 1, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset, // foran terrenget der de ligger tett
    }));
  }
}

/** Nummeret ved en stand, malt gult på bakken. */
function standNumber(t: Terrain, ref: string, x: number, z: number, heading: number): THREE.Mesh {
  const cv = document.createElement("canvas");
  cv.width = 128; cv.height = 64;
  const g = cv.getContext("2d")!;
  g.font = "bold 52px Helvetica, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#e8c520";
  g.fillText(ref, 64, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }));
  mesh.position.set(x, Math.max(0, t.heightAt(x / t.cell, z / t.cell)) + LIFT + 0.12, z);
  mesh.rotation.y = -heading; // leses når man kjører inn mot standen
  return mesh;
}

/** Blå kantlys langs taksebanene, ett for hver 30. meter på hver side: [x, y, z, r, g, b] i meter.
 *  SYNTETISK: plassert etter vanlig mønster, ikke etter flyplassens lysanlegg. Ingen lys inne på oppstillingsflatene
 *  (der står flyene) eller på rullebanen (den har sine egne). */
export function taxiLightPositions(t: Terrain): number[][] {
  const aero = t.aeroways, out: number[][] = [];
  if (!aero) return out;
  const { cell } = t, runways = t.meta.airports[0].runways;
  const onApron = (x: number, z: number): boolean => aero.aprons.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0] * cell, zi = ring[i][1] * cell, xj = ring[j][0] * cell, zj = ring[j][1] * cell;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  });
  const onRunway = (x: number, z: number): boolean => runways.some((rw) => {
    const ax = rw.ends[0].x * cell, az = rw.ends[0].y * cell, dx = rw.ends[1].x * cell - ax, dz = rw.ends[1].y * cell - az, len = Math.hypot(dx, dz);
    const along = ((x - ax) * dx + (z - az) * dz) / len, cross = Math.abs((x - ax) * dz - (z - az) * dx) / len;
    return along > -5 && along < len + 5 && cross < rw.widthM / 2 + 4;
  });
  for (const tw of aero.taxiways) {
    for (const [l, r] of ribbon(resample(tw.line.map(([x, y]): XZ => [x * cell, y * cell]), 30), tw.width + 2)) for (const [x, z] of [l, r]) {
      if (onApron(x, z) || onRunway(x, z)) continue;
      out.push([x, Math.max(0, t.heightAt(x / cell, z / cell)) + 0.6, z, 40, 100, 255]);
    }
  }
  return out;
}

/** Ruta til standen under taksing: en grønn stripe langs taksebanene (som «follow the greens» på store flyplasser)
 *  og en lysende søyle på standen, så den ses på avstand. SYNTETISK: hjelpemidler for spilleren. */
export function buildTaxiRoute(t: Terrain, route: [number, number][], stand: [number, number]): THREE.Object3D[] {
  const line = new Builder(t, LIFT + 0.2);
  line.strip(route.map(([x, y]): XZ => [x * t.cell, y * t.cell]), 1.4);
  const mesh = line.mesh(0x2fe04a, -5);
  mesh.material = new THREE.MeshBasicMaterial({ color: 0x2fe04a, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  const x = stand[0] * t.cell, z = stand[1] * t.cell, y = Math.max(0, t.heightAt(stand[0], stand[1]));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 40, 10), new THREE.MeshBasicMaterial({ color: 0x2fe04a, transparent: true, opacity: 0.45, depthWrite: false }));
  beam.position.set(x, y + 20, z);
  const pad = new THREE.Mesh(new THREE.RingGeometry(9, 11, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2fe04a, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
  pad.position.set(x, y + LIFT + 0.25, z);
  return [mesh, beam, pad];
}

/** Flatene som tegner flyplassens bakkeanlegg, eller ingen når utsnittet ikke har det. */
export function buildAirportGround(t: Terrain): THREE.Object3D[] {
  const aero = t.aeroways;
  if (!aero) return [];
  const m = (p: [number, number]): XZ => [p[0] * t.cell, p[1] * t.cell]; // rutenett -> meter (x øst, z sør)
  const asphalt = new Builder(t, LIFT), apron = new Builder(t, LIFT - 0.04), paint = new Builder(t, LIFT + 0.08);
  for (const ring of aero.aprons) apron.polygon(ring.map(m));
  for (const tw of aero.taxiways) {
    const line = tw.line.map(m);
    asphalt.strip(line, tw.width);
    paint.strip(line, LINE_W);
  }
  const out: THREE.Object3D[] = [apron.mesh(0x55575b, -1), asphalt.mesh(0x47494e, -2), paint.mesh(0xd9b61c, -3)];
  for (const st of aero.stands) {
    const [x, z] = m(st.at);
    let heading = 0;
    if (st.line && st.line.length > 1) {
      const line = st.line.map(m), [ax, az] = line[line.length - 2], [bx, bz] = line[line.length - 1];
      heading = Math.atan2(bx - ax, -(bz - az));
      apron.strip(line, STAND_LANE_M); // asfalt langs linja, også der flata rundt ikke er kartlagt
      paint.strip(line, LINE_W);
    }
    if (st.ref) out.push(standNumber(t, st.ref, x, z, heading));
  }
  // innkjøringslinjene ble lagt til etter at flatene ble bygget: bygg dem på nytt
  out[0] = apron.mesh(0x55575b, -1);
  // Oppstillingsflatene er flombelyst om natta: rendereren skrur opp gløden når det mørkner. SYNTETISK.
  out[0].name = "apron";
  ((out[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xfff0d0);
  ((out[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
  out[2] = paint.mesh(0xd9b61c, -3);
  return out;
}
