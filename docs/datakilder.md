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

### Brudekkhøyde: Nasjonal høydemodell, DOM 1 m – Kartverket

| | |
|---|---|
| Tjeneste | WCS, `https://wcs.geonorge.no/skwms1/wcs.hoyde-dom-nhm-25833` |
| Dekning | `nhm_dom_topo_25833` (overflatemodell: terreng + bruer, bygninger, trær) |
| Lisens | CC BY 4.0, © Kartverket |
| Brukt til | Høyden på brudekker: 1 m uten resampling, bare i vinduer rundt bruene (58 vinduer, 1,7 km² for Kjevik). Høyden på store bygg (kun 10 m-flisene): 10 m over hele utsnittet |
| Verifisert | Ja. Varoddbrua: dekket stiger fra 14 til 37 m over Topdalsfjorden |

DTM har ikke bruer (der er det sjø under Varoddbrua), DOM har. Per celle brua
går gjennom tas medianen av DOM langs senterlinja (prøve hver 5. m, median av
5 x 5 m rundt hver prøve for å se bort fra biler og rekkverk). «Bruer» med
mindre enn 3 m klaring til terrenget tegnes som vanlig vei.

### Arealdekke, veier, bruer og bygninger: N50 Kartdata – Kartverket

| | |
|---|---|
| Fil | `https://nedlasting.geonorge.no/geonorge/Basisdata/N50Kartdata/FGDB/Basisdata_<fylke>_25833_N50Kartdata_FGDB.zip`. Verifisert for `42_Agder` (256 MB), `11_Rogaland` (187 MB), `46_Vestland` (490 MB), `32_Akershus` (53 MB) og `18_Nordland` (481 MB) |
| Format | Esri filgeodatabase, EPSG:25833. Leses med geopandas/pyogrio (GDAL OpenFileGDB) |
| Lisens | Creative Commons BY 4.0 |
| Kreditering | © Kartverket |
| Verifisert | Ja. Fylkesfil og kommunefil (`Basisdata_4204_Kristiansand_...`) finnes; GML finnes bare per kommune |

Lag og filtre som brukes (`pipeline/src/flypipe/n50.py`):

| Hva | Lag | Filter |
|---|---|---|
| Arealdekke | `N50_Arealdekke_omrade` | alle; `objtype` -> 15 klasser, se `landcover.py` |
| Veier | `N50_Samferdsel_senterlinje` | `objtype = Veglenke`, `typeveg = enkelBilveg`, `medium = T`, `vegkategori` E/R/F |
| Bruer | samme | `medium = L` (i lufta), `vegkategori` E/R/F/K/P |
| Bygninger | `N50_BygningerOgAnlegg_posisjon` og `_omrade` | `objtype = Bygning` |
| Stedsnavn | `N50_Stedsnavn_tekstplassering` | rader med `stedsnummer`; tunneler utelatt. Tekstbiter slås sammen per sted, hele navnet tas fra `fulltekst` |

Tunneler (`medium = U`), stier, traktorveier, gang- og sykkelveier og jernbane
tegnes ikke. Kommunale og private veier (1050 km i utsnittet) er utelatt fordi
de ville fylt nesten hver celle i tettbygde strøk på 50 m-rutenett.

N50 er generalisert for 1:50 000: bygninger er punkter (store bygg er flater),
og ikke alle hus er med. Antallet i `metadata.json` er N50-objekter, ikke
faktiske bygninger.

Stedsnavnene vises i lufta når man flyr (`names.json`). Navn, type og hvor
viktig navnet er (kartets skriftstørrelse) er fra N50. Plasseringen er
kartteksten sin, som står *ved siden av* stedet. De 262 største navnene er
derfor flyttet til stedets eget punkt, hentet fra
`https://ws.geonorge.no/stedsnavn/v1/sted?stedsnummer=&utkoordsys=25833`
(Sentralt stedsnavnregister, CC BY 4.0, verifisert 2026-11-21) og lagret i
`data/ssr_points.json`, som ligger i git. Brunavn er flyttet til nærmeste punkt på brudekket. Mindre
navn står fortsatt der kartet har trykket dem, opptil noen hundre meter unna.
Hvor langt unna et navn vises, og at navn bak en ås skjules, er valgt i
spillet (`web/src/labels.ts`).

N50 har ikke bygningshøyde. I 50 m-flisene er høyden nominell: 7 m for
bygningspunkter og 12 m for bygninger som er flater i N50. I 10 m-flisene får
flatene høyde fra DOM minus DTM (median innenfor flaten, begrenset til
4–80 m, flatt tak); punktene er fortsatt 7 m. 10 m-flisene tar også med
kommunale og private bilveier (1384 km mot 329 km).

### Flyplasser og rullebaner: OurAirports

| | |
|---|---|
| Filer | `https://davidmegginson.github.io/ourairports-data/airports.csv` og `runways.csv` |
| Lisens | Public domain (ingen krav; krediteres likevel) |
| Brukt til | ENCN referansepunkt, baneender (lon/lat), banelengde og -bredde, høyde |
| Verifisert | Ja |

Flyplassene i spillet (2026-11-20), alle sentrert på referansepunktet fra OurAirports:

| ICAO | Utsnitt | N50-fylke | Baner | Meridiankonvergens | Kontroll mot Kartverket |
|---|---|---|---|---|---|
| ENCN Kjevik | `kjevik10` | Agder | 03/21 | -5,89° | Se under |
| ENZV Sola | `sola10` | Rogaland | 10/28, 18/36 | -8,03° | 6 punkter langs banene: terreng = Rullebane, høyde innenfor 2 m |
| ENBR Flesland | `flesland10` | Vestland | 17/35 | -8,52° | 3 punkter, som over |
| ENGM Gardermoen | `gardermoen10` | Akershus | 01L/19R, 01R/19L | -3,39° | 6 punkter, som over |
| ENBO Bodø | `bodo10` | Nordland | 07/25 | -0,59° | 3 punkter, som over |

Alle utsnittene ligger innenfor ett fylke (andel celler uten arealdekke er 0),
så én N50-fil per flyplass holder. Det er kontrollert per utsnitt, ikke antatt.

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

## Beregnet eller syntetisk (ikke data)

| Hva | Hvordan | Merknad |
|---|---|---|
| Solas posisjon | Regnes i `web/src/sun.ts` fra klokke og flyplassens posisjon (lavpresisjonsformler, ca. 0,01°) | Testet mot middagshøyde ved solverv og jevndøgn. Erstatter planen om MET sitt sunrise-API: lyssetting trenger asimut og høyde hvert øyeblikk, ikke bare tidspunkt for soloppgang |
| Himmelfarger og lysstyrke | Tabell per solhøyde i `web/src/sky.ts` | Valgt for utseende. Grensene -6°/-12°/-18° er de vanlige for tussmørke |
| Gatelys og vinduslys (`lights.png`) | `pipeline/src/flypipe/lights.py`: 2–18 % av cellene i bebygde arealklasser; utenfor dem lys ved N50-bygningene (80 % av dem i en klynge, 50 % av de enslige); gatelys på hver 5. veicelle nær bebyggelse, nær en bygningsklynge og på europa-/riksvei | Viser hvor N50 har vei og bygninger, ikke hvor det faktisk er lys. Hva som er en klynge er et valg (DBSCAN, 100 m, minst 5 bygninger), se docs/analyser.md |
| Rullebanelys | Kantlys hver 60. m, grønne terskellys, 420 m innflygingslys med tverrbjelke | Vanlig mønster, ikke ENCNs faktiske lysanlegg (AIP er ikke slått opp) |
| Lykter på bruer | Hver 30. m langs senterlinja, 8 m over dekket | Syntetisk |
| Bakkedetaljer | `web/src/groundDetail.ts`: mønster per overflateklasse (trekroner, furer, bølger, korn) og uregelmessige klassegrenser, regnet i shaderen | Hvilken klasse som ligger hvor er ekte (N50, `surface.bin`). Mønsteret er ikke: trærne står ikke der trær står, og grensene er forskjøvet opptil ca. 6 m med støy |
| Rullebanemerking | `web/src/runwayDecal.ts`: terskelstriper, banenummer, siktepunkt, midt- og kantlinjer | Baneender, bredde og forskjøvne terskler er ekte (OurAirports). Selve oppmerkingen følger vanlig mønster, ikke ENCNs |
| Stjerner, måne | 1400 tilfeldige punkter; fast, svakt «månelys» ovenfra | Ingen stjernekatalog, ingen månefase |
| Instrumentpanel (A320) | `web/src/panel.ts`. Eget oppsett tegnet etter hvordan hovedpanelet i en A320 er bygget opp; ingen grafikk er hentet fra plakater eller produsent | Ekte fra flymodell og kart: fart, høyde, stigning, kurs, stilling, radiohøyde, peiling og avstand til ENCN, terrengbildet på ND (høydekartet, farget etter høyde i forhold til flyet), klokke. Klaff- og understellsvisning, landingsmemoets linjer for understell og klaff, og varslene OVERSPEED, STALL og L/G GEAR NOT DOWN følger flymodellen. Syntetisk: motorverdiene på E/WD (regnet rett fra gasshåndtaket), memolinjene SIGNS/CABIN/SPLRS (alltid grønne), FOB. FCU: streker med prikk i SPD og HDG betyr at flyet styrer verdien selv; med autopiloten på vises farten og kursen den holder. ALT-vinduet viser høyden innflygingen startet i (syntetisk: spillet har ingen klarert høyde). Høydebåndet viser høyde over havet (NN2000) uten trykkorreksjon, og kursen er sann, ikke magnetisk |
| Kontrolltårnet | Posisjon fra pipeline (`airports.tower_position`), interiør i `web/src/towerPanel.ts` | Ekte: tårnet står på N50-bygningen med bygningstype 411 (ekspedisjonsbygning, flyterminal, kontrolltårn) nærmest referansepunktet. Typen sier ikke om bygningen er terminal eller tårn, og ikke hvor på den tårnet står. Antatt: punktet på bygningen nærmest rullebanen, øyehøyde 32 m over bakken, tårnets form. Radarbildet viser flyets faktiske posisjon, høyde og fart. Syntetisk: kallesignalet TFY320, vind (alltid vindstille, flymodellen har ingen), QNH, lyspanelet og hele innredningen |
| Autopilot | `web/src/autopilot.ts`. Tre proporsjonalregulatorer (kurs mot senterlinja, høyde mot 3°-glidebanen, fart) og en tabell for når understell og klaffer settes ut | Syntetisk og regelstyrt: ingen maskinlæring og ingen språkmodell. Tallene er valgt for spillets flymodell, ikke hentet fra en A320. Den følger den samme syntetiske glidebanen som PFD viser, ikke flyplassens ILS |
| Flylogg og gjennomgang | `web/src/flightlog.ts` skriver en logg per innflyging; `pipeline/src/flypipe/debrief.py` regner ut avvik, fart mot grensene og terrenget under flyet | Ekte fra flymodellen: posisjon (EPSG:25833), høyde, fart, stilling, hendelser. Terreng og stedsnavn i gjennomgangen er fra flisene (DTM og N50). Syntetisk: kriteriene for «stabilisert innflyging» ved 1000 og 500 fot er spillets egne, med vanlige flyselskapskriterier som forbilde. Loggen inneholder ingenting om spilleren og sendes ingen steder fra den publiserte siden |
| Analyser | `pipeline/src/flypipe/analysis.py`, beskrevet i docs/analyser.md | Regnet fra ekte data (DTM, N50-bygninger, baneender). Antatt eller valgt: tårnets plassering og øyehøyde, glidebanen (3°, syntetisk), beltebredden for klaring og klyngeparametrene. Synligheten tar ikke med trær og bygninger |
| Kurs- og glidebaneviser | `web/src/guidance.ts`, vist på PFD | Regnet fra baneendene i OurAirports: senterlinja, og en glidebane på 3° som treffer banen 300 m etter terskelen. Det er IKKE flyplassens ILS. Ekte anlegg har egen plassering og vinkel, og ikke alle baner har ILS. Innflygingen i spillet starter på denne glidebanen |
| Diplom | `web/src/diploma.ts` | Tallene er det flymodellen målte i landingsøyeblikket. Karaktergrensene (synkerate 250/500 fot/min, 8 m fra senterlinja, 900 m etter terskel, 155 kt, klaff 3) er valgt for spillet, ikke hentet fra flyoperative krav. Diplomet er en spillpremie, ikke et sertifikat |
| Delingssiden | `web/public/share/` (PHP) | Tegner diplomet fra tallene i lenka. Tallene kommer fra spillet, men hvem som helst kan endre dem i adressen: diplomet er ikke et bevis. Bakgrunnen er et fast skjermbilde fra spillet (Kjevik), uansett flyplass. Skriftene er DejaVu (fri lisens, se `web/public/share/fonts/DEJAVU-LICENSE.txt`), hentet fra prosjektets utgivelse 2.37 på GitHub |
| Flymodell | `web/src/physics.ts` | Prototypens enkle fartsmodell, styrt av tabeller per klaffstilling: steilefart 145/125/116/110/105 kt, fartsgrense 350/230/200/185/177 kt, og lavere toppfart jo mer klaff. Understellet bruker 8 s, bremser, og har grense 280 kt. Tallene er i A320-størrelse, satt etter hukommelsen og ikke slått opp i flyets håndbok. Ingen aerodynamikk, vekt eller vind. Å overskride en fartsgrense gir bare varsel, ingen skade |
| Flyet i 3D | `web/src/glRenderer.ts` | Riktige hovedmål (37,6 m langt, 34 m vingespenn), ellers enkle former og nøytral bemaling |

## Undersøkt, ikke i bruk: bilde som bakketekstur (2026-11-20)

### Ortofoto: Norge i bilder – ikke åpent

Alle tjenestene til Norge i bilder står i Geonorges kartkatalog med tilgang
«Norge digitalt begrenset» og Norge digitalt-lisens, ikke CC BY:

| Tjeneste | Resultat uten pålogging |
|---|---|
| WMTS `https://tilecache.norgeibilder.no/wmts/utm33_euref89` | `499 Token Required` |
| WMS `https://services.norgeibilder.no/wms/ortofoto` | `499` |
| WMS `https://wms.geonorge.no/skwms1/wms.nib` | «Bruker kan ikke autentiseres» |
| `opencache.statkart.no` (eldre åpen cache) | svarer ikke lenger |

Lisensvilkår: <https://www.kartverket.no/geodataarbeid/norge-digitalt/partsinformasjon/avtaler-og-vilkar/norge-digitalt-lisens>.
Bruk krever at man er Norge digitalt-part eller har egen avtale. Om UiA er
part, og om en students sideprosjekt dekkes, er ikke undersøkt. Selv med
tilgang kan flisene trolig ikke legges i et åpent repo eller på en åpen
nettside.

### Sentinel-2 skyfri mosaikk – åpent, men 10 m

| | |
|---|---|
| Tjeneste | WMS, `https://wms.geonorge.no/skwms1/wms.sentinel2`, lag `sentinel2` |
| Innhold | Årlig skyfri mosaikk av Sentinel-2, juni–august, prosessert av Kartverket |
| CRS / format | EPSG:25833 støttes; PNG/JPEG; maks 8192 x 8192 per kall |
| Tilgang | Åpne data, ingen pålogging |
| Kreditering (krav) | «Copernicus Sentinel-2 data (årstall)/prosessert av Statens Kartverk» |
| Verifisert | Ja. Hele Kjevik-utsnittet hentet i 10 m (2560 x 2560, 12 MB PNG, 11 s). Bildet ligger riktig i rutenettet: rullebanen faller på samme celler som i fargekartet |

Begrensninger: oppløsningen er 10 m (som fargekartet vi har), så bakken blir
ikke skarpere på nært hold. Bildet har sommerens solskygger bakt inn, og
vann er nesten svart.

## Undersøkt, ikke i bruk: flere og bedre bygninger (2026-11-21)

Bakgrunn: N50 har 8 098 bygninger i Kjevik-utsnittet, de fleste som punkter, og ingen enkelthus i
by og tettsted. Spørsmålet var hva som finnes av mer detaljerte, åpne kilder.

| Kilde | Hva | Lisens | Funn |
|---|---|---|---|
| FKB-Bygning (Geovekst) | Kommunenes detaljerte kart: omriss av hvert bygg, 1:500 | Norge digitalt-lisens. Ikke åpne data: «Nedlasting av data begrenset til Norge digitalt avtaleparter» | Kan ikke brukes |
| Matrikkelen - Bygningspunkt (Kartverket) | Ett punkt per bygning, med bygningstype og status | CC BY 4.0, åpne data | 57 883 bygninger i Kjevik-utsnittet, sju ganger N50. Bare punkt, ingen form eller høyde |
| INSPIRE Buildings WMS (Kartverket) | Bygningsomriss som kartbilde | CC BY-NC 4.0 | Bare bilde (WMS), ikke vektordata, og ikke-kommersiell lisens. Ingen nedlasting funnet |
| OpenStreetMap | Bygningsomriss | ODbL | 57 945 bygninger i en boks litt større enn utsnittet. 95 % av et utvalg på 4 000 har matrikkelens bygningsnummer (`ref:bygningsnr`), så de kan kobles til bygningstypen. 8 % har etasjetall, nesten ingen har høyde |
| satellittdata.no (Norsk Romsenter) | Sentinel-data over Norge | Copernicus | Ingen bygningsdata og ingen bilder med høyere oppløsning enn Sentinel. Samme grunnlag som mosaikken over |

Kontrollert slik:
- Lisens og tilgang er lest fra Geonorges kartkatalog (`kartkatalog.geonorge.no/api/getdata/<uuid>`).
- Matrikkelen er lastet ned for Agder (40 MB) og telt innenfor utsnittet. Fila ligger samme sted og i
  samme form som N50: `nedlasting.geonorge.no/geonorge/Basisdata/MatrikkelenBygning/FGDB/Basisdata_<fylke>_25833_MatrikkelenBygning_FGDB.zip`.
  Laget heter `bygning`, CRS er EPSG:25833. WFS finnes også (`wfs.geonorge.no/skwms1/wfs.matrikkelen-bygningspunkt`, typen `app:Bygning`).
- OpenStreetMap er telt med Overpass API. Utvalget på 4 000 er de første Overpass ga, ikke et tilfeldig utvalg.

Det matrikkelen viser om Kjevik-utsnittet:
- 55 408 av bygningene står (status tatt i bruk, ferdigattest eller midlertidig brukstillatelse). Resten er
  blant annet godkjent, men ikke bygget.
- 65 % ligger i arealklassen Tettbebyggelse og 2 % i Bymessig bebyggelse, altså der N50 ikke har enkelthus.
- 19 657 er garasjer, uthus og naust (type 181-183). 35 751 er andre bygg.

Ikke avklart:
- ODbL krever at en database avledet av OpenStreetMap deles på samme vilkår. `structures.json` bygget på
  OSM-omriss ville trolig være en slik database. Det må vurderes før OSM tas i bruk.
- Hvor godt OSM-omrissene dekker landsbygda og de andre flyplassene er ikke sjekket.
- Matrikkelen har adresse- og eiendoms-ID per bygning. De trengs ikke og skal ikke med i flisene.

### Lyd: ElevenLabs (generert)

| | |
|---|---|
| Tjenester | `POST https://api.elevenlabs.io/v1/sound-generation` (lydeffekter) og `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` (tale, modell `eleven_multilingual_v2`). Verifisert 2026-11-20 |
| Nøkkel | `ELEVENLABS_API_KEY` i miljøet. Brukes bare av `pipeline/src/flypipe/audio.py` |
| Innhold | 10 lydeffekter (motor, vind, tårnrom, understell, klaff, landing, krasj, plask, varsel, radioklikk) og 18 taleklipp (høydeutrop, «retard», «too low, gear», «stall», og fire meldinger fra tårnet). Tekst og stemme per fil står i `web/public/audio/manifest.json` |
| Lisens | Kontoeieren har bekreftet (2026-11-21) at abonnementet gir rett til å publisere lyden. Dette er eierens opplysning; pipeline kan ikke lese abonnementet, fordi nøkkelen ikke har lesetilgang til kontoen. Kreditering vises i spillet. Lydfilene er ikke omfattet av repoets MIT-lisens |
| Reproduserbarhet | Ingen: samme tekst gir ny lyd hver gang. Filene ligger derfor i git |

Alt er syntetisk. Ingen lyd er opptak av et fly, og stemmen fra tårnet er
ikke en flygeleder. Kallesignalet «Teinum 320» er oppdiktet. Radioteksten
følger vanlig mønster for en landingsklarering, men er ikke kontrollert mot
gjeldende fraseologi.

## Planlagt (ikke i bruk, ikke verifisert ennå)

| Fase | Kilde | Lisens / kreditering | Merknad |
|---|---|---|---|
| 2 | MET Norway `api.met.no` tafmetar | NLOD 2.0 og CC BY 4.0, «Data fra MET Norway» | Krever identifiserende User-Agent med kontaktinfo. Kapsles bak et grensesnitt; skal erstattes av SWIM / OGC API EDR |
| 3 | Avinor flydata XML (`asrv.avinor.no/XmlFeed/v1.0`, `airportNames`, `airlineNames`) | Avinors vilkår må leses og dokumenteres før bruk | Private flyplasser (Torp, Haugesund) mangler |

Eksakte URL-er, parametre og vilkår for disse føres inn her når de er
sjekket mot dokumentasjonen – ikke før.
