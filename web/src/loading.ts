// Lasteskjermen: ligger i index.html og vises før skriptet er hentet. Her fylles den med flyplassens navn,
// oversiktskart og framdrift, og tas bort når første bilde er tegnet.

const el = (id: string): HTMLElement | null => document.getElementById(id);

/** Navnet på flyplassen og oversiktskartet (thumb.jpg, finnes for 10 m-utsnittene). */
export function loadingAirport(name: string, thumbUrl: string): void {
  const text = el("loaderText"), map = el("loaderMap") as HTMLImageElement | null;
  if (text) text.textContent = `Loading ${name}`;
  if (!map) return;
  map.onload = () => { map.hidden = false; };
  map.src = thumbUrl; // mangler bildet, blir det bare ikke vist
}

/** Framdrift 0-1. Den følger høydekartet, som er tre firedeler av det som lastes ned. */
export function loadingProgress(fraction: number): void {
  const bar = el("loaderBar"), pct = el("loaderPct"), text = el("loaderText");
  const p = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  if (bar) { bar.style.width = `${p}%`; bar.parentElement!.setAttribute("aria-valuenow", String(p)); }
  if (pct) pct.textContent = `${p} %`;
  // Etter nedlastingen bygger nettleseren terrenget, og det tar også litt tid
  if (p === 100 && text) text.textContent = "Preparing the terrain";
}

/** Første bilde er tegnet: ton ut og fjern. */
export function loadingDone(): void {
  const loader = el("loader");
  if (!loader) return;
  loader.classList.add("done");
  setTimeout(() => loader.remove(), 400);
}

/** Lastingen feilet. Gir false hvis lasteskjermen alt er borte (feilen kom senere, i spillet). */
export function loadingFailed(): boolean {
  const loader = el("loader");
  if (!loader || loader.classList.contains("done")) return false;
  loader.classList.add("failed");
  el("loaderText")!.textContent = "Could not load the airport. Check your connection and try again.";
  const retry = el("loaderRetry") as HTMLButtonElement;
  retry.hidden = false;
  retry.onclick = () => location.reload();
  return true;
}
