/* Skiver (høydekurver -> sprites): skive k = alle celler med høyde >= k * ekvidistanse. */
import { shadeC } from "./colors";
import { BRIDGE, type Terrain } from "./terrain";

export const LAYERS = 56;

export interface Layer {
  cv: HTMLCanvasElement;
  x0: number;
  y0: number;
  hk: number;
}

export interface LayerStack {
  layers: Layer[];
  equidistance: number;
  /** Bakken sett rett ovenfra, med strukturer. Til minikartet. */
  minimap: HTMLCanvasElement;
}

/* Strukturer i stabelen: en celle er med i skive k når kb <= k <= kt.
 * Bygning: fra skiven over bakken og opp til taket (vegger under, tak øverst).
 * Bru: bare skiven i dekkhøyde. Skivene under er tomme, så det er luft under brua. */
function structureSlices(t: Terrain, dh: number, count: number): { kb: Int16Array; kt: Int16Array } {
  const n = t.width * t.height, kb = new Int16Array(n).fill(-1), kt = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!t.sKind[i]) continue;
    const above = Math.min(count - 1, Math.floor(Math.max(0, t.hgt[i]) / dh) + 1);
    const top = Math.min(count - 1, Math.max(above, Math.round(t.sTop[i] / dh)));
    kt[i] = top;
    kb[i] = t.sKind[i] === BRIDGE ? top : above;
  }
  return { kb, kt };
}

export function buildLayers(t: Terrain, count = LAYERS): LayerStack {
  const W = t.width, H = t.height, { hgt, col, sCol } = t;
  const dh = t.meta.maxHeight / count;
  const { kb, kt } = structureSlices(t, dh, count);
  const layers: Layer[] = [];
  for (let k = 0; k < count; k++) {
    const hk = k * dh;
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (k > 0) {
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (hgt[i] >= hk || (kb[i] <= k && k <= kt[i])) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) break;
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext("2d")!, id = cx.createImageData(w, h), u = new Uint32Array(id.data.buffer);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y + y0) * W + x + x0, hh = hgt[i];
      if (kb[i] <= k && k <= kt[i]) {
        u[y * w + x] = k === kt[i] ? sCol[i] : shadeC(sCol[i], 0.6); // tak/dekke øverst, vegg under
      } else if (k === 0 || hh >= hk) {
        let c = col[i];
        if (hh >= hk + dh) c = shadeC(c, 0.6); // dekkes av skiven over: mørk kant
        u[y * w + x] = c;
      }
    }
    cx.putImageData(id, 0, 0);
    layers.push({ cv, x0, y0, hk });
  }

  const minimap = document.createElement("canvas");
  minimap.width = W;
  minimap.height = H;
  const mx = minimap.getContext("2d")!, mid = mx.createImageData(W, H), mu = new Uint32Array(mid.data.buffer);
  for (let i = 0; i < W * H; i++) mu[i] = t.sKind[i] ? sCol[i] : col[i];
  mx.putImageData(mid, 0, 0);
  return { layers, equidistance: dh, minimap };
}
