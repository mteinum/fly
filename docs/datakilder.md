# Datakilder

Status per fase 1 (2026-11-17). «Verifisert» betyr at endepunktet er kalt og
svaret kontrollert i dette prosjektet.

## I bruk (fase 1)

### Høyde: Nasjonal høydemodell, DTM 1 m – Kartverket

| | |
|---|---|
| Tjeneste | WCS, `https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833` |
| Dekning | `nhm_dtm_topo_25833` (EPSG:25833, 1 m, høyder i NN2000) |
| Kall | WCS 1.0.0 `GetCoverage`, `FORMAT=GeoTIFF`, `INTERPOLATION=bilinear`, maks 3840 x 2160 piksler per kall |
| Lisens | Creative Commons BY 4.0 |
| Kreditering | © Kartverket |
| Brukt til | `heightmap.f32`, hillshade, fargekart |
| Verifisert | Ja. Ingen manuell nedlasting nødvendig. |

Tjenesten er en ArcGIS ImageServer bak Geonorge. Den resampler selv når man
ber om grovere oppløsning enn 1 m; se [resampling.md](resampling.md).
Over sjø er verdien 0 (svakt negativ nær land). Det finnes ingen nodata-verdi.

### Flyplasser og rullebaner: OurAirports

| | |
|---|---|
| Filer | `https://davidmegginson.github.io/ourairports-data/airports.csv` og `runways.csv` |
| Lisens | Public domain (ingen krav; krediteres likevel) |
| Brukt til | ENCN referansepunkt, baneender (lon/lat), banelengde og -bredde, høyde |
| Verifisert | Ja |

**Hvorfor OurAirports og ikke AIP Norge:** AIP (Avinor) er den autoritative
kilden, men publiseres som eAIP (HTML/PDF per AIRAC-syklus) uten et stabilt,
maskinlesbart endepunkt. Det ville gitt skjermskraping eller håndpunching,
og ingen av delene er reproduserbart. OurAirports er én CSV med koordinater
for begge baneender, er public domain og dekker alle flyplassene vi trenger
i fase 3 (også Torp og Haugesund).

Ulempen er at dataene er dugnadsbaserte og kan være utdaterte. Derfor
kontrollerer vi dem mot Kartverket:
- Avstanden mellom baneendene er 2038 m (geodetisk); publisert lengde er 2035 m.
- Retningen mellom baneendene er 34,9° sann; oppgitt `le_heading_degT` er 35°.
- DTM-høyden under banen er 11–17 m; OurAirports oppgir 12,5 m og 15,8 m.
- Den rasteriserte banen faller på den flate stripa mellom Topdalsfjorden og
  Topdalselva i DTM-en.

Koordinatene i `runways.csv` er banens fysiske ender, ikke de forskjøvne
tersklene (`displaced_threshold_ft` er 120 m og 190 m på ENCN).

### Fasit for tester: Kartverkets åpne API-er

| API | Brukt til |
|---|---|
| `https://ws.geonorge.no/transformering/v1/transformer?x=&y=&fra=4258&til=25833` | Uavhengig fasit for koordinattransformasjon |
| `https://ws.geonorge.no/stedsnavn/v1/navn?sok=&utkoordsys=` | Posisjon for Kristiansand domkirke og Moseidvarden (Sentralt stedsnavnregister) |
| `https://ws.geonorge.no/hoydedata/v1/punkt?koordsys=25833&nord=&ost=` | Uavhengig fasit for høyde (DTM 1 m) |

Lisens: CC BY 4.0, © Kartverket. Verdiene er lagret i
`tests/fixtures/reference_points.json`, så testene kjører uten nett.

Merk: punkt-API-et svarer med dybde over sjø (`datakilde: dybdekurver`) og
regulert vannstand over regulerte innsjøer (`innsjohoyde`). Bare punkter med
`datakilde: dtm1` er sammenlignbare med DTM-en.

## Planlagt (ikke i bruk, ikke verifisert ennå)

| Fase | Kilde | Lisens / kreditering | Merknad |
|---|---|---|---|
| 2 | N50 Kartdata (arealdekke), Kartverket via Geonorge | CC BY 4.0, © Kartverket | Nedlastingsmåte (Geonorge nedlastings-API eller manuell) må avklares |
| 2 | MET Norway `api.met.no` tafmetar | NLOD 2.0 og CC BY 4.0, «Data fra MET Norway» | Krever identifiserende User-Agent med kontaktinfo. Kapsles bak et grensesnitt; skal erstattes av SWIM / OGC API EDR |
| 2 | MET Norway `api.met.no` sunrise | Som over | |
| 3 | Avinor flydata XML (`asrv.avinor.no/XmlFeed/v1.0`, `airportNames`, `airlineNames`) | Avinors vilkår må leses og dokumenteres før bruk | Private flyplasser (Torp, Haugesund) mangler |

Eksakte URL-er, parametre og vilkår for disse føres inn her når de er
sjekket mot dokumentasjonen – ikke før.
