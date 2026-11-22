/* Flyets tilstand. */

export type PlaneState = "fly" | "landed" | "crash" | "outside";

/** Det som ble målt i det hjulene tok bakken. */
export interface Touchdown {
  runway: string; // baneenden det ble landet fra, f.eks. «03»
  kt: number; // fart
  fpm: number; // synkerate i fot per minutt (positiv = nedover)
  crossM: number; // avstand fra senterlinja
  pastThresholdM: number; // avstand fra terskelen langs banen (negativ = før terskelen)
  flaps: number; // klaffstilling 0-4
}

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
  speedBrake: boolean; // luftbremsespaken
  brake: number; // luftbremsenes stilling: 0 = inne, 1 = helt ute
  autobrake: number; // autobremsen: 1 = LO, 2 = MED, 3 = MAX. Virker etter landing
  wheelBrake: number; // hvor hardt hjulbremsene står på nå, 0-1 (autobrems, fotbremser eller parkeringsbrems)
  brakeTemp: number; // bremsenes temperatur i °C. SYNTETISK: varmes av bremsingen og kjøles sakte
  taxi: boolean; // piloten har tatt over på bakken og takser selv (etter landing)
  parked: boolean; // flyet står stille for godt: parkert, stående etter landing, eller kjørt fast
  stuck: boolean; // kjørt av asfalten og satt fast under taksing
  still: number; // s flyet har stått stille etter utrullingen uten at piloten har begynt å takse
  spoilersArmed: boolean; // bakkespoilerne er armert (luftbremsespaken trukket opp): da går de ut ved landing
  state: PlaneState;
  t: number; // s igjen i ikke-flygende tilstand
  touchdown: Touchdown | null; // satt ved landing, nullstilt ved ny innflyging
}

/** Nytt fly i landingsoppsett: understell nede, full klaff. */
export const newPlane = (): Plane => ({
  x: 0, y: 0, alt: 0, hdg: 0, spd: 0, pitch: 0, roll: 0, thr: 0,
  gearDown: true, gear: 1, flapCfg: 4, flaps: 4, speedBrake: false, brake: 0, autobrake: 2, wheelBrake: 0, brakeTemp: 40, taxi: false, parked: false, stuck: false, still: 0, spoilersArmed: true, state: "fly", t: 0, touchdown: null,
});
