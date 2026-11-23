/* Spillflyten rundt en krasj: reprise, så ny innflyging. Kjøres uten nettleser, med et minimum av DOM. */
import { beforeAll, describe, expect, it } from "vitest";
import type { Game } from "./game";
import { REPLAY_HOLD, REPLAY_SECONDS } from "./replay";
import { loadTestTerrain } from "./testTerrain";

const t = loadTestTerrain();
const element = () => ({ onclick: null, addEventListener() {}, focus() {} });

beforeAll(() => {
  Object.assign(globalThis, {
    location: { search: "" },
    addEventListener: () => {},
    document: { getElementById: element, querySelectorAll: () => [] },
  });
});

async function newGame(): Promise<Game> {
  const { createGame } = await import("./game");
  return createGame(t, element() as unknown as HTMLElement);
}
/** Kjør spillet til `done` er sann, maks `seconds`. Returnerer sekundene som gikk. */
function run(game: Game, done: () => boolean, seconds = 120, each: () => void = () => {}): number {
  let s = 0;
  while (!done() && s < seconds) { each(); game.step(0.02); s += 0.02; }
  return s;
}

describe("reprise etter krasj", () => {
  it("spiller av de siste fem sekundene utenfra, og starter så en ny innflyging", async () => {
    const game = await newGame(), P = game.P;
    run(game, () => false, 8); // fly litt, så opptaket er fullt
    // stup: nesa må holdes nede, ellers retter flyet seg opp av seg selv
    run(game, () => game.replay !== null, 60, () => { P.pitch = -0.4; });
    expect(P.state).toBe("crash");
    const replay = game.replay!, crash = { x: P.x, y: P.y, alt: P.alt }, count = game.approach.count;

    // reprisen begynner fem sekunder før, høyere oppe og lenger unna
    expect(replay.plane.alt).toBeGreaterThan(crash.alt + 50);
    expect(Math.hypot(replay.plane.x - crash.x, replay.plane.y - crash.y) * t.cell).toBeGreaterThan(200);
    // kameraet står stille i nærheten av der det endte
    const [sx, , sz] = replay.spectator;
    expect(Math.hypot(sx - crash.x * t.cell, sz - crash.y * t.cell)).toBeLessThan(200);

    // fysikken står stille: det ekte flyet rører seg ikke mens reprisen går
    const start = { ...replay.plane };
    run(game, () => false, 2);
    expect(game.replay).toBe(replay);
    expect([P.x, P.y, P.state]).toEqual([crash.x, crash.y, "crash"]);
    expect(replay.plane.alt).toBeLessThan(start.alt);
    expect(replay.spectator).toEqual([sx, replay.spectator[1], sz]);

    // etter fem sekunder pluss pausen er reprisen over og en ny innflyging i gang
    const rest = run(game, () => game.replay === null, 20);
    expect(rest + 2).toBeGreaterThan(REPLAY_SECONDS);
    expect(rest + 2).toBeLessThan(REPLAY_SECONDS + REPLAY_HOLD + 0.2);
    expect(P.state).toBe("fly");
    expect(game.approach.count).toBe(count + 1);
  });

  it("ender reprisen i sammenstøtet", async () => {
    const game = await newGame(), P = game.P;
    run(game, () => false, 8);
    run(game, () => game.replay !== null, 60, () => { P.pitch = -0.4; });
    const crashAlt = P.alt, replay = game.replay!;
    run(game, () => false, REPLAY_SECONDS + 0.5);
    expect(game.replay).toBe(replay);
    expect(replay.plane.alt).toBeCloseTo(crashAlt, 1);
    expect(replay.plane.x).toBeCloseTo(P.x, 6);
  });

  it("gir ingen reprise når flyet bare forlater kartet", async () => {
    const game = await newGame(), P = game.P;
    Object.assign(P, { x: 2, y: 250, alt: 900, hdg: -Math.PI / 2, pitch: 0, thr: 0.5 });
    const count = game.approach.count;
    run(game, () => game.approach.count > count, 30);
    expect(game.replay).toBeNull();
    expect(game.approach.count).toBe(count + 1);
  });
});

describe("styring med mus eller finger", () => {
  it("drar flyet i krenging og nese, går til midten når den slippes, og tar over fra autopiloten", async () => {
    const game = await newGame(), P = game.P;
    game.stick(0.8, 0);
    run(game, () => false, 2);
    expect(P.roll).toBeGreaterThan(0.2); // høyre
    game.stick(-0.8, 0);
    run(game, () => false, 4);
    expect(P.roll).toBeLessThan(-0.2);
    game.stick(null);
    const pitch0 = P.pitch;
    game.stick(0, 0.9); // bakover = nese opp
    run(game, () => false, 1);
    expect(P.pitch).toBeGreaterThan(pitch0 + 0.05);
    game.stick(0, -0.9);
    run(game, () => false, 2);
    expect(P.pitch).toBeLessThan(pitch0);
    // et trykk uten å dra er ikke styring: autopiloten blir stående
    game.stick(null);
    game.control({ kind: "autopilot" });
    game.stick(0.02, 0.01);
    run(game, () => false, 0.5);
    expect(game.autopilot).toBe(true);
    game.stick(0.5, 0);
    run(game, () => false, 0.1);
    expect(game.autopilot).toBe(false);
  });
});


describe("kurs mot et skip", () => {
  it("følger skipet mens det flytter seg, og slipper når skipet blir borte", async () => {
    const game = await newGame(), P = game.P;
    const ship = { id: 257000000, x: P.x + 300, y: P.y - 300, heading: 0, speed: 5, name: "TESTSKIP", lengthM: 80, detail: "" };
    game.ships = [ship];
    game.flyToShip(ship.id);
    expect(game.directTo).toMatchObject({ x: ship.x, y: ship.y, ship: { id: ship.id, name: "TESTSKIP" } });
    game.ships = [{ ...ship, x: ship.x + 20, y: ship.y - 10 }];
    game.step(0.02);
    expect(game.directTo).toMatchObject({ x: ship.x + 20, y: ship.y - 10 });
    game.ships = [];
    game.step(0.02);
    expect(game.directTo).toBeNull();
    expect(game.msg.text).toContain("TESTSKIP");
  });

  it("melder fra når flyet er over skipet, så det kan tas bilde", async () => {
    const game = await newGame(), P = game.P;
    game.ships = [{ id: 7, x: P.x + 5, y: P.y, heading: 0, speed: 0, name: "TESTSKIP", lengthM: 80, detail: "" }];
    game.flyToShip(7);
    game.step(0.02);
    expect(game.directTo).toBeNull();
    expect(game.shipReached).toEqual({ id: 7, name: "TESTSKIP" });
  });

  it("gjør ingenting for et skip som ikke finnes", async () => {
    const game = await newGame();
    game.flyToShip(1);
    expect(game.directTo).toBeNull();
  });
});
