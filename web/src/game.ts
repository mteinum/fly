/* Spilltilstand, klokke og inndata. */
import { autopilot } from "./autopilot";
import { startTime } from "./clock";
import { gradeLanding } from "./diploma";
import { type FlightLog, FlightLogger } from "./flightlog";
import { type Keys, moveFlaps, softStick, startApproach, toggleGear, toggleSpeedBrake, update } from "./physics";
import { Recorder, REPLAY_HOLD } from "./replay";
import { newPlane, type Plane } from "./plane";
import { type SkyState, skyState } from "./sky";
import { sunPosition } from "./sun";
import type { Airport, Terrain } from "./terrain";

/** Utvendig kamera følger flyet bakfra; cockpit ser ut gjennom frontruta; tårn ser flyet fra kontrolltårnet.
 *  «replay» velges ikke av spilleren: det er reprisen etter en krasj, sett fra et fast punkt. */
export type Camera = "external" | "cockpit" | "tower" | "replay";
const CAMERAS: Camera[] = ["external", "cockpit", "tower"];

/** Reprisen som spilles nå: flyet slik det var, og hvor kameraet står. */
export interface Replay {
  plane: Plane;
  spectator: [number, number, number];
}

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
  approach: { count: number; ident: string; autopilot: boolean; platformFt: number };
  /** Det autopiloten flyr etter nå (fart i kt, sann kurs i grader), eller null når den er av. Vises på FCU. */
  apTarget: { speedKt: number; courseTrueDeg: number } | null;
  /** Flight director (D slår den av og på): stillingen autopiloten ville holdt nå, vist som to grønne streker på PFD
   *  som piloten kan fly etter. `fd` er null når den er av, eller når autopiloten ikke kunne landet herfra. */
  flightDirector: boolean;
  fd: { pitch: number; bank: number } | null;
  /** Autopiloten flyr (A slår den av og på). `approach.autopilot` husker om den har vært brukt på denne innflygingen. */
  autopilot: boolean;
  /** Ett steg: klokke, fysikk, meldinger og ny innflyging når det trengs. */
  step(dt: number): void;
  /** Start en ny innflyging til samme bane. */
  restart(): void;
  /** Satt mens reprisen etter en krasj spilles av. Fysikken står stille imens. */
  replay: Replay | null;
  /** Skipene akkurat nå, til kartet: posisjon i rutenettet, rutenettkurs (rad) og fart (m/s). Settes av main.ts. */
  ships: { x: number; y: number; heading: number; speed: number; name: string; lengthM: number; detail: string }[];
  /** Andre fly akkurat nå, til kart og skilt: posisjon i rutenettet, høyde (m), rutenettkurs, kallesignal og linje to. */
  traffic: { x: number; y: number; alt: number; heading: number; name: string; detail: string }[];
  /** Loggen fra forrige innflyging som ble avsluttet (landing, krasj eller avbrutt), eller null. */
  flightLog: FlightLog | null;
}

const TIME_STEP_MS = 30 * 60 * 1000;

export function createGame(terrain: Terrain, focus: HTMLElement): Game {
  const airport = terrain.meta.airports[0];
  // Alle baneender på flyplassen, i den rekkefølgen T blar gjennom dem
  const ends = airport.runways.flatMap((rw) => rw.ends);
  const runwayOf = (end: (typeof ends)[number]) => airport.runways.find((rw) => rw.ends.includes(end))!;
  const params = new URLSearchParams(location.search);
  let endIdx = Math.max(0, ends.findIndex((e) => e.ident === params.get("rwy")));
  const P = newPlane();
  const K: Keys = {};
  const held: Record<string, number> = {}; // hvor lenge piltastene har vært holdt, som utslag 0-1
  const msg: Message = { text: "", t: 0 };
  const say = (text: string, t = 3) => { msg.text = text; msg.t = t; };
  const approach = { count: 0, ident: ends[endIdx].ident, autopilot: false, platformFt: 0 };
  // Tar piloten i stikka eller gassen, slipper autopiloten (som i flyet)
  const MANUAL = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyW", "KeyS"];
  const setAutopilot = (on: boolean, why = "") => {
    if (on && P.state !== "fly") return;
    game.autopilot = on;
    if (on) approach.autopilot = true;
    say(on ? "Autopilot on" : `Autopilot off${why}`, 2.5);
  };
  /** Kontrollene dette steget: pilotens taster, eller autopilotens utslag når den flyr. */
  const controls = (dt: number): Keys => {
    const manual = softStick(held, K, dt);
    game.apTarget = null;
    game.fd = null;
    if (game.flightDirector && P.state === "fly") {
      const want = autopilot(P, terrain, runwayOf(ends[endIdx]), ends[endIdx]);
      if (!("unable" in want)) game.fd = { pitch: want.pitch, bank: want.bank };
    }
    if (!game.autopilot || P.state !== "fly") return manual;
    if (MANUAL.some((k) => K[k])) { setAutopilot(false); return manual; }
    const cmd = autopilot(P, terrain, runwayOf(ends[endIdx]), ends[endIdx]);
    if ("unable" in cmd) { setAutopilot(false, `: ${cmd.unable}`); return manual; }
    if (cmd.gearDown !== P.gearDown) toggleGear(P, say);
    if (cmd.flapCfg !== P.flapCfg) moveFlaps(P, Math.sign(cmd.flapCfg - P.flapCfg), say);
    game.apTarget = { speedKt: cmd.speedKt, courseTrueDeg: ends[endIdx].headingTrueDeg };
    return cmd.keys;
  };
  const recorder = new Recorder(), logger = new FlightLogger(terrain, airport);
  let replayTime = 0;
  const reset = () => {
    // en innflyging som avbrytes i lufta logges også, hvis den varte lenge nok til å si noe
    const aborted = P.state === "fly" ? logger.finish(P, "", null, game.autopilot) : null;
    if (aborted && aborted.samples.length > 20) game.flightLog = aborted;
    recorder.clear();
    game.replay = null;
    game.autopilot = approach.autopilot = false;
    startApproach(P, terrain, ends[endIdx]);
    logger.start(P, runwayOf(ends[endIdx]), ends[endIdx], new Date());
    approach.count++;
    approach.ident = ends[endIdx].ident;
    approach.platformFt = Math.round((P.alt * 3.28084) / 100) * 100; // høyden innflygingen starter i, til FCU
    say(`Approach ${airport.icao} runway ${ends[endIdx].ident}`, 3);
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
    autopilot: false,
    flightDirector: true,
    fd: null,
    apTarget: null,
    ships: [],
    traffic: [],
    flightLog: null,
    cam: CAMERAS.find((c) => c === params.get("cam")) ?? "external",
    env: environment(time),
    restart: () => reset(),
    replay: null,
    step(dt) {
      game.time += dt * 1000;
      game.env = environment(game.time);
      if (game.replay) {
        // reprise: spill av opptaket, la siste bilde stå litt, og start så på nytt
        replayTime += dt;
        recorder.sample(replayTime, game.replay.plane);
        if (replayTime > recorder.duration + REPLAY_HOLD) reset();
        return;
      }
      if (msg.t > 0) msg.t -= dt;
      const wasFlying = P.state === "fly";
      const again = update(P, terrain, airport, controls(dt), dt, say);
      if (wasFlying) logger.step(P, dt, game.autopilot);
      if (wasFlying && P.state !== "fly") game.flightLog = logger.finish(P, msg.text, P.touchdown && gradeLanding(P.touchdown), game.autopilot) ?? game.flightLog;
      if (P.state !== "fly") game.autopilot = false;
      if (wasFlying) recorder.record(P, dt); // også steget der det smalt, så reprisen ender i sammenstøtet
      if (wasFlying && P.state === "crash" && recorder.duration > 0.5) {
        replayTime = 0;
        game.replay = { plane: { ...P, state: "fly" }, spectator: recorder.spectator(terrain) };
        recorder.sample(0, game.replay.plane);
      } else if (again) reset();
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
    if (e.code === "KeyA") setAutopilot(!game.autopilot);
    if (e.code === "KeyD") { game.flightDirector = !game.flightDirector; say(`Flight director ${game.flightDirector ? "on" : "off"}`, 2); }
    if (e.code === "KeyG") toggleGear(P, say);
    if (e.code === "KeyB") toggleSpeedBrake(P, say);
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
  document.getElementById("tAuto")!.onclick = () => setAutopilot(!game.autopilot);
  document.getElementById("tGear")!.onclick = () => toggleGear(P, say);
  document.getElementById("tBrake")!.onclick = () => toggleSpeedBrake(P, say);
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
  // ?ap: la autopiloten fly fra start
  if (params.has("ap")) setAutopilot(true);
  // ?flaps=0-4: start med klaffene i denne stillingen (til å se dem på flyet)
  if (params.has("brake")) Object.assign(P, { speedBrake: true, brake: 1 }); // ?brake: start med luftbremsene ute
  const flapsAt = params.has("flaps") ? Math.round(Number(params.get("flaps"))) : NaN;
  if (flapsAt >= 0 && flapsAt <= 4) Object.assign(P, { flapCfg: flapsAt, flaps: flapsAt });
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
