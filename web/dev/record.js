/* Opptak av korte filmklipp fra spillet, bilde for bilde. Kun i utviklingsmodus, lastet av main.ts med ?capture&record.
 *
 * Spillet går ikke av seg selv i opptaksmodus: skriptet tar ett steg på 1/30 s om gangen, legger 3D-bildet og
 * skjermteksten sammen på ett lerret, og sender bildet til utviklingsserveren (/__frame, se vite.config.ts).
 * Filmen får dermed jevn bildefrekvens uansett hvor fort maskinen tegner.
 *
 * Adressefelt: record=<scenenavn>, s=<sekunder som tas opp>, og ett av ff=<sekunder før opptaket> eller
 * until=agl:<m> (flyet er lavere enn dette over baneenden) eller until=stand:<m> (nærmere standen enn dette).
 * taxi=1 lar en enkel fører takse etter ruta. caption=<tekst> legges øverst i bildet (capy=<andel av høyden>).
 * pan=1 viser nedre halvdel av bildet i dobbel størrelse og glir over det, til overheadpanelet og midtkonsollen.
 */
const q = new URLSearchParams(location.search), FPS = 30, scene = q.get("record");
const game = window.__game, step = window.__capture.step, P = game.P;
const gl = document.getElementById("gl"), screen = document.getElementById("screen");
const out = document.createElement("canvas");
const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code }));
const cell = 10;

/** Fører under taksing: sikter på et punkt 30 m framme langs ruta og holder ca. 14 kt, saktere i svinger og inn mot standen. */
function drive() {
  if (P.state !== "landed" || P.parked) return;
  const plan = game.taxiPlan;
  let turn = 0, target = 7.5;
  if (plan && plan.route.length > 1) {
    let left = 30 / cell, [tx, ty] = plan.route[1];
    for (let i = 1; i < plan.route.length; i++) {
      const [ax, ay] = i === 1 ? [P.x, P.y] : plan.route[i - 1], [bx, by] = plan.route[i], len = Math.hypot(bx - ax, by - ay);
      if (len >= left) { tx = ax + ((bx - ax) * left) / len; ty = ay + ((by - ay) * left) / len; break; }
      left -= len; tx = bx; ty = by;
    }
    const want = Math.atan2(tx - P.x, -(ty - P.y)), err = Math.atan2(Math.sin(want - P.hdg), Math.cos(want - P.hdg));
    turn = err > 0.05 ? 1 : err < -0.05 ? -1 : 0;
    if (Math.abs(err) > 0.5) target = 4;
    const toStand = Math.hypot(plan.stand.at[0] - P.x, plan.stand.at[1] - P.y) * cell;
    if (toStand < 60) target = Math.max(1.2, toStand / 9);
    if (toStand < 6) target = 0;
  }
  key("ArrowRight", turn > 0); key("ArrowLeft", turn < 0);
  key("KeyW", P.spd < target - 0.4 && P.thr < 0.32); key("KeyS", P.spd > target + 0.3 || P.thr > 0.34); key("Space", P.spd > target + 1.5 || target === 0);
}

const tick = () => { if (q.has("taxi")) drive(); step(1 / FPS); };
const end = game.airport.runways.flatMap((r) => r.ends).find((e) => e.ident === game.approach.ident);
const standM = () => (game.taxiPlan ? Math.hypot(game.taxiPlan.stand.at[0] - P.x, game.taxiPlan.stand.at[1] - P.y) * cell : 1e9);
const [untilKind, untilValue] = (q.get("until") ?? "").split(":");
const ready = (waited) => (untilKind === "agl" ? P.alt - end.elevationM < Number(untilValue) : untilKind === "stand" ? standM() < Number(untilValue) : waited >= Number(q.get("ff") ?? 0));

async function run() {
  let waited = 0;
  tick();
  while (!ready(waited) && waited < 400) { tick(); waited += 1 / FPS; if (Math.round(waited * FPS) % 60 === 0) await new Promise((r) => setTimeout(r)); }
  const n = Math.round(Number(q.get("s") ?? 2.5) * FPS), caption = q.get("caption") ?? "", events = [];
  let prev = P.state, parked = P.parked;
  for (let i = 0; i < n; i++) {
    tick();
    if (P.state !== prev) { events.push({ frame: i, state: P.state }); prev = P.state; }
    if (P.parked && !parked) { events.push({ frame: i, parked: true }); parked = true; }
    // 3D-bildet må kopieres i samme oppgave som det ble tegnet, ellers er lerretet tomt
    out.width = gl.width; out.height = gl.height;
    const g = out.getContext("2d");
    if (q.has("pan")) {
      // nærbilde av panelet (nedre halvdel av bildet), som glir fra venstre mot høyre gjennom klippet
      const sw = out.width / 2, sh = out.height / 2, sx = (out.width - sw) * (i / Math.max(1, n - 1)) * 0.9 + (out.width - sw) * 0.05;
      g.drawImage(gl, sx, sh, sw, sh, 0, 0, out.width, out.height);
      g.drawImage(screen, (sx / out.width) * screen.width, screen.height / 2, screen.width / 2, screen.height / 2, 0, 0, out.width, out.height);
    } else {
      g.drawImage(gl, 0, 0);
      g.drawImage(screen, 0, 0, out.width, out.height);
    }
    if (caption) {
      const size = Math.round(out.width * 0.058);
      g.font = `800 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.shadowColor = "rgba(0,0,0,.9)"; g.shadowBlur = size * 0.28; g.shadowOffsetY = size * 0.05;
      g.fillStyle = "#fff"; g.fillText(caption, out.width / 2, out.height * Number(q.get("capy") ?? 0.1), out.width * 0.92);
      g.shadowColor = "transparent";
    }
    const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", 0.93));
    await fetch(`/__frame?scene=${scene}&i=${i}`, { method: "POST", body: blob });
  }
  await fetch(`/__frame?scene=${scene}&done=1`, { method: "POST", body: JSON.stringify({ frames: n, waited: +waited.toFixed(1), events, spd: P.spd, state: P.state, size: [out.width, out.height] }) });
}
run().catch((e) => fetch(`/__frame?scene=${scene}&done=1`, { method: "POST", body: JSON.stringify({ error: String(e) }) }));
