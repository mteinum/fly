# teinum-fly

Pixel-art flysimulator over ekte norsk terreng, bygget på åpne norske geodata.
Sideprosjekt til IS-930 (GIS og KI) ved UiA: GIS-delen skal være ryddig,
reproduserbar og dokumentert.

## Arkitektur

```
pipeline/   Python 3.12 + uv. Henter og prosesserer data -> web/public/data/<utsnitt>/
  src/flypipe/
    crs.py       ALL koordinattransformasjon (WGS84 <-> UTM 33), konvergens
    grid.py      GridSpec: UTM-meter <-> rutenettceller
    areas.py     definisjon av utsnitt (kjevik)
    dtm.py       Kartverket DTM via WCS, cache i data/raw/
    airports.py  OurAirports: flyplass + rullebaner
    n50.py       N50 Kartdata: veier, bruer, bygninger -> feature-raster
    terrain.py   blokkmiddel, hillshade, fargekart
    build.py     setter det sammen og skriver fliser + metadata.json
web/        Vite + TypeScript, Canvas 2D, ingen spillmotor
  src/
    terrain.ts        laster fliser; heightAt, utmToGrid, sann kurs
    layers.ts         skiver for sprite stacking
    chaseRenderer.ts  jaktkamera (sprite stack)
    voxelRenderer.ts  cockpit (Voxel Space)
    plane.ts physics.ts hud.ts main.ts
data/raw/        cache av nedlastede rådata (ikke i git)
data/processed/  GeoTIFF-kopier for kontroll i QGIS (ikke i git)
tests/fixtures/  fasitpunkter fra Kartverkets API-er, delt av pytest og vitest
reference/       opprinnelig prototype (én HTML-fil), kun til oppslag
docs/            datakilder.md, resampling.md, ai-logg.md
```

Flisformat per utsnitt: `heightmap.f32` (Float32 little-endian, rad for rad fra
nord), `colormap.png` (RGB), `metadata.json` (bbox, CRS, cellestørrelse,
min/maks høyde, konvergens, flyplasser med rullebaner).

## Kommandoer

```bash
cd pipeline && uv run flypipe build kjevik   # hent data, skriv fliser
cd pipeline && uv run pytest                 # tester (krever bygde fliser)
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
- Vektordata rasteriseres til spillrutenettet i pipeline og bakes inn i
  fargekartet. Prioritet: rullebane > bru > vei > bygning > terreng.
  Høydekartet endres aldri av vektordata (bruer ligger derfor på vannflata).
- Uttrykket: 320x200, nearest-neighbour, teknikkene fra prototypen beholdes.
- Commit per logisk steg, uten Co-Authored-By.
- Arbeidet går i faser (se README.md). Gjør én fase, stopp for gjennomgang.
