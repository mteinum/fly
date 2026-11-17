/* Skiver (høydekurver -> sprites): skive k = alle celler med høyde >= k * ekvidistanse. */
import { shadeC } from "./colors";
import type { Terrain } from "./terrain";

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
}

export function buildLayers(t: Terrain, count = LAYERS): LayerStack {
  const W = t.width, H = t.height, { hgt, col } = t;
  const dh = t.meta.maxHeight / count;
  const layers: Layer[] = [];
  for (let k = 0; k < count; k++) {
    const hk = k * dh;
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (k > 0) {
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hgt[y * W + x] >= hk) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
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
      if (k === 0 || hh >= hk) {
        let c = col[i];
        if (hh >= hk + dh) c = shadeC(c, 0.6); // dekkes av skiven over: mørk kant
        u[y * w + x] = c;
      }
    }
    cx.putImageData(id, 0, 0);
    layers.push({ cv, x0, y0, hk });
  }
  return { layers, equidistance: dh };
}
