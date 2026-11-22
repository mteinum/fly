import { GameAudio } from "./audio";
import { createDiplomaUi, gradeLanding } from "./diploma";
import { type FlightLog, flightLogName } from "./flightlog";
import { createGame, isTyping, runLoop, type Weather } from "./game";
import { GlRenderer } from "./glRenderer";
import { drawCornerMap, drawHud, drawMessage } from "./hud";
import { candidates, declutter, inSight, labelStyle, type PlaceName } from "./labels";
import { drawOverhead, drawPedestal, overheadHit, pedestalHit, pedestalThrustAt } from "./cockpitViews";
import { drawPanel, panelHit, thrustAt } from "./panel";
import { groundVelocity, verticalSpeed } from "./physics";
import { H, OX, setScreen, TOP, W } from "./screen";
import { type AisShip, Fleet, position, shipColor, shipKind } from "./ships";
import { tcasLevel } from "./tcas";
import { loadTerrain } from "./terrain";
import { towerView } from "./tower";
import { osloTime } from "./clock";
import { composeSnapshot, deliverSnapshot, snapshotInfo } from "./snapshot";
import { drawTower, towerHit } from "./towerPanel";
import { type AdsbAircraft, aircraftSize, locate, Traffic } from "./traffic";

const DEFAULT_ICAO = "ENCN";

interface AreaInfo { id: string; name: string; icao: string; cellSize: number }

/** Flyplassene pipeline har bygget 10 m-fliser for (data/index.json). */
async function listAirports(dataUrl: string): Promise<AreaInfo[]> {
  try {
    const index: { areas: AreaInfo[] } = await (await fetch(`${dataUrl}/index.json`)).json();
    return index.areas.filter((a) => a.cellSize === 10);
  } catch {
    return [{ id: "kjevik10", name: "Kristiansand Airport, Kjevik", icao: DEFAULT_ICAO, cellSize: 10 }];
  }
}

let area = "kjevik10";

async function main(): Promise<void> {
  const dataUrl = `${import.meta.env.BASE_URL}data`, params = new URLSearchParams(location.search);
  const airports = await listAirports(dataUrl);
  // ?apt=ENZV velger flyplass (ICAO-kode). Ukjent kode gir standardflyplassen.
  const wanted = (params.get("apt") ?? DEFAULT_ICAO).toUpperCase();
  const chosen = airports.find((a) => a.icao === wanted) ?? airports.find((a) => a.icao === DEFAULT_ICAO) ?? airports[0];
  area = chosen.id;
  const picker = document.getElementById("airports")!;
  for (const a of airports) {
    const link = document.createElement("a");
    link.textContent = `${a.icao} ${a.name.split(",").pop()!.trim()}`;
    link.href = `?apt=${a.icao}`;
    if (a === chosen) link.className = "current";
    picker.append(link);
  }
  document.title = `Fly an Airbus A320 to ${chosen.name.split(",").pop()!.trim()} – teinum-fly`;
  document.getElementById("where")!.textContent = chosen.name;
  const assets = await loadTerrain(`${dataUrl}/${area}`);
  const { terrain } = assets;
  // Skjermtekst og instrumentpanel tegnes på et eget lerret oppå 3D-bildet
  const overlay = document.getElementById("screen") as HTMLCanvasElement;
  const g = overlay.getContext("2d")!;
  let scale = 1; // lerretspiksler per logisk enhet
  const fit = () => {
    const dpr = Math.min(devicePixelRatio, 2), unit = setScreen(overlay.clientWidth, overlay.clientHeight);
    overlay.width = Math.round(overlay.clientWidth * dpr);
    overlay.height = Math.round(overlay.clientHeight * dpr);
    scale = unit * dpr;
  };
  new ResizeObserver(fit).observe(overlay);
  fit();

  const map = document.createElement("canvas");
  map.width = map.height = 512;
  map.getContext("2d")!.drawImage(assets.colormap, 0, 0, 512, 512);

  const renderer = new GlRenderer(document.getElementById("gl") as HTMLCanvasElement, terrain, assets);
  // Vinden på flyplassen akkurat nå: siste METAR fra Meteorologisk institutt, hentet fra /weather/ på serveren.
  // Spillet venter høyst to sekunder på svaret; uten svar er det vindstille. `?wind=` i adressen går foran.
  const weatherUrl = import.meta.env.DEV ? (params.get("weather") ?? "https://fly.teinum.no/weather/") : `${import.meta.env.BASE_URL}weather/`;
  let weather: Weather | null = null;
  if (!params.has("wind")) {
    try {
      const r = await fetch(`${weatherUrl}?apt=${chosen.icao}`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) weather = await r.json();
    } catch { /* ingen vind denne gangen */ }
  }
  const game = createGame(terrain, overlay, weather);
  // Mus og berøring på instrumentpanelet i cockpit: spakene og knappene som kan betjenes (se panelHit i panel.ts).
  // Gasshåndtakene kan dras; resten er ett trykk.
  const logicalY = (e: PointerEvent): number => { const r = overlay.getBoundingClientRect(); return TOP + ((e.clientY - r.top) / r.width) * W; };
  const controlAt = (e: PointerEvent) => {
    if ((game.cam !== "cockpit" && game.cam !== "tower") || game.replay) return null;
    const r = overlay.getBoundingClientRect();
    const lx = ((e.clientX - r.left) / r.width) * W - OX, ly = logicalY(e);
    if (game.cam === "tower") return towerHit(lx, ly);
    return game.look === "up" ? overheadHit(lx, ly) : game.look === "down" ? pedestalHit(lx, ly) : panelHit(lx, ly);
  };
  let draggingThrust = false;
  overlay.addEventListener("pointerdown", (e) => {
    const c = controlAt(e);
    if (!c) return;
    game.control(c);
    draggingThrust = c.kind === "thrust";
    if (draggingThrust) overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener("pointermove", (e) => {
    if (draggingThrust) game.control({ kind: "thrust", thr: (game.look === "down" ? pedestalThrustAt : thrustAt)(logicalY(e)) });
    else overlay.style.cursor = controlAt(e) ? "pointer" : "";
  });
  for (const ev of ["pointerup", "pointercancel"]) overlay.addEventListener(ev, () => { draggingThrust = false; });
  // Musehjulet i tårnet: kikkerten inn og ut, ett trinn per rykk
  let wheelAt = 0;
  overlay.addEventListener("wheel", (e) => {
    if (game.cam !== "tower" || e.deltaY === 0) return;
    e.preventDefault();
    if (performance.now() - wheelAt < 180) return;
    wheelAt = performance.now();
    game.control({ kind: "towerZoom", step: e.deltaY < 0 ? 1 : -1 });
  }, { passive: false });
  document.getElementById("fullscreen")!.onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };
  const mapInfo =
    `Map ${((terrain.width * terrain.cell) / 1000).toFixed(1)} km · cell ${terrain.cell} m · ${renderer.buildingCount} building cells · ${terrain.bridges.length} bridges · ${terrain.meta.crs}`;
  // Forklaring til bygningsfargene: navn og farge kommer fra pipeline, så de to ikke kan komme i utakt
  const legend = document.getElementById("legend")!;
  for (const [name, color] of terrain.meta.structures.buildingColors?.legend ?? []) {
    const item = document.createElement("span"), swatch = document.createElement("i");
    swatch.style.cssText = `display:inline-block;width:.7em;height:.7em;margin:0 .3em 0 .7em;background:${color};border:1px solid rgba(255,255,255,.4)`;
    item.append(swatch, name);
    item.style.whiteSpace = "nowrap";
    legend.append(item);
    legend.hidden = false;
  }
  // Det pipeline har regnet ut om innflygingen som flys nå (analysis.py)
  let infoFor = -1;
  const showInfo = () => {
    if (infoFor === game.approach.count) return;
    infoFor = game.approach.count;
    const a = game.airport.runways.flatMap((rw) => rw.ends).find((e) => e.ident === game.approach.ident)?.approach;
    const facts = a ? ` · Runway ${game.approach.ident}: lowest clearance under the glide path ${Math.round(a.lowestClearanceM)} m, ${(a.lowestClearanceAtM / 1000).toFixed(1)} km out` +
      (a.seenFromTowerShare === undefined || a.seenFromTowerShare >= 0.995 ? "" : ` · the tower sees ${Math.round(a.seenFromTowerShare * 100)} % of the approach`) : "";
    document.getElementById("info")!.textContent = mapInfo + facts;
  };
  document.getElementById("credits")!.textContent = [...terrain.meta.attribution, "Audio: generated with ElevenLabs"].join(" · ");

  // Skipstrafikk: ekte skip fra Kystverkets AIS, hentet fra /ais/ på serveren hvert halve minutt.
  // Utviklingsserveren har ingen PHP og henter fra den publiserte siden. Svarer ikke tjenesten, blir det sjø uten skip.
  // ?ais=adresse (kun utviklingsmodus): hent fra en lokal PHP-server i stedet
  const fleet = new Fleet(), aisUrl = import.meta.env.DEV ? (params.get("ais") ?? "https://fly.teinum.no/ais/") : `${import.meta.env.BASE_URL}ais/`;
  if (terrain.meta.ships) {
    const poll = async () => {
      try {
        const r = await fetch(`${aisUrl}?apt=${chosen.icao}`);
        if (!r.ok) return;
        const data: { ships: AisShip[] } = await r.json();
        fleet.update(data.ships, terrain, performance.now() / 1000);
        credit("Ship positions: Kystverket (NLOD)");
      } catch { /* ingen skip denne gangen */ }
    };
    void poll();
    setInterval(() => { if (!document.hidden) void poll(); }, 30000);
  }

  // Flytrafikk: ekte fly fra adsb.lol, hentet fra /traffic/ på serveren. Kilden har en døgngrense, så serveren
  // oppdaterer høyst hvert 45. sekund; her spørres det like ofte. Uten svar er himmelen tom.
  const traffic = new Traffic(), trafficUrl = import.meta.env.DEV ? (params.get("traffic") ?? "https://fly.teinum.no/traffic/") : `${import.meta.env.BASE_URL}traffic/`;
  let credits = [...terrain.meta.attribution];
  const showCredits = () => { document.getElementById("credits")!.textContent = [...credits, "Audio: generated with ElevenLabs"].join(" · "); };
  const credit = (text: string) => { if (!credits.includes(text)) { credits = [...credits, text]; showCredits(); } };
  if (game.wind.source === "metar") credit("Weather: MET Norway (CC BY 4.0)");
  if (terrain.meta.traffic) {
    const poll = async () => {
      try {
        const r = await fetch(`${trafficUrl}?apt=${chosen.icao}`);
        if (!r.ok) return;
        const data: { aircraft: AdsbAircraft[] } = await r.json();
        traffic.update(data.aircraft, terrain, performance.now() / 1000);
        credit("Aircraft positions: adsb.lol (ODbL)");
      } catch { /* ingen fly denne gangen */ }
    };
    void poll();
    setInterval(() => { if (!document.hidden) void poll(); }, 45000);
  }

  // Om-skjermen. Spillet går videre bak den; Esc, Close eller et klikk utenfor lukker.
  const about = document.getElementById("about")!;
  const showAbout = (on: boolean) => { about.hidden = !on; if (!on) overlay.focus(); };
  document.getElementById("aboutBuild")!.textContent = `Build ${__BUILD__.date}${__BUILD__.commit ? ` · ${__BUILD__.commit}` : ""}`;
  for (const id of ["aboutOpen", "aboutOpen2"]) document.getElementById(id)!.onclick = () => showAbout(true);
  document.getElementById("aboutClose")!.onclick = () => showAbout(false);
  about.addEventListener("click", (e) => { if (e.target === about) showAbout(false); });
  addEventListener("keydown", (e) => { if (e.code === "Escape" && !about.hidden) showAbout(false); });
  // ?about: åpne den med en gang (til skjermbilder)
  if (params.has("about")) showAbout(true);

  // ?clean: bare 3D-bildet, uten skjermtekst, hjelp og kreditering. Til skjermbilder (f.eks. delingsbildet).
  const clean = new URLSearchParams(location.search).has("clean");
  document.body.classList.toggle("clean", clean);
  const audio = new GameAudio(`${import.meta.env.BASE_URL}audio`, game.airport);
  addEventListener("keydown", (e) => {
    if (e.code === "KeyM" && !e.repeat && !isTyping(e)) { game.msg.text = audio.toggleMute() ? "Sound off" : "Sound on"; game.msg.t = 1.5; }
  });

  // ?selftest (kun i utviklingsmodus): start lyden uten tastetrykk og skriv tilstanden til <body data-audio>.
  // Brukes til å kontrollere lydmotoren i hodeløs nettleser, der ingen kan trykke eller høre.
  // ?capture (kun i utviklingsmodus): gi opptaksskriptet tilgang til spilltilstanden (flyets posisjon, ruta under taksing)
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("capture")) {
    (window as unknown as { __game: typeof game }).__game = game;
    // ?record: opptaksskriptet tar over og sender bildene til utviklingsserveren (se web/dev/record.js)
    if (new URLSearchParams(location.search).has("record")) void import(/* @vite-ignore */ `${location.origin}/dev/record.js`);
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("selftest")) {
    void audio.startNow();
    setInterval(() => { document.body.dataset.audio = JSON.stringify(audio.status); }, 500);
  }

  // Diplom etter landing: bildet tas i landingsøyeblikket, diplomet vises når flyet står stille
  const diploma = createDiplomaUi("https://fly.teinum.no/"), glCanvas = document.getElementById("gl") as HTMLCanvasElement;
  let landingPhoto: HTMLCanvasElement | null = null, wasLanded = false;
  let diplomaShown = false;
  const PARKED_SHORT_WAIT_S = 5;
  let shownPlan: typeof game.taxiPlan = null; // ruta som er tegnet på bakken nå
  // R og T starter ny innflyging og lukker diplomet - men ikke når de er bokstaver i navnet som skrives
  addEventListener("keydown", (e) => { if (!isTyping(e) && (e.code === "KeyR" || e.code === "KeyT")) diploma.hide(); });

  // Flylogg: L laster ned loggen fra forrige innflyging. I utviklingsmodus lagres hver logg også i data/flights/
  // (se vite.config.ts), så den kan gås gjennom lokalt. Flyloggen sendes ingen steder fra den publiserte siden.
  let savedLog: FlightLog | null = null;
  addEventListener("keydown", (e) => {
    if (e.code !== "KeyL" || e.repeat || isTyping(e)) return;
    const log = game.flightLog;
    if (log) {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([JSON.stringify(log)], { type: "application/json" }));
      link.download = flightLogName(log);
      link.click();
      URL.revokeObjectURL(link.href);
    }
    game.msg.text = log ? "Flight log downloaded" : "No flight log yet: finish an approach first"; game.msg.t = 2.5;
  });

  // Stedsnavn tegnes under paneler og skjermtekst, så de aldri ligger oppå instrumentene. N slår dem av og på.
  let showNames = true;
  addEventListener("keydown", (e) => {
    if (e.code === "KeyN" && !e.repeat && !isTyping(e)) { showNames = !showNames; game.msg.text = showNames ? "Place names on" : "Place names off"; game.msg.t = 1.5; }
  });
  // Kjennemerker med logo (fra pipeline, data/landmarks.json): et lite skilt over stedet
  const signs = (terrain.meta.landmarks ?? []).map((lm) => {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}${lm.image}`;
    // samme form som et stedsnavn, så sikt og avstand kan sjekkes med de samme funksjonene
    return { lm, image, place: { name: lm.name, x: lm.x, y: lm.y, z: lm.z, size: 12, type: "landmark", group: "bebyggelse" } satisfies PlaceName };
  });
  const MAX_SHIP_LABELS = 6, DETAIL_FONT = '400 2.1px "Helvetica Neue", Helvetica, Arial, sans-serif';
  const SIGN_RANGE_M = 9000, SIGN_HEIGHT = 3.4; // logiske enheter: på størrelse med et stedsnavn
  const drawSigns = (cx: number, cy: number, ey: number) => {
    for (const { lm, image, place } of signs) {
      if (!image.complete || !image.naturalWidth) continue;
      if (Math.hypot(lm.x - cx, lm.y - cy) * terrain.cell > SIGN_RANGE_M || !inSight(terrain, cx, cy, ey, place)) continue;
      const at = renderer.project(lm.x * terrain.cell, lm.z + 25, lm.y * terrain.cell);
      if (!at) continue;
      const px = at[0] * W, py = TOP + at[1] * (H - TOP), h = SIGN_HEIGHT, w = (h * image.naturalWidth) / image.naturalHeight;
      g.save();
      g.globalAlpha = 0.8;
      g.strokeStyle = "rgba(0,0,0,.4)"; g.lineWidth = 0.25;
      g.beginPath(); g.moveTo(px, py - 4.4); g.lineTo(px, py); g.stroke(); // strek ned til stedet, som for navnene
      g.fillStyle = "#ffffff"; g.beginPath(); g.roundRect(px - w / 2 - 0.8, py - 4.4 - h - 1.4, w + 1.6, h + 1.4, 0.6); g.fill();
      g.drawImage(image, px - w / 2, py - 4.4 - h - 0.7, w, h);
      g.restore();
    }
  };
  const drawNames = () => {
    const [ex, ey, ez] = renderer.eye, cx = ex / terrain.cell, cy = ez / terrain.cell;
    drawSigns(cx, cy, ey);
    const boxes: { x: number; y: number; w: number; h: number; place: PlaceName; px: number; py: number; font: string; detail?: string }[] = [];
    // Skipsnavn (fra AIS) når vi er i nærheten: de nærmeste først, så de får plass før stedsnavnene.
    // Store skip ses lenger enn små. Skip som ikke har sendt navnet sitt ennå, får ikke skilt.
    const near = game.ships
      .filter((s) => s.name)
      .map((s) => ({ s, d: Math.hypot(s.x - cx, s.y - cy) * terrain.cell }))
      .filter(({ s, d }) => d < (s.lengthM > 100 ? 9000 : 5000))
      .sort((a, b) => a.d - b.d);
    let shipLabels = 0;
    for (const { s } of near) {
      // de seks nærmeste som faktisk er i bildet: skip bak kameraet skal ikke bruke opp plassene
      if (shipLabels >= MAX_SHIP_LABELS) break;
      // navnet står litt over overbygget; samme form som et stedsnavn, så sikt og utforming gjenbrukes
      const place: PlaceName = { name: s.name, x: s.x, y: s.y, z: Math.min(Math.max(s.lengthM * 0.13, 5), 28), size: 7, type: "skip", group: "skip" };
      const at = renderer.project(s.x * terrain.cell, place.z + 8, s.y * terrain.cell);
      if (!at || !inSight(terrain, cx, cy, ey, place)) continue;
      const px = at[0] * W, py = TOP + at[1] * (H - TOP), size = 2.9, font = `500 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      g.font = font;
      let w = g.measureText(s.name).width;
      if (s.detail) { g.font = DETAIL_FONT; w = Math.max(w, g.measureText(s.detail).width); }
      // med en linje til under navnet flyttes navnet opp, så linja får plass over streken ned til skipet
      const lift = s.detail ? 2.6 : 0;
      boxes.push({ x: px - w / 2 - 2, y: py - 6 - size - lift, w: w + 4, h: size + 3 + lift, place, px, py: py - lift, font, detail: s.detail });
      shipLabels++;
    }
    // Andre fly: de nærmeste i bildet, innen 20 km. Skiltet står over flyet, med type og høyde under kallesignalet.
    let flightLabels = 0;
    for (const a of [...game.traffic].sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy))) {
      if (flightLabels >= MAX_SHIP_LABELS || Math.hypot(a.x - cx, a.y - cy) * terrain.cell > 20000) break;
      const place: PlaceName = { name: a.name, x: a.x, y: a.y, z: a.alt, size: 7, type: "fly", group: "fly" };
      const at = renderer.project(a.x * terrain.cell, a.alt + 14, a.y * terrain.cell);
      if (!at || !inSight(terrain, cx, cy, ey, place)) continue;
      const px = at[0] * W, py = TOP + at[1] * (H - TOP), size = 2.9, font = `500 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      g.font = font;
      let w = g.measureText(a.name).width;
      g.font = DETAIL_FONT; w = Math.max(w, g.measureText(a.detail).width);
      boxes.push({ x: px - w / 2 - 2, y: py - 6 - size - 2.6, w: w + 4, h: size + 5.6, place, px, py: py - 2.6, font, detail: a.detail });
      flightLabels++;
    }
    // Standen flyet skal til, mens det takser: skilt over stedet, foran alle stedsnavn
    if (game.taxiPlan) {
      const st = game.taxiPlan.stand, z = Math.max(0, terrain.heightAt(st.at[0], st.at[1]));
      const at = renderer.project(st.at[0] * terrain.cell, z + 26, st.at[1] * terrain.cell);
      if (at) {
        const name = st.ref ? `STAND ${st.ref}` : "APRON", size = 3.4, font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
        g.font = font;
        const w = g.measureText(name).width, px = at[0] * W, py = TOP + at[1] * (H - TOP);
        boxes.unshift({ x: px - w / 2 - 2, y: py - 6 - size, w: w + 4, h: size + 3, place: { name, x: st.at[0], y: st.at[1], z, size: 12, type: "stand", group: "stand" }, px, py, font });
      }
    }
    for (const { place, distanceM } of candidates(terrain, cx, cy, ey)) {
      const at = renderer.project(place.x * terrain.cell, place.z + 20, place.y * terrain.cell);
      if (!at || !inSight(terrain, cx, cy, ey, place)) continue;
      const px = at[0] * W, py = TOP + at[1] * (H - TOP), near = distanceM < 2500 ? 1 : 0;
      const size = Math.min(3.9, 2.6 + (place.size - 5) * 0.17 + near * 0.25);
      const font = `${labelStyle(place).italic ? "italic " : ""}500 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      g.font = font;
      const w = g.measureText(place.name).width;
      boxes.push({ x: px - w / 2 - 2, y: py - 6 - size, w: w + 4, h: size + 3, place, px, py, font }); // luft rundt, så det blir færre navn
    }
    g.save();
    // Chrome legger tekst på hele piksler loddrett så lenge lerretet bare er skalert. Da rykker navnene én piksel om
    // gangen mens terrenget glir jevnt under dem. En umerkelig liten dreining om bildets midtpunkt (under én piksel
    // ute i kanten) slår av den avrundingen, så navnene følger terrenget.
    g.translate(W / 2, (TOP + H) / 2); g.rotate(0.0004); g.translate(-W / 2, -(TOP + H) / 2);
    g.textAlign = "center"; g.textBaseline = "alphabetic"; g.lineJoin = "round";
    // Dempet: liten, halvgjennomsiktig skrift med tynn skygge. Navnene skal kunne leses, ikke ta over bildet.
    g.globalAlpha = 0.63;
    for (const b of declutter(boxes, 16 + shipLabels + flightLabels)) {
      const { color } = labelStyle(b.place);
      g.strokeStyle = "rgba(0,0,0,.4)"; g.lineWidth = 0.25;
      const foot = b.detail ? b.py + 2.6 : b.py;
      g.beginPath(); g.moveTo(b.px, b.py - (b.detail ? 1.6 : 4.4)); g.lineTo(b.px, foot); g.stroke(); // strek ned til stedet
      g.font = b.font;
      g.strokeStyle = "rgba(0,0,0,.5)"; g.lineWidth = 0.6; g.strokeText(b.place.name, b.px, b.py - 5);
      g.fillStyle = color; g.fillText(b.place.name, b.px, b.py - 5);
      if (b.detail) {
        g.font = DETAIL_FONT;
        g.strokeStyle = "rgba(0,0,0,.5)"; g.lineWidth = 0.5; g.strokeText(b.detail, b.px, b.py - 2.3);
        g.fillStyle = color; g.fillText(b.detail, b.px, b.py - 2.3);
      }
    }
    g.restore();
  };

  // Bilde til deling (K eller Photo-knappen). Tas i samme ramme som 3D-bildet tegnes, ellers er WebGL-lerretet tomt.
  // I den ramma tegnes ikke skjermtekst, hjørnekart og meldinger: bildet skal vise utsikten, ikke måleverdiene.
  let photoWanted = false, photoFrame = false;
  const wantPhoto = () => { photoWanted = true; };
  window.addEventListener("keydown", (e) => { if (e.code === "KeyK" && !e.repeat && !isTyping(e)) wantPhoto(); });
  document.getElementById("tPhoto")!.onclick = wantPhoto;
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("photo")) setTimeout(wantPhoto, 1500);
  const message = (y: number) => { if (!photoFrame) drawMessage(g, game, y); };

  const frame = (dt: number): void => {
    game.step(dt);
    const shipNow = performance.now() / 1000;
    const ships = fleet.list.map((s) => {
      const [x, y] = position(s, terrain, shipNow);
      return { x, y, heading: s.heading, lengthM: s.lengthM, beamM: s.beamM, speed: s.speed, color: shipColor(s.type), name: s.name,
        // linje to på skiltet: type og destinasjon, det som finnes av dem
        detail: [shipKind(s.type), s.dest && `→ ${s.dest}`].filter(Boolean).join(" ") };
    });
    renderer.setShips(ships);
    game.ships = ships; // samme liste til oversiktskartet
    const ownGround = groundVelocity(game.P, game.wind.vector); // TCAS regner med kurs og fart over bakken
    const own = { x: game.P.x, y: game.P.y, alt: game.P.alt, course: ownGround.track, speed: ownGround.speed, climb: verticalSpeed(game.P) };
    const others = traffic.list.map((a) => {
      const [x, y, alt] = locate(a, terrain, shipNow);
      // linje to på skiltet: flytype og høyde i fot (som i luftfarten), eller at flyet står på bakken
      const detail = [a.type, a.ground ? "on ground" : `${Math.round((alt * 3.28084) / 100) * 100} ft`].filter(Boolean).join(" · ");
      // TCAS varsler bare når vi selv flyr; ellers er trafikken bare nær eller fjern
      const seen = tcasLevel(own, { x, y, alt, course: a.course, speed: a.speed, climb: a.climb, ground: a.ground }, terrain.cell);
      const tcas = seen === "advisory" && game.P.state !== "fly" ? "proximate" : seen;
      return { id: a.id, x, y, alt, heading: a.course, climb: a.climb, ...aircraftSize(a.cat), name: a.flight || a.type || "aircraft", detail, tcas };
    });
    renderer.setTraffic(others);
    if (game.taxiPlan !== shownPlan) { shownPlan = game.taxiPlan; renderer.setTaxiRoute(shownPlan); }
    game.traffic = others;
    showInfo();
    audio.update(game, terrain);
    const today = osloTime(game.time);
    renderer.figureState = { on: game.figures, wind: game.wind.vector, month: today.month, day: today.day };
    if (game.replay) renderer.render(game.replay.plane, "replay", game.env, game.replay.spectator);
    else { renderer.towerZoom = game.towerZoom; renderer.render(game.P, game.cam, game.env); }
    if (game.flightLog !== savedLog) {
      savedLog = game.flightLog;
      if (import.meta.env.DEV && savedLog) void fetch("/__flightlog", { method: "POST", body: JSON.stringify(savedLog) }).catch(() => {});
    }
    const landed = game.P.state === "landed";
    if (landed && !wasLanded) {
      // WebGL-bildet må kopieres i samme ramme som det ble tegnet, ellers er det tomt
      landingPhoto = document.createElement("canvas");
      landingPhoto.width = glCanvas.width;
      landingPhoto.height = glCanvas.height;
      landingPhoto.getContext("2d")!.drawImage(glCanvas, 0, 0);
    }
    if (landed && game.P.parked && game.P.touchdown && game.approach.autopilot) {
      // Autopiloten får karakter, men ikke diplom: det er for den som fløy selv
      const grade = gradeLanding(game.P.touchdown);
      // Kjørte piloten seg fast under taksingen etterpå, skal den beskjeden stå: ellers ser flyet bare ut til å ha stanset
      const stars = `${"★".repeat(grade.stars)}${"☆".repeat(5 - grade.stars)}`;
      // etter taksing: kort, så linja får plass ved siden av hjørnekartet
      game.msg.text = game.taxiResult ? `${game.taxiResult} Autopilot landing ${stars}. Press R.`
        : `${game.P.stuck ? "Stuck in the grass. " : ""}Autopilot: ${stars} ${grade.title}. Press R and beat it.`;
      game.msg.t = 1;
    } else if (landed && game.P.parked && game.P.touchdown && !diploma.open && !diplomaShown && !clean && landingPhoto && game.parkedS >= (game.parkedShort ? PARKED_SHORT_WAIT_S : 0)) {
      // Parkert et stykke fra standen: diplomet venter litt, så piloten rekker å slippe bremsen og kjøre helt fram
      diploma.show({ airportName: chosen.name, icao: chosen.icao, touchdown: game.P.touchdown, taxi: game.taxiResult, taxiDone: game.taxiDone }, landingPhoto, () => { diploma.hide(); game.restart(); });
      diplomaShown = true;
    }
    // Parkeringsbremsen er sluppet igjen (Enter): diplomet legges bort, og kommer tilbake når flyet parkeres på nytt
    if (landed && !game.P.parked && diplomaShown) { diploma.hide(); diplomaShown = false; }
    if (!landed) diplomaShown = false;
    wasLanded = landed;
    g.setTransform(scale, 0, 0, scale, 0, -TOP * scale); // logisk TOP ligger i overkanten av vinduet
    g.clearRect(0, TOP, W, H - TOP);
    if (clean) return;
    if (showNames && !game.replay) drawNames();
    if (game.replay) {
      // reprisen vises uten instrumenter: bare merket og hva som skjedde
      g.font = "bold 9px ui-monospace, Menlo, Consolas, monospace"; g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(6, TOP + 6, 50, 14);
      g.fillStyle = Math.floor(performance.now() / 500) % 2 ? "#ff4a3d" : "#ffffff"; g.fillText("● REPLAY", 10, TOP + 16.5);
      game.msg.t = 1; // meldingen om hva som skjedde står gjennom hele reprisen
      drawMessage(g, game, TOP + 34);
      return;
    }
    if (game.autopilot) {
      g.font = "bold 5px ui-monospace, Menlo, Consolas, monospace"; g.textAlign = "center"; g.textBaseline = "alphabetic";
      g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(W / 2 - 9, TOP + 9.5, 18, 7);
      g.fillStyle = "#5dff8a"; g.fillText("AP", W / 2, TOP + 15);
    }
    if (game.cam === "tower") {
      drawTower(g, terrain, map, game, towerView(terrain, game.P, game.towerZoom));
      message(TOP + 20);
    } else if (game.cam === "cockpit" && game.look !== "forward") {
      // blikket er løftet eller senket: panelet fyller vinduet, og piloten ser ikke ut
      if (game.look === "up") drawOverhead(g, game); else drawPedestal(g, game, terrain);
      message(TOP + 20);
    } else if (game.cam === "cockpit") {
      drawPanel(g, terrain, game);
      // Et ekte fly har ikke dette kartet, men uten det er det vanskelig å finne flyplassen
      if (!photoFrame) drawCornerMap(g, terrain, map, game, 16);
      message(TOP + 20);
    } else if (!photoFrame) {
      drawHud(g, terrain, map, game);
    }
  };
  runLoop((dt) => {
    photoFrame = photoWanted;
    photoWanted = false;
    frame(dt);
    if (!photoFrame) return;
    photoFrame = false;
    const info = snapshotInfo(terrain, chosen, game.replay ? game.replay.plane : game.P, game.time);
    const photo = composeSnapshot(clean ? [glCanvas] : [glCanvas, overlay], glCanvas.width, glCanvas.height, info);
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("photo")) {
      // ?photo i utviklingsmodus: ta bildet av seg selv og vis det over siden, så det kan kontrolleres i et skjermbilde
      photo.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:99";
      document.body.append(photo);
      return;
    }
    void deliverSnapshot(photo, info).then(
      (how) => { if (how === "downloaded") { game.msg.text = "Photo saved to your downloads"; game.msg.t = 2.5; } },
      () => { game.msg.text = "Could not make the photo"; game.msg.t = 2.5; },
    );
  });
}

main().catch((err) => {
  document.getElementById("fullscreen")!.onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };
  document.getElementById("info")!.textContent = `Error: ${err.message}. Have you run the pipeline (uv run flypipe build ${area})?`;
  throw err;
});
