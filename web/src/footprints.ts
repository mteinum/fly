/* Bygninger med form: leser buildings.bin (omriss fra OpenStreetMap, se pipeline/src/flypipe/footprints.py)
 * og gjør dem om til trekanter. Ren regning, uten three.js, så den kan testes uten nettleser.
 *
 * Omrissene er © OpenStreetMap contributors, Open Database License (ODbL). */

export interface Footprint {
  /** Hjørnene som [x, z, x, z, ...] i meter fra kartets nordvestre hjørne (x mot øst, z mot sør). Ikke lukket. */
  ring: Float32Array;
  base: number; // m (NN2000): veggene går ned hit
  top: number; // m (NN2000): flatt tak
  color: [number, number, number]; // 0-255
}

/** Les buildings.bin: «FBLD», versjon, antall, og per bygg hjørner (u16), farge (3 x u8), fyll, bunn, topp (f32) og hjørnene. */
export function parseFootprints(buf: ArrayBuffer): Footprint[] {
  const v = new DataView(buf);
  if (String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== "FBLD" || v.getUint32(4, true) !== 1) throw new Error("buildings.bin har ukjent format");
  const count = v.getUint32(8, true), out: Footprint[] = [];
  let o = 12;
  for (let i = 0; i < count; i++) {
    const n = v.getUint16(o, true), color: [number, number, number] = [v.getUint8(o + 2), v.getUint8(o + 3), v.getUint8(o + 4)];
    const base = v.getFloat32(o + 6, true), top = v.getFloat32(o + 10, true);
    o += 14;
    const ring = new Float32Array(n * 2);
    for (let k = 0; k < n * 2; k++, o += 4) ring[k] = v.getFloat32(o, true);
    out.push({ ring, base, top, color });
  }
  if (o !== buf.byteLength) throw new Error("buildings.bin har feil lengde");
  return out;
}

/** To ganger arealet med fortegn: positivt når hjørnene går mot klokka i (x, z)-planet. */
const signedArea2 = (r: Float32Array): number => {
  let a = 0;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return a;
};

/** Del et enkelt mangekant i trekanter (øreklipping). Returnerer hjørneindekser, tre per trekant.
 *  Omrissene er små (7-10 hjørner i snitt), så den enkle O(n²)-metoden holder. */
export function triangulate(r: Float32Array): number[] {
  const n = r.length / 2, out: number[] = [];
  if (n < 3) return out;
  const ccw = signedArea2(r) > 0, idx = Array.from({ length: n }, (_, i) => i);
  const cross = (a: number, b: number, c: number) => (r[b * 2] - r[a * 2]) * (r[c * 2 + 1] - r[a * 2 + 1]) - (r[b * 2 + 1] - r[a * 2 + 1]) * (r[c * 2] - r[a * 2]);
  const inside = (p: number, a: number, b: number, c: number) => {
    const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    return ccw ? d1 > 0 && d2 > 0 && d3 > 0 : d1 < 0 && d2 < 0 && d3 < 0;
  };
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      const turn = cross(a, b, c);
      if (ccw ? turn <= 0 : turn >= 0) continue; // innoverhjørne: ikke et øre
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // selvkryssende eller utartet omriss: ta det vi har
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

export interface BuildingMesh {
  position: Float32Array; // x, y, z per hjørne
  color: Uint8Array; // r, g, b per hjørne
  index: Uint32Array;
}

/** Vegger er litt mørkere enn taket, så formen leses også når lyset står rett på. */
const WALL_SHADE = 0.78;

/** Trekanter for en gruppe bygg: vegger fra bunn til topp, og flatt tak. Hjørnene deles ikke mellom tak og
 *  vegg (de har ulik farge), og flatene får kanter fordi materialet skyggelegger per flate. */
export function buildingMesh(buildings: Footprint[]): BuildingMesh {
  let nVert = 0, nIdx = 0;
  const tris = buildings.map((b) => triangulate(b.ring));
  buildings.forEach((b, i) => { const n = b.ring.length / 2; nVert += n * 3; nIdx += n * 6 + tris[i].length; });
  const position = new Float32Array(nVert * 3), color = new Uint8Array(nVert * 3), index = new Uint32Array(nIdx);
  let v = 0, k = 0;
  buildings.forEach((b, bi) => {
    const n = b.ring.length / 2, roof = v, low = v + n, high = v + 2 * n, [r, g, bl] = b.color;
    for (let pass = 0; pass < 3; pass++) {
      // 0: takets hjørner, 1: veggenes nedre, 2: veggenes øvre
      const y = pass === 1 ? b.base : b.top, s = pass === 0 ? 1 : WALL_SHADE;
      for (let i = 0; i < n; i++, v++) {
        position[v * 3] = b.ring[i * 2]; position[v * 3 + 1] = y; position[v * 3 + 2] = b.ring[i * 2 + 1];
        color[v * 3] = r * s; color[v * 3 + 1] = g * s; color[v * 3 + 2] = bl * s;
      }
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      index[k++] = low + i; index[k++] = high + i; index[k++] = low + j;
      index[k++] = low + j; index[k++] = high + i; index[k++] = high + j;
    }
    for (const t of tris[bi]) index[k++] = roof + t;
  });
  return { position, color, index };
}
