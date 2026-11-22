/* Bilde til deling: det spilleren ser akkurat nå, med en stripe nederst som sier hvor flyet er.
 * Teksten bygges her (ren funksjon, testet); selve bildet settes sammen i composeSnapshot. */
import { osloTime } from "./clock";
import type { Plane } from "./plane";
import type { Terrain } from "./terrain";

const FT = 3.28084, KT = 1.943844;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Kreditering som må følge kartdataene når bildet deles (CC BY 4.0 og ODbL). */
export const SNAPSHOT_CREDIT = "Map data © Kartverket · © OpenStreetMap contributors";

export interface SnapshotInfo {
  headline: string;
  /** To halvdeler: flyet, og stedet og tiden. Står på én linje i liggende bilder og to i stående. */
  detail: [string, string];
  /** Til filnavnet: fly-teinum-<icao>-<dato>-<klokke>. */
  fileName: string;
}

/** Stedet bildet er tatt over: det største navnet på bebyggelse innen 2,5 km, ellers det nærmeste innen 8 km. */
export function nearestPlace(t: Terrain, x: number, y: number): string | null {
  let best: string | null = null, bestScore = -Infinity;
  for (const n of t.names) {
    if (n.group !== "bebyggelse" && n.type !== "by" && n.type !== "tettsted") continue;
    const d = Math.hypot((n.x - x) * t.cell, (n.y - y) * t.cell);
    if (d > 8000) continue;
    // en by innen 6 km går foran alt (over havna heter det «Oslo», ikke navnet på nærmeste holme). Ellers teller
    // størrelsen mest innen 2,5 km, og lenger unna vinner det som er nærmest
    const score = n.type === "by" && d <= 6000 ? 1000 - d / 1000 : d <= 2500 ? 100 + n.size - d / 2500 : -d / 1000;
    if (score > bestScore) { bestScore = score; best = n.name; }
  }
  return best;
}

/** `airport.name` er navnet spillet viser (fra utsnittet), ikke navnet i flyplassdataene. */
export function snapshotInfo(t: Terrain, airport: { icao: string; name: string }, P: Plane, timeMs: number): SnapshotInfo {
  const place = nearestPlace(t, P.x, P.y), name = airport.name, when = osloTime(timeMs);
  const headline = P.state === "landed" ? `${P.parked ? "Parked" : "On the ground"} at ${name}`
    : P.state === "crash" ? `Crashed${place ? ` near ${place}` : ""}`
    : place ? `Over ${place}` : `Near ${name}`;
  const clock = `${String(when.hour).padStart(2, "0")}:${String(when.minute).padStart(2, "0")}`;
  const flying = P.state === "fly" ? ` · ${Math.round((P.alt * FT) / 10) * 10} ft · ${Math.round(P.spd * KT)} kt` : "";
  return {
    headline,
    detail: [`Airbus A320${flying}`, `${airport.icao} ${name} · ${when.day} ${MONTHS[when.month - 1]} ${when.year} ${clock}`],
    fileName: `fly-teinum-${airport.icao}-${when.year}-${String(when.month).padStart(2, "0")}-${String(when.day).padStart(2, "0")}-${clock.replace(":", "")}`,
  };
}

const MAX_WIDTH = 1920;

/** Sett sammen bildet: 3D-bildet, det som er tegnet oppå (instrumenter, stedsnavn), og infostripa nederst. */
export function composeSnapshot(layers: CanvasImageSource[], width: number, height: number, info: SnapshotInfo): HTMLCanvasElement {
  const k = Math.min(1, MAX_WIDTH / width), out = document.createElement("canvas");
  out.width = Math.round(width * k); out.height = Math.round(height * k);
  const g = out.getContext("2d")!, W = out.width, H = out.height;
  for (const layer of layers) g.drawImage(layer, 0, 0, W, H);
  // Stripa: mørk toning nederst, så teksten kan leses over både hav og snø
  const band = Math.max(70, Math.round(H * (H > W ? 0.2 : 0.16))), u = Math.max(W, H * 1.4) / 100; // u: skriftenhet som tåler både liggende og stående bilder
  const shade = g.createLinearGradient(0, H - band * 1.5, 0, H);
  shade.addColorStop(0, "rgba(6,10,20,0)"); shade.addColorStop(0.45, "rgba(6,10,20,.6)"); shade.addColorStop(1, "rgba(6,10,20,.9)");
  g.fillStyle = shade; g.fillRect(0, H - band * 1.5, W, band * 1.5);
  const pad = u * 1.6, sans = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  g.textBaseline = "alphabetic";
  const portrait = H > W, line = u * 1.8;
  // nederst: kreditering. I stående bilder står den alene på en linje til venstre, i liggende under adressen til høyre
  const lines = portrait ? [...info.detail] : [info.detail.join(" · ")];
  const textBottom = portrait ? H - pad - line * 0.9 : H - pad, headY = textBottom - lines.length * line - u * 0.3;
  g.textAlign = "right"; g.font = `700 ${u * 2.5}px ${sans}`; g.fillStyle = "#f0d48a";
  g.fillText("fly.teinum.no", W - pad, portrait ? headY : H - pad - u * 1.5);
  const brandW = g.measureText("fly.teinum.no").width + pad * 2;
  g.font = `400 ${u * 0.95}px ${sans}`; g.fillStyle = "rgba(230,234,242,.75)";
  g.textAlign = portrait ? "left" : "right";
  g.fillText(SNAPSHOT_CREDIT, portrait ? pad : W - pad, H - pad);
  g.textAlign = "left"; g.fillStyle = "#ffffff"; g.font = `700 ${u * 2.5}px ${sans}`;
  g.fillText(info.headline, pad, headY, W - brandW - pad);
  g.font = `400 ${u * 1.35}px ${sans}`; g.fillStyle = "rgba(230,234,242,.92)";
  lines.forEach((text, i) => g.fillText(text, pad, textBottom - (lines.length - 1 - i) * line, (portrait ? W : W - brandW) - pad * 2));
  return out;
}

const toBlob = (canvas: HTMLCanvasElement, type: string): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("kunne ikke lage bildet"))), type, 0.9));
const asFile = async (canvas: HTMLCanvasElement, info: SnapshotInfo): Promise<File> => new File([await toBlob(canvas, "image/jpeg")], `${info.fileName}.jpg`, { type: "image/jpeg" });

/** Last ned bildet som JPEG. */
export async function downloadSnapshot(canvas: HTMLCanvasElement, info: SnapshotInfo): Promise<void> {
  const file = await asFile(canvas, info), a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Legg bildet på utklippstavla, som PNG (det eneste bildeformatet nettlesere tar imot der).
 *  `canvas` kan være et løfte om et bilde som ikke er tatt ennå: Safari krever at utklippstavla bes om i selve
 *  trykket, og bildet tas først i neste ramme. */
export async function copySnapshot(canvas: HTMLCanvasElement | Promise<HTMLCanvasElement>): Promise<void> {
  const png = Promise.resolve(canvas).then((c) => toBlob(c, "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** Har enheten et delingsark som tar bilder (telefon og nettbrett)? */
export const canShareSnapshot = (): boolean =>
  typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "x.jpg", { type: "image/jpeg" })] });

/** Åpne delingsarket. Returnerer false hvis brukeren avbrøt. */
export async function shareSnapshot(canvas: HTMLCanvasElement, info: SnapshotInfo): Promise<boolean> {
  try {
    await navigator.share({ files: [await asFile(canvas, info)], title: "fly.teinum.no", text: `${info.headline}. https://fly.teinum.no/` });
    return true;
  } catch (err) {
    if ((err as Error).name === "AbortError") return false;
    throw err;
  }
}
