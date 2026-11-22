# teinum-fly

Flysimulator over ekte norsk terreng: innflyging med Airbus A320 til Kjevik (ENCN),
Sola (ENZV), Flesland (ENBR), Ålesund (ENAL), Gardermoen (ENGM), Bodø (ENBO), Tromsø (ENTC) eller Mehamn (ENMH). Hver flyplass har et kartutsnitt
på 25,6 x 25,6 km i 10 m-celler. WebGL, sann målestokk, bygninger
og bruer som geometri, sol og mørke etter klokka, og cockpit med instrumentpanel.

## Kjøre

Forutsetninger: [uv](https://docs.astral.sh/uv/) og Node 22.

```bash
# 1. Pipeline: hent data og skriv fliser (laster ned ca. 280 MB første gang, deretter fra cache)
cd pipeline
uv run flypipe build all        # alle flyplasser (42 MB hver, ikke i git; ca. 1,3 GB nedlasting første gang)
uv run flypipe build kjevik10   # eller bare én: kjevik10, sola10, flesland10, gardermoen10, bodo10
uv run pytest

# 2. Spill
cd ../web
npm install
npm run dev          # http://localhost:5173
npm test
```

Spillet tilbyr de flyplassene som er bygget. 50 m-flisene i `web/public/data/kjevik/`
er sjekket inn fordi testene bruker dem; spillet gjør det ikke lenger.
`data/raw/` (cache) kan slettes for å hente alt
på nytt. `data/processed/kjevik/*.tif` er georefererte kopier som kan åpnes
i QGIS for kontroll mot andre kartlag.

Du starter 8 km ute med klaff 2 og understellet oppe. Ta ut understellet og
full klaff, brems til ca. 140 kt, og land. Landing med understellet oppe er
buklanding.

Spillet fyller hele nettleservinduet. «Hjelp» øverst viser tastene og har en knapp
for fullskjerm.

Taster: piltaster styrer, `W`/`S` gass, `G` understell, `F`/`V` klaff ut/inn,
`C` bytter mellom utvendig kamera, cockpit og tårn, `R` ny innflyging, `T` bytt bane (03/21), `Q`/`E` stiller klokka en
halvtime bakover/framover, `M` slår lyden av og på, `N` stedsnavnene, `D` flight director,
`Z` rekkevidden på ND (10, 20, 40 NM), `X` terrenget på ND av og på. Lyden starter ved første tastetrykk.

I cockpit kan understellsspaken, luftbremsen, gasshåndtakene (dra), klaffspaken og knappene AP1 og FD også
betjenes med mus eller finger.

Flyplass velges under «Hjelp» eller med `?apt=ENZV` (ICAO-kode). `T` blar gjennom alle
baneender på flyplassen.

URL-parametre: `?apt=ENGM`, `?cam=cockpit` eller `?cam=tower`, `?rwy=21`, `?cfg=full` (start med understell nede
og full klaff), `?time=22:00` og `?date=2026-06-21`
(norsk tid; uten dem starter spillet kl. 13:00 i dag), og `?pos=øst,nord,høyde,kurs` (UTM 33,
meter, sann kurs), f.eks. `?pos=91725,6468775,70,174` for Varoddbrua.

## Innflyging

PFD viser en magenta rombe for glidebanen (til høyre for horisonten) og en for kursen
(under den), slik et ILS-anlegg gjør: fly mot romben. Står begge i midten, er du på
senterlinja og på 3° glidebane. ND viser forlenget senterlinje med et merke per nautiske
mil. Veiledningen er regnet fra banegeometrien, ikke fra flyplassens faktiske anlegg.

## Terrengvarsel

I cockpit varsler flyet når det er på vei i terrenget: «terrain ahead» og gul tekst på ND når det er under
45 sekunder til, «pull up» og rødt når det haster. Terrenget det gjelder er helfarget på ND. Varselet regnes fra
høydekartet og flyets bane akkurat nå (`web/src/gpws.ts`); reglene er forenklet og gjelder ikke bygninger og bruer.

## Flight director

De to grønne strekene på PFD viser stillingen autopiloten ville holdt akkurat nå. Fly så de krysser midt i
flysymbolet, og du følger senterlinja og glidebanen ned. `D` slår dem av og på. De styrer ingenting selv.

## Autopilot

`A` lar flyet lande selv: det følger senterlinja og glidebanen, setter ut understell og
klaffer og flater ut over banen. Ta i stikka eller gassen, og du flyr igjen. Autopiloten er en
regelstyrt regulator (`web/src/autopilot.ts`), ikke maskinlæring. Den får karakter, men ikke diplom.

## Flylogg og gjennomgang med KI

Hver innflyging logges (posisjon i UTM 33, høyde, fart, avvik, hendelser). `L` laster ned
loggen fra forrige innflyging. Kjører du spillet lokalt (`npm run dev`), lagres loggene også
i `data/flights/`.

Gjennomgangen gjøres av en KI-agent på din egen maskin, ikke på nettsiden:

```bash
cd pipeline && uv run flypipe debrief        # hovedtallene for siste innflyging, som JSON
```

I Claude Code, startet i denne mappa: godkjenn MCP-serveren `teinum-fly` (`.mcp.json`) og be om
en gjennomgang («debrief siste landing»). Agenten får fire verktøy som leser loggen og flisene
(`pipeline/src/flypipe/debrief.py`), og en skill som sier hvordan en gjennomgang skal være
(`.claude/skills/debrief/`). Alle tall kommer fra verktøyene; språkmodellen regner ikke og
husker ikke flyplassen. Den publiserte siden kaller ingen språkmodell.

## Analyser

Pipeline regner tre ting per flyplass (`pipeline/src/flypipe/analysis.py`), og skriver dem til
`metadata.json` og til `data/processed/` for QGIS:

- **Synlighet fra tårnet** (`tower_viewshed.tif`): hvor høyt et fly må være over hver celle for å
  ses, med jordkrumning og brytning.
- **Klaring under innflygingen**: laveste avstand fra 3°-glidebanen til terreng, bygninger og
  bruer for hver baneende. Vises i hjelpepanelet.
- **Bygningsklynger** (`building_clusters.gpkg`): DBSCAN på N50-bygningene. Klynger får gatelys
  om natta, enslige hus bare lys i vinduet.

## Skip

Ved alle flyplassene unntatt Gardermoen ser du de skipene som faktisk er der, fra Kystverkets åpne AIS-data.
Spillet henter dem hvert halve minutt fra en liten tjeneste på samme nettsted (`web/public/ais/`), som
leser Kystverkets strøm. Småbåter er ikke med i de åpne dataene. Svarer ikke tjenesten, er sjøen tom.

## Andre fly

Fly som faktisk er i lufta rundt flyplassen vises i spillet, med kallesignal, type og høyde. Posisjonene kommer
fra adsb.lol, et nettverk av frivillige mottakere, via en liten tjeneste på samme nettsted
(`web/public/traffic/`). Dekningen varierer, og kilden har en døgngrense, så himmelen kan være tom.

## Reprise

Etter en krasj spilles de siste fem sekundene av på nytt, sett fra et fast punkt ved siden
av der det endte. Deretter starter en ny innflyging. `R` hopper over reprisen.

## Diplom

Når flyet står stille etter en landing, vises et diplom med karakter (1–5 stjerner) og det
som ble målt i landingsøyeblikket: fart, synkerate, avstand fra senterlinja og hvor på
banen hjulene tok bakken. Bakgrunnen er 3D-bildet fra landingen. All tekst er på engelsk.

Deling skjer med en lenke til `fly.teinum.no/share/?...`, der resultatet står i adressen.
Den siden (PHP på webhotellet) tegner diplomet på nytt, slik at Facebook, Messenger og
iMessage viser det som forhåndsvisning. Bildet der har en fast bakgrunn; bildet fra din egen
landing får du med «Download image», og «Share» legger det ved der nettleseren støtter det.
Ingenting lastes opp eller lagres på serveren. Navnet lagres bare i nettleseren.

## Publisering

Spillet publiseres til <https://fly.teinum.no/> (et webhotell med cPanel) av GitHub Actions
når `main` pushes: testene kjøres, 10 m-flisene bygges av pipeline (rådata caches),
spillet bygges med Vite, og `deploy/deploy-cpanel.sh` laster opp `web/dist` med SSH og
rsync. Skriptet godtar bare en dokumentrot som slutter med `/fly.teinum.no`, sjekker at
mappa finnes, sletter ingenting, og bytter `index.html` til slutt.

Alt publiseringen trenger ligger som repository secrets: `CPANEL_HOST`, `CPANEL_USERNAME`,
`CPANEL_DEPLOY_PATH`, `CPANEL_SSH_KEY`, `CPANEL_SSH_PASSWORD` (nøkkelpassord) og
`CPANEL_SSH_KNOWN_HOSTS` (`CPANEL_PORT` hvis porten ikke er 22). Vert, bruker og sti er
secrets og ikke variabler, fordi de ellers skrives i klartekst i loggene. Ingen nøkler
eller passord skal ligge i repoet.

Delingsbildet `web/public/og.jpg` (1200 x 630) er et skjermbilde fra spillet med
`?clean` (uten skjermtekst), med tittel lagt på. Lag et nytt hvis utseendet endres mye.

Oppsettet følger `morten.teinum.no`. `web/public/.htaccess` gir HTTPS, komprimering av
flisene og cache-regler.

## Dokumentasjon

- [CLAUDE.md](CLAUDE.md) – arkitektur, konvensjoner, CRS-regler
- [docs/datakilder.md](docs/datakilder.md) – kilder, lisenser, kreditering
- [docs/resampling.md](docs/resampling.md) – 1 m -> 50 m, metode og måling
- [docs/ai-logg.md](docs/ai-logg.md) – feil og rettelser underveis
- [docs/analyser.md](docs/analyser.md) – synlighet, klaring og klynger: metode, valg og resultater

## Faser

1. **Kjevik: DTM, hillshade, rullebane fra flyplassdata** (ferdig)
2. **N50-arealdekke, veier, bruer og bygninger, tid på døgnet** (ferdig) · METAR-vind og -sikt (gjenstår)
3. Fliser/LOD langs ENCN–ENGM, ruter fra Avinor
4. AI-genererte sprite-stabler, LLM-briefing fra METAR/TAF

Utenom fasene: autopilot, flylogg med lokal KI-gjennomgang, og analysene over (ferdig).

## Lisens

Koden er lisensiert under MIT, se [LICENSE](LICENSE). Det gjelder ikke data og medier som
følger med eller hentes av pipeline; de har egne vilkår:

- Kartfliser og fasitpunkter er avledet av data fra Kartverket (CC BY 4.0).
- Bygningsomriss (`data/osm/` og `buildings.bin` i flisene) er © OpenStreetMap contributors under
  Open Database License (ODbL) 1.0, se [data/osm/LICENSE.md](data/osm/LICENSE.md).
- Flyplassdata er fra OurAirports (public domain).
- Lydfilene i `web/public/audio/` er generert med ElevenLabs og publisert av
  rettighetshaveren. De er ikke omfattet av MIT-lisensen.
- Skriftene i `web/public/share/fonts/` er DejaVu, med egen lisens i samme mappe.

Detaljer står i [docs/datakilder.md](docs/datakilder.md).

## Kreditering

Høydedata (DTM og DOM), N50 Kartdata og stedsnavn: © Kartverket (CC BY 4.0). Flyplassdata: OurAirports
(public domain).
