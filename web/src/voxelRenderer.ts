/* Cockpit: Voxel Space. Samme høydekart og fargekart, loddrette striper per skjermkolonne med y-buffer. */
import { clamp, css, mixC, rgb } from "./colors";
import type { Plane } from "./plane";
import { H, W } from "./screen";
import { BRIDGE, BUILDING, type Terrain } from "./terrain";

const SKY: [number, number, number, number][] = [[0, 255, 176, 102], [0.15, 240, 120, 110], [0.45, 120, 70, 130], [1, 25, 22, 55]];
const FOG: [number, number, number] = [255, 176, 102];
const FOCAL = 160;
const DIST = 320; // celler (16 km ved 50 m)
export const HORIZON = H * 0.45;

function skyAt(t: number): number {
  t = clamp(t, 0, 1);
  for (let i = 1; i < SKY.length; i++) if (t <= SKY[i][0]) {
    const a = SKY[i - 1], b = SKY[i], u = (t - a[0]) / (b[0] - a[0]);
    return rgb((a[1] + (b[1] - a[1]) * u) | 0, (a[2] + (b[2] - a[2]) * u) | 0, (a[3] + (b[3] - a[3]) * u) | 0);
  }
  return rgb(25, 22, 55);
}

export class VoxelRenderer {
  private oc = document.createElement("canvas");
  private ox: CanvasRenderingContext2D;
  private img: ImageData;
  private buf: Uint32Array;
  private ybuf = new Int32Array(W);
  // Brudekker tegnes uten å flytte y-bufferen (det er luft under). Masken hindrer
  // at terreng lenger bak tegner over dem.
  private deck = new Uint8Array(W * H);
  private deckCol = new Uint8Array(W);

  constructor() {
    this.oc.width = W;
    this.oc.height = H;
    this.ox = this.oc.getContext("2d")!;
    this.img = this.ox.createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  render(g: CanvasRenderingContext2D, t: Terrain, P: Plane): void {
    const { buf, ybuf, deck, deckCol } = this, { hgt, col, sKind, sBase, sTop, sCol, width: N, height: M, cell } = t;
    deck.fill(0);
    deckCol.fill(0);
    const hor = HORIZON + P.pitch * FOCAL, fogC = rgb(...FOG);
    for (let y = 0; y < H; y++) buf.fill(y < hor ? skyAt((hor - y) / 120) : fogC, y * W, y * W + W);
    ybuf.fill(H);
    const sa = Math.sin(P.hdg), ca = Math.cos(P.hdg), camH = P.alt + 3;
    let z = 0.4, dz = 0.2;
    while (z < DIST) {
      const half = (z * (W / 2)) / FOCAL, fx = P.x + sa * z, fy = P.y - ca * z;
      let lx = fx - ca * half, ly = fy - sa * half;
      const dx = (ca * 2 * half) / W, dy = (sa * 2 * half) / W;
      const zm = z * cell, fog = Math.pow(z / DIST, 1.4);
      for (let i = 0; i < W; i++, lx += dx, ly += dy) {
        let h = 0, c = t.seaColor;
        if (lx >= 0 && ly >= 0 && lx < N && ly < M) {
          const ci = (ly | 0) * N + (lx | 0);
          c = col[ci];
          // bilineær høyde mellom cellesentre, ellers blir 50 m-cellene trappetrinn på nært hold
          const gx = lx - 0.5, gy = ly - 0.5;
          const x0 = gx < 0 ? 0 : gx > N - 2 ? N - 2 : gx | 0, y0 = gy < 0 ? 0 : gy > M - 2 ? M - 2 : gy | 0;
          const u = clamp(gx - x0, 0, 1), v = clamp(gy - y0, 0, 1), k = y0 * N + x0;
          const top = hgt[k] + (hgt[k + 1] - hgt[k]) * u, bot = hgt[k + N] + (hgt[k + N + 1] - hgt[k + N]) * u;
          h = Math.max(0, top + (bot - top) * v);
          if (sKind[ci] === BUILDING) {
            h = sTop[ci];
            c = sCol[ci];
          } else if (sKind[ci] === BRIDGE) {
            const y0d = Math.max(0, (((camH - sTop[ci]) / zm) * FOCAL + hor) | 0);
            const y1d = Math.min(ybuf[i], Math.max(y0d + 1, (((camH - sBase[ci]) / zm) * FOCAL + hor) | 0));
            if (y0d < y1d) {
              const dc = mixC(sCol[ci], FOG[0], FOG[1], FOG[2], fog);
              for (let y = y0d; y < y1d; y++) if (!deck[y * W + i]) { buf[y * W + i] = dc; deck[y * W + i] = 1; }
              deckCol[i] = 1;
            }
          }
        }
        let sy = (((camH - h) / zm) * FOCAL + hor) | 0;
        if (sy < ybuf[i]) {
          if (sy < 0) sy = 0;
          const cc = mixC(c, FOG[0], FOG[1], FOG[2], fog);
          if (deckCol[i]) { for (let y = sy; y < ybuf[i]; y++) if (!deck[y * W + i]) buf[y * W + i] = cc; }
          else for (let y = sy; y < ybuf[i]; y++) buf[y * W + i] = cc;
          ybuf[i] = sy;
        }
      }
      z += dz;
      dz += 0.005;
    }
    this.ox.putImageData(this.img, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = css(skyAt(0.3));
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, HORIZON);
    g.rotate(-P.roll);
    g.scale(1.45, 1.45);
    g.drawImage(this.oc, -W / 2, -HORIZON);
    g.restore();
  }
}
