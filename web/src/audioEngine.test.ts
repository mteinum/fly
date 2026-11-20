/* Lydmotorens hendelseslogikk, kjørt mot en liksom-AudioContext der klokka styres av testen.
 * Tester HVA som spilles og NÅR - ikke hvordan det høres ut. */
import { beforeAll, describe, expect, it } from "vitest";
import type { Game } from "./game";
import { skyState } from "./sky";
import { newPlane } from "./plane";
import { loadTestTerrain } from "./testTerrain";

const FT = 3.28084;
let clock = 0;
const param = () => ({ value: 0, setTargetAtTime() {} });
const node = () => ({ connect: (n: unknown) => n, gain: param(), frequency: param(), Q: param(), playbackRate: param(), type: "", curve: null, loop: false, loopStart: 0, loopEnd: 0, buffer: null, start() {} });
class FakeContext {
  state = "running";
  destination = node();
  get currentTime() { return clock; }
  createGain = node; createBufferSource = node; createBiquadFilter = node; createWaveShaper = node;
  decodeAudioData = async () => ({ duration: 1 });
}

const t = loadTestTerrain();
const airport = t.meta.airports[0], [le, he] = airport.runways[0].ends;
// et punkt midt over rullebanen, og et over fjorden
const rwy = { x: (le.x + he.x) / 2, y: (le.y + he.y) / 2 };

async function setup(cam: Game["cam"] = "cockpit") {
  const { GameAudio } = await import("./audio");
  const audio = new GameAudio("/audio");
  await audio.startNow();
  const P = Object.assign(newPlane(), rwy, { spd: 70, thr: 0.3 });
  const game = { P, cam, airport, approach: { count: 1, ident: "03" }, msg: { text: "", t: 0 }, time: 0, env: { sunAzimuth: 0, sunElevation: 0, sky: skyState(30) }, step() {} } as Game;
  const ground = Math.max(0, t.heightAt(P.x, P.y));
  /** Sett radiohøyden (fot) og kjør én ramme. */
  const frame = (raFt: number, dt = 0.05) => { P.alt = ground + raFt / FT; clock += dt; audio.update(game, t); };
  return { audio, game, P, frame, played: () => audio.status.played };
}

beforeAll(() => {
  Object.assign(globalThis, {
    AudioContext: FakeContext,
    addEventListener: () => {},
    fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }),
  });
});

describe("lydmotoren", () => {
  it("leser alle lydene og starter de tre sløyfene", async () => {
    const { audio } = await setup();
    expect(audio.status).toMatchObject({ state: "running", loaded: 28, loops: 3 });
  });

  it("gir landingsklarering 2,5 s etter at innflygingen starter, over radio i cockpit", async () => {
    const { frame, played } = await setup();
    for (let i = 0; i < 40; i++) frame(1500);
    expect(played()).toEqual([]);
    for (let i = 0; i < 20; i++) frame(1500);
    expect(played()).toEqual(["radio", "cleared_03"]);
  });

  it("roper ut høydene i rekkefølge på vei ned, og «retard» til slutt", async () => {
    const { frame, played } = await setup();
    for (let i = 0; i < 80; i++) frame(1200); // la klareringen bli ferdig
    for (let ft = 1200; ft > 2; ft -= 2) frame(ft, 0.2);
    const calls = played().filter((n) => n.startsWith("alt_") || n === "retard");
    expect(calls).toEqual(["alt_1000", "alt_500", "alt_400", "alt_300", "alt_200", "alt_100", "alt_50", "alt_40", "alt_30", "alt_20", "alt_10", "retard"]);
  });

  it("varsler om understellet: tårnet én gang, flyet gjentatte ganger", async () => {
    const { frame, played, P } = await setup();
    Object.assign(P, { gearDown: false, gear: 0 });
    for (let i = 0; i < 80; i++) frame(900);
    expect(played()).not.toContain("go_around");
    for (let i = 0; i < 200; i++) frame(450);
    expect(played().filter((n) => n === "go_around")).toHaveLength(1);
    expect(played().filter((n) => n === "too_low_gear").length).toBeGreaterThanOrEqual(3);
  });

  it("spiller understell og klaff når spakene flyttes, men ikke ved ny innflyging", async () => {
    const { frame, played, P, game } = await setup();
    for (let i = 0; i < 80; i++) frame(2000);
    P.gearDown = false; frame(2000);
    P.flapCfg = 3; frame(2000);
    expect(played().slice(-2)).toEqual(["gear", "flaps"]);
    // ny innflyging stiller spakene tilbake: det skal ikke lage lyd
    const before = played().length;
    Object.assign(P, { gearDown: true, flapCfg: 2 }); game.approach.count++;
    frame(2000);
    expect(played().length).toBe(before);
  });

  it("spiller landing og velkomst fra tårnet, og plask i vann", async () => {
    const a = await setup();
    for (let i = 0; i < 80; i++) a.frame(300);
    a.P.state = "landed";
    for (let i = 0; i < 80; i++) a.frame(0);
    expect(a.played()).toContain("touchdown");
    expect(a.played().slice(-2)).toEqual(["radio", "welcome"]);

    const b = await setup();
    [b.P.x, b.P.y] = t.utmToGrid(92000, 6469000); // Topdalsfjorden
    for (let i = 0; i < 80; i++) b.frame(300);
    b.P.state = "crash";
    b.frame(0);
    expect(b.played()).toContain("splash");
    expect(b.played()).not.toContain("crash");
  });

  it("i tårnet: ingen utrop fra flyet, og flygelederen høres uten radio", async () => {
    const { frame, played } = await setup("tower");
    for (let i = 0; i < 80; i++) frame(1200);
    for (let ft = 1200; ft > 2; ft -= 2) frame(ft, 0.2);
    expect(played()).toContain("cleared_03");
    expect(played()).not.toContain("radio");
    expect(played().some((n) => n.startsWith("alt_"))).toBe(false);
  });
});
