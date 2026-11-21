/* Lyd: motor og vind som følger flyet, hendelser (understell, klaff, landing), flyets utrop
 * og flygelederen i tårnet. Filene er generert med ElevenLabs av pipeline (`flypipe audio`)
 * og er syntetiske - se web/public/audio/manifest.json.
 *
 * Nettlesere tillater ikke lyd før brukeren har trykket på noe, så lyden starter ved første
 * tastetrykk eller klikk.
 */
import type { Camera, Game } from "./game";
import { warnings } from "./physics";
import type { Airport, Terrain } from "./terrain";
import { towerView } from "./tower";

const FT = 3.28084;
const LOOPS = ["engine", "wind", "tower_room"] as const;
const ONE_SHOTS = ["gear", "flaps", "speedbrake", "touchdown", "crash", "splash", "warning", "radio", "retard", "too_low_gear", "stall", "go_around"];
/** Radiohøyder (fot) flyet roper ut på vei ned. */
export const CALLOUTS = [1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10];

/** Utropet som skal komme når radiohøyden går fra `prevFt` til `ft`, eller null. Bare på vei ned, og bare det laveste hvis flere passeres. */
export function altitudeCallout(prevFt: number, ft: number): number | null {
  if (ft >= prevFt) return null;
  let hit: number | null = null;
  for (const c of CALLOUTS) if (prevFt > c && ft <= c) hit = c;
  return hit;
}

interface Loop { gain: GainNode; source: AudioBufferSourceNode; filter?: BiquadFilterNode }

export class GameAudio {
  muted = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loops = new Map<string, Loop>();
  private ready = false;
  /** Når hver talekanal er ledig igjen (AudioContext-tid), så utrop ikke snakker i munnen på hverandre. */
  private busy = { callout: 0, tower: 0 };
  private repeatAt = { stall: 0, gear: 0, warning: 0 };
  private prev = { ra: Infinity, state: "", gearDown: true, flapCfg: -1, speedBrake: false, approach: -1 };
  private pending: { at: number; run: () => void }[] = [];
  private warnedGear = -1;
  private played: string[] = [];

  /** `airport` avgjør hvilke tårnmeldinger som lastes: én klarering per baneende og en velkomst. */
  constructor(private baseUrl: string, private airport: Airport) {
    const start = () => { void this.start(); };
    addEventListener("keydown", start, { once: true });
    addEventListener("pointerdown", start, { once: true });
  }

  /** Tilstand for feilsøking: om lyden er i gang, og hvor mange filer som ble lest. */
  get status(): { state: string; loaded: number; loops: number; played: string[] } {
    return { state: this.ctx?.state ?? "ikke startet", loaded: this.buffers.size, loops: this.loops.size, played: this.played };
  }

  /** Start uten å vente på tastetrykk. Virker bare der nettleseren tillater lyd uten brukerhandling. */
  startNow(): Promise<void> {
    return this.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  private async start(): Promise<void> {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);
    const icao = this.airport.icao;
    const towerClips = [...this.airport.runways.flatMap((rw) => rw.ends.map((e) => `cleared_${icao}_${e.ident}`)), `welcome_${icao}`];
    const names = [...LOOPS, ...ONE_SHOTS, ...CALLOUTS.map((c) => `alt_${c}`), ...towerClips];
    await Promise.all(names.map(async (name) => {
      try {
        const data = await (await fetch(`${this.baseUrl}/${name}.mp3`)).arrayBuffer();
        this.buffers.set(name, await ctx.decodeAudioData(data));
      } catch { /* manglende lydfil: spillet går videre uten den */ }
    }));
    for (const name of LOOPS) {
      const buffer = this.buffers.get(name);
      if (!buffer) continue;
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      // mp3 har litt stillhet i hver ende; hold sløyfa innenfor
      source.loopStart = 0.06;
      source.loopEnd = buffer.duration - 0.08;
      gain.gain.value = 0;
      if (name === "engine") {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        source.connect(filter).connect(gain);
        this.loops.set(name, { source, gain, filter });
      } else {
        source.connect(gain);
        this.loops.set(name, { source, gain });
      }
      gain.connect(this.master);
      source.start();
    }
    this.ready = true;
  }

  /** Spill en lyd én gang. `radio` gir telefonbånd og litt forvrengning, som over flyradio. */
  private play(name: string, volume: number, radio = false): number {
    const ctx = this.ctx, buffer = this.buffers.get(name);
    if (!ctx || !buffer || volume <= 0.001) return 0;
    this.played.push(name);
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    if (radio) {
      const band = ctx.createBiquadFilter(), shaper = ctx.createWaveShaper(), curve = new Float32Array(257);
      band.type = "bandpass"; band.frequency.value = 1700; band.Q.value = 0.9;
      for (let i = 0; i < 257; i++) curve[i] = Math.tanh(((i - 128) / 128) * 3);
      shaper.curve = curve;
      source.connect(band).connect(shaper).connect(gain);
    } else source.connect(gain);
    gain.connect(this.master);
    source.start();
    return buffer.duration;
  }

  /** Tale på en kanal. Hoppes over hvis kanalen er opptatt, med mindre den er viktig. */
  private say(channel: "callout" | "tower", name: string, volume: number, opts: { radio?: boolean; force?: boolean } = {}): void {
    const now = this.ctx!.currentTime;
    if (!opts.force && now < this.busy[channel]) return;
    const d = this.play(name, volume, opts.radio);
    if (d) this.busy[channel] = now + d + 0.15;
  }

  private later(seconds: number, run: () => void): void {
    this.pending.push({ at: this.ctx!.currentTime + seconds, run });
  }

  update(game: Game, t: Terrain): void {
    if (!this.ready || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime, P = game.P, cam: Camera = game.cam;
    const inside = cam === "cockpit", tower = cam === "tower";
    const dist = tower ? towerView(t, P).distanceM : 0;
    // i tårnet høres flyet svakere jo lenger unna det er
    const near = tower ? Math.min(1, 500 / Math.max(dist, 1)) : 1;
    const set = (name: string, value: number) => this.loops.get(name)?.gain.gain.setTargetAtTime(value, now, 0.12);

    const flying = P.state === "fly" || P.state === "landed";
    const power = P.state === "landed" ? 0.05 : P.thr;
    const engine = this.loops.get("engine");
    if (engine) {
      engine.source.playbackRate.setTargetAtTime(0.75 + power * 0.7, now, 0.3);
      engine.filter!.frequency.setTargetAtTime(inside ? 900 : tower ? 2200 : 5000, now, 0.1);
      set("engine", flying ? (inside ? 0.22 + 0.3 * power : 0.4 + 0.5 * power) * near : 0);
    }
    const wind = this.loops.get("wind");
    if (wind) {
      wind.source.playbackRate.setTargetAtTime(0.8 + P.spd / 250, now, 0.3);
      // luftbremsene ute: mer sus og rumling så lenge de står oppe i luftstrømmen
      set("wind", flying && !tower ? Math.min(1, (P.spd / 95) ** 2) * (inside ? 0.16 : 0.22) * (1 + 0.8 * P.brake) : 0);
    }
    set("tower_room", tower ? 5 : 0);

    for (const p of this.pending.filter((q) => q.at <= now)) p.run();
    this.pending = this.pending.filter((q) => q.at > now);

    const ra = Math.max(0, P.alt - Math.max(0, t.heightAt(P.x, P.y))) * FT, prev = this.prev;

    // ny innflyging: tårnet gir landingsklarering
    if (game.approach.count !== prev.approach) {
      prev.approach = game.approach.count;
      prev.ra = Infinity;
      this.pending.length = 0;
      const ident = game.approach.ident, count = game.approach.count;
      this.later(2.5, () => {
        if (game.approach.count !== count) return;
        if (game.cam !== "tower") this.play("radio", 0.25);
        this.say("tower", `cleared_${this.airport.icao}_${ident}`, 0.9, { radio: game.cam !== "tower", force: true });
      });
    } else if (P.state === "fly") {
      if (P.gearDown !== prev.gearDown && !tower) this.play("gear", 0.5);
      if (P.flapCfg !== prev.flapCfg && prev.flapCfg >= 0 && !tower) this.play("flaps", 0.4);
      if (P.speedBrake !== prev.speedBrake && !tower) this.play("speedbrake", 0.2); // klippet er 7 dB sterkere enn klaffelyden
    }

    if (P.state !== prev.state) {
      if (P.state === "landed") {
        this.play("touchdown", 0.45 * near);
        this.later(3, () => { if (game.cam !== "tower") this.play("radio", 0.25); this.say("tower", `welcome_${this.airport.icao}`, 0.9, { radio: game.cam !== "tower", force: true }); });
      } else if (P.state === "crash") {
        this.play(t.isWater(P.x, P.y) ? "splash" : "crash", 0.8 * Math.max(near, 0.15));
      }
    }

    if (P.state === "fly") {
      const w = warnings(P, ra);
      if (inside) {
        const call = altitudeCallout(prev.ra, ra);
        if (call !== null) this.say("callout", `alt_${call}`, 0.9, { force: call <= 50 });
        if (prev.ra > 15 && ra <= 15 && P.thr > 0.05) this.later(0.5, () => this.say("callout", "retard", 0.9, { force: true }));
        if (w.stall && now > this.repeatAt.stall) { this.say("callout", "stall", 1, { force: true }); this.repeatAt.stall = now + 1.9; }
        else if (w.gearNotDown && ra < 500 && now > this.repeatAt.gear) { this.say("callout", "too_low_gear", 1); this.repeatAt.gear = now + 3; }
        if (w.overspeed && now > this.repeatAt.warning) { this.play("warning", 0.3); this.repeatAt.warning = now + 2.4; }
      }
      // tårnet ser at understellet ikke er ute: én påminnelse per innflyging
      if (w.gearNotDown && this.warnedGear !== game.approach.count) {
        this.warnedGear = game.approach.count;
        if (!tower) this.play("radio", 0.25);
        this.say("tower", "go_around", 0.9, { radio: !tower, force: true });
      }
    }
    Object.assign(prev, { ra, state: P.state, gearDown: P.gearDown, flapCfg: P.flapCfg, speedBrake: P.speedBrake });
  }
}
