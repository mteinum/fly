/* Byggesteg for flisene i dist/data (kjøres av Vite-pluginen i vite.config.ts, aldri i nettleseren).
 *
 * 1. Versjon: hver `{ file: ... }` i metadata.json får `hash` = de 12 første heksadesimale tegnene i filas SHA-256.
 *    Spillet henter fila som `<fil>?v=<hash>` (fileUrl i terrain.ts), og .htaccess lar nettleseren beholde den
 *    for alltid. Filnavnene er uendret: publiseringen sletter aldri noe på serveren, så navn med hash ville hopet seg opp.
 * 2. Komprimering: .br og .gz ved siden av hver .f32/.bin/.json, så Apache slipper å komprimere 26 MB per besøk
 *    og kan sende brotli. Begge skrives ALLTID, også når de ikke blir mindre: en gammel utgave på serveren
 *    må bli overskrevet, ellers ville den blitt sendt i stedet for den nye fila.
 *
 * Bare kopien i dist/ endres. web/public/data er pipelinens utdata og røres ikke.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotli = promisify(brotliCompress), gz = promisify(gzip);

/** Bare rene filnavn i samme mappe: ingen skråstrek, så metadata kan aldri peke ut av mappa. */
const PLAIN_NAME = /^[A-Za-z0-9._-]+$/;
/** Filtypene som komprimeres. PNG og JPG er allerede komprimert. */
const COMPRESSIBLE = /\.(?:f32|bin|json)$/;

export const hashOf = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex").slice(0, 12);

/** Går gjennom hele JSON-treet og setter `hash` på hvert objekt med en `file` som finnes i `dir`.
 *  Returnerer antall filer som fikk hash. */
export function stampHashes(node: unknown, dir: string): number {
  if (Array.isArray(node)) return node.reduce<number>((n, v) => n + stampHashes(v, dir), 0);
  if (node === null || typeof node !== "object") return 0;
  const obj = node as Record<string, unknown>;
  let n = 0;
  if (typeof obj.file === "string" && PLAIN_NAME.test(obj.file)) {
    const path = join(dir, obj.file);
    // «..» slipper gjennom mønsteret, men er en mappe og ikke en fil
    if (existsSync(path) && statSync(path).isFile()) { obj.hash = hashOf(readFileSync(path)); n++; }
  }
  for (const v of Object.values(obj)) n += stampHashes(v, dir);
  return n;
}

/** Stempler metadata.json i hver undermappe av `dataDir`. Returnerer antall filer som fikk hash. */
export function stampDataDir(dataDir: string): number {
  let n = 0;
  for (const e of readdirSync(dataDir, { withFileTypes: true })) {
    const metaPath = join(dataDir, e.name, "metadata.json");
    if (!e.isDirectory() || !existsSync(metaPath)) continue;
    const meta: unknown = JSON.parse(readFileSync(metaPath, "utf-8"));
    n += stampHashes(meta, join(dataDir, e.name));
    writeFileSync(metaPath, JSON.stringify(meta));
  }
  return n;
}

function compressibleFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? compressibleFiles(join(dir, e.name)) : e.isFile() && COMPRESSIBLE.test(e.name) ? [join(dir, e.name)] : []);
}

/** Skriver <fil>.br (brotli 11) og <fil>.gz (gzip 9) for hver .f32/.bin/.json under `dataDir`, også i undermapper. */
export async function compressDataDir(dataDir: string): Promise<{ files: number; raw: number; br: number; gz: number }> {
  const queue = compressibleFiles(dataDir).sort(), total = { files: queue.length, raw: 0, br: 0, gz: 0 };
  // brotli 11 er tregt (rundt ett minutt for et høydekart på 26 MB): noen filer om gangen, i zlibs egne tråder
  const worker = async () => {
    for (let path = queue.pop(); path; path = queue.pop()) {
      const data = readFileSync(path);
      const [b, g] = await Promise.all([
        brotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
        gz(data, { level: 9 }),
      ]);
      writeFileSync(`${path}.br`, b);
      writeFileSync(`${path}.gz`, g);
      total.raw += data.length; total.br += b.length; total.gz += g.length;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return total;
}

/** Hele steget: først hash i metadata, så komprimering (metadata komprimeres med hashene i). */
export async function versionAndCompress(dataDir: string): Promise<string> {
  if (!existsSync(dataDir)) return "data: nothing to do";
  const stamped = stampDataDir(dataDir), c = await compressDataDir(dataDir);
  const mb = (v: number) => (v / 1e6).toFixed(1);
  return `data: ${stamped} files versioned, ${c.files} compressed (${mb(c.raw)} MB -> br ${mb(c.br)} MB, gzip ${mb(c.gz)} MB)`;
}
