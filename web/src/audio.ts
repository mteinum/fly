/* Lyd: motor og vind som følger flyet, hendelser (understell, klaff, landing), flyets utrop
 * og flygelederen i tårnet. Filene er generert med ElevenLabs av pipeline (`flypipe audio`)
 * og er syntetiske - se web/public/audio/manifest.json.
 *
 * Nettlesere tillater ikke lyd før brukeren har trykket på noe, så lyden starter ved første
 * tastetrykk eller klikk.
 */
import type { Camera, Game } from "./game";
import { terrainAlert } from "./gpws";
import { warnings } from "./physics";
import type { Airport, Terrain } from "./terrain";
import { towerView } from "./tower";

const FT = 3.28084;
const LOOPS = ["engine", "wind", "tower_room"] as const;
const ONE_SHOTS = ["gear", "flaps", "speedbrake", "touchdown", "crash", "splash", "warning", "radio", "retard", "too_low_gear", "stall", "go_around", "terrain_ahead", "pull_up", "traffic"];
/** Ordene tårnet leser vinden med. Tallene er ett klipp per siffer. */
const ATC_WORDS = ["atc_wind", "atc_degrees", "atc_knots", "atc_gusting", ...Array.from({ length: 10 }, (_, i) => `atc_${i}`)];

/** Klippene tårnet leser vinden med: «wind two four zero degrees, one five knots», og «gusting two seven» ved kast.
 *  Retningen leses i hele ti grader med tre sifre (nord er 360), farten uten ledende null. */
export function windReadout(fromDeg: number, kt: number, gustKt: number | null = null): string[] {
  const digits = (n: string): string[] => [...n].map((c) => `atc_${c}`);
  const dir = (Math.round(fromDeg / 10) * 10) % 360 || 360;
  return ["atc_wind", ...digits(String(dir).padStart(3, "0")), "atc_degrees", ...digits(String(Math.round(kt))), "atc_knots",
    ...(gustKt !== null && gustKt > kt ? ["atc_gusting", ...digits(String(Math.round(gustKt)))] : [])];
}

/** Ordene i takseklareringen, og bokstavalfabetet taksebanene leses med. */
const ATC_TAXI = ["atc_callsign", "atc_backtrack", "atc_taxi_stand", "atc_taxi_apron", "atc_via", "atc_left", "atc_right", ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c) => `atc_letter_${c}`)];

/** Klippene tårnet leser takseklareringen med: «Teinum 320, taxi to stand one six via Bravo, Yankee».
 *  Standen leses siffer for siffer («171L» = one seven one left), taksebanene med bokstavalfabetet («A5» = Alpha five).
 *  En stand uten nummer er «the apron». Navn som ikke er en bokstav med eventuelle sifre (som «L BLUE») leses ikke. */
export function taxiReadout(standRef: string, via: string[], turnAround: boolean): string[] {
  const out = ["atc_callsign", ...(turnAround ? ["atc_backtrack"] : [])];
  if (/^[0-9]{1,3}[LR]?$/.test(standRef)) out.push("atc_taxi_stand", ...[...standRef].map((c) => (c === "L" ? "atc_left" : c === "R" ? "atc_right" : `atc_${c}`)));
  else out.push("atc_taxi_apron");
  const named = via.filter((r) => /^[A-Z][0-9]{0,2}$/.test(r));
  if (named.length) out.push("atc_via", ...named.flatMap((r) => [`atc_letter_${r[0]}`, ...[...r.slice(1)].map((c) => `atc_${c}`)]));
  return out;
}

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
  /** Hvor i hvert taleklipp lyden faktisk er (start og lengde i s), så klipp som settes sammen ikke får pauser imellom. */
  private voiced = new Map<string, [number, number]>();
  private loops = new Map<string, Loop>();
  private ready = false;
  /** Når hver talekanal er ledig igjen (AudioContext-tid), så utrop ikke snakker i munnen på hverandre. */
  private busy = { callout: 0, tower: 0 };
  private repeatAt = { stall: 0, gear: 0, warning: 0, terrain: 0 };
  private prev = { ra: Infinity, state: "", gearDown: true, flapCfg: -1, speedBrake: false, approach: -1, taxiCall: 0 };
  private pending: { at: number; run: () => void }[] = [];
  private warnedGear = -1;
  /** Flyene det er gitt trafikkvarsel for nå: «traffic, traffic» sies én gang per fly, når varselet kommer. */
  private advised = new Set<string>();
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
    // klarering satt sammen av deler, når tårnet skal lese opp vinden: tårnets navn, vinden, og banen
    const parts = [`tower_${icao}`, ...this.airport.runways.flatMap((rw) => rw.ends.map((e) => `cleared_rwy_${e.ident}`)), ...ATC_WORDS, ...ATC_TAXI];
    const names = [...LOOPS, ...ONE_SHOTS, ...CALLOUTS.map((c) => `alt_${c}`), ...towerClips, ...parts];
    await Promise.all(names.map(async (name) => {
      try {
        const data = await (await fetch(`${this.baseUrl}/${name}.mp3`)).arrayBuffer();
        const buffer = await ctx.decodeAudioData(data);
        this.buffers.set(name, buffer);
        if (parts.includes(name) && typeof buffer.getChannelData === "function") {
          // finn første og siste sted med lyd: generert tale har stillhet i begge ender
          const s = buffer.getChannelData(0), quiet = 0.02;
          let a = 0, b = s.length - 1;
          while (a < b && Math.abs(s[a]) < quiet) a++;
          while (b > a && Math.abs(s[b]) < quiet) b--;
          this.voiced.set(name, [Math.max(0, a / buffer.sampleRate - 0.02), Math.min(buffer.duration, (b - a) / buffer.sampleRate + 0.06)]);
        }
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
  private play(name: string, volume: number, radio = false, when = 0): number {
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
    const [offset, length] = this.voiced.get(name) ?? [0, buffer.duration];
    source.start(when, offset, length);
    return length;
  }

  /** Tale på en kanal. Hoppes over hvis kanalen er opptatt, med mindre den er viktig. */
  private say(channel: "callout" | "tower", name: string, volume: number, opts: { radio?: boolean; force?: boolean } = {}): void {
    const now = this.ctx!.currentTime;
    if (!opts.force && now < this.busy[channel]) return;
    const d = this.play(name, volume, opts.radio);
    if (d) this.busy[channel] = now + d + 0.15;
  }

  /** Flere taleklipp etter hverandre på tårnets kanal, som én melding. */
  private sayAll(names: string[], volume: number, radio: boolean): void {
    let at = this.ctx!.currentTime;
    for (const name of names) at += this.play(name, volume, radio, at) + 0.03;
    this.busy.tower = at + 0.15;
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
    const power = P.state === "landed" ? Math.max(0.05, P.thr) : P.thr; // tomgang under utrullingen, gass under taksing
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
        // I vind leser tårnet den opp: «Teinum 320, Kjevik tower. Wind 240 degrees 15 knots. Runway 03, cleared to land.»
        // Vindstille, eller mangler noen av delene: den ferdige klareringen, som slutter med «wind calm».
        const parts = [`tower_${this.airport.icao}`, ...windReadout(game.wind.fromTrueDeg, game.wind.kt, game.wind.gustKt), `cleared_rwy_${ident}`];
        if (game.wind.kt >= 3 && parts.every((p) => this.buffers.has(p))) this.sayAll(parts, 0.9, game.cam !== "tower");
        else this.say("tower", `cleared_${this.airport.icao}_${ident}`, 0.9, { radio: game.cam !== "tower", force: true });
      });
    } else if (P.state === "fly") {
      if (P.gearDown !== prev.gearDown && !tower) this.play("gear", 0.5);
      if (P.flapCfg !== prev.flapCfg && prev.flapCfg >= 0 && !tower) this.play("flaps", 0.4);
      if (P.speedBrake !== prev.speedBrake && !tower) this.play("speedbrake", 0.2); // klippet er 7 dB sterkere enn klaffelyden
    }

    // Takseklareringen: leses når spillet har gitt den (game.taxiCall teller dem), satt sammen av enkeltklipp
    if (game.taxiCall.count !== prev.taxiCall) {
      prev.taxiCall = game.taxiCall.count;
      const plan = game.taxiPlan, parts = plan ? taxiReadout(plan.stand.ref, plan.via, game.taxiCall.turnAround) : [];
      if (parts.length && parts.every((p) => this.buffers.has(p))) {
        if (!tower) this.play("radio", 0.25);
        this.sayAll(parts, 0.9, !tower);
      }
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
        const terrain = game.sys.gpwsTerr ? terrainAlert(P, t, this.airport, game.wind.vector) : null; // TERR av på overheadpanelet
        const call = altitudeCallout(prev.ra, ra);
        if (call !== null) this.say("callout", `alt_${call}`, 0.9, { force: call <= 50 });
        if (prev.ra > 15 && ra <= 15 && P.thr > 0.05) this.later(0.5, () => this.say("callout", "retard", 0.9, { force: true }));
        if (w.stall && now > this.repeatAt.stall) { this.say("callout", "stall", 1, { force: true }); this.repeatAt.stall = now + 1.9; }
        // terrengvarsel: «pull up» når det haster, ellers «terrain ahead». Steiling går foran, understell kommer etter.
        else if (terrain?.level === "warning" && now > this.repeatAt.terrain) { this.say("callout", "pull_up", 1, { force: true }); this.repeatAt.terrain = now + 2.8; }
        else if (terrain && now > this.repeatAt.terrain) { this.say("callout", "terrain_ahead", 0.95); this.repeatAt.terrain = now + 4.5; }
        else if (w.gearNotDown && ra < 500 && now > this.repeatAt.gear) { this.say("callout", "too_low_gear", 1); this.repeatAt.gear = now + 3; }
        if (w.overspeed && now > this.repeatAt.warning) { this.play("warning", 0.3); this.repeatAt.warning = now + 2.4; }
      }
      // trafikkvarsel: ett utrop når et nytt fly blir gult på ND. Under 500 fot tier det, som i flyet.
      const advisories = new Set(game.sys.tcasStandby ? [] : game.traffic.filter((a) => a.tcas === "advisory").map((a) => a.id)); // TCAS i beredskap varsler ikke
      if (inside && ra > 500 && [...advisories].some((id) => !this.advised.has(id))) this.say("callout", "traffic", 0.95);
      this.advised = advisories;
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
