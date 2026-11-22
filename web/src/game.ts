/* Spilltilstand, klokke og inndata. */
import { autobrakeFor, autopilot, steerTo } from "./autopilot";
import { startTime } from "./clock";
import { gradeLanding } from "./diploma";
import { type FlightLog, FlightLogger } from "./flightlog";
import { type Keys, moveFlaps, park, setAutobrake, softStick, TAXI_ENTRY, startApproach, toggleGear, toggleSpeedBrake, update, type Wind, windFrom } from "./physics";
import { Recorder, REPLAY_HOLD } from "./replay";
import { newPlane, type Plane } from "./plane";
import { clock, type Sight, sightsFrom, visitSights } from "./sights";
import { type SkyState, skyState } from "./sky";
import { sunPosition } from "./sun";
import { buildTaxiGraph, chooseStand, lastExitM, planTaxi, type TaxiGraph, type TaxiPlan } from "./taxiRoute";
import type { TcasLevel } from "./tcas";
import { TOWER_ZOOMS } from "./tower";
import type { Airport, Terrain } from "./terrain";

/** Utvendig kamera følger flyet bakfra; cockpit ser ut gjennom frontruta; tårn ser flyet fra kontrolltårnet.
 *  «replay» velges ikke av spilleren: det er reprisen etter en krasj, sett fra et fast punkt. */
export type Camera = "external" | "cockpit" | "tower" | "replay";
const CAMERAS: Camera[] = ["external", "cockpit", "tower"];

/** Reprisen som spilles nå: flyet slik det var, og hvor kameraet står. */
export interface Replay {
  plane: Plane;
  spectator: [number, number, number];
}

/** Noe på instrumentpanelet som kan betjenes med mus eller finger (se panelHit i panel.ts). */
export type PanelControl =
  | { kind: "gear" } | { kind: "speedBrake" } | { kind: "autopilot" } | { kind: "flightDirector" }
  /** Rekkevidden på ND (neste trinn), og terrengbildet på ND av/på. */
  | { kind: "ndRange" } | { kind: "ndTerrain" } | { kind: "flightPathVector" }
  /** På overheadpanelet og midtkonsollen: setebeltebryteren, TERR på GPWS-panelet, TCAS-velgeren, armering av
   *  bakkespoilerne, og siden SD skal vise (samme tast en gang til gir automatisk valg igjen). */
  /** Kikkerten i tårnet: ett trinn inn (1) eller ut (-1), eller neste trinn rundt (0). */
  | { kind: "towerZoom"; step: number }
  | { kind: "parkBrake" } | { kind: "seatBelts" } | { kind: "gpwsTerr" } | { kind: "tcasMode" } | { kind: "spoilersArm" } | { kind: "sdPage"; page: "eng" | "wheel" }
  /** Autobremsen: 1 = LO, 2 = MED, 3 = MAX. */
  | { kind: "autobrake"; level: number }
  /** Klaffspaken settes i stilling 0-4. */
  | { kind: "flaps"; cfg: number }
  /** Gasshåndtakene settes i stilling 0-1. */
  | { kind: "thrust"; thr: number };

export interface Message {
  text: string;
  t: number;
}

export interface Environment {
  /** Solas retning i rutenettet (radianer, 0 = rutenett-nord, med klokka) og høyde (radianer). */
  sunAzimuth: number;
  sunElevation: number;
  sky: SkyState;
}

export interface Game {
  P: Plane;
  airport: Airport;
  msg: Message;
  cam: Camera;
  /** Spillklokka, UTC i ms. Går i sanntid; Q/E stiller den en halvtime bakover/framover. */
  time: number;
  env: Environment;
  /** Gjeldende innflyging: løpenummer (øker for hver ny), banen det flys mot, og tiden flyet har vært i lufta (s). */
  approach: { count: number; ident: string; autopilot: boolean; platformFt: number; elapsedS: number };
  /** Det autopiloten flyr etter nå (fart i kt, sann kurs i grader), eller null når den er av. Vises på FCU. */
  apTarget: { speedKt: number; courseTrueDeg: number } | null;
  /** Flight director (D slår den av og på): stillingen autopiloten ville holdt nå, vist som to grønne streker på PFD
   *  som piloten kan fly etter. `fd` er null når den er av, eller når autopiloten ikke kunne landet herfra. */
  flightDirector: boolean;
  fd: { pitch: number; bank: number } | null;
  /** Hvor piloten ser i cockpit: fram mot instrumentpanelet, opp på overheadpanelet (U) eller ned på midtkonsollen (J). */
  look: "forward" | "up" | "down";
  /** Brytere på overheadpanelet og midtkonsollen som virker: setebelteskiltet (SIGNS i landingsmemoet), terrengvarselet,
   *  TCAS i beredskap (da vises ingen trafikk), og hvilken side SD viser («auto» følger understellet). */
  sys: { seatBelts: boolean; gpwsTerr: boolean; tcasStandby: boolean; sdPage: "auto" | "eng" | "wheel" };
  /** Etter landing: standen flyet har fått og ruta dit fra der flyet er nå (fornyes mens flyet takser), eller null
   *  når flyplassen ikke har stands som kan nås. `taxiResult` er hvordan det gikk, når flyet står: til diplomet. */
  taxiPlan: TaxiPlan | null;
  taxiResult: string | null;
  /** Hvor lenge flyet har stått parkert (s), og om det står et stykke fra standen. Da venter diplomet noen sekunder,
   *  så piloten rekker å slippe bremsen og kjøre helt fram. */
  parkedS: number;
  parkedShort: boolean;
  /** Takseklareringer tårnet har gitt (teller opp for hver), og om den siste ba flyet snu på banen. Lyden leser den opp. */
  taxiCall: { count: number; turnAround: boolean };
  /** Takset helt fram til en nummerert stand: standen og tiden fra landing (s). Til diplomet og delingslenka. */
  taxiDone: { stand: string; seconds: number } | null;
  /** Kikkerten i tårnkameraet: forstørrelsen (1, 2, 4 eller 8). Pluss og minus, musehjulet eller et trykk på kikkerten. */
  towerZoom: number;
  /** Morofigurene (figures.ts) vises. L slår dem av og på. */
  figures: boolean;
  /** Fartsvektoren («fuglen») på PFD: viser hvor flyet er på vei over bakken. P slår den av og på. */
  flightPathVector: boolean;
  /** Vinden: hvor den kommer fra (sann retning i grader) og middelvinden i knop, og det samme som fart i rutenettet.
   *  `source` sier hvor den kom fra: flyplassens METAR, adressen (`?wind=240/15`) eller ingen (vindstille).
   *  Jevn over hele kartet og hele innflygingen; kastene (`gustKt`) leses opp av tårnet, men flymodellen bruker dem ikke. */
  wind: { fromTrueDeg: number; kt: number; gustKt: number | null; vector: Wind; source: "none" | "url" | "metar"; metar: string | null };
  /** Navigasjonsdisplayet: rekkevidden i NM (Z blar 10, 20, 40) og om terrenget tegnes (X). */
  nd: { rangeNm: number; terrain: boolean };
  /** Sightseeing: signalbyggene i utsnittet som kan finnes ved å fly over dem (tom liste der det er for få), hvor
   *  mange som er funnet på denne turen, og tiden da det siste ble funnet (s fra start), eller null. */
  sights: { list: Sight[]; found: number; doneS: number | null; photos: number };
  /** Stedene som var med i et bilde spilleren tok nå: de som er nye telles, og spilleren får beskjed. */
  photographed(seen: Sight[]): void;
  /** Punktet spilleren har trykket på i oversiktskartet (rutenett), eller null. Flyet svinger dit av seg selv;
   *  høyde og fart styrer piloten fortsatt. Slippes når flyet er framme, eller når piloten svinger selv. */
  directTo: { x: number; y: number } | null;
  /** Sett kursen mot et punkt i rutenettet (trykk i oversiktskartet). */
  flyTo(x: number, y: number): void;
  /** Autopiloten flyr (A slår den av og på). `approach.autopilot` husker om den har vært brukt på denne innflygingen. */
  autopilot: boolean;
  /** Ett steg: klokke, fysikk, meldinger og ny innflyging når det trengs. */
  step(dt: number): void;
  /** Start en ny innflyging til samme bane. */
  restart(): void;
  /** Betjen en spake eller knapp på instrumentpanelet. Gjør det samme som tasten for den. */
  control(c: PanelControl): void;
  /** Satt mens reprisen etter en krasj spilles av. Fysikken står stille imens. */
  replay: Replay | null;
  /** Skipene akkurat nå, til kartet: posisjon i rutenettet, rutenettkurs (rad) og fart (m/s). Settes av main.ts. */
  ships: { x: number; y: number; heading: number; speed: number; name: string; lengthM: number; detail: string }[];
  /** Andre fly akkurat nå, til kart, skilt og ND: posisjon i rutenettet, høyde (m), rutenettkurs, stigning (m/s),
   *  kallesignal og linje to, og hvordan TCAS ser flyet (se tcas.ts). */
  traffic: { id: string; x: number; y: number; alt: number; heading: number; climb: number; name: string; detail: string; tcas: TcasLevel }[];
  /** Loggen fra forrige innflyging som ble avsluttet (landing, krasj eller avbrutt), eller null. */
  flightLog: FlightLog | null;
}

const TIME_STEP_MS = 30 * 60 * 1000;
const DIRECT_REACHED_M = 400; // så nær punktet i kartet regnes flyet som framme
/** Rekkeviddene ND kan stå på (NM). Flyet har også 80, 160 og 320, men kartutsnittet er bare 14 NM bredt. */
export const ND_RANGES = [10, 20, 40];

/** Vinden på flyplassen fra værtjenesten (web/public/weather): siste METAR, og vinden lest ut av den. */
export interface Weather { metar: string | null; wind: { dir: number | null; kt: number; gust: number | null } | null }

/** `weather` er flyplassens vind akkurat nå, når den er hentet. `?wind=` i adressen går foran. */
export function createGame(terrain: Terrain, focus: HTMLElement, weather: Weather | null = null): Game {
  const airport = terrain.meta.airports[0];
  // Alle baneender på flyplassen, i den rekkefølgen T blar gjennom dem
  const ends = airport.runways.flatMap((rw) => rw.ends);
  const runwayOf = (end: (typeof ends)[number]) => airport.runways.find((rw) => rw.ends.includes(end))!;
  const params = new URLSearchParams(location.search);
  // Vinden: fra adressen («?wind=240/15», sann retning den kommer fra og knop, høyst 50; «?wind=0/0» er vindstille),
  // ellers fra flyplassens siste METAR. Variabel vind (VRB) har ingen retning og regnes som vindstille.
  // Retninger fra kilder er sanne; rutenettet er dreid med meridiankonvergensen.
  const windArg = /^(\d{1,3})\/(\d{1,2})$/.exec(params.get("wind") ?? ""), observed = !windArg && weather?.wind && weather.wind.dir !== null ? weather.wind : null;
  const windKt = windArg ? Math.min(50, Number(windArg[2])) : observed ? Math.min(60, observed.kt) : 0;
  const windDeg = windKt > 0 ? (windArg ? Number(windArg[1]) : observed!.dir!) % 360 : 0;
  const wind: Game["wind"] = {
    fromTrueDeg: windDeg, kt: windKt, gustKt: observed?.gust ?? null,
    vector: windFrom(((windDeg - terrain.meta.gridConvergenceDeg) * Math.PI) / 180, windKt / 1.943844),
    source: windArg ? "url" : weather?.wind ? "metar" : "none", metar: windArg ? null : weather?.metar ?? null,
  };
  // Banen: den som er bedt om, ellers den med mest motvind (som tårnet ville valgt), ellers den første
  const headwind = (e: (typeof ends)[number]) => Math.cos(((windDeg - e.headingTrueDeg) * Math.PI) / 180);
  const intoWind = windKt >= 3 ? ends.indexOf([...ends].sort((p, q) => headwind(q) - headwind(p))[0]) : 0;
  let endIdx = params.has("rwy") ? Math.max(0, ends.findIndex((e) => e.ident === params.get("rwy"))) : intoWind;
  // Sightseeing (?tour, eller T forbi siste bane): start over byen i stedet for på innflygingen, og land på turens bane
  const tours = airport.tours ?? [];
  let tourIdx = params.has("tour") && tours.length ? 0 : -1;
  if (tourIdx >= 0) endIdx = Math.max(0, ends.findIndex((e) => e.ident === tours[tourIdx].runway));
  const P = newPlane();
  const K: Keys = {};
  const held: Record<string, number> = {}; // hvor lenge piltastene har vært holdt, som utslag 0-1
  const msg: Message = { text: "", t: 0 };
  const say = (text: string, t = 3) => { msg.text = text; msg.t = t; };
  const approach = { count: 0, ident: ends[endIdx].ident, autopilot: false, platformFt: 0, elapsedS: 0 };
  // Tar piloten i stikka eller gassen, slipper autopiloten (som i flyet)
  const MANUAL = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyW", "KeyS"];
  const setAutopilot = (on: boolean, why = "") => {
    if (on && P.state !== "fly") return;
    game.autopilot = on;
    if (on) game.directTo = null;
    if (on) approach.autopilot = true;
    say(on ? "Autopilot on" : `Autopilot off${why}`, 2.5);
  };
  const toggleFlightDirector = () => { game.flightDirector = !game.flightDirector; say(`Flight director ${game.flightDirector ? "on" : "off"}`, 2); };
  const toggleBird = () => { game.flightPathVector = !game.flightPathVector; say(`Flight path vector ${game.flightPathVector ? "on" : "off"}`, 2); };
  const zoomTower = (step: number) => {
    if (game.cam !== "tower") return;
    const i = TOWER_ZOOMS.indexOf(game.towerZoom), next = step === 0 ? (i + 1) % TOWER_ZOOMS.length : Math.min(TOWER_ZOOMS.length - 1, Math.max(0, i + step));
    if (TOWER_ZOOMS[next] === game.towerZoom) return;
    game.towerZoom = TOWER_ZOOMS[next];
    say(game.towerZoom === 1 ? "Binoculars down" : `Binoculars ${game.towerZoom}x`, 1.5);
  };
  const nextRange = () => { game.nd.rangeNm = ND_RANGES[(ND_RANGES.indexOf(game.nd.rangeNm) + 1) % ND_RANGES.length]; say(`ND range ${game.nd.rangeNm} NM`, 1.5); };
  const toggleTerrain = () => { game.nd.terrain = !game.nd.terrain; say(`Terrain on ND ${game.nd.terrain ? "on" : "off"}`, 1.5); };
  /** Kontrollene dette steget: pilotens taster, eller autopilotens utslag når den flyr. */
  const controls = (dt: number): Keys => {
    const manual = softStick(held, K, dt);
    game.apTarget = null;
    game.fd = null;
    if (game.flightDirector && P.state === "fly") {
      const want = autopilot(P, terrain, runwayOf(ends[endIdx]), ends[endIdx], wind.vector);
      if (!("unable" in want)) game.fd = { pitch: want.pitch, bank: want.bank };
    }
    if (game.directTo && P.state !== "fly") game.directTo = null;
    if (game.directTo) {
      const to = steerTo(P, game.directTo.x, game.directTo.y, terrain.cell);
      if (K.ArrowLeft || K.ArrowRight) { game.directTo = null; say("Map heading cancelled", 2); }
      else if (to.distanceM < DIRECT_REACHED_M) { game.directTo = null; say("Reached the point on the map", 2.5); }
      else return { ...manual, ArrowRight: Math.max(0, to.right), ArrowLeft: Math.max(0, -to.right) };
    }
    if (!game.autopilot || P.state !== "fly") return manual;
    if (MANUAL.some((k) => K[k])) { setAutopilot(false); return manual; }
    const cmd = autopilot(P, terrain, runwayOf(ends[endIdx]), ends[endIdx], wind.vector);
    if ("unable" in cmd) { setAutopilot(false, `: ${cmd.unable}`); return manual; }
    if (cmd.gearDown !== P.gearDown) toggleGear(P, say);
    if (cmd.flapCfg !== P.flapCfg) moveFlaps(P, Math.sign(cmd.flapCfg - P.flapCfg), say);
    if (Math.max(cmd.autobrake, plannedAutobrake) !== P.autobrake) setAutobrake(P, Math.max(cmd.autobrake, plannedAutobrake), say);
    game.apTarget = { speedKt: cmd.speedKt, courseTrueDeg: ends[endIdx].headingTrueDeg };
    return cmd.keys;
  };
  const recorder = new Recorder(), logger = new FlightLogger(terrain, airport);
  // Taksing til en stand: nettet av taksebaner bygges én gang; standen velges ved landing og ruta fornyes underveis
  const taxiGraph: TaxiGraph | null = buildTaxiGraph(terrain, airport);
  let stand: TaxiGraph["stands"][number] | null = null, taxiS = 0, replanIn = 0, toldRoute = false, plannedAutobrake = 2, sawParked = false;
  const STAND_REACHED_M = 25;
  /** Etter landing: velg stand, hold ruta fersk, si fra om den, og avgjør hvordan taksingen endte. */
  const taxiStep = (dt: number): void => {
    if (P.state !== "landed" || !taxiGraph) return;
    if (!stand) stand = chooseStand(taxiGraph, airport, approach.count);
    if (!stand) return;
    const name = stand.ref ? `stand ${stand.ref}` : "the apron", toStandM = Math.hypot(P.x - stand.at[0], P.y - stand.at[1]) * terrain.cell;
    if (!P.parked) {
      taxiS += dt;
      replanIn -= dt;
      if (replanIn <= 0) { replanIn = 1.5; game.taxiPlan = planTaxi(terrain, taxiGraph, P.x, P.y, stand, P.hdg); }
      // Tårnet gir standen og ruta når flyet er nede i taksefart. SYNTETISK: se taxiRoute.ts.
      if (!toldRoute && game.taxiPlan && P.spd < TAXI_ENTRY) {
        toldRoute = true;
        // Går ruta bakover langs rullebanen, må flyet snu der det står: det går bare i lav fart
        const [nx, ny] = game.taxiPlan.route[Math.min(2, game.taxiPlan.route.length - 1)];
        const back = (nx - P.x) * Math.sin(P.hdg) - (ny - P.y) * Math.cos(P.hdg) < 0;
        game.taxiCall = { count: game.taxiCall.count + 1, turnAround: back };
        say(`Tower: ${back ? "turn around on the runway (slowly, under 10 kt), " : ""}taxi to ${name}${game.taxiPlan.via.length ? ` via ${game.taxiPlan.via.join(", ")}` : ""}.${P.taxi ? "" : " Press W."}`, 10);
      }
      // framme: flyet står stille på standen. Parkeringsbremsen settes av seg selv.
      if (P.taxi && P.spd === 0 && toStandM < STAND_REACHED_M) park(P, say);
    }
    // Parkert siden sist: også når bremsen ble satt med Enter eller på panelet, som skjer mellom to steg
    const justParked = P.parked && !sawParked, released = !P.parked && sawParked;
    sawParked = P.parked;
    game.parkedS = P.parked ? game.parkedS + dt : 0;
    // bremsen er sluppet igjen: turen fortsetter, og resultatet gjelder ikke lenger
    if (released) { game.taxiResult = game.taxiDone = null; game.parkedShort = false; replanIn = 0; }
    if (justParked && P.taxi) {
      const time = `${Math.floor(taxiS / 60)}:${String(Math.floor(taxiS % 60)).padStart(2, "0")}`;
      game.taxiResult = P.stuck ? `Got stuck in the grass on the way to ${name}.`
        : toStandM < STAND_REACHED_M ? `Taxied to ${name} in ${time}.`
        : `Parked ${Math.round(toStandM / 10) * 10} m from ${name}.`;
      if (!P.stuck && toStandM < STAND_REACHED_M && stand.ref) game.taxiDone = { stand: stand.ref, seconds: Math.floor(taxiS) };
      game.parkedShort = !P.stuck && toStandM >= STAND_REACHED_M;
      if (!P.stuck) say(toStandM < STAND_REACHED_M ? `Parked at ${name}. Welcome to ${airport.name.split(",").pop()!.trim()}!` : `${game.taxiResult} Enter releases the brake.`, 6);
      game.taxiPlan = null;
    }
  };
  let replayTime = 0;
  const reset = () => {
    // en innflyging som avbrytes i lufta logges også, hvis den varte lenge nok til å si noe
    const aborted = P.state === "fly" ? logger.finish(P, "", null, game.autopilot) : null;
    if (aborted && aborted.samples.length > 20) game.flightLog = aborted;
    recorder.clear();
    game.replay = null;
    game.taxiPlan = game.taxiResult = game.taxiDone = null;
    game.parkedS = 0; game.parkedShort = false;
    stand = null; taxiS = 0; replanIn = 0; toldRoute = false; sawParked = false;
    game.autopilot = approach.autopilot = false;
    game.directTo = null;
    for (const s of game.sights.list) s.found = s.photographed = false;
    game.sights.found = game.sights.photos = 0; game.sights.doneS = null;
    startApproach(P, terrain, ends[endIdx]);
    const tour = tourIdx >= 0 ? tours[tourIdx] : null;
    if (tour) Object.assign(P, { x: tour.x, y: tour.y, alt: tour.altitudeM, hdg: ((tour.headingTrueDeg - terrain.meta.gridConvergenceDeg) * Math.PI) / 180, pitch: 0 });
    // MED, eller MAX på korte baner og der MED ville rullet forbi siste avkjøring. Piloten kan endre den (1, 2, 3)
    plannedAutobrake = P.autobrake = autobrakeFor(runwayOf(ends[endIdx]), ends[endIdx], taxiGraph && lastExitM(taxiGraph, runwayOf(ends[endIdx]), ends[endIdx]));
    logger.start(P, runwayOf(ends[endIdx]), ends[endIdx], new Date());
    approach.count++;
    approach.elapsedS = 0;
    approach.ident = ends[endIdx].ident;
    approach.platformFt = Math.round((P.alt * 3.28084) / 100) * 100; // høyden innflygingen starter i, til FCU
    say(tour ? `${tour.name} tour, then land on runway ${ends[endIdx].ident}` : `Approach ${airport.icao} runway ${ends[endIdx].ident}`, tour ? 5 : 3);
  };
  const environment = (time: number): Environment => {
    // Sola regnes for flyplassen; over 25 km er forskjellen ubetydelig
    const sun = sunPosition(time, airport.arp.lat, airport.arp.lon);
    return {
      // sann asimut -> rutenett: rutenett = sann - meridiankonvergens
      sunAzimuth: ((sun.azimuthDeg - terrain.meta.gridConvergenceDeg) * Math.PI) / 180,
      sunElevation: (sun.elevationDeg * Math.PI) / 180,
      sky: skyState(sun.elevationDeg),
    };
  };
  const time = startTime(params, Date.now());
  const game: Game = {
    P, airport, msg, time, approach,
    autopilot: false,
    flightDirector: true,
    fd: null,
    nd: { rangeNm: ND_RANGES[0], terrain: true },
    flightPathVector: false,
    figures: params.get("fun") !== "0", // ?fun=0: start uten morofigurene
    towerZoom: TOWER_ZOOMS.includes(Number(params.get("zoom"))) ? Number(params.get("zoom")) : 1, // ?zoom=4: start med kikkerten
    taxiPlan: null,
    taxiResult: null,
    parkedS: 0,
    parkedShort: false,
    taxiCall: { count: 0, turnAround: false },
    taxiDone: null,
    look: params.get("look") === "up" ? "up" : params.get("look") === "down" ? "down" : "forward",
    sys: { seatBelts: true, gpwsTerr: true, tcasStandby: false, sdPage: "auto" },
    wind,
    apTarget: null,
    directTo: null,
    sights: { list: sightsFrom(terrain.names), found: 0, doneS: null, photos: 0 },
    photographed(seen) {
      const fresh = seen.filter((s) => !s.photographed), total = game.sights.list.length;
      if (!fresh.length) return;
      for (const s of fresh) s.photographed = true;
      game.sights.photos += fresh.length;
      say(game.sights.photos === total ? `All ${total} sights photographed!` : `Photographed ${fresh.map((s) => s.name).join(" and ")} (${game.sights.photos} of ${total})`, 5);
    },
    flyTo(x, y) {
      if (P.state !== "fly" || game.replay) return;
      if (game.autopilot) setAutopilot(false);
      game.directTo = { x: Math.min(terrain.width, Math.max(0, x)), y: Math.min(terrain.height, Math.max(0, y)) };
      say("Turning to the point on the map", 2.5);
    },
    ships: [],
    traffic: [],
    flightLog: null,
    cam: CAMERAS.find((c) => c === params.get("cam")) ?? "external",
    env: environment(time),
    restart: () => reset(),
    control(c) {
      if (c.kind === "gear") toggleGear(P, say);
      else if (c.kind === "speedBrake") toggleSpeedBrake(P, say);
      else if (c.kind === "autopilot") setAutopilot(!game.autopilot);
      else if (c.kind === "flightDirector") toggleFlightDirector();
      else if (c.kind === "ndRange") nextRange();
      else if (c.kind === "ndTerrain") toggleTerrain();
      else if (c.kind === "flightPathVector") toggleBird();
      else if (c.kind === "parkBrake") park(P, say);
      else if (c.kind === "towerZoom") zoomTower(c.step);
      else if (c.kind === "seatBelts") { game.sys.seatBelts = !game.sys.seatBelts; say(`Seat belt signs ${game.sys.seatBelts ? "on" : "off"}`, 1.5); }
      else if (c.kind === "gpwsTerr") { game.sys.gpwsTerr = !game.sys.gpwsTerr; say(`Terrain warning ${game.sys.gpwsTerr ? "on" : "off"}`, 1.5); }
      else if (c.kind === "tcasMode") { game.sys.tcasStandby = !game.sys.tcasStandby; say(`TCAS ${game.sys.tcasStandby ? "standby" : "TA"}`, 1.5); }
      else if (c.kind === "spoilersArm") { P.spoilersArmed = !P.spoilersArmed; say(`Ground spoilers ${P.spoilersArmed ? "armed" : "not armed"}`, 1.5); }
      else if (c.kind === "sdPage") game.sys.sdPage = game.sys.sdPage === c.page ? "auto" : c.page;
      else if (c.kind === "autobrake") setAutobrake(P, c.level, say);
      else if (c.kind === "flaps") for (let i = Math.abs(c.cfg - P.flapCfg), step = Math.sign(c.cfg - P.flapCfg); i > 0; i--) moveFlaps(P, step, say);
      else if (P.state === "fly") {
        // tar piloten i gasshåndtakene, slipper autopiloten, som når W eller S trykkes
        if (game.autopilot) setAutopilot(false);
        P.thr = Math.min(1, Math.max(0, c.thr));
      }
    },
    replay: null,
    step(dt) {
      game.time += dt * 1000;
      game.env = environment(game.time);
      if (game.replay) {
        // reprise: spill av opptaket, la siste bilde stå litt, og start så på nytt
        replayTime += dt;
        recorder.sample(replayTime, game.replay.plane);
        if (replayTime > recorder.duration + REPLAY_HOLD) reset();
        return;
      }
      if (msg.t > 0) msg.t -= dt;
      const wasFlying = P.state === "fly";
      if (wasFlying) approach.elapsedS += dt; // stoppeklokka på panelet: står når flyet har landet
      const again = update(P, terrain, airport, controls(dt), dt, say, wind.vector);
      taxiStep(dt);
      if (wasFlying && P.state === "fly") {
        const sights = game.sights;
        for (const s of visitSights(sights.list, P.x, P.y, P.alt, terrain.cell)) {
          sights.found++;
          if (sights.found < sights.list.length) say(`Found ${s.name} (${sights.found} of ${sights.list.length})`, 3.5);
          else { sights.doneS = approach.elapsedS; say(`Found ${s.name}: all ${sights.found} sights in ${clock(sights.doneS)}. Now land!`, 7); }
        }
      }
      if (wasFlying) logger.step(P, dt, game.autopilot);
      if (wasFlying && P.state !== "fly") game.flightLog = logger.finish(P, msg.text, P.touchdown && gradeLanding(P.touchdown), game.autopilot) ?? game.flightLog;
      if (P.state !== "fly") game.autopilot = false;
      if (wasFlying) recorder.record(P, dt); // også steget der det smalt, så reprisen ender i sammenstøtet
      if (wasFlying && P.state === "crash" && recorder.duration > 0.5) {
        replayTime = 0;
        game.replay = { plane: { ...P, state: "fly" }, spectator: recorder.spectator(terrain) };
        recorder.sample(0, game.replay.plane);
      } else if (again) reset();
    },
  };
  const toggleCam = () => { game.cam = CAMERAS[(CAMERAS.indexOf(game.cam) + 1) % CAMERAS.length]; game.look = "forward"; };
  /** Se opp eller ned i cockpit. Samme tast en gang til ser fram igjen. */
  const lookTo = (dir: "up" | "down") => { if (game.cam === "cockpit") game.look = game.look === dir ? "forward" : dir; };

  addEventListener("keydown", (e) => {
    if (isTyping(e)) return; // navnefeltet på diplomet
    K[e.code] = true;
    if (e.code === "KeyQ") game.time -= TIME_STEP_MS;
    if (e.code === "KeyE") game.time += TIME_STEP_MS;
    if (e.repeat) return;
    if (e.code === "KeyC") toggleCam();
    if (e.code === "KeyR") reset();
    if (e.code === "KeyT") {
      // neste bane; etter den siste kommer turene, og så første bane igjen
      if (tourIdx >= 0) { tourIdx = tourIdx + 1 < tours.length ? tourIdx + 1 : -1; endIdx = tourIdx >= 0 ? endIdx : 0; }
      else if (endIdx + 1 < ends.length) endIdx++;
      else if (tours.length) tourIdx = 0;
      else endIdx = 0;
      if (tourIdx >= 0) endIdx = Math.max(0, ends.findIndex((x) => x.ident === tours[tourIdx].runway));
      reset();
    }
    if (e.code === "KeyA") setAutopilot(!game.autopilot);
    if (e.code === "KeyD") toggleFlightDirector();
    if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") setAutobrake(P, Number(e.code.slice(5)), say);
    if (e.code === "Enter") park(P, say);
    if (e.code === "KeyL" && !e.repeat) { game.figures = !game.figures; say(game.figures ? "Fun figures on" : "Fun figures off", 1.5); }
    if (e.code === "Equal" || e.code === "NumpadAdd" || e.code === "BracketRight") zoomTower(1);
    if (e.code === "Minus" || e.code === "NumpadSubtract" || e.code === "Slash") zoomTower(-1);
    if (e.code === "KeyU") lookTo("up");
    if (e.code === "KeyJ") lookTo("down");
    if (e.code === "KeyP") toggleBird();
    if (e.code === "KeyZ") nextRange();
    if (e.code === "KeyX") toggleTerrain();
    if (e.code === "KeyG") toggleGear(P, say);
    if (e.code === "KeyB") toggleSpeedBrake(P, say);
    if (e.code === "KeyF") moveFlaps(P, 1, say);
    if (e.code === "KeyV") moveFlaps(P, -1, say);
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  });
  addEventListener("keyup", (e) => { K[e.code] = false; });
  document.querySelectorAll<HTMLButtonElement>("#touch button[data-k]").forEach((b) => {
    const k = b.dataset.k!;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); K[k] = true; });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => { K[k] = false; });
  });
  document.getElementById("tCam")!.onclick = toggleCam;
  document.getElementById("tPark")!.onclick = () => park(P, say);
  document.getElementById("tAuto")!.onclick = () => setAutopilot(!game.autopilot);
  document.getElementById("tGear")!.onclick = () => toggleGear(P, say);
  document.getElementById("tBrake")!.onclick = () => toggleSpeedBrake(P, say);
  document.getElementById("tFlapOut")!.onclick = () => moveFlaps(P, 1, say);
  document.getElementById("tFlapIn")!.onclick = () => moveFlaps(P, -1, say);
  document.getElementById("tTime")!.onclick = () => { game.time += 4 * TIME_STEP_MS; };
  focus.addEventListener("click", () => focus.focus());

  reset();
  // ?pos=øst,nord,høyde,sannKurs (UTM 33, m, grader): start et vilkårlig sted, til feilsøking
  const pos = params.get("pos")?.split(",").map(Number);
  if (pos?.length === 4 && pos.every(Number.isFinite)) {
    [P.x, P.y] = terrain.utmToGrid(pos[0], pos[1]);
    P.alt = pos[2];
    P.hdg = ((pos[3] - terrain.meta.gridConvergenceDeg) * Math.PI) / 180;
    P.pitch = 0;
  }
  // ?to=øst,nord (UTM 33, m): sett kursen mot dette punktet, som et trykk i kartet (til feilsøking)
  const to = params.get("to")?.split(",").map(Number);
  if (to?.length === 2 && to.every(Number.isFinite)) game.flyTo(...terrain.utmToGrid(to[0], to[1]));
  // ?taxi: hopp over flygingen og start på rullebanen etter landing, i taksefart (til å øve på taksing). Uten
  // landing blir det ikke noe diplom.
  if (params.has("taxi")) {
    const end = ends[endIdx], rw = runwayOf(end), h = (end.headingGridDeg * Math.PI) / 180, d = (rw.lengthM * 0.45) / terrain.cell;
    const x = end.x + Math.sin(h) * d, y = end.y - Math.cos(h) * d;
    Object.assign(P, { state: "landed", x, y, hdg: h, alt: Math.max(0, terrain.heightAt(x, y)) + 1, spd: 12, pitch: 0, roll: 0, thr: 0, gearDown: true, gear: 1, flapCfg: 4, flaps: 4, taxi: true });
  }
  // ?cfg=full: start ferdig satt opp for landing (understell nede, full klaff)
  // ?ap: la autopiloten fly fra start
  if (params.has("ap")) setAutopilot(true);
  // ?flaps=0-4: start med klaffene i denne stillingen (til å se dem på flyet)
  if (params.has("brake")) Object.assign(P, { speedBrake: true, brake: 1 }); // ?brake: start med luftbremsene ute
  const flapsAt = params.has("flaps") ? Math.round(Number(params.get("flaps"))) : NaN;
  if (flapsAt >= 0 && flapsAt <= 4) Object.assign(P, { flapCfg: flapsAt, flaps: flapsAt });
  if (params.get("cfg") === "full") Object.assign(P, { gearDown: true, gear: 1, flapCfg: 4, flaps: 4 });
  focus.focus();
  return game;
}

/** Sant når tastetrykket hører til et skrivefelt. Da skal det ikke styre spillet. */
export const isTyping = (e: Event): boolean => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

/** Kjør `frame(dt)` hver animasjonsramme, med dt begrenset til 50 ms. */
export function runLoop(frame: (dt: number) => void): void {
  // ?capture (kun i utviklingsmodus): spillet går ikke av seg selv. Den som tar opptak kaller window.__capture.step(dt)
  // for hvert bilde, så filmen får jevn bildefrekvens uansett hvor fort maskinen tegner (se web/dev/record.js).
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("capture")) {
    (window as unknown as { __capture: object }).__capture = { step: frame };
    return;
  }
  let last = performance.now();
  const tick = (now: number) => {
    // Aldri bakover: tidsstempelet til første bilde kan ligge før performance.now() over, og negativ tid ville kjørt
    // klokka, understellet og bremsene baklengs
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    frame(dt);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
