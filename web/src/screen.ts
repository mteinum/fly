/* Skjermtekst, instrumentpanel og tårninteriør tegnes i logiske enheter som skaleres til vinduet.
 *
 * Grunnflaten er 320 x 200. Vinduet fylles helt:
 *  - bredere enn 16:10: høyden er 200 enheter og W vokser. Faste oppsett sentreres med OX.
 *  - smalere enn 16:10: bredden er 320 enheter og flaten forlenges oppover. TOP blir negativ,
 *    og alt som er tegnet for 0-200 står nederst, der panelene hører hjemme.
 * W, TOP, OX og ASPECT er levende bindinger som oppdateres av setScreen().
 */
export const H = 200;
export const BASE_W = 320;
/** Øvre kant av instrumentpanelet i cockpit, og av benken i tårnet (logisk y). */
export const PANEL_TOP = 106;
export const TOWER_SILL = 136;

export let W = BASE_W;
/** Logisk y for vinduets overkant (0 eller negativ). */
export let TOP = 0;
/** Forskyvning som sentrerer et 320 bredt oppsett. */
export let OX = 0;
/** Vinduets bredde / høyde. */
export let ASPECT = BASE_W / H;

/** Tilpass til et vindu på cssW x cssH. Returnerer CSS-piksler per logisk enhet. */
export function setScreen(cssW: number, cssH: number): number {
  ASPECT = cssW / cssH;
  if (ASPECT >= BASE_W / H) {
    W = H * ASPECT;
    TOP = 0;
  } else {
    W = BASE_W;
    TOP = H - BASE_W / ASPECT;
  }
  OX = (W - BASE_W) / 2;
  return cssW / W;
}

/** Hvor mye 3D-bildet må flyttes opp (andel av høyden) for at horisonten skal ligge midt i ruta over `edge`. */
export const horizonShift = (edge: number): number => 0.5 - (edge - TOP) / (H - TOP) / 2;
