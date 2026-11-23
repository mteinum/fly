import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { versionAndCompress } from "./src/dataVersions.ts";

const FLIGHTS = fileURLToPath(new URL("../data/flights/", import.meta.url));

/** Kun utviklingsserveren: tar imot flylogger fra spillet og lagrer dem i data/flights/ (ikke i git),
 *  der de kan gås gjennom lokalt (`flypipe mcp`). Finnes ikke på den publiserte siden. */
const flightLogs = (): Plugin => ({
  name: "flight-logs",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__flightlog", (req, res) => {
      if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => { size += c.length; if (size <= 2e6) chunks.push(c); });
      req.on("end", () => {
        try {
          if (size > 2e6) throw new Error("too large");
          const log = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          if (log?.version !== 1 || !Array.isArray(log.samples)) throw new Error("not a flight log");
          // filnavnet settes her, av tegn vi selv velger: ingenting fra innholdet brukes som sti
          const safe = (v: unknown) => String(v).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
          const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
          mkdirSync(FLIGHTS, { recursive: true });
          writeFileSync(`${FLIGHTS}${stamp}Z-${safe(log.icao)}-${safe(log.runway)}-${safe(log.outcome)}.json`, JSON.stringify(log));
          res.statusCode = 204;
        } catch {
          res.statusCode = 400;
        }
        res.end();
      });
    });
  },
});

/** Kun utviklingsserveren, og bare når FLY_FRAMES_DIR er satt: tar imot bilder fra opptaksskriptet (web/dev/record.js)
 *  og lagrer dem som <mappe>/<scene>/<nummer>.jpg, til å sette sammen film av. Finnes ikke på den publiserte siden. */
const videoFrames = (): Plugin => ({
  name: "video-frames",
  apply: "serve",
  configureServer(server) {
    const root = process.env.FLY_FRAMES_DIR;
    if (!root) return;
    server.middlewares.use("/__frame", (req, res) => {
      if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
      const q = new URL(req.url ?? "", "http://x").searchParams, chunks: Buffer[] = [];
      // stien settes av tegn vi selv velger: scenenavn av bokstaver, tall og bindestrek, og et bildenummer
      const scene = (q.get("scene") ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40), i = Math.max(0, Math.min(99999, Number(q.get("i")) || 0));
      let size = 0;
      req.on("data", (c: Buffer) => { size += c.length; if (size <= 8e6) chunks.push(c); });
      req.on("end", () => {
        if (!scene || size > 8e6) { res.statusCode = 400; res.end(); return; }
        mkdirSync(`${root}/${scene}`, { recursive: true });
        writeFileSync(`${root}/${scene}/${q.has("done") ? "done.json" : `${String(i).padStart(4, "0")}.jpg`}`, Buffer.concat(chunks));
        res.statusCode = 204; res.end();
      });
    });
  },
});

/** Kun bygget: etter at Vite har kopiert public/ til dist/ får flisene i dist/data versjon (hash i metadata.json)
 *  og ferdig komprimerte utgaver (.br og .gz). Se src/dataVersions.ts. Utviklingsserveren leser public/ som før. */
const dataVersions = (): Plugin => {
  let dataDir = "";
  return {
    name: "data-versions",
    apply: "build",
    configResolved(config) { dataDir = resolve(config.root, config.build.outDir, "data"); },
    async closeBundle() { console.log(await versionAndCompress(dataDir)); },
  };
};

/** Hvilken utgave som kjører, til Om-skjermen: dato og git-commit på byggetidspunktet. */
const build = () => {
  let commit = process.env.GITHUB_SHA?.slice(0, 7) ?? "";
  try { commit ||= execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* ikke et git-repo */ }
  return { date: new Date().toISOString().slice(0, 10), commit };
};

export default defineConfig({ plugins: [flightLogs(), videoFrames(), dataVersions()], define: { __BUILD__: JSON.stringify(build()) } });
