/* Spillklokka er UTC i millisekunder. Vises og stilles i norsk tid (Europe/Oslo). */

const OSLO = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

export interface LocalTime { year: number; month: number; day: number; hour: number; minute: number }

export function osloTime(utcMs: number): LocalTime {
  const p: Record<string, number> = {};
  for (const part of OSLO.formatToParts(utcMs)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute };
}

/** Norsk klokkeslett -> UTC. Finner UTC-forskyvningen (sommer-/vintertid) ved å prøve seg fram. */
export function osloToUtc(t: LocalTime): number {
  const wanted = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute);
  let utc = wanted;
  for (let i = 0; i < 2; i++) {
    const o = osloTime(utc);
    utc -= Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute) - wanted;
  }
  return utc;
}

export function formatOslo(utcMs: number): string {
  const t = osloTime(utcMs);
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

export const DEFAULT_HOUR = 13;

/** Starttid: ?time=HH:MM og ?date=YYYY-MM-DD (norsk tid). Uten parametre: i dag kl. 13:00. */
export function startTime(params: URLSearchParams, nowMs: number): number {
  const t = osloTime(nowMs);
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.get("date") ?? "");
  const time = /^(\d{1,2}):(\d{2})$/.exec(params.get("time") ?? "");
  [t.hour, t.minute] = [DEFAULT_HOUR, 0];
  if (date) [t.year, t.month, t.day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  if (time) [t.hour, t.minute] = [Number(time[1]), Number(time[2])];
  return osloToUtc(t);
}

/** Datoen i norsk tid som YYYY-MM-DD (formatet til ?date og til datovelgeren). */
export function isoDate(utcMs: number): string {
  const t = osloTime(utcMs);
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

/** Samme klokkeslett (norsk tid) på en annen dato, YYYY-MM-DD. Null hvis datoen ikke finnes (30. februar, tull). */
export function withDate(utcMs: number, iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])], check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const t = osloTime(utcMs);
  return osloToUtc({ year, month, day, hour: t.hour, minute: t.minute });
}
