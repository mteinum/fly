# teinum-fly

Flysimulator over ekte norsk terreng: innflyging til Kristiansand lufthavn,
Kjevik (ENCN), 25,6 x 25,6 km i 10 m-celler. WebGL, sann målestokk, bygninger
og bruer som geometri, sol og mørke etter klokka, og cockpit med instrumentpanel.

## Kjøre

Forutsetninger: [uv](https://docs.astral.sh/uv/) og Node 22.

```bash
# 1. Pipeline: hent data og skriv fliser (laster ned ca. 280 MB første gang, deretter fra cache)
cd pipeline
uv run flypipe build kjevik10   # 10 m-fliser som spillet bruker (37 MB, ikke i git)
uv run flypipe build kjevik     # 50 m-fliser: grovt nivå, brukes av testene (ligger i git)
uv run pytest

# 2. Spill
cd ../web
npm install
npm run dev          # http://localhost:5173
npm test
```

Spillet krever at `kjevik10` er bygget. 50 m-flisene i `web/public/data/kjevik/`
er sjekket inn fordi testene bruker dem; spillet gjør det ikke lenger.
`data/raw/` (cache) kan slettes for å hente alt
på nytt. `data/processed/kjevik/*.tif` er georefererte kopier som kan åpnes
i QGIS for kontroll mot andre kartlag.

Taster: piltaster styrer, `W`/`S` gass, `C` bytter mellom utvendig kamera og
cockpit, `R` ny innflyging, `T` bytt bane (03/21), `Q`/`E` stiller klokka en
halvtime bakover/framover.

URL-parametre: `?cam=cockpit`, `?rwy=21`, `?time=22:00` og `?date=2026-06-21`
(norsk tid; uten dem brukes klokka nå), og `?pos=øst,nord,høyde,kurs` (UTM 33,
meter, sann kurs), f.eks. `?pos=91725,6468775,70,174` for Varoddbrua.

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
