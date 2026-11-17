# teinum-fly

Pixel-art flysimulator over ekte norsk terreng. Fase 1: innflyging til
Kristiansand lufthavn, Kjevik (ENCN), 25,6 x 25,6 km i 50 m-celler.

## Kjøre

Forutsetninger: [uv](https://docs.astral.sh/uv/) og Node 22.

```bash
# 1. Pipeline: hent data og skriv fliser (laster ned ca. 280 MB første gang, deretter fra cache)
cd pipeline
uv run flypipe build kjevik
uv run pytest

# 2. Spill
cd ../web
npm install
npm run dev          # http://localhost:5173
npm test
```

Flisene i `web/public/data/kjevik/` er sjekket inn, så spillet kjører også
uten å kjøre pipeline først. `data/raw/` (cache) kan slettes for å hente alt
på nytt. `data/processed/kjevik/*.tif` er georefererte kopier som kan åpnes
i QGIS for kontroll mot andre kartlag.

Taster: piltaster styrer, `W`/`S` gass, `C` kamera, `R` ny innflyging,
`T` bytt bane (03/21). `?cam=cockpit&rwy=21` i URL-en velger startoppsett, og
`?pos=øst,nord,høyde,kurs` (UTM 33, meter, sann kurs) starter et vilkårlig sted,
f.eks. `?pos=91725,6468775,70,174` for Varoddbrua.

## Dokumentasjon

- [CLAUDE.md](CLAUDE.md) – arkitektur, konvensjoner, CRS-regler
- [docs/datakilder.md](docs/datakilder.md) – kilder, lisenser, kreditering
- [docs/resampling.md](docs/resampling.md) – 1 m -> 50 m, metode og måling
- [docs/ai-logg.md](docs/ai-logg.md) – feil og rettelser underveis

## Faser

1. **Kjevik: DTM, hillshade, rullebane fra flyplassdata** (ferdig)
2. **N50-arealdekke, veier, bruer og bygninger** (ferdig) · METAR-vind og -sikt, sollys fra sunrise-API (gjenstår)
3. Fliser/LOD langs ENCN–ENGM, ruter fra Avinor
4. AI-genererte sprite-stabler, LLM-briefing fra METAR/TAF

## Kreditering

Høydedata (DTM og DOM), N50 Kartdata og stedsnavn: © Kartverket (CC BY 4.0). Flyplassdata: OurAirports
(public domain).
