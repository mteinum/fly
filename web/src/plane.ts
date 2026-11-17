/* Flyets tilstand. */

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
