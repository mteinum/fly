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
    areas.py      definisjon av utsnitt (kjevik10 = 10 m, kjevik = 50 m)
    dtm.py        Kartverket DTM og DOM via WCS, cache i data/raw/
    airports.py   OurAirports: flyplass + rullebaner; tårnposisjon fra N50-bygning type 411
    n50.py        N50 Kartdata: veier, bruer, bygninger -> feature-raster
    landcover.py  N50 Arealdekke -> palettindeks per celle
    structures.py bruer (dekkhøyde fra DOM) og bygninger som egen liste
    lights.py     nattlys (syntetisk plassert)
    terrain.py    blokkmiddel, hillshade, fargekart
    build.py      setter det sammen og skriver fliser + metadata.json
    audio.py      lyd generert med ElevenLabs -> web/public/audio/ (krever ELEVENLABS_API_KEY)
web/        Vite + TypeScript + three.js (kun til tegning), ingen spillmotor
  src/
    main.ts        laster fliser, kobler sammen og kjører løkka
    game.ts        spilltilstand, klokke, inndata
    terrain.ts     laster fliser; heightAt, isWater, utmToGrid, sann kurs
    physics.ts     flymodell (enkel, med A320-lignende fartsgrenser), landing, kollisjon
    sun.ts         solas posisjon fra tid og sted
    sky.ts         himmelfarger og lysstyrke fra solhøyden
    clock.ts       norsk tid <-> UTC
    glRenderer.ts  WebGL: terrengnett med LOD, normalkart, bygninger, bruer, lys
    groundDetail.ts  prosedyrale bakkedetaljer per overflateklasse (shader, syntetisk)
    runwayDecal.ts   rullebanen som skarp flate med merking (merkingen er syntetisk)
    audio.ts       lydmotor: motor, vind, hendelser, utrop, flygeleder
    hud.ts         skjermtekst og kart (utvendig kamera)
    panel.ts       A320-instrumentpanel (cockpit): PFD, ND med terreng, E/WD, FCU
    tower.ts       tårnkameraets geometri (blikkretning, kikkertkamera)
    towerPanel.ts  tårnets interiør: sprosser, benk med radar, stripe, værpanel
data/raw/        cache av nedlastede rådata (ikke i git)
data/processed/  GeoTIFF-kopier for kontroll i QGIS (ikke i git)
tests/fixtures/  fasitpunkter fra Kartverkets API-er, delt av pytest og vitest
reference/       opprinnelig piksel-prototype (én HTML-fil), kun til oppslag
docs/            datakilder.md, resampling.md, ai-logg.md
```

Flisformat per utsnitt (alle rad for rad fra nord):
- `heightmap.f32`: Float32 little-endian, rent terreng (DTM)
- `colormap.png`: RGB, bakken: arealdekke + veier + rullebane. 10 m-flisene har ren
  flatefarge (spillet lyssetter selv); 50 m-flisene har hillshade bakt inn
- `lights.png`: RGB, nattlys (kun 10 m). Syntetisk plassert langs veier og i bebyggelse
- `surface.bin`: uint8, arealdekke med vei (16) og rullebane (17) lagt oppå; velger detaljmønster på bakken
- `landcover.bin`: uint8 palettindeks (klasser i metadata.json; avgjør hva som er vann)
- `structures.json`: `[kol, rad, type, bunn, topp, r, g, b]` for bruer og bygninger
- `metadata.json`: bbox, CRS, cellestørrelse, min/maks høyde, konvergens,
  flyplasser med rullebaner, klasseliste

## Kommandoer

```bash
cd pipeline && uv run flypipe build kjevik10   # 10 m-fliser som spillet bruker (37 MB, ikke i git)
cd pipeline && uv run flypipe build kjevik     # 50 m-fliser: grovt nivå, brukes av testene (i git)
cd pipeline && uv run pytest                   # tester (krever bygde fliser)
cd pipeline && uv run flypipe audio            # generer manglende lydfiler (bruker ElevenLabs-kvote)
cd web && npm run dev                        # spill på http://localhost:5173
cd web && npm test && npm run typecheck
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
   Ved Kjevik er konvergensen -5,89° (nesten 7° vest for sentralmeridianen).
   Retninger fra kilder (rullebane, vind, sol) er sanne og må korrigeres;
   rullebaneretning regnes helst direkte fra transformerte endepunkter.
   I rendereren er verden høyrehendt i meter: X = øst, Y = opp, Z = sør
   (nord er -Z). Framover er `(sin hdg, 0, -cos hdg)`, og flyets rotasjon er
   Euler YXZ = `(pitch, -hdg, -roll)`.
6. Målestokkfaktoren ved Kjevik er 1,0016: rutenettavstander er 0,16 % lengre
   enn i terrenget. Ignoreres i flymodellen, men ikke anta eksakt likhet i tester.
7. Høyder er NN2000 (meter). Flyplasshøyder fra OurAirports er i fot (MSL).
8. WGS84 og ETRS89 regnes som like (avvik < 1 m).

## Konvensjoner

- Kode og identifikatorer på engelsk, kommentarer og dokumentasjon på norsk.
- Ikke finn på API-endepunkter. Sjekk GetCapabilities/OpenAPI eller spør.
  Verifiserte endepunkter står i docs/datakilder.md.
- Pipeline skal være reproduserbar: ingen manuelle steg, deterministisk
  utdata (fast støyfrø), rådata caches i data/raw/.
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
- Tid: spillklokka er UTC i ms, vises i norsk tid. Solas asimut er sann og må
  korrigeres med meridiankonvergensen før den brukes i rutenettet (game.ts).
- Skill mellom ekte og syntetisk: det som er plassert etter mønster og ikke
  etter data (nattlys, rullebanelys, bakkedetaljer, banemerking, stjerner, himmelfarger) skal merkes
  som syntetisk i koden og i docs/datakilder.md.
- Begge flissett har samme format og samme bbox. Kode som leser fliser skal
  ikke anta cellestørrelse: regn i meter og del på `terrain.cell`.
- Spillet fyller hele vinduet. Skjermtekst, panel og tårninteriør tegnes i logiske enheter
  (grunnflate 320 x 200, se web/src/screen.ts): bruk `W` og `TOP` for det som skal følge
  vinduskanten, og `OX` for å sentrere faste oppsett. Ikke anta 16:10.
- API-nøkler leses fra miljøet i pipeline og skrives aldri til fil, logg eller nettleser.
- Generert lyd er ikke reproduserbar. `flypipe audio` lager bare filer som mangler;
  slett en fil for å lage den på nytt. Lydfilene ligger i git.
- Commit per logisk steg, uten Co-Authored-By.
- Arbeidet går i faser (se README.md). Gjør én fase, stopp for gjennomgang.
