/* Spilltilstand, klokke og inndata. */
import { startTime } from "./clock";
import { type Keys, moveFlaps, startApproach, toggleGear, update } from "./physics";
import { newPlane, type Plane } from "./plane";
import { type SkyState, skyState } from "./sky";
import { sunPosition } from "./sun";
import type { Airport, Terrain } from "./terrain";

/** Utvendig kamera følger flyet bakfra; cockpit ser ut gjennom frontruta; tårn ser flyet fra kontrolltårnet. */
export type Camera = "external" | "cockpit" | "tower";
const CAMERAS: Camera[] = ["external", "cockpit", "tower"];

export interface Message {
  text: string;
  t: number;
}

export interface Environment {
  /** Solas retning i rutenettet (radianer, 0 = rutenett-nord, med klokka) og høyde (radianer). */
  sunAzimuth: number;
  sunElevation: number;
  sky: SkyState;
}

export interface Game {
  P: Plane;
  airport: Airport;
  msg: Message;
  cam: Camera;
  /** Spillklokka, UTC i ms. Går i sanntid; Q/E stiller den en halvtime bakover/framover. */
  time: number;
  env: Environment;
  /** Gjeldende innflyging: løpenummer (øker for hver ny) og banen det flys mot. */
  approach: { count: number; ident: string };
  /** Ett steg: klokke, fysikk, meldinger og ny innflyging når det trengs. */
  step(dt: number): void;
  /** Start en ny innflyging til samme bane. */
  restart(): void;
}

const TIME_STEP_MS = 30 * 60 * 1000;

export function createGame(terrain: Terrain, focus: HTMLElement): Game {
  const airport = terrain.meta.airports[0];
  // Alle baneender på flyplassen, i den rekkefølgen T blar gjennom dem
  const ends = airport.runways.flatMap((rw) => rw.ends);
  const params = new URLSearchParams(location.search);
  let endIdx = Math.max(0, ends.findIndex((e) => e.ident === params.get("rwy")));
  const P = newPlane();
  const K: Keys = {};
  const msg: Message = { text: "", t: 0 };
  const say = (text: string, t = 3) => { msg.text = text; msg.t = t; };
  const approach = { count: 0, ident: ends[endIdx].ident };
  const reset = () => {
    startApproach(P, terrain, ends[endIdx]);
    approach.count++;
    approach.ident = ends[endIdx].ident;
    say(`Innflyging ${airport.icao} bane ${ends[endIdx].ident}`, 3);
  };
  const environment = (time: number): Environment => {
    // Sola regnes for flyplassen; over 25 km er forskjellen ubetydelig
    const sun = sunPosition(time, airport.arp.lat, airport.arp.lon);
    return {
      // sann asimut -> rutenett: rutenett = sann - meridiankonvergens
      sunAzimuth: ((sun.azimuthDeg - terrain.meta.gridConvergenceDeg) * Math.PI) / 180,
      sunElevation: (sun.elevationDeg * Math.PI) / 180,
      sky: skyState(sun.elevationDeg),
    };
  };
  const time = startTime(params, Date.now());
  const game: Game = {
    P, airport, msg, time, approach,
    cam: CAMERAS.find((c) => c === params.get("cam")) ?? "external",
    env: environment(time),
    restart: () => reset(),
    step(dt) {
      game.time += dt * 1000;
      game.env = environment(game.time);
      if (msg.t > 0) msg.t -= dt;
      if (update(P, terrain, airport, K, dt, say)) reset();
    },
  };
  const toggleCam = () => { game.cam = CAMERAS[(CAMERAS.indexOf(game.cam) + 1) % CAMERAS.length]; };

  addEventListener("keydown", (e) => {
    if (isTyping(e)) return; // navnefeltet på diplomet
    K[e.code] = true;
    if (e.code === "KeyQ") game.time -= TIME_STEP_MS;
    if (e.code === "KeyE") game.time += TIME_STEP_MS;
    if (e.repeat) return;
    if (e.code === "KeyC") toggleCam();
    if (e.code === "KeyR") reset();
    if (e.code === "KeyT") { endIdx = (endIdx + 1) % ends.length; reset(); }
    if (e.code === "KeyG") toggleGear(P, say);
    if (e.code === "KeyF") moveFlaps(P, 1, say);
    if (e.code === "KeyV") moveFlaps(P, -1, say);
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  });
  addEventListener("keyup", (e) => { K[e.code] = false; });
  document.querySelectorAll<HTMLButtonElement>("#touch button[data-k]").forEach((b) => {
    const k = b.dataset.k!;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); K[k] = true; });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => { K[k] = false; });
  });
  document.getElementById("tCam")!.onclick = toggleCam;
  document.getElementById("tGear")!.onclick = () => toggleGear(P, say);
  document.getElementById("tFlapOut")!.onclick = () => moveFlaps(P, 1, say);
  document.getElementById("tFlapIn")!.onclick = () => moveFlaps(P, -1, say);
  document.getElementById("tTime")!.onclick = () => { game.time += 4 * TIME_STEP_MS; };
  focus.addEventListener("click", () => focus.focus());

  reset();
  // ?pos=øst,nord,høyde,sannKurs (UTM 33, m, grader): start et vilkårlig sted, til feilsøking
  const pos = params.get("pos")?.split(",").map(Number);
  if (pos?.length === 4 && pos.every(Number.isFinite)) {
    [P.x, P.y] = terrain.utmToGrid(pos[0], pos[1]);
    P.alt = pos[2];
    P.hdg = ((pos[3] - terrain.meta.gridConvergenceDeg) * Math.PI) / 180;
    P.pitch = 0;
  }
  // ?cfg=full: start ferdig satt opp for landing (understell nede, full klaff)
  if (params.get("cfg") === "full") Object.assign(P, { gearDown: true, gear: 1, flapCfg: 4, flaps: 4 });
  focus.focus();
  return game;
}

/** Sant når tastetrykket hører til et skrivefelt. Da skal det ikke styre spillet. */
export const isTyping = (e: Event): boolean => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

/** Kjør `frame(dt)` hver animasjonsramme, med dt begrenset til 50 ms. */
export function runLoop(frame: (dt: number) => void): void {
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(dt);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
