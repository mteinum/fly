import { createGame, runLoop } from "./game";
import { GlRenderer } from "./glRenderer";
import { drawHud, drawMessage } from "./hud";
import { drawPanel } from "./panel";
import { H, W } from "./screen";
import { loadTerrain } from "./terrain";

const AREA = "kjevik10";

async function main(): Promise<void> {
  const assets = await loadTerrain(`${import.meta.env.BASE_URL}data/${AREA}`);
  const { terrain } = assets;
  // Skjermtekst og instrumentpanel tegnes på et eget lerret oppå 3D-bildet
  const overlay = document.getElementById("screen") as HTMLCanvasElement;
  const g = overlay.getContext("2d")!;
  const fit = () => {
    overlay.width = Math.round(overlay.clientWidth * Math.min(devicePixelRatio, 2));
    overlay.height = Math.round((overlay.width * H) / W);
  };
  new ResizeObserver(fit).observe(overlay);
  fit();

  const map = document.createElement("canvas");
  map.width = map.height = 512;
  map.getContext("2d")!.drawImage(assets.colormap, 0, 0, 512, 512);

  const renderer = new GlRenderer(document.getElementById("gl") as HTMLCanvasElement, terrain, assets);
  const game = createGame(terrain, overlay);
  document.getElementById("info")!.textContent =
    `Kart ${((terrain.width * terrain.cell) / 1000).toFixed(1)} km · celle ${terrain.cell} m · ${renderer.buildingCount} bygningsceller · ${terrain.bridges.length} bruer · ${terrain.meta.crs}`;
  document.getElementById("credits")!.textContent = terrain.meta.attribution.join(" · ");

  runLoop((dt) => {
    game.step(dt);
    renderer.render(game.P, game.cam, game.env);
    const s = overlay.width / W;
    g.setTransform(s, 0, 0, s, 0, 0);
    g.clearRect(0, 0, W, H);
    if (game.cam === "cockpit") {
      drawPanel(g, terrain, map, game);
      drawMessage(g, game, 20);
    } else {
      drawHud(g, terrain, map, game);
    }
  });
}

main().catch((err) => {
  document.getElementById("info")!.textContent = `Feil: ${err.message}. Har du kjørt pipeline (uv run flypipe build ${AREA})?`;
  throw err;
});
