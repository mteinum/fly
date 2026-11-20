import { GameAudio } from "./audio";
import { createDiplomaUi } from "./diploma";
import { createGame, isTyping, runLoop } from "./game";
import { GlRenderer } from "./glRenderer";
import { drawHud, drawMessage } from "./hud";
import { drawPanel } from "./panel";
import { H, setScreen, TOP, W } from "./screen";
import { loadTerrain } from "./terrain";
import { towerView } from "./tower";
import { drawTower } from "./towerPanel";

const DEFAULT_ICAO = "ENCN";

interface AreaInfo { id: string; name: string; icao: string; cellSize: number }

/** Flyplassene pipeline har bygget 10 m-fliser for (data/index.json). */
async function listAirports(dataUrl: string): Promise<AreaInfo[]> {
  try {
    const index: { areas: AreaInfo[] } = await (await fetch(`${dataUrl}/index.json`)).json();
    return index.areas.filter((a) => a.cellSize === 10);
  } catch {
    return [{ id: "kjevik10", name: "Kristiansand Airport, Kjevik", icao: DEFAULT_ICAO, cellSize: 10 }];
  }
}

let area = "kjevik10";

async function main(): Promise<void> {
  const dataUrl = `${import.meta.env.BASE_URL}data`, params = new URLSearchParams(location.search);
  const airports = await listAirports(dataUrl);
  // ?apt=ENZV velger flyplass (ICAO-kode). Ukjent kode gir standardflyplassen.
  const wanted = (params.get("apt") ?? DEFAULT_ICAO).toUpperCase();
  const chosen = airports.find((a) => a.icao === wanted) ?? airports.find((a) => a.icao === DEFAULT_ICAO) ?? airports[0];
  area = chosen.id;
  const picker = document.getElementById("airports")!;
  for (const a of airports) {
    const link = document.createElement("a");
    link.textContent = `${a.icao} ${a.name.split(",").pop()!.trim()}`;
    link.href = `?apt=${a.icao}`;
    if (a === chosen) link.className = "current";
    picker.append(link);
  }
  document.title = `Fly an Airbus A320 to ${chosen.name.split(",").pop()!.trim()} – teinum-fly`;
  document.getElementById("where")!.textContent = chosen.name;
  const assets = await loadTerrain(`${dataUrl}/${area}`);
  const { terrain } = assets;
  // Skjermtekst og instrumentpanel tegnes på et eget lerret oppå 3D-bildet
  const overlay = document.getElementById("screen") as HTMLCanvasElement;
  const g = overlay.getContext("2d")!;
  let scale = 1; // lerretspiksler per logisk enhet
  const fit = () => {
    const dpr = Math.min(devicePixelRatio, 2), unit = setScreen(overlay.clientWidth, overlay.clientHeight);
    overlay.width = Math.round(overlay.clientWidth * dpr);
    overlay.height = Math.round(overlay.clientHeight * dpr);
    scale = unit * dpr;
  };
  new ResizeObserver(fit).observe(overlay);
  fit();

  const map = document.createElement("canvas");
  map.width = map.height = 512;
  map.getContext("2d")!.drawImage(assets.colormap, 0, 0, 512, 512);

  const renderer = new GlRenderer(document.getElementById("gl") as HTMLCanvasElement, terrain, assets);
  const game = createGame(terrain, overlay);
  document.getElementById("fullscreen")!.onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };
  document.getElementById("info")!.textContent =
    `Map ${((terrain.width * terrain.cell) / 1000).toFixed(1)} km · cell ${terrain.cell} m · ${renderer.buildingCount} building cells · ${terrain.bridges.length} bridges · ${terrain.meta.crs}`;
  document.getElementById("credits")!.textContent = [...terrain.meta.attribution, "Audio: generated with ElevenLabs"].join(" · ");

  // ?clean: bare 3D-bildet, uten skjermtekst, hjelp og kreditering. Til skjermbilder (f.eks. delingsbildet).
  const clean = new URLSearchParams(location.search).has("clean");
  document.body.classList.toggle("clean", clean);
  const audio = new GameAudio(`${import.meta.env.BASE_URL}audio`, game.airport);
  addEventListener("keydown", (e) => {
    if (e.code === "KeyM" && !e.repeat && !isTyping(e)) { game.msg.text = audio.toggleMute() ? "Sound off" : "Sound on"; game.msg.t = 1.5; }
  });

  // ?selftest (kun i utviklingsmodus): start lyden uten tastetrykk og skriv tilstanden til <body data-audio>.
  // Brukes til å kontrollere lydmotoren i hodeløs nettleser, der ingen kan trykke eller høre.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("selftest")) {
    void audio.startNow();
    setInterval(() => { document.body.dataset.audio = JSON.stringify(audio.status); }, 500);
  }

  // Diplom etter landing: bildet tas i landingsøyeblikket, diplomet vises når flyet står stille
  const diploma = createDiplomaUi("https://fly.teinum.no/"), glCanvas = document.getElementById("gl") as HTMLCanvasElement;
  let landingPhoto: HTMLCanvasElement | null = null, wasLanded = false;
  // R og T starter ny innflyging og lukker diplomet - men ikke når de er bokstaver i navnet som skrives
  addEventListener("keydown", (e) => { if (!isTyping(e) && (e.code === "KeyR" || e.code === "KeyT")) diploma.hide(); });

  runLoop((dt) => {
    game.step(dt);
    audio.update(game, terrain);
    renderer.render(game.P, game.cam, game.env);
    const landed = game.P.state === "landed";
    if (landed && !wasLanded) {
      // WebGL-bildet må kopieres i samme ramme som det ble tegnet, ellers er det tomt
      landingPhoto = document.createElement("canvas");
      landingPhoto.width = glCanvas.width;
      landingPhoto.height = glCanvas.height;
      landingPhoto.getContext("2d")!.drawImage(glCanvas, 0, 0);
    }
    if (landed && game.P.spd === 0 && game.P.touchdown && !diploma.open && !clean && landingPhoto) {
      diploma.show({ airportName: chosen.name, icao: chosen.icao, touchdown: game.P.touchdown }, landingPhoto, () => { diploma.hide(); game.restart(); });
      landingPhoto = null;
    }
    wasLanded = landed;
    g.setTransform(scale, 0, 0, scale, 0, -TOP * scale); // logisk TOP ligger i overkanten av vinduet
    g.clearRect(0, TOP, W, H - TOP);
    if (clean) return;
    if (game.cam === "tower") {
      drawTower(g, terrain, map, game, towerView(terrain, game.P));
      drawMessage(g, game, TOP + 20);
    } else if (game.cam === "cockpit") {
      drawPanel(g, terrain, game);
      drawMessage(g, game, TOP + 20);
    } else {
      drawHud(g, terrain, map, game);
    }
  });
}

main().catch((err) => {
  document.getElementById("fullscreen")!.onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };
  document.getElementById("info")!.textContent = `Error: ${err.message}. Have you run the pipeline (uv run flypipe build ${area})?`;
  throw err;
});
