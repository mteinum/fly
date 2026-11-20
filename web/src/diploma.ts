/* Diplom etter landing: karakter, et bilde som kan deles, og knappene for å dele det.
 * Diplomet er en spillpremie, ikke et sertifikat. Karakteren regnes fra det flymodellen målte
 * i landingsøyeblikket; grensene er valgt for spillets skyld, ikke hentet fra flyoperative krav. */
import type { Touchdown } from "./plane";

export interface Grade {
  stars: number; // 1-5
  title: string;
  /** Hva som trakk ned, i klartekst. */
  remarks: string[];
}

// Samme titler som i web/public/share/lib.php (delingssiden tegner sitt eget bilde)
export const TITLES = ["", "You got it down", "Hard landing", "Acceptable landing", "Nice landing", "Butter landing"];

export function gradeLanding(td: Touchdown): Grade {
  const remarks: string[] = [];
  let stars = 5;
  if (td.fpm > 500) { stars -= 2; remarks.push("hard touchdown"); }
  else if (td.fpm > 250) { stars -= 1; remarks.push("firm touchdown"); }
  if (td.crossM > 8) { stars -= 1; remarks.push("off the centreline"); }
  if (td.pastThresholdM < 0) { stars -= 1; remarks.push("short of the threshold"); }
  else if (td.pastThresholdM > 900) { stars -= 1; remarks.push("long landing"); }
  if (td.kt > 155) { stars -= 1; remarks.push("high speed"); }
  if (td.flaps < 3) { stars -= 1; remarks.push("not enough flap"); }
  stars = Math.max(1, stars);
  return { stars, title: TITLES[stars], remarks };
}

export interface DiplomaData {
  name: string;
  airportName: string; // «Stavanger Airport, Sola»
  icao: string;
  touchdown: Touchdown;
  grade: Grade;
  date: Date;
}

const W = 1200, H = 630;
const SERIF = 'Georgia, "Times New Roman", serif', SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export const shareText = (d: DiplomaData): string =>
  `I landed an Airbus A320 at ${d.airportName.split(",").pop()!.trim()}, runway ${d.touchdown.runway}: ${"★".repeat(d.grade.stars)}${"☆".repeat(5 - d.grade.stars)} ${d.grade.title}.`;

/** Lenka som deles: delingssiden på serveren tegner diplomet fra tallene, så forhåndsvisningen viser det. */
export function shareUrl(siteUrl: string, d: DiplomaData): string {
  const td = d.touchdown, iso = `${d.date.getFullYear()}-${String(d.date.getMonth() + 1).padStart(2, "0")}-${String(d.date.getDate()).padStart(2, "0")}`;
  const q = new URLSearchParams({
    n: d.name.trim(), a: d.icao, r: td.runway, s: String(d.grade.stars), k: String(Math.round(td.kt)), f: String(Math.round(td.fpm)),
    c: td.crossM.toFixed(1), t: String(Math.round(td.pastThresholdM)), d: iso,
  });
  return `${siteUrl}share/?${q}`;
}

/** Tegn diplomet (1200 x 630, samme format som delingsbilder). `photo` er 3D-bildet fra landingsøyeblikket. */
export function drawDiploma(canvas: HTMLCanvasElement, d: DiplomaData, photo: CanvasImageSource | null): void {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#0c1626"; g.fillRect(0, 0, W, H);
  if (photo) {
    const pw = (photo as HTMLCanvasElement).width, ph = (photo as HTMLCanvasElement).height;
    const s = Math.max(W / pw, H / ph); // dekk hele flaten
    g.drawImage(photo, (W - pw * s) / 2, (H - ph * s) / 2, pw * s, ph * s);
    g.fillStyle = "rgba(8,14,28,.68)"; g.fillRect(0, 0, W, H);
  }
  // dobbel gullramme
  g.strokeStyle = "#d9b25a"; g.lineWidth = 5; g.strokeRect(22, 22, W - 44, H - 44);
  g.lineWidth = 1.5; g.strokeRect(34, 34, W - 68, H - 68);

  const text = (s: string, y: number, font: string, color: string) => {
    g.font = font; g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(s, W / 2, y, W - 140);
  };
  text("D I P L O M A", 96, `600 58px ${SERIF}`, "#f0d48a");
  text("awarded to", 150, `italic 24px ${SERIF}`, "#d6dbe6");
  text(d.name.trim() || "a skilled pilot", 204, `600 54px ${SERIF}`, "#ffffff");
  text(`for landing an Airbus A320 at ${d.airportName} (${d.icao}), runway ${d.touchdown.runway}`, 266, `26px ${SERIF}`, "#e6eaf2");

  // stjerner og karakter
  g.font = `52px ${SANS}`; g.textAlign = "center"; g.textBaseline = "middle";
  const starW = 62, x0 = W / 2 - starW * 2;
  for (let i = 0; i < 5; i++) { g.fillStyle = i < d.grade.stars ? "#ffd04a" : "rgba(255,255,255,.22)"; g.fillText("★", x0 + i * starW, 338); }
  text(d.grade.title, 396, `600 34px ${SERIF}`, "#f0d48a");

  // målinger
  const td = d.touchdown, where = td.pastThresholdM >= 0 ? `${Math.round(td.pastThresholdM)} m past threshold` : `${Math.round(-td.pastThresholdM)} m before threshold`;
  const stats: [string, string][] = [
    ["Speed", `${Math.round(td.kt)} kt`],
    ["Sink rate", `${Math.round(td.fpm)} ft/min`],
    ["Off centreline", `${td.crossM.toFixed(1)} m`],
    ["Touchdown", where],
  ];
  const colW = (W - 160) / stats.length;
  stats.forEach(([label, value], i) => {
    const x = 80 + colW * (i + 0.5);
    g.font = `20px ${SANS}`; g.fillStyle = "#aeb8cc"; g.fillText(label.toUpperCase(), x, 468);
    g.font = `600 30px ${SANS}`; g.fillStyle = "#ffffff"; g.fillText(value, x, 506, colW - 16);
  });

  g.font = `22px ${SANS}`; g.textBaseline = "alphabetic";
  g.textAlign = "left"; g.fillStyle = "#d6dbe6";
  g.fillText(d.date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), 62, H - 56);
  g.textAlign = "center"; g.fillStyle = "#f0d48a"; g.font = `600 26px ${SANS}`;
  g.fillText("fly.teinum.no", W / 2, H - 56);
  g.textAlign = "right"; g.fillStyle = "#aeb8cc"; g.font = `18px ${SANS}`;
  g.fillText("Flight simulator · Map data © Kartverket", W - 62, H - 56);
}

const NAME_KEY = "teinum-fly.pilot";

export interface DiplomaUi {
  /** Vis diplomet for en landing. `again` kalles når piloten vil ha ny innflyging. */
  show(data: Omit<DiplomaData, "name" | "grade" | "date">, photo: CanvasImageSource | null, again: () => void): void;
  hide(): void;
  readonly open: boolean;
}

/** Koble diplomet til elementene i index.html. */
export function createDiplomaUi(siteUrl: string): DiplomaUi {
  const root = document.getElementById("diploma")!, canvas = document.getElementById("diplomaCanvas") as HTMLCanvasElement;
  const name = document.getElementById("pilotName") as HTMLInputElement, note = document.getElementById("diplomaNote")!;
  const shareBtn = document.getElementById("diplomaShare") as HTMLButtonElement;
  let current: DiplomaData | null = null, photo: CanvasImageSource | null = null, onAgain = () => {};
  try { name.value = localStorage.getItem(NAME_KEY) ?? ""; } catch { /* lagring kan være sperret */ }

  const redraw = () => { if (current) { current.name = name.value; drawDiploma(canvas, current, photo); } };
  const blob = () => new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("kunne ikke lage bildet"))), "image/png"));
  const url = () => shareUrl(siteUrl, current!);
  /** Delevinduer åpner seg bak et spill i fullskjerm, så gå ut av fullskjerm først. */
  const leaveFullscreen = async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); };
  const download = async () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await blob());
    a.download = `diploma-${current!.icao}-runway-${current!.touchdown.runway}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  name.addEventListener("input", () => {
    try { localStorage.setItem(NAME_KEY, name.value); } catch { /* ok */ }
    redraw();
  });
  document.getElementById("diplomaDownload")!.onclick = () => void download();
  document.getElementById("diplomaFacebook")!.onclick = async () => {
    // Facebook tar bare imot en lenke og henter forhåndsvisningen selv - derfor lenka til delingssiden
    const target = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url())}`;
    await leaveFullscreen();
    window.open(target, "_blank", "noopener");
    note.textContent = "Facebook shows the diploma from the link. The picture there has a standard background; download the image if you want the one from your own landing.";
  };
  document.getElementById("diplomaAgain")!.onclick = () => onAgain();
  shareBtn.onclick = async () => {
    const file = new File([await blob()], "diploma.png", { type: "image/png" }), text = shareText(current!);
    try {
      await leaveFullscreen();
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "Diploma from teinum-fly", text: `${text} ${url()}` });
      else if (navigator.share) await navigator.share({ title: "Diploma from teinum-fly", text, url: url() });
      else {
        await navigator.clipboard.writeText(`${text} ${url()}`);
        note.textContent = "This browser cannot share directly. The text and link are copied, so you can paste them into a message. The link shows the diploma.";
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") note.textContent = "Sharing failed. Try \"Download image\".";
    }
  };

  const ui: DiplomaUi = {
    get open() { return !root.hidden; },
    show(data, shot, again) {
      current = { ...data, name: name.value, grade: gradeLanding(data.touchdown), date: new Date() };
      photo = shot;
      onAgain = again;
      const r = current.grade.remarks;
      note.textContent = r.length ? `Marked down for: ${r.join(", ")}.` : "Nothing to fault.";
      drawDiploma(canvas, current, photo);
      root.hidden = false;
    },
    hide() { root.hidden = true; current = null; },
  };
  return ui;
}
