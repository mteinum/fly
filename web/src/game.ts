/* Felles spilltilstand og inndata for pikselmodus og 3D-modus. */
import type { Camera, Message } from "./hud";
import { type Keys, startApproach, update } from "./physics";
import { newPlane, type Plane } from "./plane";
import type { Airport, Terrain } from "./terrain";

export interface Game {
  P: Plane;
  airport: Airport;
  msg: Message;
  cam: Camera;
  /** Ett steg: fysikk, meldinger og ny innflyging når det trengs. */
  step(dt: number): void;
}

export function createGame(terrain: Terrain, focus: HTMLElement): Game {
  const airport = terrain.meta.airports[0];
  const runway = airport.runways[0];
  const params = new URLSearchParams(location.search);
  let endIdx = Math.max(0, runway.ends.findIndex((e) => e.ident === params.get("rwy")));
  const P = newPlane();
  const K: Keys = {};
  const msg: Message = { text: "", t: 0 };
  const say = (text: string, t = 3) => { msg.text = text; msg.t = t; };
  const reset = () => {
    startApproach(P, terrain, runway.ends[endIdx]);
    say(`Innflyging ${airport.icao} bane ${runway.ends[endIdx].ident}`, 3);
  };
  const game: Game = {
    P, airport, msg,
    cam: params.get("cam") === "cockpit" ? "cockpit" : "chase",
    step(dt) {
      if (msg.t > 0) msg.t -= dt;
      if (update(P, terrain, airport, K, dt, say)) reset();
    },
  };
  const toggleCam = () => { game.cam = game.cam === "chase" ? "cockpit" : "chase"; };

  addEventListener("keydown", (e) => {
    K[e.code] = true;
    if (e.repeat) return;
    if (e.code === "KeyC") toggleCam();
    if (e.code === "KeyR") reset();
    if (e.code === "KeyT") { endIdx = 1 - endIdx; reset(); }
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  });
  addEventListener("keyup", (e) => { K[e.code] = false; });
  document.querySelectorAll<HTMLButtonElement>("#touch button[data-k]").forEach((b) => {
    const k = b.dataset.k!;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); K[k] = true; });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => { K[k] = false; });
  });
  document.getElementById("tCam")!.onclick = toggleCam;
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
  focus.focus();
  return game;
}

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
