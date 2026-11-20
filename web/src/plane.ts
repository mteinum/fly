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
  gearDown: boolean; // understellsspaken
  gear: number; // understellets stilling: 0 = oppe, 1 = nede og låst
  flapCfg: number; // klaffspaken: 0, 1, 2, 3 eller 4 (FULL)
  flaps: number; // klaffenes stilling, 0-4, går gradvis mot flapCfg
  state: PlaneState;
  t: number; // s igjen i ikke-flygende tilstand
}

/** Nytt fly i landingsoppsett: understell nede, full klaff. */
export const newPlane = (): Plane => ({
  x: 0, y: 0, alt: 0, hdg: 0, spd: 0, pitch: 0, roll: 0, thr: 0,
  gearDown: true, gear: 1, flapCfg: 4, flaps: 4, state: "fly", t: 0,
});
