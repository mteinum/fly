/* Skarp bakke uten bilde: prosedyrale detaljer per overflateklasse, lagt inn i terrengmaterialets shader.
 *
 * Fargekartet er 10 m per piksel og blir utsmurt på nært hold. Her gjøres tre ting,
 * alle tonet inn etter hvor mange meter én skjermpiksel dekker (så det ikke flimrer på avstand):
 *   1. Klassegrensene får en uregelmessig kant: klassen slås opp i et støyforskjøvet punkt.
 *      Vei, rullebane og oppstillingsplass får i stedet en jevn, rett kant fra en lineært
 *      filtrert maske, så en vei på skrå blir et sammenhengende bånd og ikke en trapp.
 *   2. Nær bakken brukes klassens flatefarge direkte i stedet for det utsmurte fargekartet.
 *   3. Fargen ganges med et mønster for klassen: trekroner, plogfurer, kvartaler, bølger, korn.
 *
 * Alt dette er SYNTETISK. Det viser hva slags overflate N50 sier det er, ikke hvordan den ser ut:
 * trærne står ikke der trærne står, og furene går ikke den veien bonden pløyde.
 */
import * as THREE from "three";
import type { Terrain } from "./terrain";

const MAX_CLASSES = 24;

const VERTEX_DECL = "varying vec3 vGroundPos;\n";
const VERTEX_BODY = "\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n";

const FRAGMENT_DECL = /* glsl */ `
varying vec3 vGroundPos;
uniform sampler2D surfaceMap;
uniform sampler2D hardMap;    // 1 der det er vei, rullebane eller oppstillingsplass; lineært filtrert
uniform vec2 groundSize;   // utsnittets bredde og høyde i meter
uniform vec3 surfaceColor[${MAX_CLASSES}];
uniform float groundTime;

float gHash(vec2 q) {
  uvec2 u = uvec2(ivec2(floor(q)) + 100000);
  uint h = u.x * 374761393u + u.y * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967295.0;
}
float gNoise(vec2 q) {
  vec2 i = floor(q), f = fract(q), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// avstand til nærmeste tilfeldige punkt: gir runde «kroner» med mørke mellomrom
float gCells(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  float d = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(gHash(i + g), gHash(i + g + vec2(17.0, 59.0)));
    d = min(d, length(g + o - f));
  }
  return d;
}
// mønster med bølgelengde L (m) tones ut når en piksel dekker mer enn ca. en tredel av L
float gFade(float L, float px) { return 1.0 - smoothstep(0.18 * L, 0.45 * L, px); }
int gClass(vec2 p) { return int(texture2D(surfaceMap, p / groundSize).r * 255.0 + 0.5); }
// vei, rullebane og oppstillingsplass skal ha rette kanter
bool gHard(int c) { return c == 15 || c == 16 || c == 17; }

float gDetail(int c, vec2 p, float px) {
  float big = gNoise(p / 45.0) - 0.5;
  float mid = (gNoise(p / 7.0) - 0.5) * gFade(7.0, px);
  float fine = (gNoise(p / 1.3) - 0.5) * gFade(1.3, px);
  if (c >= 1 && c <= 3) {  // vann: to lag bølger som driver hver sin vei
    float a = gNoise(p / 9.0 + vec2(groundTime * 0.35, groundTime * 0.2)) - 0.5;
    float b = gNoise(p / 2.2 - vec2(groundTime * 0.6, 0.0)) - 0.5;
    return 1.0 + 0.12 * a * gFade(9.0, px) + 0.08 * b * gFade(2.2, px);
  }
  if (c == 4) {  // skog: trekroner
    float crowns = 0.60 + 0.80 * (1.0 - gCells(p / 6.5));
    return mix(1.0, crowns, gFade(6.5, px)) * (1.0 + 0.18 * big) * (1.0 + 0.28 * fine);
  }
  if (c == 7) {  // dyrket mark: furer, med ny retning for hver 140 m-rute
    float ang = gHash(floor(p / 140.0)) * 3.14159;
    float rows = sin(dot(p, vec2(cos(ang), sin(ang))) * 6.28318 / 3.2);
    return 1.0 + 0.08 * rows * gFade(3.2, px) + 0.24 * big + 0.12 * mid;
  }
  if (c >= 8 && c <= 10) {  // bebyggelse og industri: ujevne flekker i tomtestørrelse
    float lot = gNoise(p / 9.0 + 13.0) - 0.5;
    return 1.0 + 0.34 * lot * gFade(9.0, px) + 0.18 * fine + 0.10 * mid;
  }
  if (gHard(c) || c == 13) return 1.0 + 0.10 * fine + 0.06 * mid;          // asfalt og stein: fint korn
  if (c == 11 || c == 12) return 1.0 + 0.12 * fine + 0.10 * mid + 0.08 * big; // gress
  return 1.0 + 0.30 * mid + 0.22 * fine + 0.14 * big;                        // åpent område, myr, ukjent
}
`;

const FRAGMENT_BODY = /* glsl */ `
{
  vec2 gp = vGroundPos.xz;
  float gpx = max(length(dFdx(gp)), length(dFdy(gp)));  // meter per skjermpiksel
  float gDet = 1.0 - smoothstep(3.0, 10.0, gpx);
  if (gDet > 0.0) {
    vec2 warp = (vec2(gNoise(gp * 0.13), gNoise(gp * 0.13 + 57.3)) - 0.5) * 9.0
              + (vec2(gNoise(gp * 0.5 + 9.1), gNoise(gp * 0.5 + 77.7)) - 0.5) * 2.5;
    int c0 = gClass(gp), c1 = gClass(gp + warp);
    // naturlig underlag: den forskjøvne klassen, eller den uforskjøvne hvis forskyvningen traff asfalt
    int cn = gHard(c1) ? c0 : c1;
    vec3 natural = gHard(cn) ? diffuseColor.rgb : surfaceColor[cn];
    float naturalDetail = gDetail(cn, gp, gpx);
    // asfalt: dekning 0-1 fra den filtrerte masken, med skarp terskel
    float paved = smoothstep(0.36, 0.46, texture2D(hardMap, gp / groundSize).r);
    int ch = gHard(c0) ? c0 : (gHard(c1) ? c1 : 16);
    vec3 near = mix(natural, surfaceColor[ch], paved);
    diffuseColor.rgb = mix(diffuseColor.rgb, near, (1.0 - smoothstep(1.5, 5.0, gpx)) * 0.85);
    diffuseColor.rgb *= mix(1.0, mix(naturalDetail, gDetail(ch, gp, gpx), paved), gDet);
  }
}
`;

export interface GroundDetail {
  /** Kalles hver ramme med tid i sekunder (bølgene på vannet). */
  setTime(seconds: number): void;
}

/** Legg detaljshaderen inn i terrengmaterialet. `surface` er surface.bin: én klassekode per celle. */
export function addGroundDetail(material: THREE.MeshStandardMaterial, t: Terrain, surface: Uint8Array): GroundDetail {
  const map = new THREE.DataTexture(surface, t.width, t.height, THREE.RedFormat, THREE.UnsignedByteType);
  map.magFilter = map.minFilter = THREE.NearestFilter; // klassekoder kan ikke blandes
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.needsUpdate = true;

  const hardData = new Uint8Array(surface.length);
  for (let i = 0; i < surface.length; i++) if (surface[i] === 15 || surface[i] === 16 || surface[i] === 17) hardData[i] = 255;
  const hard = new THREE.DataTexture(hardData, t.width, t.height, THREE.RedFormat, THREE.UnsignedByteType);
  hard.magFilter = hard.minFilter = THREE.LinearFilter;
  hard.needsUpdate = true;

  const colors = Array.from({ length: MAX_CLASSES }, () => new THREE.Color(0x808080));
  for (const c of t.meta.surface.classes) {
    if (c.code < MAX_CLASSES) colors[c.code].setRGB(c.color[0] / 255, c.color[1] / 255, c.color[2] / 255, THREE.SRGBColorSpace);
  }
  const uniforms = {
    surfaceMap: { value: map },
    hardMap: { value: hard },
    groundSize: { value: new THREE.Vector2(t.width * t.cell, t.height * t.cell) },
    surfaceColor: { value: colors },
    groundTime: { value: 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_DECL + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>" + VERTEX_BODY);
    shader.fragmentShader = FRAGMENT_DECL + shader.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>" + FRAGMENT_BODY);
  };
  material.needsUpdate = true;
  return { setTime: (s) => { uniforms.groundTime.value = s % 3600; } };
}
