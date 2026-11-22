# teinum-fly

Flysimulator (WebGL) over ekte norsk terreng, bygget på åpne norske geodata.
Sideprosjekt til IS-930 (GIS og KI) ved UiA: GIS-delen skal være ryddig,
reproduserbar og dokumentert.

## Arkitektur

```
pipeline/   Python 3.12 + uv. Henter og prosesserer data -> web/public/data/<utsnitt>/ (se pipeline/README.md)
  src/flypipe/
    crs.py        ALL koordinattransformasjon (WGS84 <-> UTM 33), konvergens
    grid.py       GridSpec: UTM-meter <-> rutenettceller
    areas.py      definisjon av utsnitt: 10 m rundt ENCN, ENZV, ENBR, ENAL, ENGM, ENBO, ENTC og ENMH, og 50 m for Kjevik.
                  Kjevik-utsnittet er flyttet 3,5 km sørover (center_offset) for å få med hele Flekkerøya,
                  og Ålesund-utsnittet 4,5 km sørover for å få med byen
    dtm.py        Kartverket DTM og DOM via WCS, cache i data/raw/
    airports.py   OurAirports: flyplass + rullebaner; tårnposisjon fra N50-bygning type 411
    n50.py        N50 Kartdata: veier, bruer, bygninger -> feature-raster
    osm.py        fra OpenStreetMap, hentet for hånd til data/osm/ (i git, ODbL): bygningsomriss (`flypipe osm <utsnitt>`)
                  og flyplassens bakkeanlegg med taksebaner, oppstillingsflater og stands (`flypipe aeroways <utsnitt>`)
    footprints.py bygg med form: omriss (OSM) + type (Matrikkelen) + høyde (DOM) -> buildings.bin
    matrikkel.py  Matrikkelen: alle bygninger som punkt med type (10 m-flisene); høyde og farge er valgt etter type
    landcover.py  N50 Arealdekke -> palettindeks per celle
    structures.py bruer (dekkhøyde fra DOM), bygninger, kirketårn og fyr (målt i DOM) som egen liste
    lights.py     nattlys (syntetisk plassert; bygningsklynger avgjør hvor det er gatelys)
    terrain.py    blokkmiddel, hillshade, fargekart
    build.py      setter det sammen og skriver fliser + metadata.json
    analysis.py   synlighet fra tårnet, klaring under innflygingene, bygningsklynger (DBSCAN) -> metadata.json
    debrief.py    regner ut fakta fra en flylogg (avvik, porter, fart, terreng under flyet)
    mcp_server.py MCP-server som gir en KI-agent verktøyene i debrief.py (kun lokalt, `--group agent`)
    audio.py      lyd generert med ElevenLabs -> web/public/audio/ (krever ELEVENLABS_API_KEY)
web/        Vite + TypeScript + three.js (kun til tegning), ingen spillmotor
  src/
    main.ts        laster fliser, kobler sammen og kjører løkka
    game.ts        spilltilstand, klokke, inndata
    terrain.ts     laster fliser; heightAt, isWater, utmToGrid, sann kurs
    physics.ts     flymodell (enkel, med A320-lignende fartsgrenser), klaffer, understell, luftbremser, landing, kollisjon,
                   utrulling med autobrems, og taksing på asfalten etter landing
    autopilot.ts   regelstyrt autopilot for innflyging og landing (A), flyr med spillerens kontroller
    guidance.ts    avvik fra senterlinje og 3° glidebane (vises som ILS på PFD, syntetisk)
    footprints.ts  leser buildings.bin og lager trekanter (vegger og flatt tak) for bygg med omriss
    traffic.ts     andre fly fra ADS-B: UTM -> rutenett, bevegelse og høyde mellom oppdateringer
    ships.ts       skip fra AIS: UTM -> rutenett, bevegelse mellom meldinger, jevne oppdateringer
    flightlog.ts   flylogg per innflyging (UTM 33, sann kurs); L laster ned, utviklingsserveren lagrer i data/flights/
    replay.ts      opptak av de siste 5 s og reprise utenfra etter krasj
    sun.ts         solas posisjon fra tid og sted
    sky.ts         himmelfarger og lysstyrke fra solhøyden
    clock.ts       norsk tid <-> UTC
    glRenderer.ts  WebGL: terrengnett med LOD, normalkart, bygninger, bruer, lys
    groundDetail.ts  prosedyrale bakkedetaljer per overflateklasse (shader, syntetisk)
    runwayDecal.ts   rullebanen som skarp flate med merking (merkingen er syntetisk)
    taxiDecal.ts     taksebaner, oppstillingsflater, senterlinjer og standnumre som skarpe flater (fra aeroways.json)
    audio.ts       lydmotor: motor, vind, hendelser, utrop, flygeleder
    diploma.ts     diplom etter landing: karakter, bilde til deling, deleknapper
    labels.ts      stedsnavn i lufta: utvalg etter viktighet og avstand, fri sikt, plassering
    hud.ts         skjermtekst og kart (utvendig kamera)
    panel.ts       A320-instrumentpanel (cockpit): PFD, ND med terreng, E/WD, FCU
    tower.ts       tårnkameraets geometri (blikkretning, kikkertkamera)
    towerPanel.ts  tårnets interiør: sprosser, benk med radar, stripe, værpanel
data/raw/        cache av nedlastede rådata (ikke i git)
data/processed/  GeoTIFF-kopier for kontroll i QGIS (ikke i git)
data/osm/        bygningsomriss fra OpenStreetMap per utsnitt (i git; ODbL, se LICENSE.md der)
data/flights/    flylogger fra spillet i utviklingsmodus (ikke i git)
.mcp.json        MCP-serveren `teinum-fly` for Claude Code; .claude/skills/debrief/ sier hvordan en innflyging gås gjennom
deploy/          publisering til fly.teinum.no (SSH + rsync), kjøres av .github/workflows/deploy.yml
web/public/share/  delingssiden for diplomer (PHP på webhotellet): index.php, image.php, lib.php
web/public/traffic/ flytjenesten (PHP på webhotellet): henter fly rundt en flyplass fra adsb.lol, med døgnbudsjett
web/public/weather/ værtjenesten (PHP på webhotellet): henter flyplassens siste METAR fra api.met.no og gir spillet vinden
web/public/ais/    skipstjenesten (PHP på webhotellet): leser Kystverkets åpne AIS-strøm og gir spillet skipene ved en flyplass
tests/fixtures/  fasitpunkter fra Kartverkets API-er, og flylogger (flights/, lages av vitest), delt av pytest og vitest
reference/       opprinnelig piksel-prototype (én HTML-fil), kun til oppslag
docs/            datakilder.md, resampling.md, analyser.md, ai-logg.md
```

Flisformat per utsnitt (alle rad for rad fra nord):
- `heightmap.f32`: Float32 little-endian, rent terreng (DTM)
- `colormap.png`: RGB, bakken: arealdekke + veier + rullebane. 10 m-flisene har ren
  flatefarge (spillet lyssetter selv); 50 m-flisene har hillshade bakt inn
- `lights.png`: RGB, nattlys (kun 10 m). Syntetisk plassert langs veier og i bebyggelse
- `surface.bin`: uint8, arealdekke med vei (16), rullebane (17) og taksebane/oppstillingsflate (18) lagt oppå; velger detaljmønster på bakken
- `landcover.bin`: uint8 palettindeks (klasser i metadata.json; avgjør hva som er vann)
- `structures.json`: `[kol, rad, type, bunn, topp, r, g, b]` for bruer og bygninger, `churchTowers`: `[x, y, bunn, topp]`, `lighthouses`: `[x, y, bunn, topp, tårn]` og `tunnels`: polylinjer `[x, y]`
- `buildings.bin` (10 m-utsnittene): bygg med form, se footprints.py for formatet.
  I `structures.json` har cellene under disse byggene et niende felt = 1 (tegnes ikke som boks)
- `aeroways.json` (10 m-utsnittene): flyplassens bakkeanlegg fra OpenStreetMap i rutenettkoordinater: `taxiways`
  (navn, bredde i m, linje), `aprons` (polygoner), `stands` (nummer, sted, innkjøringslinje) og `holds`
- `thumb.jpg` (10 m-utsnittene): oversiktskart 320 x 320 med rullebanene i hvitt, til flyplassvelgeren på delingssiden
- `names.json`: `[navn, x, y, z, skriftstørrelse, type, gruppe]`, stedsnavn fra N50, viktigste først
- `metadata.json`: bbox, CRS, cellestørrelse, min/maks høyde, konvergens,
  flyplasser med rullebaner (hver baneende har `approach` fra analysis.py), klasseliste, `analysis`

## Kommandoer

```bash
cd pipeline && uv run flypipe build all        # alle utsnitt (ca. 1,3 GB nedlasting første gang)
cd pipeline && uv run flypipe build sola10     # ett utsnitt: kjevik10, sola10, flesland10, gardermoen10, bodo10 (42 MB hver, ikke i git)
cd pipeline && uv run flypipe build kjevik     # 50 m-fliser: grovt nivå, brukes av testene (i git)
cd pipeline && uv run pytest                   # tester (krever bygde fliser)
cd pipeline && uv run flypipe audio            # generer manglende lydfiler (bruker ElevenLabs-kvote)
cd web && npm run dev                        # spill på http://localhost:5173
cd web && npm test && npm run typecheck
cd web && UPDATE_FIXTURES=1 npm test         # lag flyloggene i tests/fixtures/flights/ på nytt (etter endring i flymodell/autopilot)
cd pipeline && uv run flypipe debrief        # hovedtallene for siste flylogg i data/flights/
cd pipeline && uv run python tests/ais_reference.py   # lag fasiten for skipstjenesten på nytt (etter nytt opptak)
```

## Ny flyplass

1. `areas.py`: en linje med `_airport_10m(id, navn, ICAO, fylke)`. Fylkeskoden må finnes både for N50 og Matrikkelen
   (se fillistene på nedlasting.geonorge.no). Bruk `center_offset` hvis byen ellers faller utenfor.
2. `audio.py` AIRPORTS: navnet tårnet bruker. `uv run flypipe audio` lager de tre klippene (bruker ElevenLabs-kvote).
3. `uv run flypipe osm <id>` henter bygningsomriss til data/osm/ (tar noen minutter; Overpass svarer ofte 502),
   og `uv run flypipe aeroways <id>` taksebaner, oppstillingsflater og stands.
4. Fasit i tests/fixtures/reference_points.json: referansepunktet fra Kartverkets transformasjons-API, og tre
   høyder langs banen fra høyde-API-et (under `heights.areas.<id uten 10>`).
5. Legg id-en i testlistene: pipeline/tests/conftest.py, test_matrikkel.py, test_traffic.py, og AREAS i
   web/src/airports.test.ts og autopilot.test.ts.
6. `uv run flypipe build <id>`, så testene. Se på analysetallene i metadata (klaring under innflygingene): en
   negativ klaring betyr at en rett 3°-bane går gjennom terreng, og da duger ikke flyplassen i spillet.
7. Tekster som ramser opp flyplasser: web/index.html (beskrivelse og om-skjerm), README.md, docs/datakilder.md.

## CRS-regler

1. Arbeidsprojeksjon er EUREF89 UTM 33, EPSG:25833. Alt internt er (øst, nord) i meter.
2. WGS84-kilder (flyplasser, senere Avinor og METAR) transformeres KUN i
   `pipeline/src/flypipe/crs.py`, med pyproj og `always_xy=True`. Rekkefølgen er
   alltid (lon, lat) - aldri (lat, lon). Web-koden transformerer aldri selv;
   den får ferdige UTM- og rutenettkoordinater i metadata.json.
   ETT UNNTAK: skipsposisjoner kommer i sanntid og kan ikke gå gjennom pipeline. De transformeres på
   serveren, i `utm33()` i web/public/ais/lib.php (Krügers rekker). Den testes mot de samme fasitpunktene
   fra Kartverket som crs.py. Flytjenesten (web/public/traffic) bruker samme funksjon. Ingen andre steder.
3. Spillets rutenett: `x = (øst - west) / celle`, `y = (north - nord) / celle`.
   **y øker mot sør** (rad 0 = nord). Heltall er cellekanter; celleverdien
   gjelder i cellesenteret (+0.5).
4. Kurs i spillet er **rutenettretning** (radianer, 0 = rutenett-nord, med
   klokka): `x += sin(hdg)`, `y -= cos(hdg)`.
5. Rutenett-nord er ikke sann nord. `sann = rutenett + gridConvergenceDeg`.
   Konvergensen er -5,88° i Kjevik-utsnittet (regnet i utsnittets sentrum, som ligger 3,5 km sør for flyplassen), -8,03° på Sola, -8,52° på Flesland, -3,39° på
   Gardermoen, -0,59° i Bodø, -7,89° i Ålesund, +3,68° i Tromsø og +12,15° på Mehamn (Tromsø og Mehamn ligger øst
   for sentralmeridianen og har positivt fortegn). Den står i hvert utsnitts metadata.json; bruk aldri én verdi for flere utsnitt.
   Retninger fra kilder (rullebane, vind, sol) er sanne og må korrigeres;
   rullebaneretning regnes ALLTID fra baneendene, både rutenettkurs (headingGridDeg) og sann kurs
   (headingTrueDeg, geodetisk asimut). Kildens kurs er feil for Mehamn (magnetisk i feltet for sann) og
   ligger bare med som headingPublishedDeg.
   I rendereren er verden høyrehendt i meter: X = øst, Y = opp, Z = sør
   (nord er -Z). Framover er `(sin hdg, 0, -cos hdg)`, og flyets rotasjon er
   Euler YXZ = `(pitch, -hdg, -roll)`.
6. Målestokkfaktoren er 1,0016 ved Kjevik og opptil 1,0032 på Vestlandet: rutenettavstander er 0,16-0,32 % lengre
   enn i terrenget. Ignoreres i flymodellen, men ikke anta eksakt likhet i tester.
7. Høyder er NN2000 (meter). Flyplasshøyder fra OurAirports er i fot (MSL). GPS-høyder (fra andre fly) er over
   ellipsoiden: geoidehøyden (31-45 m, per utsnitt i data/geoid.json) trekkes fra. Trykkhøyde er ikke høyde over havet.
8. WGS84 og ETRS89 regnes som like (avvik < 1 m).

## Konvensjoner

- Kode og identifikatorer på engelsk, kommentarer og dokumentasjon på norsk.
- ALL tekst spilleren ser er på engelsk: skjermtekst, meldinger, paneler, diplom, hjelp,
  delingsbilder og navn/kreditering som pipeline skriver til metadata.
- Ikke finn på API-endepunkter. Sjekk GetCapabilities/OpenAPI eller spør.
  Verifiserte endepunkter står i docs/datakilder.md.
- Pipeline skal være reproduserbar: ingen manuelle steg, deterministisk
  utdata (fast støyfrø), rådata caches i data/raw/. Små oppslag mot API-er som kan være
  nede eller sperre GitHub (stedsnavn) lagres i git, se data/ssr_points.json.
- Stol ikke på at en tjeneste leverte det du ba om: sjekk CRS, størrelse og
  georeferering på det som kommer tilbake (se asserts i dtm.py).
- Nye datakilder: lisens og kreditering inn i docs/datakilder.md og i
  `attribution` i metadata.json (vises i spillet).
- Hver gang noe viser seg å være feil og må rettes (særlig akseretning,
  fortegn, CRS): før det i docs/ai-logg.md.
- Vektordata rasteriseres til spillrutenettet i pipeline. Bakken (arealdekke,
  veier, rullebane) bakes inn i fargekartet. Alt med høyde over terrenget
  (bruer, bygninger) går i structures.json og tegnes av renderne.
- Høydekartet er alltid rent terreng og endres aldri av vektordata.
- Vann avgjøres av arealdekket (`Terrain.isWater`), ikke av høyde <= 0.
- Sann målestokk, ingen vertikal overdrivelse. three.js brukes bare til
  tegning; fysikk og terrengoppslag er ren TypeScript og testes uten nettleser.
- Kameraene heter «utvendig», «cockpit» og «tårn» (ikke «jakt»).
- Tid: spillet starter kl. 13:00 norsk tid samme dag (kan overstyres med ?time og ?date).
  Spillklokka er UTC i ms, vises i norsk tid. Solas asimut er sann og må
  korrigeres med meridiankonvergensen før den brukes i rutenettet (game.ts).
- Skill mellom ekte og syntetisk: det som er plassert etter mønster og ikke
  etter data (nattlys, rullebanelys, bakkedetaljer, banemerking, stjerner, himmelfarger) skal merkes
  som syntetisk i koden og i docs/datakilder.md.
- Øst-koordinater i UTM 33 er NEGATIVE på Vestlandet (Sola og Flesland ligger rundt -39 000).
  Det er riktig, og koden må tåle det.
- Flere flyplasser: ikke anta én rullebane (`runways[0]`) eller Kjevik noe sted. Flyplass velges
  med `?apt=ICAO`; hvilke som finnes står i web/public/data/index.json, skrevet av pipeline.
- Alle flissett har samme format. Kode som leser fliser skal
  ikke anta cellestørrelse: regn i meter og del på `terrain.cell`.
- Spillet fyller hele vinduet. Skjermtekst, panel og tårninteriør tegnes i logiske enheter
  (grunnflate 320 x 200, se web/src/screen.ts): bruk `W` og `TOP` for det som skal følge
  vinduskanten, og `OX` for å sentrere faste oppsett. Ikke anta 16:10.
- Serverkode finnes fire steder, alle PHP på webhotellet. Værtjenesten (weather/) henter flyplassens METAR fra
  api.met.no høyst hvert tiende minutt per flyplass, før svaret sendes (ett lite kall), og lagrer bare meldingen. Flytjenesten (traffic/) er bygget som skipstjenesten, men
  henter fra adsb.lol, som tillater 500 forespørsler i døgnet uten nøkkel: den spør høyst hvert 45. sekund per
  flyplass, bare mens noen spiller, og stopper på 440 per døgn (regnskapet ligger i traffic/cache/lock). Delingssiden (share/) lagrer ingenting og tar ikke imot
  opplastinger: diplomet tegnes fra tallene i adressen, og alt derfra avgrenses i lib.php. Titlene der må holdes
  like TITLES i web/src/diploma.ts. Skipstjenesten (ais/) lagrer bare siste skipsposisjoner (ais/cache/, sperret
  for direkte henting) og ingenting om besøkende; eneste inndata er flyplasskoden, som må finnes i areas.json.
  Den lytter på Kystverkets strøm bare når noen spiller, etter at svaret er sendt, og én om gangen.
- PHP kjøres ikke direkte på denne maskinen, men i en container:
  `podman machine start && podman run --rm -v "$PWD":/w -w /w docker.io/library/php:8.1-cli bash deploy/test_ais.sh /tmp/ais-test`
  (tilsvarende for deploy/test_share.sh, som trenger GD). Begge kjøres også i GitHub Actions.
- Publiseringen sletter aldri filer på serveren. En fil som skal bort må erstattes med en tom utgave.
- KI i spillet koster ingenting å spille: ingen språkmodell kalles fra den publiserte siden. Det som trenger en
  modell (gjennomgang av flylogger) kjører bare lokalt, og modellen får alle tall fra verktøy (debrief.py).
- Glidebanens geometri finnes to steder: web/src/guidance.ts og pipeline/src/flypipe/analysis.py. Endres den ene,
  må den andre følge; airports.test.ts sammenligner dem.
- Geometri i UTM-planet bruker `headingGridDeg` (fra baneendene), aldri publisert sann kurs minus konvergens:
  den sanne kursen er avrundet til hele grader.
- Kjennemerker med logo står i data/landmarks.json (posisjon fra stedsnavnregisteret, bilde i web/public/).
  Logoer tilhører institusjonene: legg bare inn en når eieren av prosjektet har bedt om det.
- Fargekartet brukes bare på avstand: nær bakken tegner shaderen naturlige flater fra `surface.bin`.
  Det som skal synes på nært hold må være en overflateklasse eller egen geometri (slik tunnelene er).
- Om-skjermen (About, i web/index.html) sier hva som er ekte og hva som er syntetisk, hvem som krediteres og hva
  siden gjør med personvern. Endres noe av dette, må teksten der følge med.
- OpenStreetMap-data er ODbL: data/osm/ og det som avledes av dem (buildings.bin, bygningscellene) deles under
  samme lisens og krediteres «© OpenStreetMap contributors» i metadata og på om-skjermen. Bygget henter aldri
  fra Overpass selv; `flypipe osm` kjøres for hånd, som `flypipe audio`.
- Besøksmåling: Google Tag Manager (GTM-KJ2W4NZK) lastes i web/index.html. Det er den eneste tredjeparten
  siden kontakter. Spilldata (flylogg, navn på diplom) skal ikke sendes dit.
- API-nøkler leses fra miljøet i pipeline og skrives aldri til fil, logg eller nettleser.
- Generert lyd er ikke reproduserbar. `flypipe audio` lager bare filer som mangler;
  slett en fil for å lage den på nytt. Lydfilene ligger i git.
- Commit per logisk steg, uten Co-Authored-By.
- Arbeidet går i faser (se README.md). Gjør én fase, stopp for gjennomgang.
