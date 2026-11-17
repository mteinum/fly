import { renderChase } from "./chaseRenderer";
import { type Camera, drawCockpitFrame, drawHud, type Message } from "./hud";
import { buildLayers } from "./layers";
import { type Keys, startApproach, update } from "./physics";
import { buildPlaneSprites, newPlane } from "./plane";
import { H, W } from "./screen";
import { loadTerrain } from "./terrain";
import { VoxelRenderer } from "./voxelRenderer";

const AREA = "kjevik";

async function main(): Promise<void> {
  const scr = document.getElementById("screen") as HTMLCanvasElement;
  scr.width = W;
  scr.height = H;
  const g = scr.getContext("2d")!;
  g.imageSmoothingEnabled = false;

  const terrain = await loadTerrain(`${import.meta.env.BASE_URL}data/${AREA}`);
  const stack = buildLayers(terrain);
  const sprites = buildPlaneSprites();
  const voxel = new VoxelRenderer();
  const airport = terrain.meta.airports[0];
  const runway = airport.runways[0];

  const params = new URLSearchParams(location.search);
  let cam: Camera = params.get("cam") === "cockpit" ? "cockpit" : "chase";
  let endIdx = Math.max(0, runway.ends.findIndex((e) => e.ident === params.get("rwy")));
  const P = newPlane();
  const K: Keys = {};
  const msg: Message = { text: "", t: 0 };
  const say = (text: string, t = 3) => { msg.text = text; msg.t = t; };
  const reset = () => {
    startApproach(P, terrain, runway.ends[endIdx]);
    say(`Innflyging ${airport.icao} bane ${runway.ends[endIdx].ident}`, 3);
  };

  document.getElementById("info")!.textContent =
    `${stack.layers.length} skiver, ekvidistanse ${stack.equidistance.toFixed(1)} m · kart ${((terrain.width * terrain.cell) / 1000).toFixed(1)} km · celle ${terrain.cell} m · ${terrain.meta.crs}`;
  document.getElementById("credits")!.textContent = terrain.meta.attribution.join(" · ");

  addEventListener("keydown", (e) => {
    K[e.code] = true;
    if (e.repeat) return;
    if (e.code === "KeyC") cam = cam === "chase" ? "cockpit" : "chase";
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
  document.getElementById("tCam")!.onclick = () => { cam = cam === "chase" ? "cockpit" : "chase"; };
  scr.addEventListener("click", () => scr.focus());

  reset();
  scr.focus();
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (msg.t > 0) msg.t -= dt;
    if (update(P, terrain, airport, K, dt, say)) reset();
    if (cam === "chase") renderChase(g, terrain, stack, sprites, P);
    else { voxel.render(g, terrain, P); drawCockpitFrame(g, terrain, P); }
    drawHud(g, terrain, stack, airport, P, cam, msg);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err) => {
  document.getElementById("info")!.textContent = `Feil: ${err.message}. Har du kjørt pipeline (uv run flypipe build kjevik)?`;
  throw err;
});
