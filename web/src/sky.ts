/* Himmel og lys som funksjon av solhøyden. Fargene er valgt for utseende, ikke målt. */

export type RGB = [number, number, number];

export interface SkyState {
  zenith: RGB;
  horizon: RGB;
  sunColor: RGB;
  /** Styrke på retningslyset fra sola (0 når sola er nede). */
  sunLight: number;
  /** Styrke på det retningsløse himmellyset. */
  ambient: number;
  /** 0 = dag, 1 = mørkt. Styrer gatelys, stjerner og instrumentlys. */
  night: number;
}

// Nøkkelverdier per solhøyde (grader), sortert fra natt til dag.
// -18/-12/-6 er grensene for astronomisk, nautisk og borgerlig tussmørke.
const KEYS: [elevation: number, zenith: RGB, horizon: RGB, sunColor: RGB, sunLight: number, ambient: number][] = [
  [-18, [3, 5, 12], [8, 10, 22], [255, 140, 70], 0, 0.1],
  [-12, [6, 10, 26], [16, 22, 46], [255, 140, 70], 0, 0.13],
  [-6, [18, 30, 70], [70, 70, 100], [255, 140, 70], 0, 0.28],
  [-1, [44, 70, 130], [226, 130, 86], [255, 150, 80], 0.15, 0.55],
  [3, [60, 100, 170], [240, 180, 130], [255, 190, 130], 1.3, 0.8],
  [12, [72, 128, 200], [176, 206, 230], [255, 238, 214], 2.6, 1.05],
  [40, [64, 124, 204], [180, 208, 232], [255, 248, 236], 3.0, 1.15],
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function skyState(sunElevationDeg: number): SkyState {
  const e = Math.min(Math.max(sunElevationDeg, KEYS[0][0]), KEYS[KEYS.length - 1][0]);
  let i = 1;
  while (i < KEYS.length - 1 && e > KEYS[i][0]) i++;
  const a = KEYS[i - 1], b = KEYS[i], t = (e - a[0]) / (b[0] - a[0]);
  // lysene tennes når sola er 2° over horisonten og er fullt på ved -6°
  const n = Math.min(1, Math.max(0, (2 - sunElevationDeg) / 8));
  return {
    zenith: mix(a[1], b[1], t),
    horizon: mix(a[2], b[2], t),
    sunColor: mix(a[3], b[3], t),
    sunLight: lerp(a[4], b[4], t),
    ambient: lerp(a[5], b[5], t),
    night: n * n * (3 - 2 * n),
  };
}
