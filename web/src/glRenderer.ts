/* 3D-renderer (WebGL via three.js): terrengnett fra høydekartet, fargekartet som tekstur,
 * bygninger og bruer som geometri. Sann målestokk, ingen vertikal overdrivelse.
 * Lyset følger sola: terrenget skygges fra et normalkart regnet ut av høydekartet.
 *
 * Verdenskoordinater i meter, høyrehendt:
 *   X = øst   (rutenett-x * celle)
 *   Y = opp   (m over havet, NN2000)
 *   Z = sør   (rutenett-y * celle), så nord er -Z
 * Rutenettkurs hdg (0 = nord, med klokka) gir framoverretning (sin hdg, 0, -cos hdg).
 */
import * as THREE from "three";
import type { Camera, Environment } from "./game";
import { addGroundDetail, type GroundDetail } from "./groundDetail";
import { buildRunwayDecal } from "./runwayDecal";
import type { Plane } from "./plane";
import type { RGB } from "./sky";
import { CHURCH_TOWER_HALF_WIDTH } from "./physics";
import { BUILDING, type Terrain, type TerrainAssets } from "./terrain";
import { SCOPE, TOWER_FOV, towerView } from "./tower";
import { H as SCREEN_H, horizonShift, OX, PANEL_TOP, TOP, TOWER_SILL } from "./screen";

const CHUNK = 128; // celler per side i en terrengrute
const LOD_STEPS = [1, 2, 4, 8, 16]; // celler mellom hvert punkt i nettet
const LOD_DIST = [1.5, 3, 6, 12]; // avstand (i ruter) der neste, grovere steg tar over
const REBUILDS_PER_FRAME = 6;
const DECK_THICKNESS = 2.5;
const RELIEF = 1.5; // overdrivelse av helningen i normalkartet, så lavt terreng får synlig skygge
const SKY_RADIUS = 60000;

const WARM_WHITE: RGB = [255, 236, 200], GREEN: RGB = [60, 255, 120], STREET: RGB = [255, 190, 120];

interface Chunk {
  mesh: THREE.Mesh;
  cx: number;
  cy: number;
  step: number;
}

const color = (c: RGB): THREE.Color => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

/** Utslag i grader for klaffstilling 0, 1, 2, 3 og FULL, som på A320 (1 = 1+F). */
const FLAP_DEG = [0, 10, 15, 20, 35], SLAT_DEG = [0, 18, 22, 22, 27];

export class GlRenderer {
  readonly buildingCount: number;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1.6, 2, 150000);
  private chunks: Chunk[] = [];
  private indexCache = new Map<number, THREE.BufferAttribute>();
  private terrainMat: THREE.MeshStandardMaterial;
  private buildingMat = new THREE.MeshLambertMaterial({ emissive: 0xffc27a, emissiveIntensity: 0 });
  private plane: THREE.Group;
  private gear = new THREE.Group();
  /** Klaffer (bak) og slats (foran) på vingene: hver plate glir ut og vipper ned med klaffstillingen. */
  private highLift: { panel: THREE.Mesh; chord: number; slat: boolean }[] = [];
  private towerMesh = new THREE.Group();
  private scopeCamera = new THREE.PerspectiveCamera(10, SCOPE.w / SCOPE.h, 5, 150000);
  private shadow: THREE.Mesh;
  private fog = new THREE.Fog(0, 3000, 28000);
  private sun = new THREE.DirectionalLight(0xffffff, 0);
  private moon = new THREE.DirectionalLight(0x9db4ff, 0);
  private ambient = new THREE.AmbientLight(0xffffff, 1);
  private landingLight = new THREE.SpotLight(0xfff2d8, 0, 1400, 0.3, 0.7, 0);
  private skyDome: THREE.Mesh;
  private skyUniforms = { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };
  private sunDisc: THREE.Mesh;
  private stars: THREE.Points;
  private runwayLights: THREE.Points;
  private lamps: THREE.Points;
  private size = new THREE.Vector2(1, 1);
  private groundDetail: GroundDetail;

  constructor(private canvas: HTMLCanvasElement, private t: Terrain, assets: TerrainAssets) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.fog = this.fog;

    const map = new THREE.Texture(assets.colormap);
    map.flipY = false; // rad 0 i bildet er nord = minst Z
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    map.needsUpdate = true;
    this.terrainMat = new THREE.MeshStandardMaterial({
      map, roughness: 1, metalness: 0, side: THREE.DoubleSide,
      normalMap: this.normalMap(), normalMapType: THREE.ObjectSpaceNormalMap,
    });
    if (assets.lights) {
      const glow = new THREE.Texture(assets.lights);
      glow.flipY = false;
      glow.colorSpace = THREE.SRGBColorSpace;
      glow.needsUpdate = true;
      this.terrainMat.emissiveMap = glow;
      this.terrainMat.emissive = new THREE.Color(0xffffff);
      this.terrainMat.emissiveIntensity = 0;
    }

    this.groundDetail = addGroundDetail(this.terrainMat, t, assets.surface);

    for (let cy = 0; cy * CHUNK < t.height; cy++) for (let cx = 0; cx * CHUNK < t.width; cx++) {
      const step = LOD_STEPS[LOD_STEPS.length - 1];
      const mesh = new THREE.Mesh(this.chunkGeometry(cx, cy, step), this.terrainMat);
      this.scene.add(mesh);
      this.chunks.push({ mesh, cx, cy, step });
    }

    this.scene.add(this.surroundings());

    this.moon.position.set(-0.35, 0.8, 0.5);
    this.scene.add(this.sun, this.moon, this.ambient, this.landingLight, this.landingLight.target);

    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: "varying float h; void main() { h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; varying float h;
          void main() { gl_FragColor = vec4(mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.45)), 1.0);
          #include <colorspace_fragment>
          }`,
      }),
    );
    this.skyDome.renderOrder = -2;
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS * 0.012, 16, 8), new THREE.MeshBasicMaterial({ fog: false, depthWrite: false }));
    this.sunDisc.renderOrder = -1;
    this.stars = this.buildStars();
    this.scene.add(this.skyDome, this.sunDisc, this.stars);

    for (const rw of t.meta.airports[0].runways) this.scene.add(buildRunwayDecal(t, rw, map.anisotropy));
    this.buildingCount = this.addBuildings();
    this.addChurchTowers();
    this.addTunnels();
    this.addBridges();
    this.runwayLights = this.pointLights(this.runwayLightPositions(), 3.2);
    this.lamps = this.pointLights(this.bridgeLampPositions(), 2.4);
    this.plane = this.buildPlane();
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(16, 24).rotateX(-Math.PI / 2).scale(1, 1, 1.1),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.buildTower();
    this.scene.add(this.runwayLights, this.lamps, this.plane, this.shadow, this.towerMesh);

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.size.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------- terreng ---------- */

  /** Det som ligger utenfor kartutsnittet: én stor flate. Hav ved kysten; i innlandet en flate i
   *  høyde med kartets laveste punkt og med skogfarge, så kartet ikke ender i blått hav. Ikke data. */
  private surroundings(): THREE.Mesh {
    const t = this.t, W = t.width, H = t.height;
    let water = 0, n = 0;
    for (let i = 0; i < W; i += 8) for (const [x, y] of [[i, 0], [i, H - 1], [0, i], [W - 1, i]]) {
      n++;
      if (t.isWater(x + 0.5, y + 0.5)) water++;
    }
    const inland = water / n < 0.25, forest = t.meta.surface.classes.find((c) => c.code === 4)?.color ?? [46, 101, 54];
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: color(inland ? forest : t.meta.seaColor), roughness: 1, metalness: 0 }),
    );
    // Under kartets laveste punkt, ellers ville flaten stikke opp gjennom dalene inne i kartet
    plane.position.set((W * t.cell) / 2, inland ? Math.max(0, t.meta.minHeight) - 5 : -0.5, (H * t.cell) / 2);
    return plane;
  }

  /** Flatenormaler fra høydekartet (sentraldifferanser), pakket som RGB. Samme rutenett som høydekartet. */
  private normalMap(): THREE.DataTexture {
    const { hgt, width: W, height: H, cell } = this.t, data = new Uint8Array(W * H * 4);
    const z = (c: number, r: number) => Math.max(0, hgt[Math.min(Math.max(r, 0), H - 1) * W + Math.min(Math.max(c, 0), W - 1)]);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      // normal = (-dz/døst, 1, -dz/dsør), normalisert
      const nx = (-(z(c + 1, r) - z(c - 1, r)) / (2 * cell)) * RELIEF, nz = (-(z(c, r + 1) - z(c, r - 1)) / (2 * cell)) * RELIEF;
      const inv = 1 / Math.hypot(nx, 1, nz), i = (r * W + c) * 4;
      data[i] = (nx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (inv * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  /** Nett for én rute. Punktene ligger i cellesentrene, der høydeverdien gjelder. */
  private chunkGeometry(cx: number, cy: number, step: number): THREE.BufferGeometry {
    const { hgt, width: W, height: H, cell } = this.t;
    const n = CHUNK / step, side = n + 1, grid = side * side;
    const pos = new Float32Array((grid + 4 * side) * 3), uv = new Float32Array((grid + 4 * side) * 2);
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
      const col = Math.min(cx * CHUNK + i * step, W - 1), row = Math.min(cy * CHUNK + j * step, H - 1), k = j * side + i;
      pos[k * 3] = (col + 0.5) * cell;
      pos[k * 3 + 1] = Math.max(0, hgt[row * W + col]);
      pos[k * 3 + 2] = (row + 0.5) * cell;
      uv[k * 2] = (col + 0.5) / W;
      uv[k * 2 + 1] = (row + 0.5) / H;
    }
    // Skjørt: kantpunktene kopieres og senkes, så det ikke blir glipper mot naboruter med annet steg
    const drop = step * cell * 2;
    for (let e = 0; e < 4; e++) for (let i = 0; i < side; i++) {
      const src = e === 0 ? i : e === 1 ? (side - 1) * side + i : e === 2 ? i * side : i * side + side - 1;
      const k = grid + e * side + i;
      pos[k * 3] = pos[src * 3];
      pos[k * 3 + 1] = pos[src * 3 + 1] - drop;
      pos[k * 3 + 2] = pos[src * 3 + 2];
      uv[k * 2] = uv[src * 2];
      uv[k * 2 + 1] = uv[src * 2 + 1];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(this.chunkIndex(step));
    geo.computeBoundingSphere();
    return geo;
  }

  /** Trekantindekser er like for alle ruter med samme steg. */
  private chunkIndex(step: number): THREE.BufferAttribute {
    let attr = this.indexCache.get(step);
    if (attr) return attr;
    const n = CHUNK / step, side = n + 1, grid = side * side;
    const idx = new Uint16Array((n * n + 4 * n) * 6);
    let p = 0;
    const quad = (a: number, b: number, c: number, d: number) => { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * side + i;
      quad(a, a + 1, a + side, a + side + 1);
    }
    for (let e = 0; e < 4; e++) for (let i = 0; i < n; i++) {
      const a = e === 0 ? i : e === 1 ? (side - 1) * side + i : e === 2 ? i * side : i * side + side - 1;
      const b = e < 2 ? a + 1 : a + side, s = grid + e * side + i;
      quad(a, b, s, s + 1);
    }
    attr = new THREE.BufferAttribute(idx, 1);
    this.indexCache.set(step, attr);
    return attr;
  }

  private updateLod(): void {
    const size = CHUNK * this.t.cell, cam = this.camera.position;
    const wanted: { c: Chunk; step: number; d: number }[] = [];
    for (const c of this.chunks) {
      const d = Math.hypot(cam.x / size - (c.cx + 0.5), cam.z / size - (c.cy + 0.5), cam.y / size);
      let lod = 0;
      while (lod < LOD_DIST.length && d > LOD_DIST[lod]) lod++;
      if (LOD_STEPS[lod] !== c.step) wanted.push({ c, step: LOD_STEPS[lod], d });
    }
    wanted.sort((a, b) => a.d - b.d);
    for (const { c, step } of wanted.slice(0, REBUILDS_PER_FRAME)) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = this.chunkGeometry(c.cx, c.cy, step);
      c.step = step;
    }
  }

  /* ---------- strukturer ---------- */

  /** Én boks per bygningscelle, fra bakken til taket. */
  private addBuildings(): number {
    const { sKind, sBase, sTop, sCol, width: W, cell } = this.t;
    let count = 0;
    for (let i = 0; i < sKind.length; i++) if (sKind[i] === BUILDING) count++;
    if (!count) return 0;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), this.buildingMat, count);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < sKind.length; i++) {
      if (sKind[i] !== BUILDING) continue;
      const col = i % W, row = (i / W) | 0;
      m.makeScale(cell, sTop[i] - sBase[i], cell).setPosition((col + 0.5) * cell, sBase[i], (row + 0.5) * cell);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k++, c.setHex(sCol[i], THREE.SRGBColorSpace));
    }
    mesh.frustumCulled = false; // én felles avgrensning for hele kartet gir ingen gevinst
    this.scene.add(mesh);
    return count;
  }

  /** Kirketårn: hvitt tårn med mørkt spir. Plass og høyde er målt (DOM); formen er SYNTETISK:
   *  alle tårn tegnes likt, kvadratiske, med spir på den øverste tredjedelen. */
  private addChurchTowers(): void {
    const towers = this.t.churchTowers, { cell } = this.t;
    if (!towers.length) return;
    const w = CHURCH_TOWER_HALF_WIDTH * 2;
    const shaft = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), this.buildingMat, towers.length);
    // firesidet pyramide, dreid så sidene flukter med tårnet
    const spire = new THREE.InstancedMesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0), this.buildingMat, towers.length);
    const m = new THREE.Matrix4(), white = new THREE.Color(0xeeece4), roof = new THREE.Color(0x4a5a55);
    towers.forEach(([x, y, base, top], k) => {
      const eaves = base + (top - base) * 0.65;
      m.makeScale(w, eaves - base, w).setPosition(x * cell, base, y * cell);
      shaft.setMatrixAt(k, m); shaft.setColorAt(k, white);
      m.makeScale(w * 1.15, top - eaves, w * 1.15).setPosition(x * cell, eaves, y * cell);
      spire.setMatrixAt(k, m); spire.setColorAt(k, roof);
    });
    shaft.frustumCulled = spire.frustumCulled = false;
    this.scene.add(shaft, spire);
  }

  /** Veitunneler: stiplet linje oppå bakken og sjøen der tunnelen går under, slik et kart tegner dem.
   *  Hvor tunnelen går er ekte (N50). At den synes, er SYNTETISK: en tunnel ses ikke fra lufta. */
  private addTunnels(): void {
    const { cell } = this.t, pos: number[] = [], idx: number[] = [];
    const DASH = 40, GAP = 40, HALF = 7, LIFT = 1.5; // meter
    for (const line of this.t.tunnels) {
      let along = 0; // meter fra tunnelens start
      for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1], [bx, by] = line[i];
        const len = Math.hypot(bx - ax, by - ay) * cell;
        if (len < 0.01) continue;
        const ux = (bx - ax) / len, uy = (by - ay) / len; // celler per meter langs linja
        const nx = -uy * cell * HALF, nz = ux * cell * HALF; // normal i meter (XZ)
        // del lenken i korte biter (10 m), så streken følger bakken, og ta med bitene som ligger i en strek
        for (let d = 0; d < len; d += 10) {
          const d1 = Math.min(d + 10, len), mid = along + (d + d1) / 2;
          if (mid % (DASH + GAP) > DASH) continue;
          const base = pos.length / 3;
          for (const dd of [d, d1]) {
            const x = ax + ux * dd, y = ay + uy * dd, h = Math.max(0, this.t.heightAt(x, y)) + LIFT;
            pos.push(x * cell - nx, h, y * cell - nz, x * cell + nx, h, y * cell + nz);
          }
          idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        along += len;
      }
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: 0xd8d8de, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  /** Brudekker som bånd langs senterlinja, med høyde fra DOM i hvert punkt. */
  private addBridges(): void {
    const { cell } = this.t, pos: number[] = [], idx: number[] = [];
    for (const b of this.t.bridges) {
      if (b.points.length < 2) continue;
      const base = pos.length / 3, pts = b.points, half = b.width / 2;
      for (let i = 0; i < pts.length; i++) {
        const [x, y, z] = pts[i], a = pts[Math.max(i - 1, 0)], c = pts[Math.min(i + 1, pts.length - 1)];
        const dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * half, nz = (dx / len) * half; // normal til kjøreretningen, i XZ-planet
        // dekket legges aldri under terrenget (landkar og lave overganger)
        const top = Math.max(z, this.t.heightAt(x, y) + 0.4), X = x * cell, Z = y * cell;
        // fire punkter per snitt: topp venstre/høyre, bunn venstre/høyre
        pos.push(X - nx, top, Z - nz, X + nx, top, Z + nz, X - nx, top - DECK_THICKNESS, Z - nz, X + nx, top - DECK_THICKNESS, Z + nz);
        if (i > 0) {
          const p = base + (i - 1) * 4, q = p + 4;
          idx.push(p, p + 1, q, p + 1, q + 1, q); // topp
          idx.push(p + 2, q + 2, p + 3, p + 3, q + 2, q + 3); // bunn
          idx.push(p, q, p + 2, p + 2, q, q + 2); // venstre side
          idx.push(p + 1, p + 3, q + 1, p + 3, q + 3, q + 1); // høyre side
        }
      }
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xdad4c6, side: THREE.DoubleSide })));
  }

  /** Airbus A320 i ekte størrelse (lengde 37,6 m, vingespenn 34 m), bygget av enkle former. Nesa peker mot -Z. */
  private buildPlane(): THREE.Group {
    const g = new THREE.Group(), body = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f4f6 }), grey = new THREE.MeshLambertMaterial({ color: 0xb8bec6, side: THREE.DoubleSide });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c2733 }), navy = new THREE.MeshLambertMaterial({ color: 0x14365f, side: THREE.DoubleSide });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      body.add(m);
    };
    const R = 1.98; // skrogradius
    add(new THREE.CylinderGeometry(R, R, 26, 20).rotateX(Math.PI / 2), white, 0, 0, -1); // skrog, z fra -14 til 12
    add(new THREE.SphereGeometry(R, 20, 12).scale(1, 1, 2.5), white, 0, 0, -14); // nese
    add(new THREE.CylinderGeometry(R, 0.45, 9.5, 20).rotateX(-Math.PI / 2), white, 0, 0.55, 16.7); // halekon, løftet bak
    add(new THREE.BoxGeometry(2.5, 0.7, 1.6), dark, 0, 0.95, -16.4); // cockpitvinduer

    // Planform sett ovenfra: [x ut fra midten, z bakover]. Speiles for venstre side.
    const surface = (pts: [number, number][], thickness: number, mat: THREE.Material, y: number) => {
      for (const side of [1, -1]) {
        const shape = new THREE.Shape(pts.map(([px, pz]) => new THREE.Vector2(px * side, pz)));
        // formen ligger i XY; dreid 90° om X blir formens y til verdens z
        add(new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }).rotateX(Math.PI / 2), mat, 0, y, 0);
      }
    };
    surface([[1.6, -4.2], [17, 4.6], [17, 6.2], [5.6, 3.4], [1.6, 3.6]], 0.45, grey, -0.9); // vinger, 25° pilform
    surface([[0.6, 15.2], [6.2, 19.4], [6.2, 20.6], [0.6, 19.6]], 0.3, grey, 1.1); // haleplan
    // halefinne sett fra siden: [z bakover, y opp]
    const fin = new THREE.Shape([[13.4, 1.6], [18.6, 9.6], [20.8, 9.6], [19.8, 1.6]].map(([pz, py]) => new THREE.Vector2(pz, py)));
    add(new THREE.ExtrudeGeometry(fin, { depth: 0.4, bevelEnabled: false }).rotateY(-Math.PI / 2), navy, 0.2, 0, 0);
    for (const side of [1, -1]) { // motorer under vingene
      add(new THREE.CylinderGeometry(1.15, 1.0, 4.4, 16).rotateX(Math.PI / 2), white, side * 5.75, -2.3, -2.6);
      add(new THREE.CylinderGeometry(1.0, 1.0, 0.3, 16).rotateX(Math.PI / 2), dark, side * 5.75, -2.3, -4.85);
    }
    // Klaffer langs bakkanten og slats langs forkanten. Hver plate henger i en gruppe som følger vingekanten,
    // ligger skjult inne i vingen når den er inne, og glir ut og ned når klaffspaken settes (se render).
    // SYNTETISK form; utslagene per stilling følger A320 (se FLAP_DEG og SLAT_DEG).
    const plate = new THREE.MeshLambertMaterial({ color: 0x6f7884 }); // mørkere enn vingen, så platene skiller seg ut
    const hinge = (x0: number, z0: number, x1: number, z1: number, chord: number, slat: boolean) => {
      for (const side of [1, -1]) {
        // endepunktene sortert på x, så platens lokale z peker bakover på begge vinger
        const [ax, az, bx, bz] = side > 0 ? [x0, z0, x1, z1] : [-x1, z1, -x0, z0];
        const group = new THREE.Group();
        group.position.set((ax + bx) / 2, -1.13, (az + bz) / 2);
        group.rotation.y = Math.atan2(-(bz - az), bx - ax);
        // klaffens hengsel er forkanten (platen går bakover fra z = 0); slatens er bakkanten (platen går framover)
        const panel = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(bx - ax, bz - az), 0.16, chord).translate(0, 0, slat ? -chord / 2 : chord / 2), plate);
        group.add(panel);
        body.add(group);
        this.highLift.push({ panel, chord, slat });
      }
    };
    hinge(2.3, 3.55, 5.6, 3.4, 1.7, false); // indre klaff
    hinge(5.8, 3.45, 12.6, 5.12, 1.4, false); // ytre klaff
    hinge(2.6, -3.63, 16.4, 4.26, 0.75, true); // slats langs hele forkanten
    const lamp = (c: number, x: number, y: number, z: number) => add(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: c, fog: false }), x, y, z);
    lamp(0xff2020, -17.1, -1.1, 5.4); // navigasjonslys: rødt på venstre vinge (babord)
    lamp(0x20ff40, 17.1, -1.1, 5.4); // grønt på høyre (styrbord)
    lamp(0xffffff, 0, 1.2, 21.6); // hvitt i halen
    // Understell: nesehjul og to hovedhjul. Gruppa skaleres i høyden når det går inn og ut.
    const strut = new THREE.MeshLambertMaterial({ color: 0x8a9098 });
    for (const [gx, gz, wheels] of [[0, -11.5, 0.5], [-3.8, 1.2, 0.9], [3.8, 1.2, 0.9]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.5, 8), strut);
      leg.position.set(gx, -0.75, gz);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, wheels, 14).rotateZ(Math.PI / 2), dark);
      wheel.position.set(gx, -1.45, gz);
      this.gear.add(leg, wheel);
    }
    this.gear.position.y = -1.6; // festepunkt under skroget; hjulenes underkant havner 3,6 m under aksen
    body.add(this.gear);
    // Flyets posisjon (P.alt) er hjulenes høyde: skrogets akse ligger 3,6 m over
    body.position.y = 3.6;
    g.add(body);
    g.rotation.order = "YXZ";
    return g;
  }

  /** Kontrolltårnet sett utenfra: skaft og glasskabin. Formen er antatt; bare plasseringen har datagrunnlag. */
  private buildTower(): void {
    const tw = this.t.meta.airports[0].tower, cell = this.t.cell, height = tw.eyeM - tw.groundM;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, height - 3, 12), new THREE.MeshLambertMaterial({ color: 0xc9cdd2 }));
    shaft.position.y = (height - 3) / 2;
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 4.6, 5, 12), new THREE.MeshLambertMaterial({ color: 0x223040 }));
    cab.position.y = height - 0.5;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 0.6, 12), new THREE.MeshLambertMaterial({ color: 0xe6e8ea }));
    roof.position.y = height + 2.3;
    this.towerMesh.add(shaft, cab, roof);
    this.towerMesh.position.set(tw.x * cell, tw.groundM, tw.y * cell);
  }

  /* ---------- himmel og lys ---------- */

  private buildStars(): THREE.Points {
    // Tilfeldige punkter på øvre halvkule - ikke en stjernekatalog. Fast frø, så himmelen er lik hver gang.
    let seed = 20261117;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const pos: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const y = 0.04 + rnd() * 0.96, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y) * SKY_RADIUS * 0.9;
      pos.push(Math.cos(a) * r, y * SKY_RADIUS * 0.9, Math.sin(a) * r);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    stars.frustumCulled = false;
    stars.renderOrder = -1;
    return stars;
  }

  /** Lyspunkter med fast størrelse på skjermen, så de synes på lang avstand. Hvert element: [x, y, z, r, g, b]. */
  private pointLights(lights: number[][], size: number): THREE.Points {
    const pos: number[] = [], col: number[] = [], c = new THREE.Color();
    for (const [x, y, z, r, g, b] of lights) {
      pos.push(x, y, z);
      c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      col.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false }));
    points.frustumCulled = false;
    return points;
  }

  /** Kantlys, terskellys og innflygingslys. Plassert etter vanlig mønster, IKKE etter ENCNs faktiske lysanlegg. */
  private runwayLightPositions(): number[][] {
    const { cell } = this.t, out: number[][] = [];
    const put = (x: number, z: number, c: RGB) => out.push([x, Math.max(0, this.t.heightAt(x / cell, z / cell)) + 1, z, ...c]);
    for (const rw of this.t.meta.airports[0].runways) {
      const [a, b] = rw.ends, ax = a.x * cell, az = a.y * cell, bx = b.x * cell, bz = b.y * cell;
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nz = ux;
      const half = rw.widthM / 2 + 1.5;
      for (let d = 0; d <= len; d += 60) for (const s of [-1, 1]) put(ax + ux * d + nx * half * s, az + uz * d + nz * half * s, WARM_WHITE);
      for (const [ex, ez, dir] of [[ax, az, -1], [bx, bz, 1]] as const) {
        for (let o = -half; o <= half; o += half / 4) put(ex + nx * o, ez + nz * o, GREEN);
        for (let d = 30; d <= 420; d += 30) put(ex + ux * d * dir, ez + uz * d * dir, WARM_WHITE);
        for (let o = -15; o <= 15; o += 5) put(ex + ux * 300 * dir + nx * o, ez + uz * 300 * dir + nz * o, WARM_WHITE);
      }
    }
    return out;
  }

  /** Lykter langs bruene, hver 30. meter. */
  private bridgeLampPositions(): number[][] {
    const { cell } = this.t, out: number[][] = [];
    for (const b of this.t.bridges) for (let i = 0; i < b.points.length; i += 6) {
      const [x, y, z] = b.points[i];
      out.push([x * cell, Math.max(z, this.t.heightAt(x, y)) + 8, y * cell, ...STREET]);
    }
    return out;
  }

  private applyEnvironment(env: Environment): void {
    const { sky } = env, cosEl = Math.cos(env.sunElevation);
    const dir = new THREE.Vector3(Math.sin(env.sunAzimuth) * cosEl, Math.sin(env.sunElevation), -Math.cos(env.sunAzimuth) * cosEl);
    this.sun.position.copy(dir);
    this.sun.color.copy(color(sky.sunColor));
    this.sun.intensity = sky.sunLight;
    this.moon.intensity = 0.22 * sky.night;
    this.ambient.color.copy(color(sky.zenith)).lerp(new THREE.Color(0xffffff), 0.65);
    this.ambient.intensity = sky.ambient;
    this.skyUniforms.zenith.value.copy(color(sky.zenith));
    this.skyUniforms.horizon.value.copy(color(sky.horizon));
    this.fog.color.copy(color(sky.horizon));
    this.sunDisc.position.copy(this.camera.position).addScaledVector(dir, SKY_RADIUS * 0.95);
    this.sunDisc.visible = env.sunElevation > -0.02;
    (this.sunDisc.material as THREE.MeshBasicMaterial).color.copy(color(sky.sunColor));
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, sky.night * 2.5 - 1.5); // først når det er skikkelig mørkt
    this.terrainMat.emissiveIntensity = sky.night * 4;
    // svak glød: med alle hus fra matrikkelen ville sterkere glød blitt et lysteppe som skjuler lyspunktene på bakken
    this.buildingMat.emissiveIntensity = sky.night * 0.09;
    (this.runwayLights.material as THREE.PointsMaterial).opacity = 0.45 + 0.55 * sky.night;
    this.lamps.visible = sky.night > 0.05;
    (this.lamps.material as THREE.PointsMaterial).opacity = sky.night;
    this.landingLight.intensity = sky.night * 2.5;
    this.skyDome.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
  }

  /* ---------- bilde ---------- */

  private projected = new THREE.Vector3();

  /** Hvor et punkt i verden (m) havner i bildet fra forrige render(), som andel av bredde og høyde
   *  (0-1, y nedover). Null hvis punktet er bak kameraet eller utenfor bildet. */
  project(wx: number, wy: number, wz: number): [number, number] | null {
    const v = this.projected.set(wx, wy, wz).project(this.camera);
    if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null;
    return [v.x * 0.5 + 0.5, 0.5 - v.y * 0.5];
  }

  /** Kameraets plass i verden (m): øst, høyde, sør. */
  get eye(): [number, number, number] {
    const p = this.camera.position;
    return [p.x, p.y, p.z];
  }

  /** `spectator` er kameraets faste plass i verden når cam er «replay». */
  render(P: Plane, cam: Camera, env: Environment, spectator?: [number, number, number]): void {
    const { cell } = this.t, x = P.x * cell, z = P.y * cell;
    const fx = Math.sin(P.hdg), fz = -Math.cos(P.hdg);
    // Kurs om Y (med klokka sett ovenfra = negativ vinkel), nese opp om X, høyre vinge ned om Z
    this.plane.position.set(x, P.alt, z);
    this.plane.rotation.set(P.pitch, -P.hdg, -P.roll);
    this.plane.visible = cam !== "cockpit";
    this.towerMesh.visible = cam !== "tower"; // i tårnkameraet står vi inne i det
    this.gear.visible = P.gear > 0.02;
    this.gear.scale.y = Math.max(P.gear, 0.02);
    // Klaffer og slats: utslag i grader per klaffstilling (0, 1, 2, 3, FULL), interpolert mens de går
    const fi = Math.min(Math.floor(P.flaps), FLAP_DEG.length - 2), ff = P.flaps - fi;
    const flapDeg = FLAP_DEG[fi] + (FLAP_DEG[fi + 1] - FLAP_DEG[fi]) * ff, slatDeg = SLAT_DEG[fi] + (SLAT_DEG[fi + 1] - SLAT_DEG[fi]) * ff;
    for (const { panel, chord, slat } of this.highLift) {
      const out = slat ? slatDeg / SLAT_DEG[4] : flapDeg / FLAP_DEG[4]; // 0 = inne i vingen, 1 = helt ute
      panel.visible = out > 0.01;
      // inne: platen ligger inni vingen. Ute: skjøvet 85 % av sin egen bredde ut over kanten, og vippet ned
      panel.position.z = slat ? chord * (1 - 0.85 * out) : -chord * (1 - 0.85 * out);
      panel.rotation.x = ((slat ? -slatDeg : flapDeg) * Math.PI) / 180;
    }

    const ground = Math.max(0, this.t.heightAt(P.x, P.y));
    this.shadow.position.set(x, ground + 0.6, z);
    this.shadow.visible = cam !== "cockpit" && P.alt - ground < 800 && env.sky.night < 0.5;

    // landingslys: forover og litt ned
    this.landingLight.position.set(x, P.alt, z);
    this.landingLight.target.position.set(x + fx * 300, P.alt - 45 + Math.sin(P.pitch) * 300, z + fz * 300);

    const view = cam === "tower" ? towerView(this.t, P) : null;
    this.camera.fov = view ? TOWER_FOV : cam === "replay" ? 42 : 60;
    this.camera.updateProjectionMatrix();
    if (cam === "replay" && spectator) {
      // reprise: kameraet står stille og følger flyet med blikket
      this.camera.clearViewOffset();
      this.camera.position.set(...spectator);
      this.camera.rotation.order = "XYZ";
      this.camera.lookAt(x, P.alt + 3.6, z);
    } else if (view) {
      // Blikket følger flyet rundt, men holdes over benken. Bildet forskyves så horisonten ligger midt i vinduene.
      this.camera.setViewOffset(this.size.x, this.size.y, 0, this.size.y * horizonShift(TOWER_SILL), this.size.x, this.size.y);
      this.camera.position.set(...view.eye);
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.set(view.headPitch, -view.yaw, 0);
    } else if (cam === "external") {
      this.camera.clearViewOffset();
      this.camera.position.set(x - fx * 88, P.alt + 22, z - fz * 88);
      this.camera.rotation.order = "XYZ";
      this.camera.lookAt(x + fx * 70, P.alt + 3, z + fz * 70);
    } else {
      // instrumentpanelet dekker nedre del: flytt bildet opp så horisonten ligger midt i frontruta
      this.camera.setViewOffset(this.size.x, this.size.y, 0, this.size.y * horizonShift(PANEL_TOP), this.size.x, this.size.y);
      // pilotens øye: 15 m foran flyets midtpunkt og 5 m over hjulene
      this.camera.position.set(x + fx * 15, P.alt + 5, z + fz * 15);
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.set(P.pitch, -P.hdg, -P.roll);
    }
    this.applyEnvironment(env);
    this.groundDetail.setTime(performance.now() / 1000);
    this.updateLod();
    this.renderer.render(this.scene, this.camera);
    if (view) this.renderScope(view.eye, x, P.alt + 3.6, z, view.scopeFov);
  }

  /** Kikkertkameraet: flyet sett fra tårnet med lang brennvidde, tegnet inn i skjermen på benken. */
  private renderScope(eye: [number, number, number], x: number, y: number, z: number, fov: number): void {
    // logiske enheter (y ned) -> WebGL-visningsfelt (y opp), i CSS-piksler slik three.js vil ha det
    const s = this.size.y / (SCREEN_H - TOP);
    const vx = (SCOPE.x + OX) * s, vy = (SCREEN_H - SCOPE.y - SCOPE.h) * s, vw = SCOPE.w * s, vh = SCOPE.h * s;
    this.scopeCamera.fov = fov;
    this.scopeCamera.updateProjectionMatrix();
    this.scopeCamera.position.set(...eye);
    this.scopeCamera.lookAt(x, y, z);
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(vx, vy, vw, vh);
    this.renderer.setScissor(vx, vy, vw, vh);
    this.renderer.render(this.scene, this.scopeCamera);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.size.x, this.size.y);
  }
}
