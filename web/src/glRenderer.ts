/* 3D-renderer (WebGL via three.js): terrengnett fra høydekartet, fargekartet som tekstur,
 * bygninger og bruer som geometri. Sann målestokk, ingen vertikal overdrivelse.
 *
 * Verdenskoordinater i meter, høyrehendt:
 *   X = øst   (rutenett-x * celle)
 *   Y = opp   (m over havet, NN2000)
 *   Z = sør   (rutenett-y * celle), så nord er -Z
 * Rutenettkurs hdg (0 = nord, med klokka) gir framoverretning (sin hdg, 0, -cos hdg).
 */
import * as THREE from "three";
import type { Camera } from "./hud";
import type { Plane } from "./plane";
import { BUILDING, type Terrain } from "./terrain";

const CHUNK = 128; // celler per side i en terrengrute
const LOD_STEPS = [1, 2, 4, 8, 16]; // celler mellom hvert punkt i nettet
const LOD_DIST = [1.5, 3, 6, 12]; // avstand (i ruter) der neste, grovere steg tar over
const REBUILDS_PER_FRAME = 6;
const SKY = 0xb4d0e6;
const DECK_THICKNESS = 2.5;

interface Chunk {
  mesh: THREE.Mesh;
  cx: number;
  cy: number;
  step: number;
}

export class GlRenderer {
  readonly buildingCount: number;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1.6, 2, 80000);
  private chunks: Chunk[] = [];
  private indexCache = new Map<number, THREE.BufferAttribute>();
  private terrainMat: THREE.MeshBasicMaterial;
  private plane: THREE.Group;
  private shadow: THREE.Mesh;

  constructor(private canvas: HTMLCanvasElement, private t: Terrain, image: HTMLImageElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 3000, 28000);

    // Hillshade er bakt inn i fargekartet av pipeline, så terrenget tegnes uten lys.
    const tex = new THREE.Texture(image);
    tex.flipY = false; // rad 0 i bildet er nord = minst Z
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    this.terrainMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });

    for (let cy = 0; cy * CHUNK < t.height; cy++) for (let cx = 0; cx * CHUNK < t.width; cx++) {
      const step = LOD_STEPS[LOD_STEPS.length - 1];
      const mesh = new THREE.Mesh(this.chunkGeometry(cx, cy, step), this.terrainMat);
      this.scene.add(mesh);
      this.chunks.push({ mesh, cx, cy, step });
    }

    // Hav utenfor utsnittet
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...this.rgb(t.seaColor), THREE.SRGBColorSpace) }),
    );
    sea.position.set((t.width * t.cell) / 2, -0.5, (t.height * t.cell) / 2);
    this.scene.add(sea);

    // Lys for bygninger, bruer og fly: samme solretning som hillshade (rutenett-asimut)
    const hs = t.meta.hillshade, az = (hs.sunAzimuthGridDeg * Math.PI) / 180, el = (hs.sunElevationDeg * Math.PI) / 180;
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.scene.add(sun, new THREE.AmbientLight(0xffffff, 1.5));

    this.buildingCount = this.addBuildings();
    this.addBridges();
    this.plane = this.buildPlane();
    this.scene.add(this.plane);
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(7, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.scene.add(this.shadow);

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  private rgb(c: number): [number, number, number] {
    return [(c & 255) / 255, ((c >>> 8) & 255) / 255, ((c >>> 16) & 255) / 255];
  }

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------- terreng: ruter med nivådelt detaljgrad ---------- */

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
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial(), count);
    const m = new THREE.Matrix4(), color = new THREE.Color();
    let k = 0;
    for (let i = 0; i < sKind.length; i++) {
      if (sKind[i] !== BUILDING) continue;
      const col = i % W, row = (i / W) | 0;
      m.makeScale(cell, sTop[i] - sBase[i], cell).setPosition((col + 0.5) * cell, sBase[i], (row + 0.5) * cell);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k++, color.setRGB(...this.rgb(sCol[i]), THREE.SRGBColorSpace));
    }
    mesh.frustumCulled = false; // én felles avgrensning for hele kartet gir ingen gevinst
    this.scene.add(mesh);
    return count;
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

  /** Enkelt fly av bokser, i ekte størrelse (vingespenn 15 m). Nesa peker mot -Z. */
  private buildPlane(): THREE.Group {
    const g = new THREE.Group();
    const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
      m.position.set(x, y, z);
      g.add(m);
    };
    box(1.5, 1.5, 11, 0xdde2e8, 0, 0, 0); // kropp
    box(1.3, 0.9, 2.2, 0x3fb7e8, 0, 0.5, -3.2); // cockpitglass
    box(15, 0.25, 2.2, 0xc9ced6, 0, 0.3, -0.8); // vinger
    box(1.2, 0.27, 2.2, 0xd23b3b, -6.9, 0.3, -0.8); // vingetipper
    box(1.2, 0.27, 2.2, 0xd23b3b, 6.9, 0.3, -0.8);
    box(5.5, 0.2, 1.4, 0xb9bec6, 0, 0.4, 4.7); // haleplan
    box(0.25, 2.4, 1.8, 0xd23b3b, 0, 1.5, 4.6); // halefinne
    g.rotation.order = "YXZ";
    return g;
  }

  /* ---------- bilde ---------- */

  render(P: Plane, cam: Camera): void {
    const { cell } = this.t, x = P.x * cell, z = P.y * cell;
    const fx = Math.sin(P.hdg), fz = -Math.cos(P.hdg);
    // Kurs om Y (med klokka sett ovenfra = negativ vinkel), nese opp om X, høyre vinge ned om Z
    this.plane.position.set(x, P.alt, z);
    this.plane.rotation.set(P.pitch, -P.hdg, -P.roll);
    this.plane.visible = cam === "chase";

    const ground = Math.max(0, this.t.heightAt(P.x, P.y));
    this.shadow.position.set(x, ground + 0.6, z);
    this.shadow.visible = cam === "chase" && P.alt - ground < 800;

    if (cam === "chase") {
      this.camera.position.set(x - fx * 34, P.alt + 9, z - fz * 34);
      this.camera.rotation.order = "XYZ";
      this.camera.lookAt(x + fx * 30, P.alt, z + fz * 30);
    } else {
      this.camera.position.set(x, P.alt + 1.2, z);
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.set(P.pitch, -P.hdg, -P.roll);
    }
    this.updateLod();
    this.renderer.render(this.scene, this.camera);
  }
}
