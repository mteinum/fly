# teinum-fly

Flysimulator over ekte norsk terreng: innflyging med Airbus A320 til Kjevik (ENCN),
Sola (ENZV), Flesland (ENBR), Gardermoen (ENGM) eller Bodø (ENBO). Hver flyplass har et kartutsnitt
på 25,6 x 25,6 km i 10 m-celler. WebGL, sann målestokk, bygninger
og bruer som geometri, sol og mørke etter klokka, og cockpit med instrumentpanel.

## Kjøre

Forutsetninger: [uv](https://docs.astral.sh/uv/) og Node 22.

```bash
# 1. Pipeline: hent data og skriv fliser (laster ned ca. 280 MB første gang, deretter fra cache)
cd pipeline
uv run flypipe build all        # alle flyplasser (42 MB hver, ikke i git; ca. 1 GB nedlasting første gang)
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
halvtime bakover/framover, `M` slår lyden av og på. Lyden starter ved første tastetrykk.

Flyplass velges under «Hjelp» eller med `?apt=ENZV` (ICAO-kode). `T` blar gjennom alle
baneender på flyplassen.

URL-parametre: `?apt=ENGM`, `?cam=cockpit` eller `?cam=tower`, `?rwy=21`, `?cfg=full` (start med understell nede
og full klaff), `?time=22:00` og `?date=2026-06-21`
(norsk tid; uten dem starter spillet kl. 09:00 i dag), og `?pos=øst,nord,høyde,kurs` (UTM 33,
meter, sann kurs), f.eks. `?pos=91725,6468775,70,174` for Varoddbrua.

## Innflyging

PFD viser en magenta rombe for glidebanen (til høyre for horisonten) og en for kursen
(under den), slik et ILS-anlegg gjør: fly mot romben. Står begge i midten, er du på
senterlinja og på 3° glidebane. ND viser forlenget senterlinje med et merke per nautiske
mil. Veiledningen er regnet fra banegeometrien, ikke fra flyplassens faktiske anlegg.

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

Spillet publiseres til <https://fly.teinum.no/> (cPanel hos itpays) av GitHub Actions
når `main` pushes: testene kjøres, 10 m-flisene bygges av pipeline (rådata caches),
spillet bygges med Vite, og `deploy/deploy-cpanel.sh` laster opp `web/dist` med SSH og
rsync. Skriptet godtar bare en dokumentrot som slutter med `/fly.teinum.no`, sjekker at
mappa finnes, sletter ingenting, og bytter `index.html` til slutt.

Repository variables: `CPANEL_HOST`, `CPANEL_USERNAME`, `CPANEL_PORT`, `CPANEL_DEPLOY_PATH`.
Repository secrets: `CPANEL_SSH_KEY`, `CPANEL_SSH_PASSWORD` (nøkkelpassord),
`CPANEL_SSH_KNOWN_HOSTS`. Ingen nøkler eller passord skal ligge i repoet.

Delingsbildet `web/public/og.jpg` (1200 x 630) er et skjermbilde fra spillet med
`?clean` (uten skjermtekst), med tittel lagt på. Lag et nytt hvis utseendet endres mye.

Oppsettet følger `morten.teinum.no`. `web/public/.htaccess` gir HTTPS, komprimering av
flisene og cache-regler.

## Dokumentasjon

- [CLAUDE.md](CLAUDE.md) – arkitektur, konvensjoner, CRS-regler
- [docs/datakilder.md](docs/datakilder.md) – kilder, lisenser, kreditering
- [docs/resampling.md](docs/resampling.md) – 1 m -> 50 m, metode og måling
- [docs/ai-logg.md](docs/ai-logg.md) – feil og rettelser underveis

## Faser

1. **Kjevik: DTM, hillshade, rullebane fra flyplassdata** (ferdig)
2. **N50-arealdekke, veier, bruer og bygninger, tid på døgnet** (ferdig) · METAR-vind og -sikt (gjenstår)
3. Fliser/LOD langs ENCN–ENGM, ruter fra Avinor
4. AI-genererte sprite-stabler, LLM-briefing fra METAR/TAF

## Kreditering

Høydedata (DTM og DOM), N50 Kartdata og stedsnavn: © Kartverket (CC BY 4.0). Flyplassdata: OurAirports
(public domain).
