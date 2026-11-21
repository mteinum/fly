# teinum-fly

Flysimulator (WebGL) over ekte norsk terreng, bygget på åpne norske geodata.
Sideprosjekt til IS-930 (GIS og KI) ved UiA: GIS-delen skal være ryddig,
reproduserbar og dokumentert.

## Arkitektur

```
pipeline/   Python 3.12 + uv. Henter og prosesserer data -> web/public/data/<utsnitt>/
  src/flypipe/
    crs.py        ALL koordinattransformasjon (WGS84 <-> UTM 33), konvergens
    grid.py       GridSpec: UTM-meter <-> rutenettceller
    areas.py      definisjon av utsnitt: 10 m rundt ENCN, ENZV, ENBR, ENGM og ENBO, og 50 m for Kjevik
    dtm.py        Kartverket DTM og DOM via WCS, cache i data/raw/
    airports.py   OurAirports: flyplass + rullebaner; tårnposisjon fra N50-bygning type 411
    n50.py        N50 Kartdata: veier, bruer, bygninger -> feature-raster
    landcover.py  N50 Arealdekke -> palettindeks per celle
    structures.py bruer (dekkhøyde fra DOM) og bygninger som egen liste
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
    physics.ts     flymodell (enkel, med A320-lignende fartsgrenser), landing, kollisjon
    autopilot.ts   regelstyrt autopilot for innflyging og landing (A), flyr med spillerens kontroller
    guidance.ts    avvik fra senterlinje og 3° glidebane (vises som ILS på PFD, syntetisk)
    flightlog.ts   flylogg per innflyging (UTM 33, sann kurs); L laster ned, utviklingsserveren lagrer i data/flights/
    replay.ts      opptak av de siste 5 s og reprise utenfra etter krasj
    sun.ts         solas posisjon fra tid og sted
    sky.ts         himmelfarger og lysstyrke fra solhøyden
    clock.ts       norsk tid <-> UTC
    glRenderer.ts  WebGL: terrengnett med LOD, normalkart, bygninger, bruer, lys
    groundDetail.ts  prosedyrale bakkedetaljer per overflateklasse (shader, syntetisk)
    runwayDecal.ts   rullebanen som skarp flate med merking (merkingen er syntetisk)
    audio.ts       lydmotor: motor, vind, hendelser, utrop, flygeleder
    diploma.ts     diplom etter landing: karakter, bilde til deling, deleknapper
    labels.ts      stedsnavn i lufta: utvalg etter viktighet og avstand, fri sikt, plassering
    hud.ts         skjermtekst og kart (utvendig kamera)
    panel.ts       A320-instrumentpanel (cockpit): PFD, ND med terreng, E/WD, FCU
    tower.ts       tårnkameraets geometri (blikkretning, kikkertkamera)
    towerPanel.ts  tårnets interiør: sprosser, benk med radar, stripe, værpanel
data/raw/        cache av nedlastede rådata (ikke i git)
data/processed/  GeoTIFF-kopier for kontroll i QGIS (ikke i git)
data/flights/    flylogger fra spillet i utviklingsmodus (ikke i git)
.mcp.json        MCP-serveren `teinum-fly` for Claude Code; .claude/skills/debrief/ sier hvordan en innflyging gås gjennom
deploy/          publisering til fly.teinum.no (SSH + rsync), kjøres av .github/workflows/deploy.yml
web/public/share/  delingssiden for diplomer (PHP på webhotellet): index.php, image.php, lib.php
tests/fixtures/  fasitpunkter fra Kartverkets API-er, og flylogger (flights/, lages av vitest), delt av pytest og vitest
reference/       opprinnelig piksel-prototype (én HTML-fil), kun til oppslag
docs/            datakilder.md, resampling.md, analyser.md, ai-logg.md
```

Flisformat per utsnitt (alle rad for rad fra nord):
- `heightmap.f32`: Float32 little-endian, rent terreng (DTM)
- `colormap.png`: RGB, bakken: arealdekke + veier + rullebane. 10 m-flisene har ren
  flatefarge (spillet lyssetter selv); 50 m-flisene har hillshade bakt inn
- `lights.png`: RGB, nattlys (kun 10 m). Syntetisk plassert langs veier og i bebyggelse
- `surface.bin`: uint8, arealdekke med vei (16) og rullebane (17) lagt oppå; velger detaljmønster på bakken
- `landcover.bin`: uint8 palettindeks (klasser i metadata.json; avgjør hva som er vann)
- `structures.json`: `[kol, rad, type, bunn, topp, r, g, b]` for bruer og bygninger
- `names.json`: `[navn, x, y, z, skriftstørrelse, type, gruppe]`, stedsnavn fra N50, viktigste først
- `metadata.json`: bbox, CRS, cellestørrelse, min/maks høyde, konvergens,
  flyplasser med rullebaner (hver baneende har `approach` fra analysis.py), klasseliste, `analysis`

## Kommandoer

```bash
cd pipeline && uv run flypipe build all        # alle utsnitt (ca. 1 GB nedlasting første gang)
cd pipeline && uv run flypipe build sola10     # ett utsnitt: kjevik10, sola10, flesland10, gardermoen10, bodo10 (42 MB hver, ikke i git)
cd pipeline && uv run flypipe build kjevik     # 50 m-fliser: grovt nivå, brukes av testene (i git)
cd pipeline && uv run pytest                   # tester (krever bygde fliser)
cd pipeline && uv run flypipe audio            # generer manglende lydfiler (bruker ElevenLabs-kvote)
cd web && npm run dev                        # spill på http://localhost:5173
cd web && npm test && npm run typecheck
cd web && UPDATE_FIXTURES=1 npm test         # lag flyloggene i tests/fixtures/flights/ på nytt (etter endring i flymodell/autopilot)
cd pipeline && uv run flypipe debrief        # hovedtallene for siste flylogg i data/flights/
```

## CRS-regler

1. Arbeidsprojeksjon er EUREF89 UTM 33, EPSG:25833. Alt internt er (øst, nord) i meter.
2. WGS84-kilder (flyplasser, senere Avinor og METAR) transformeres KUN i
   `pipeline/src/flypipe/crs.py`, med pyproj og `always_xy=True`. Rekkefølgen er
   alltid (lon, lat) - aldri (lat, lon). Web-koden transformerer aldri selv;
   den får ferdige UTM- og rutenettkoordinater i metadata.json.
3. Spillets rutenett: `x = (øst - west) / celle`, `y = (north - nord) / celle`.
   **y øker mot sør** (rad 0 = nord). Heltall er cellekanter; celleverdien
   gjelder i cellesenteret (+0.5).
4. Kurs i spillet er **rutenettretning** (radianer, 0 = rutenett-nord, med
   klokka): `x += sin(hdg)`, `y -= cos(hdg)`.
5. Rutenett-nord er ikke sann nord. `sann = rutenett + gridConvergenceDeg`.
   Konvergensen er -5,89° ved Kjevik, -8,03° på Sola, -8,52° på Flesland, -3,39° på
   Gardermoen og -0,59° i Bodø. Den står i hvert utsnitts metadata.json; bruk aldri én verdi for flere utsnitt.
   Retninger fra kilder (rullebane, vind, sol) er sanne og må korrigeres;
   rullebaneretning regnes helst direkte fra transformerte endepunkter.
   I rendereren er verden høyrehendt i meter: X = øst, Y = opp, Z = sør
   (nord er -Z). Framover er `(sin hdg, 0, -cos hdg)`, og flyets rotasjon er
   Euler YXZ = `(pitch, -hdg, -roll)`.
6. Målestokkfaktoren er 1,0016 ved Kjevik og opptil 1,0032 på Vestlandet: rutenettavstander er 0,16-0,32 % lengre
   enn i terrenget. Ignoreres i flymodellen, men ikke anta eksakt likhet i tester.
7. Høyder er NN2000 (meter). Flyplasshøyder fra OurAirports er i fot (MSL).
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
- Tid: spillet starter kl. 09:00 norsk tid samme dag (kan overstyres med ?time og ?date).
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
- Delingssiden er den eneste serverkoden. Den lagrer ingenting og tar ikke imot opplastinger:
  diplomet tegnes fra tallene i adressen, og alt derfra avgrenses i lib.php. Titlene der må
  holdes like TITLES i web/src/diploma.ts. PHP kan ikke kjøres lokalt på denne maskinen;
  `deploy/test_share.sh` kjøres i GitHub Actions.
- KI i spillet koster ingenting å spille: ingen språkmodell kalles fra den publiserte siden. Det som trenger en
  modell (gjennomgang av flylogger) kjører bare lokalt, og modellen får alle tall fra verktøy (debrief.py).
- Glidebanens geometri finnes to steder: web/src/guidance.ts og pipeline/src/flypipe/analysis.py. Endres den ene,
  må den andre følge; airports.test.ts sammenligner dem.
- Geometri i UTM-planet bruker `headingGridDeg` (fra baneendene), aldri publisert sann kurs minus konvergens:
  den sanne kursen er avrundet til hele grader.
- Besøksmåling: Google Tag Manager (GTM-KJ2W4NZK) lastes i web/index.html. Det er den eneste tredjeparten
  siden kontakter. Spilldata (flylogg, navn på diplom) skal ikke sendes dit.
- API-nøkler leses fra miljøet i pipeline og skrives aldri til fil, logg eller nettleser.
- Generert lyd er ikke reproduserbar. `flypipe audio` lager bare filer som mangler;
  slett en fil for å lage den på nytt. Lydfilene ligger i git.
- Commit per logisk steg, uten Co-Authored-By.
- Arbeidet går i faser (se README.md). Gjør én fase, stopp for gjennomgang.
