/* Flyet: tilstand + sprite-stack. */
import { W } from "./screen";

export type PlaneState = "fly" | "landed" | "crash" | "outside";

export interface Plane {
  x: number; // rutenettceller, øker mot øst
  y: number; // rutenettceller, øker mot sør
  alt: number; // m over havet (NN2000)
  hdg: number; // rutenettkurs i radianer, 0 = nord, med klokka
  spd: number; // m/s
  pitch: number; // rad, positiv = nese opp
  roll: number; // rad, positiv = høyre vinge ned
  thr: number; // 0-1
  state: PlaneState;
  t: number; // s igjen i ikke-flygende tilstand
}

export const newPlane = (): Plane => ({ x: 0, y: 0, alt: 0, hdg: 0, spd: 0, pitch: 0, roll: 0, thr: 0, state: "fly", t: 0 });

type Rect = [x: number, y: number, w: number, h: number, fill: string];
const DEFS: Rect[][] = [
  [[9, 3, 2, 14, "#5d626c"]],
  [[8, 2, 4, 15, "#9aa0aa"], [2, 8, 16, 3, "#8a909a"]],
  [[8, 2, 4, 15, "#c9ced6"], [1, 8, 18, 3, "#c9ced6"], [1, 8, 2, 3, "#d23b3b"], [17, 8, 2, 3, "#d23b3b"], [5, 16, 10, 2, "#b9bec6"], [9, 1, 2, 1, "#c9ced6"]],
  [[9, 3, 2, 13, "#dde2e8"], [9, 4, 2, 3, "#3fb7e8"]],
  [[9, 4, 2, 3, "#9fe8ff"], [9, 14, 1, 4, "#c9ced6"]],
  [[9, 15, 1, 3, "#c9ced6"]],
  [[9, 16, 1, 2, "#d23b3b"]],
];

export function buildPlaneSprites(): HTMLCanvasElement[] {
  return DEFS.map((d) => {
    const c = document.createElement("canvas");
    c.width = c.height = 20;
    const x = c.getContext("2d")!;
    for (const [a, b, w, h, f] of d) {
      x.fillStyle = f;
      x.fillRect(a, b, w, h);
    }
    return c;
  });
}

export function drawPlane(g: CanvasRenderingContext2D, sprites: HTMLCanvasElement[], P: Plane, y: number, tilt: number): void {
  const sp = 1.5, sx = sp * (0.5 + 0.5 * Math.cos(P.roll)), sy = sp * tilt * (1 - P.pitch * 0.6);
  sprites.forEach((c, i) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.translate(W / 2 + Math.sin(P.roll) * i * 1.2, y - i * 1.1);
    g.scale(sx, sy);
    g.drawImage(c, -10, -10);
  });
  g.setTransform(1, 0, 0, 1, 0, 0);
}
