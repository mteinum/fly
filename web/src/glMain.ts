/* 3D-modus: WebGL-terreng i sann målestokk, 10 m-fliser. */
import { createGame, runLoop } from "./game";
import { GlRenderer } from "./glRenderer";
import { drawCockpitFrame, drawHud, setHudScale } from "./hud";
import { H, W } from "./screen";
import { loadTerrainAssets } from "./terrain";

const HUD_SCALE = 3;

export async function run(dataUrl: string, info: HTMLElement): Promise<string[]> {
  const { terrain, image } = await loadTerrainAssets(`${dataUrl}/kjevik10`, false);
  const hud = document.getElementById("screen") as HTMLCanvasElement;
  hud.width = W * HUD_SCALE;
  hud.height = H * HUD_SCALE;
  const g = hud.getContext("2d")!;
  setHudScale(HUD_SCALE);

  const minimap = document.createElement("canvas");
  minimap.width = minimap.height = 256;
  minimap.getContext("2d")!.drawImage(image, 0, 0, 256, 256);

  const renderer = new GlRenderer(document.getElementById("gl") as HTMLCanvasElement, terrain, image);
  const game = createGame(terrain, hud);
  info.textContent =
    `3D-modus · kart ${((terrain.width * terrain.cell) / 1000).toFixed(1)} km · celle ${terrain.cell} m · ${renderer.buildingCount} bygningsceller · ${terrain.bridges.length} bruer · ${terrain.meta.crs}`;

  runLoop((dt) => {
    game.step(dt);
    renderer.render(game.P, game.cam);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, hud.width, hud.height);
    if (game.cam === "cockpit") drawCockpitFrame(g, terrain, game.P);
    drawHud(g, terrain, minimap, game.airport, game.P, game.cam, game.msg, game.cam === "chase" ? "JAKT · 3D" : "COCKPIT · 3D");
  });
  return terrain.meta.attribution;
}
