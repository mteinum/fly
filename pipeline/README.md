# pipeline

Python-pakken `flypipe`: henter åpne norske geodata og gjør dem om til flisene spillet leser.
Den har også analysene som mater spillet, lydgenereringen og verktøyene for gjennomgang av flylogger.

Alt internt er EUREF89 UTM 33 (EPSG:25833), (øst, nord) i meter. CRS-reglene står i
[../CLAUDE.md](../CLAUDE.md), kildene i [../docs/datakilder.md](../docs/datakilder.md).

## Kjøre

Krever [uv](https://docs.astral.sh/uv/). Python 3.12 og pakkene installeres av `uv run`.

```bash
uv run flypipe build all        # alle utsnitt (ca. 1,3 GB nedlasting første gang, deretter fra cache)
uv run flypipe build kjevik10   # ett utsnitt
uv run pytest                   # tester (krever bygde fliser)
uv run flypipe audio            # generer manglende lydfiler (krever ELEVENLABS_API_KEY)
uv run flypipe osm kjevik10     # hent bygningsomriss fra OpenStreetMap på nytt (bygget bruker fila i data/osm/)
uv run flypipe debrief          # hovedtallene for siste flylogg i data/flights/
uv run --group agent flypipe mcp   # MCP-server for gjennomgang av flylogger (startes vanligvis av Claude Code)
```

## Utsnitt

Hvert utsnitt er 25,6 x 25,6 km, sentrert på flyplassens referansepunkt. De er definert i `areas.py`.

| Utsnitt | Flyplass | Celle | Brukes av |
|---|---|---|---|
| `kjevik` | Kristiansand, Kjevik (ENCN) | 50 m | testene (flisene ligger i git) |
| `kjevik10` | Kristiansand, Kjevik (ENCN) | 10 m | spillet |
| `sola10` | Stavanger, Sola (ENZV) | 10 m | spillet |
| `flesland10` | Bergen, Flesland (ENBR) | 10 m | spillet |
| `gardermoen10` | Oslo, Gardermoen (ENGM) | 10 m | spillet |
| `bodo10` | Bodø (ENBO) | 10 m | spillet |

10 m-flisene er 42 MB per utsnitt og ligger ikke i git. De bygges lokalt og i GitHub Actions.

## Fra data til fliser

`build.py` setter stegene sammen for ett utsnitt:

1. **Flyplass** (`airports.py`): rullebaner fra OurAirports, transformert til UTM 33. Tårnet plasseres på
   terminalbygningen fra N50.
2. **Terreng** (`dtm.py`, `terrain.py`): Kartverkets DTM hentes med WCS og midles til spillrutenettet.
3. **Kartdata** (`n50.py`, `landcover.py`, `matrikkel.py`): arealdekke, veier, bruer og stedsnavn fra N50,
   og bygninger fra Matrikkelen, rasterisert til rutenettet.
4. **Strukturer** (`structures.py`): bruer og bygninger som egen liste, med høyde fra overflatemodellen (DOM).
5. **Analyser** (`analysis.py`): synlighet fra tårnet, klaring under innflygingene og bygningsklynger.
6. **Nattlys** (`lights.py`): syntetisk plassert langs veier og ved bebyggelse.
7. **Skriving**: fliser og `metadata.json` til `../web/public/data/<utsnitt>/`, og georefererte kopier til
   `../data/processed/<utsnitt>/` for kontroll i QGIS.

Flisformatet er beskrevet i [../CLAUDE.md](../CLAUDE.md).

## Filene i `src/flypipe/`

| Fil | Innhold |
|---|---|
| `cli.py` | Kommandoene `build`, `audio`, `mcp` og `debrief` |
| `areas.py` | Definisjon av utsnittene |
| `build.py` | Bygger ett utsnitt: kaller stegene over og skriver fliser, metadata og `index.json` |
| `crs.py` | All koordinattransformasjon (WGS84 til UTM 33), meridiankonvergens og målestokkfaktor |
| `grid.py` | `GridSpec`: omregning mellom UTM-meter og rutenettceller |
| `dtm.py` | Terrengmodell (DTM) og overflatemodell (DOM) fra Kartverkets WCS, med kontroll av det som kommer tilbake |
| `terrain.py` | Blokkmiddel, hillshade og fargekart |
| `airports.py` | Flyplass og rullebaner fra OurAirports, og tårnposisjon |
| `n50.py` | N50 Kartdata: veier, bruer, bygninger og stedsnavn |
| `osm.py` | Bygningsomriss fra OpenStreetMap: `flypipe osm <utsnitt>` henter til `../data/osm/` (ODbL) |
| `footprints.py` | Bygg med form: omriss, type og høyde samlet til `buildings.bin` |
| `matrikkel.py` | Matrikkelen: alle bygninger som punkt med type, brukt i 10 m-flisene |
| `landcover.py` | N50 Arealdekke til én klasse per celle (flertall) |
| `structures.py` | Bruer (dekkhøyde fra DOM) og bygninger med høyde |
| `lights.py` | Nattlys (syntetisk) |
| `analysis.py` | Synlighet, klaring og bygningsklynger (DBSCAN), se [../docs/analyser.md](../docs/analyser.md) |
| `audio.py` | Lyd generert med ElevenLabs til `../web/public/audio/` |
| `debrief.py` | Regner ut fakta fra en flylogg: avvik, fart mot grensene, terreng under flyet |
| `mcp_server.py` | Gir en KI-agent verktøyene i `debrief.py` over MCP (kun lokalt) |

## Tester

| Fil | Kontrollerer |
|---|---|
| `test_crs.py` | Transformasjon og konvergens mot fasitpunkter fra Kartverket |
| `test_terrain.py` | Rutenettets akser, blokkmiddel, hillshade og fargekart |
| `test_landcover.py` | Flertallsresampling av arealdekke |
| `test_n50.py` | Rasterisering av veier, bruer og bygninger, og hva som tegnes oppå hva |
| `test_tiles.py` | De bygde flisene: metadata, høyder mot fasitpunkter, rullebaner, tårn og stedsnavn |
| `test_matrikkel.py` | Bygningshøyde etter type, og at flisene har hus også i tettbebyggelse |
| `test_analysis.py` | Analysene mot tilfeller som kan regnes for hånd, og mot en uavhengig siktlinje |
| `test_debrief.py` | Gjennomgangen mot tre flylogger i `../tests/fixtures/flights/` |

Fasitpunktene er hentet fra Kartverkets API-er og lagret i `../tests/fixtures/`, så testene kjører uten
nett. De deles med testene i `web/`.

## Data utenfor denne mappa

| Sted | Innhold | I git |
|---|---|---|
| `../data/raw/` | Cache av nedlastede rådata | nei |
| `../data/processed/` | GeoTIFF og GeoPackage for QGIS | nei |
| `../data/flights/` | Flylogger fra spillet i utviklingsmodus | nei |
| `../data/osm/` | Bygningsomriss fra OpenStreetMap per utsnitt (ODbL) | ja |
| `../data/ssr_points.json` | Stedspunkter fra stedsnavnregisteret, så bygget ikke avhenger av API-et | ja |
| `../web/public/data/` | Flisene spillet leser | bare `kjevik` |

## Avhengigheter

Kjernen bruker numpy, rasterio, pyproj, shapely, geopandas, pillow, requests og scikit-learn.
MCP-serveren trenger pakken `mcp`, som ligger i en egen gruppe (`--group agent`) og ikke installeres ved
vanlig bygging eller testing.

Bygget skal være reproduserbart: ingen manuelle steg, fast støyfrø, og rådata fra cache. Unntaket er
`flypipe audio`, der generert lyd ikke blir lik fra gang til gang; derfor ligger lydfilene i git.
