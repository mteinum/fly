/* Farger som 0xAABBGGRR (little-endian RGBA), slik ImageData lagrer dem. */

export const rgb = (r: number, g: number, b: number): number => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;

export function shadeC(c: number, f: number): number {
  return rgb(Math.min(255, ((c & 255) * f) | 0), Math.min(255, (((c >>> 8) & 255) * f) | 0), Math.min(255, (((c >>> 16) & 255) * f) | 0));
}

export function mixC(c: number, r2: number, g2: number, b2: number, t: number): number {
  const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
  return rgb((r + (r2 - r) * t) | 0, (g + (g2 - g) * t) | 0, (b + (b2 - b) * t) | 0);
}

export const css = (c: number): string => `rgb(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255})`;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
