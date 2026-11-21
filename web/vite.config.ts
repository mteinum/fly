import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

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

/** Hvilken utgave som kjører, til Om-skjermen: dato og git-commit på byggetidspunktet. */
const build = () => {
  let commit = process.env.GITHUB_SHA?.slice(0, 7) ?? "";
  try { commit ||= execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* ikke et git-repo */ }
  return { date: new Date().toISOString().slice(0, 10), commit };
};

export default defineConfig({ plugins: [flightLogs()], define: { __BUILD__: JSON.stringify(build()) } });
