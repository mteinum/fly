import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compressDataDir, stampDataDir, versionAndCompress } from "./dataVersions";
import { fileUrl } from "./terrain";

const sha12 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex").slice(0, 12);

describe("versjon og komprimering av flisene i dist/data", () => {
  let root = "", data = "", area = "";
  const heights = new Uint8Array(new Float32Array(4096).map((_, i) => Math.sin(i / 50) * 100).buffer);
  const readMeta = () => JSON.parse(readFileSync(join(area, "metadata.json"), "utf-8"));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "fly-data-"));
    data = join(root, "data");
    area = join(data, "testfield");
    mkdirSync(area, { recursive: true });
    writeFileSync(join(root, "secret.bin"), "outside the data folder");
    writeFileSync(join(data, "index.json"), JSON.stringify({ areas: [{ id: "testfield" }] }));
    writeFileSync(join(area, "heightmap.f32"), heights);
    writeFileSync(join(area, "surface.bin"), new Uint8Array(1024).fill(7));
    writeFileSync(join(area, "colormap.png"), "not really a png");
    writeFileSync(join(area, "structures.json"), JSON.stringify({ cells: [[1, 2, 3]] }));
    writeFileSync(join(area, "buildings.bin"), new Uint8Array([1, 2, 3, 4]));
    writeFileSync(join(area, "metadata.json"), JSON.stringify({
      id: "testfield",
      heightmap: { file: "heightmap.f32" },
      colormap: { file: "colormap.png" },
      surface: { file: "surface.bin", classes: [{ code: 1, name: "grass" }] },
      structures: { file: "structures.json", footprints: { file: "buildings.bin", count: 1 } },
      lights: null,
      names: { file: "missing.json", count: 0 },
      escape: { file: "../secret.bin" },
      up: { file: ".." },
      list: [{ file: "surface.bin" }],
    }, null, 2));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("setter hash på filene metadata peker på, også de som ligger nede i treet", () => {
    expect(stampDataDir(data)).toBe(6);
    const meta = readMeta();
    expect(meta.heightmap.hash).toBe(sha12(heights));
    expect(meta.heightmap.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(meta.colormap.hash).toBe(sha12("not really a png"));
    expect(meta.structures.hash).toBe(sha12(readFileSync(join(area, "structures.json"))));
    expect(meta.structures.footprints.hash).toBe(sha12(new Uint8Array([1, 2, 3, 4])));
    expect(meta.list[0].hash).toBe(meta.surface.hash);
    // resten av metadata er urørt
    expect(meta.surface.classes).toEqual([{ code: 1, name: "grass" }]);
    expect(meta.structures.footprints.count).toBe(1);
    expect(meta.lights).toBeNull();
  });

  it("gir ingen hash til filer som ikke finnes, og leser aldri utenfor mappa", () => {
    stampDataDir(data);
    const meta = readMeta();
    expect(meta.names).toEqual({ file: "missing.json", count: 0 });
    expect(meta.escape).toEqual({ file: "../secret.bin" });
    expect(meta.up).toEqual({ file: ".." });
  });

  it("gir ny hash når innholdet endres, og samme hash når det ikke gjør det", () => {
    stampDataDir(data);
    const first = readMeta();
    stampDataDir(data);
    expect(readMeta()).toEqual(first);
    writeFileSync(join(area, "surface.bin"), new Uint8Array(1024).fill(8));
    stampDataDir(data);
    const second = readMeta();
    expect(second.surface.hash).not.toBe(first.surface.hash);
    expect(second.heightmap.hash).toBe(first.heightmap.hash);
  });

  it("skriver .br og .gz som pakker ut til nøyaktig samme byte, men ikke for png", async () => {
    const total = await compressDataDir(data);
    expect(total.files).toBe(6); // index.json, metadata.json, heightmap, surface, structures, buildings
    for (const rel of ["index.json", "testfield/metadata.json", "testfield/heightmap.f32", "testfield/surface.bin", "testfield/structures.json", "testfield/buildings.bin"]) {
      const raw = readFileSync(join(data, rel));
      expect(brotliDecompressSync(readFileSync(join(data, `${rel}.br`))).equals(raw), `${rel}.br`).toBe(true);
      expect(gunzipSync(readFileSync(join(data, `${rel}.gz`))).equals(raw), `${rel}.gz`).toBe(true);
    }
    // buildings.bin er fire byte og blir større av å pakkes: skrives likevel, så en gammel utgave på serveren byttes ut
    expect(readFileSync(join(area, "buildings.bin.gz")).length).toBeGreaterThan(4);
    expect(existsSync(join(area, "colormap.png.br"))).toBe(false);
    expect(existsSync(join(area, "colormap.png.gz"))).toBe(false);
    expect(existsSync(join(root, "secret.bin.br"))).toBe(false);
  });

  it("komprimerer metadata etter at hashene er satt, og tåler at mappa mangler", async () => {
    await versionAndCompress(data);
    const packed = JSON.parse(brotliDecompressSync(readFileSync(join(area, "metadata.json.br"))).toString("utf-8"));
    expect(packed).toEqual(readMeta());
    expect(packed.heightmap.hash).toBe(sha12(heights));
    await expect(versionAndCompress(join(root, "nowhere"))).resolves.toContain("nothing");
  });
});

describe("fileUrl", () => {
  it("legger hashen på som ?v= når metadata har en", () => {
    expect(fileUrl("data/kjevik10", { file: "heightmap.f32", hash: "0123456789ab" })).toBe("data/kjevik10/heightmap.f32?v=0123456789ab");
  });
  it("gir ren adresse uten hash (utviklingsserveren)", () => {
    expect(fileUrl("data/kjevik10", { file: "heightmap.f32" })).toBe("data/kjevik10/heightmap.f32");
  });
});
