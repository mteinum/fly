/* Reprise etter krasj: de siste sekundene før sammenstøtet, sett fra et fast punkt utenfor flyet. */
import type { Plane } from "./plane";
import type { Terrain } from "./terrain";

/** Hvor mye som tas opp og spilles av (s), og hvor lenge siste bilde blir stående. */
export const REPLAY_SECONDS = 5;
export const REPLAY_HOLD = 1.2;

/** Det rendereren trenger for å tegne flyet. */
type Frame = Pick<Plane, "x" | "y" | "alt" | "hdg" | "pitch" | "roll" | "gear" | "flaps" | "thr" | "spd"> & { t: number };
const KEYS = ["x", "y", "alt", "hdg", "pitch", "roll", "gear", "flaps", "thr", "spd"] as const;

export class Recorder {
  private frames: Frame[] = [];
  private clock = 0;

  /** Ta opp flyets tilstand. Kalles hvert steg mens flyet flyr; eldre enn REPLAY_SECONDS kastes. */
  record(P: Plane, dt: number): void {
    this.clock += dt;
    const f = { t: this.clock } as Frame;
    for (const k of KEYS) f[k] = P[k];
    this.frames.push(f);
    while (this.frames.length > 2 && this.frames[1].t < this.clock - REPLAY_SECONDS) this.frames.shift();
  }

  clear(): void {
    this.frames = [];
    this.clock = 0;
  }

  /** Hvor lenge opptaket varer (s). Kortere enn REPLAY_SECONDS hvis flyet krasjet tidlig. */
  get duration(): number {
    return this.frames.length ? this.clock - this.frames[0].t : 0;
  }

  /** Flyets tilstand `seconds` inn i opptaket, interpolert mellom to opptak. Etter slutten: siste opptak. */
  sample(seconds: number, into: Plane): void {
    const fr = this.frames;
    if (!fr.length) return;
    const t = fr[0].t + Math.min(Math.max(seconds, 0), this.duration);
    let i = 1;
    while (i < fr.length - 1 && fr[i].t < t) i++;
    const a = fr[Math.max(i - 1, 0)], b = fr[Math.min(i, fr.length - 1)];
    const u = b.t > a.t ? Math.min(Math.max((t - a.t) / (b.t - a.t), 0), 1) : 1;
    for (const k of KEYS) into[k] = a[k] + (b[k] - a[k]) * u;
  }

  /** Fast kamerapunkt for reprisen (verden: øst, høyde, sør i meter): foran og til side for der det endte,
   *  høyt nok til å se over terreng og bygninger, så flyet kommer mot kameraet og treffer like ved. */
  spectator(t: Terrain): [number, number, number] {
    const last = this.frames[this.frames.length - 1], cell = t.cell;
    const fx = Math.sin(last.hdg), fy = -Math.cos(last.hdg); // framover i rutenettet
    // til høyre for flyets kurs; prøv venstre hvis høyre side ligger mye høyere (fjellside)
    let best: [number, number, number] | null = null;
    for (const side of [1, -1]) {
      const x = last.x + (fx * 70 + -fy * side * 95) / cell, y = last.y + (fy * 70 + fx * side * 95) / cell;
      const ci = t.cellIndex(x, y), ground = Math.max(0, t.heightAt(x, y), ci >= 0 && t.sKind[ci] ? t.sTop[ci] : 0);
      const pos: [number, number, number] = [x * cell, Math.max(ground + 14, last.alt + 10), y * cell];
      if (!best || pos[1] < best[1]) best = pos;
    }
    return best!;
  }
}
