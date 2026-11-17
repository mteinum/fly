/* Pikselmodus: 320 x 200, sprite stack (jaktkamera) og Voxel Space (cockpit), 50 m-fliser. */
import { renderChase } from "./chaseRenderer";
import { createGame, runLoop } from "./game";
import { drawCockpitFrame, drawHud } from "./hud";
import { buildLayers } from "./layers";
import { buildPlaneSprites } from "./plane";
import { H, W } from "./screen";
import { loadTerrain } from "./terrain";
import { VoxelRenderer } from "./voxelRenderer";

export async function run(dataUrl: string, info: HTMLElement): Promise<string[]> {
  const scr = document.getElementById("screen") as HTMLCanvasElement;
  scr.width = W;
  scr.height = H;
  const g = scr.getContext("2d")!;
  g.imageSmoothingEnabled = false;

  const terrain = await loadTerrain(`${dataUrl}/kjevik`);
  const stack = buildLayers(terrain);
  const sprites = buildPlaneSprites();
  const voxel = new VoxelRenderer();
  const game = createGame(terrain, scr);
  info.textContent =
    `Pikselmodus · ${stack.layers.length} skiver, ekvidistanse ${stack.equidistance.toFixed(1)} m · kart ${((terrain.width * terrain.cell) / 1000).toFixed(1)} km · celle ${terrain.cell} m · ${terrain.meta.crs}`;

  runLoop((dt) => {
    game.step(dt);
    if (game.cam === "chase") renderChase(g, terrain, stack, sprites, game.P);
    else { voxel.render(g, terrain, game.P); drawCockpitFrame(g, terrain, game.P); }
    drawHud(g, terrain, stack.minimap, game.airport, game.P, game.cam, game.msg);
  });
  return terrain.meta.attribution;
}
