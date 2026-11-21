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
og ikke alle hus er med. I by og tettsted er det ingen enkelthus. 10 m-flisene
bruker derfor Matrikkelen for bygningspunktene (neste avsnitt); N50 gir fortsatt
formen på store bygg, og alle bygninger i 50 m-flisene.

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
4–80 m, flatt tak). 10 m-flisene tar også med
kommunale og private bilveier (1384 km mot 329 km).

### Bygninger: Matrikkelen - Bygningspunkt – Kartverket

| | |
|---|---|
| Fil | `https://nedlasting.geonorge.no/geonorge/Basisdata/MatrikkelenBygning/FGDB/Basisdata_<fylke>_25833_MatrikkelenBygning_FGDB.zip`. Verifisert 2026-11-21 for `42_Agder` (40 MB), `11_Rogaland`, `46_Vestland`, `32_Akershus` og `18_Nordland` |
| Format | Esri filgeodatabase, laget `bygning`, punkt, EPSG:25833 |
| Lisens | CC BY 4.0 (Geonorges kartkatalog, lest 2026-11-21) |
| Kreditering | © Kartverket |
| Kode | `pipeline/src/flypipe/matrikkel.py` |
| Brukes i | 10 m-flisene |

Ett punkt per bygning i Norges offisielle eiendomsregister. Det som tas med:

- Bygg som står: status tatt i bruk, ferdigattest eller midlertidig brukstillatelse.
- Ikke garasjer, uthus og naust (type 181-183). De står inntil hus som alt fyller en 10 m-celle.

Ved Kjevik gir det 35 751 bygninger mot 7 340 bygningspunkter i N50; ved Sola 77 319 mot 6 557.

Begrensninger:
- **Bare et punkt.** Hvert bygg tegnes som én celle på 10 x 10 m, uansett størrelse og retning.
  Store bygg har i tillegg form fra N50.
- **Farge etter type.** Bygningstypen er ekte; fargen er valgt for at typene skal kunne skilles fra lufta
  (boliger teglrødt og grått, blokker lys betong, hytter brunt, industri stålblått, kontor og forretning
  mørkt blågrått, skoler gult, idrett grønt, helse lyst blågrønt, hotell oker, kirker hvitt). Den sier
  ingenting om hvordan taket faktisk ser ut. Forklaringen står i hjelpepanelet i spillet.
- **Ingen høyde.** Høyden er antatt ut fra bygningstypen: 7 m for enebolig, 8 m for rekkehus, 14 m for
  boligblokk, 5 m for fritidsbolig, 8–12 m for næringsbygg og offentlige bygg (`HEIGHT_BY_GROUP` i koden). Det er anslag,
  ikke målinger.
- **Ujevn kvalitet.** Bygg registrert før 1983 har ifølge Kartverket få opplysninger, og punktet er
  ikke alltid kontrollert.
- **Endres fortløpende.** Fylkesfilene lages på nytt jevnlig, så en ny nedlasting kan gi andre tall
  enn de som står her. Rådata caches i `data/raw/matrikkel/`.
- Fila har ID-er for adresse og eiendom per bygning. De leses ikke, og er ikke med i flisene.

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
| ENCN Kjevik | `kjevik10` | Agder | 03/21 | -5,88° (i utsnittets sentrum; -5,89° på flyplassen) | Se under |
| ENZV Sola | `sola10` | Rogaland | 10/28, 18/36 | -8,03° | 6 punkter langs banene: terreng = Rullebane, høyde innenfor 2 m |
| ENBR Flesland | `flesland10` | Vestland | 17/35 | -8,52° | 3 punkter, som over |
| ENGM Gardermoen | `gardermoen10` | Akershus | 01L/19R, 01R/19L | -3,39° | 6 punkter, som over |
| ENBO Bodø | `bodo10` | Nordland | 07/25 | -0,59° | 3 punkter, som over |
| ENMH Mehamn | `mehamn10` | Finnmark | 17/35 | +12,15° | 3 punkter, som over. Referansepunktet transformert likt med Kartverket innen 3 mm |
| ENTC Tromsø | `tromso10` | Troms | 18/36 | +3,68° | 3 punkter, som over |
| ENAL Ålesund | `alesund10` | Møre og Romsdal | 06/24 | -7,89° | 3 punkter, som over. Utsnittet er flyttet 4,5 km sørover så byen er med |

Mehamn ligger 12,8° øst for sentralmeridianen i UTM 33, langt utenfor sonens vanlige bredde. Kartverket
leverer likevel alt i UTM 33, og projeksjonen virker fint så langt ut: målestokkfaktoren er 1,0022 og
konvergensen +12,15°, den eneste positive.

**Banekursen i OurAirports er feil for Mehamn.** Feltet for sann kurs sier 170°, som er banens magnetiske
kurs (bane «17»). Sann kurs, regnet fra baneendene, er 182,4°; misvisningen der er rundt 12°. For de andre
flyplassene stemmer feltet innen 0,4°. Pipeline regner derfor alltid sann kurs fra endepunktene, og beholder
kildens tall som `headingPublishedDeg`. At endepunktene er riktige er kontrollert: tre punkter langs linja
mellom dem ligger på det Kartverket kaller rullebane.

**Innflygingen til bane 35 går tett over terrenget.** En 3° glidebane rett inn fra sør har 9 m klaring over en
ås 3,4 km før banen (analysen i docs/analyser.md). Spillet flyr den slik likevel. Banen er 880 m og brukes i
virkeligheten av mindre fly.

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
| Gatelys og vinduslys (`lights.png`) | `pipeline/src/flypipe/lights.py`: lys på bakken ved annethvert hus (Matrikkelen); 2–18 % av cellene i sentrum, industri og på flyplassen; gatelys på hver 5. veicelle nær bebyggelse, nær en bygningsklynge og på europa-/riksvei | Viser hvor det er vei og bygninger, ikke hvor det faktisk er lys. Hvilke hus som lyser er tilfeldig (fast støyfrø). Hva som er en klynge er et valg (DBSCAN, 50 m, minst 5 bygninger), se docs/analyser.md |
| Rullebanelys | Kantlys hver 60. m, grønne terskellys, 420 m innflygingslys med tverrbjelke | Vanlig mønster, ikke ENCNs faktiske lysanlegg (AIP er ikke slått opp) |
| Lykter på bruer | Hver 30. m langs senterlinja, 8 m over dekket | Syntetisk |
| Bakkedetaljer | `web/src/groundDetail.ts`: mønster per overflateklasse (trekroner, furer, bølger, korn) og uregelmessige klassegrenser, regnet i shaderen | Hvilken klasse som ligger hvor er ekte (N50, `surface.bin`). Mønsteret er ikke: trærne står ikke der trær står, og grensene er forskjøvet opptil ca. 6 m med støy |
| Rullebanemerking | `web/src/runwayDecal.ts`: terskelstriper, banenummer, siktepunkt, midt- og kantlinjer | Baneender, bredde og forskjøvne terskler er ekte (OurAirports). Selve oppmerkingen følger vanlig mønster, ikke ENCNs |
| Stjerner, måne | 1400 tilfeldige punkter; fast, svakt «månelys» ovenfra | Ingen stjernekatalog, ingen månefase |
| Instrumentpanel (A320) | `web/src/panel.ts`. Eget oppsett tegnet etter hvordan hovedpanelet i en A320 er bygget opp; ingen grafikk er hentet fra plakater eller produsent | Ekte fra flymodell og kart: fart, høyde, stigning, kurs, stilling, radiohøyde, peiling og avstand til ENCN, terrengbildet på ND (høydekartet, farget etter høyde i forhold til flyet), klokke. Andre fly på ND er de samme ADS-B-flyene som ellers i spillet, tegnet slik TCAS viser dem (rombe med høydeforskjell i hundre fot, fylt innen 6 NM og 1200 fot); spillet gir ingen trafikkvarsler. Fartstrenden på PFD er målt akselerasjon, og det røde båndet på høydebåndet er bakken under flyet (radiohøyden). FMA på PFD og lysene AP1, A/THR og APPR på FCU viser hva autopiloten (A) gjør; MASTER WARN blinker mens et rødt varsel står på E/WD. Klaff- og understellsvisning, landingsmemoets linjer for understell og klaff, og varslene OVERSPEED, STALL og L/G GEAR NOT DOWN følger flymodellen. Syntetisk: motorverdiene på E/WD (regnet rett fra gasshåndtaket), memolinjene SIGNS/CABIN/SPLRS (alltid grønne), FOB. Motorverdiene følger gasshåndtaket med et valgt etterslep, og skyvegrensen (CL/MCT/TOGA) er N1 ved sperren i samme regnestykke. Fartsmerkene VLS og alfa-vern på PFD er faste forhold til flymodellens steilefart (1,23 og 1,1), QNH står på 1013, og bremsetrykket på understellspanelet er tegnet. Nedre ECAM-skjerm (SD) viser WHEEL-siden: luftbremsene (spoiler 2-4 på hver vinge), understellets stilling og klokka er ekte, mens bremsetemperaturene, vekten og lufttemperaturene (standardatmosfære fra høyden, TAT fra farten) er syntetiske. To avvik fra flyet: de to ECAM-skjermene er mindre enn PFD og ND (i flyet er alle seks like store), og spakene fra midtkonsollen står på hver side av SD fordi konsollen ellers ikke ville vært i bildet. Knapper, dreieknapper og lamper uten funksjon i spillet (EFIS-panelene, AP2, LOC, EXPED, AUTO BRK, MASTER CAUT, AUTO LAND m.fl.) er tegnet for at panelet skal ligne og kan ikke betjenes. FCU: streker med prikk i SPD og HDG betyr at flyet styrer verdien selv; med autopiloten på vises farten og kursen den holder. ALT-vinduet viser høyden innflygingen startet i (syntetisk: spillet har ingen klarert høyde). Høydebåndet viser høyde over havet (NN2000) uten trykkorreksjon, og kursen er sann, ikke magnetisk |
| Kontrolltårnet | Posisjon fra pipeline (`airports.tower_position`), interiør i `web/src/towerPanel.ts` | Ekte: tårnet står på N50-bygningen med bygningstype 411 (ekspedisjonsbygning, flyterminal, kontrolltårn) nærmest referansepunktet. Typen sier ikke om bygningen er terminal eller tårn, og ikke hvor på den tårnet står. Antatt: punktet på bygningen nærmest rullebanen, øyehøyde 32 m over bakken, tårnets form. Radarbildet viser flyets faktiske posisjon, høyde og fart. Syntetisk: kallesignalet TFY320, vind (alltid vindstille, flymodellen har ingen), QNH, lyspanelet og hele innredningen |
| Autopilot | `web/src/autopilot.ts`. Tre proporsjonalregulatorer (kurs mot senterlinja, høyde mot 3°-glidebanen, fart) og en tabell for når understell og klaffer settes ut | Syntetisk og regelstyrt: ingen maskinlæring og ingen språkmodell. Tallene er valgt for spillets flymodell, ikke hentet fra en A320. Den følger den samme syntetiske glidebanen som PFD viser, ikke flyplassens ILS |
| Flylogg og gjennomgang | `web/src/flightlog.ts` skriver en logg per innflyging; `pipeline/src/flypipe/debrief.py` regner ut avvik, fart mot grensene og terrenget under flyet | Ekte fra flymodellen: posisjon (EPSG:25833), høyde, fart, stilling, hendelser. Terreng og stedsnavn i gjennomgangen er fra flisene (DTM og N50). Syntetisk: kriteriene for «stabilisert innflyging» ved 1000 og 500 fot er spillets egne, med vanlige flyselskapskriterier som forbilde. Loggen inneholder ingenting om spilleren og sendes ingen steder fra den publiserte siden |
| Analyser | `pipeline/src/flypipe/analysis.py`, beskrevet i docs/analyser.md | Regnet fra ekte data (DTM, N50-bygninger, baneender). Antatt eller valgt: tårnets plassering og øyehøyde, glidebanen (3°, syntetisk), beltebredden for klaring og klyngeparametrene. Synligheten tar ikke med trær og bygninger |
| Kirketårn | `structures.church_towers` i pipeline, tegnet i `web/src/glRenderer.ts` | Ekte: hvilke bygg som er kirker (Matrikkelen, type 671), og tårnets plass og høyde, målt som høyeste punkt i DOM 1 m innen 20 m fra kirkens punkt (minst 16 m over terrenget og smalt øverst). Forbehold: et høyt, slankt tre kan bli tatt for et tårn, og tynne spir kommer ikke med i DOM, så tårnene er minst så høye som vist (Kristiansand domkirke måles til 58 m). Syntetisk: formen. Alle tårn tegnes like, 5 m brede med spir på den øverste tredjedelen |
| Fyr | `structures.lighthouses` i pipeline, tegnet i `web/src/glRenderer.ts` | Ekte: hvilke steder som er fyrstasjon eller fyrlykt og hvor de ligger (N50 og stedsnavnregisteret), og tårnhøyden på fyrstasjoner, målt i DOM 1 m som for kirkene (Oksøy 36,5 m, Grønningen 14,1 m). Syntetisk: formen (hvitt tårn med rød topp), høyden på lykter (5 m), og hele lyset. Alle blinker hvitt med ett kort blink hvert 4.–9. sekund, i en takt valgt fra posisjonen. Ekte fyr har hver sin karakter, farge og sektorer; Kystverkets register over navigasjonsinnretninger er ikke undersøkt |
| Veitunneler | `n50.tunnel_lines` i pipeline, tegnet i `web/src/glRenderer.ts` | Ekte: hvor tunnelen går (N50, veier med medium = U, minst 150 m) og navnet. Syntetisk: at den synes. En tunnel ses ikke fra lufta; den tegnes som stiplet linje oppå bakken og sjøen, slik et kart gjør. Tunnelnavn uten ordet «tunnel» har fått «(tunnel)» lagt til |
| Klaffer og slats på flyet | `web/src/glRenderer.ts` | Stillingen følger flymodellen. Utslagene per stilling (klaff 0/10/15/20/35°, slats 0/18/22/22/27°) er A320-tall slik jeg husker dem, ikke kontrollert mot kilde. Formen er syntetisk: flate plater langs vingekantene |
| Luftbremser | `web/src/physics.ts` (B), tegnet i `web/src/glRenderer.ts` | Syntetisk: motstanden (26 m/s lavere toppfart), tiden ut og inn (1,2 s) og utslaget (40°) er valgt for spillet. At de er sperret med full klaff er slik jeg husker A320, ikke kontrollert mot kilde. Ingen bakkespoilere etter landing |
| UiA-skiltet | `data/landmarks.json`, tegnet i `web/src/main.ts` | Ekte: posisjonen (stedsnavnregisteret, «Universitetet i Agder»). Logoen er UiAs merke fra universitetets LaTeX-mal for oppgaver og tilhører universitetet. Den er lagt inn på prosjekteierens ønske for å merke campus; bruken er ikke avklart med UiA |
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

## Undersøkt: flere og bedre bygninger (2026-11-21)

Matrikkelen er tatt i bruk etter denne undersøkelsen (se over). De andre kildene er ikke i bruk.

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

## Undersøkt og tatt i bruk: bygningsomriss fra OpenStreetMap (2026-11-21)

I bruk i alle 10 m-utsnittene. Kode: `pipeline/src/flypipe/osm.py` og `footprints.py`. Lisens og
kreditering: `data/osm/LICENSE.md`. Alle tak er flate.

| Utsnitt | Bygg med form | Matrikkel-bygg uten omriss (bokser) | Høyde målt i DOM | Trekanter i spillet |
|---|---|---|---|---|
| Kjevik | 33 037 | 2 604 | 4 635 | 0,71 mill. |
| Sola | 74 247 | 3 160 | 11 468 | 1,61 mill. |
| Flesland | 65 453 | 3 126 | 9 677 | 1,44 mill. |
| Gardermoen | 24 013 | 1 746 | 4 180 | |
| Bodø | 13 813 | 388 | 1 779 | |

Høyden er målt (median av DOM - DTM innenfor omrisset) for bygg som dekker minst tre 10 m-celler, regnet fra
etasjetall der OSM har det, og ellers antatt etter bygningstype. Det siste gjelder de fleste småhus.

Spørsmålet var om OpenStreetMap kan gi husene form i stedet for bokser, og hva lisensen krever.

**Dekning** (bygningssentre hentet med Overpass API for hvert utsnitt, sammenlignet med Matrikkelen):

| Utsnitt | OSM-bygg | Med matrikkelens bygningsnummer | Matrikkelbygg med OSM-omriss innen 20 m | Med etasjetall |
|---|---|---|---|---|
| Kjevik | 53 849 | 97 % | 95 % | 8 % |
| Sola | 112 306 | 97 % | 97 % | 12 % |
| Flesland | 109 141 | 97 % | 98 % | 14 % |
| Gardermoen | 38 645 | 88 % | 95 % | 3 % |
| Bodø | 23 486 | 81 % | 98 % | 10 % |

Dekningen er nesten like god i spredtbygde strøk (92–96 %) som i tettbygde (96–99 %). Høyde mangler
(under 1 % har `height`). Omrissene har i snitt 7–10 hjørner. I Kvadraturen er 33 % av byggene mindre enn
én 10 m-celle og 16 % større enn fire.

**Hvor omrissene kommer fra.** OSM-wikien (Norway Building Import) sier de er importert fra Kartverkets
«INSPIRE Buildings Core2D» fra 2021, under CC BY 4.0, med `ref:bygningsnr` fra Matrikkelen. Den kilden
kan ikke lenger hentes direkte: katalogoppføringen gir 404, WFS-tjenesten svarer «ukjent applikasjon»,
og importverktøyet (NKAmapper/building2osm) skriver at tjenesten ikke leverer polygoner. Det eneste
Kartverket har ute er et kartbilde (WMS) med ikke-kommersiell lisens. OSM er dermed eneste åpne kilde
til omrissene som vektordata.

**Lisensen (ODbL 1.0)**, lest fra OSM Foundations sider og lisensteksten:
- Kreditering: «© OpenStreetMap contributors» med lenke til openstreetmap.org/copyright. For spill er
  en kredittside eller om-skjerm nok.
- En fil med omrissene (også omregnet til våre koordinater og med høyder lagt til) er etter en forsiktig
  lesning en avledet database, og må da tilbys under ODbL. Retningslinjene avgjør ikke dette for en
  vektorfil som leses av et spill. Koden kan fortsatt være MIT.
- Kravet om å tilby den avledede databasen er oppfylt når selve fila ligger åpent ute med lisensmerknad.
- Kartverkets data i samme fil (bygningstype, høyde) kan trolig holdes utenfor delingskravet når hver
  egenskap kommer helt fra én kilde, men retningslinjene dekker ikke tilfellet vårt direkte.
- Skjermbilder og video er «Produced Works»: de trenger kreditering, ikke lisens.
- OSM Foundation sier selv at veiledningen ikke er juridisk rådgivning.

**Teknisk løsning:** omrissene hentes med `flypipe osm` (Overpass, for hånd) og lagres i `data/osm/` i git
(1,2 MB for Kjevik), fordi Overpass ofte svarer 502 og bygget ikke skal avhenge av den. Spillet tegner
omrissene som vegger og flatt tak. Kollisjon bruker fortsatt 10 m-cellene under byggene.

## Undersøkt og tatt i bruk: skipstrafikk fra AIS (2026-11-21)

I bruk: Kystverkets åpne AIS-strøm leses av en liten PHP-tjeneste på webhotellet (`web/public/ais/`), og
spillet tegner skipene ved Kjevik, Sola, Flesland og Bodø (`web/src/ships.ts`). Kreditering:
«Ship positions: Kystverket (NLOD)» i spillet og på om-skjermen.

- **Ekte:** hvilke skip som er der, posisjon, kurs, fart, navn, type, mål, destinasjon og hvor på skipet antenna
  står, slik skipet selv sender det. Skroget tegnes rundt skipets midtpunkt, ikke rundt antenna.
  Destinasjonen er skrevet inn for hånd om bord og er ofte rar eller gammel. Destinasjoner med seks sifre eller
  mer vises ikke (noen skriver telefonnummer der).
- **Syntetisk:** skipets form og farge, og bevegelsen mellom to meldinger (rett fram med samme fart, høyst 2,5 min).
- **Ikke med:** fiskefartøy under 15 m og fritidsfartøy under 45 m (ikke i de åpne dataene), og skip som ikke er
  hørt på ti minutter.
- **Kontroll:** PHP-koden tolker et opptak av strømmen (2013 linjer, `tests/fixtures/ais_sample.txt`) likt med en
  uavhengig tolking i Python med pyproj: 68 skip, samme posisjon innen 15 cm og samme opplysninger. UTM-formelen
  i PHP treffer Kartverkets fasitpunkter innen en millimeter.
- **Prøvd på webhotellet:** PHP der når strømmen (tilkobling på 6 ms, 120–170 meldinger på 4 s).

Undersøkelsen som lå til grunn:

Spørsmålet var om ekte skip kan vises ved kystflyplassene (Kjevik, Sola, Flesland, Bodø).

| Kilde | Hva | Tilgang | Kontrollert |
|---|---|---|---|
| Kystverkets åpne AIS-strøm | Rå AIS-meldinger i sanntid (IEC 62320-1) over TCP, `153.44.253.27` port `5631` | Ingen registrering | Koblet til i 12 s: 38 meldinger/s, 228 fartøy med posisjon, derav 3 ved Kristiansand, 5 ved Stavanger, 13 ved Bergen og 3 ved Bodø |
| BarentsWatch Live AIS | Samme data som JSON over HTTPS, `live.ais.barentswatch.no` | Gratis, men krever registrert klient og hemmelig nøkkel (OAuth2, `id.barentswatch.no/connect/token`, scope `ais`) | Bare dokumentasjonen er lest. Endepunktene står i en Swagger-side som ikke lot seg lese |
| BarentsWatch Historic AIS | Spor per fartøy, `historic.ais.barentswatch.no` | Som over | Dokumentasjonen oppgir «No data older than 14 days» |
| Kystdatahuset (Kystverket) | Historiske AIS-data, «tilgjengelig for alle» | Ikke avklart | API-siden lot seg ikke lese |

Felles for de åpne dataene (Kystverket og BarentsWatch):
- **Lisens:** NLOD. Kystverket: «Ekstern bruk av Kystverkets AIS-data må krediteres Kystverket.» BarentsWatch
  krever teksten «Data levert av BarentsWatch», godt synlig.
- **Ikke med:** fiskefartøy under 15 m og fritidsfartøy under 45 m. Det meste av småbåttrafikken mangler altså.
- **Dekning:** Kystverkets landstasjoner langs hele kysten, pluss stasjoner til havs og satellitt.

Hvorfor det ikke kan brukes direkte fra spillet:
- En nettleser kan ikke åpne en rå TCP-forbindelse, så Kystverkets strøm trenger en mellomstasjon på en server.
- BarentsWatch krever en hemmelig nøkkel. Den kan ikke ligge i nettleseren.
- Webhotellet har PHP (delingssiden), men spillet er ellers statisk.

Valgt løsning: et lite PHP-skript på webhotellet som leser Kystverkets strøm direkte (ingen nøkkel) og gir
spillet posisjonene. Det lytter bare når noen spiller.

## Flytrafikk: adsb.lol (2026-11-21)

Andre fly rundt flyplassene hentes fra adsb.lol, et åpent nettverk av frivillige ADS-B-mottakere, via en
PHP-tjeneste på webhotellet (`web/public/traffic/`). Spillet tegner dem (`web/src/traffic.ts`).

| | |
|---|---|
| Endepunkt | `https://api.adsb.lol/v2/lat/<lat>/lon/<lon>/dist/<nautiske mil>` (kontrollert ved å kalle det 2026-11-21) |
| Lisens | Open Database License (ODbL) 1.0. Kreditering i spillet: «Aircraft positions: adsb.lol (ODbL)» |
| Grense | 500 forespørsler per døgn per IP-adresse uten nøkkel. Tjenesten bruker høyst 440 |
| Brukes | posisjon, GPS-høyde, trykkhøyde, fart, kurs, stigning, kallesignal, flytype og kategori |
| Brukes ikke | registrering (for småfly peker den på eieren) og resten av det flyet sender |

- **Ekte:** hvilke fly som er der, hvor, hvor høyt, kurs, fart og stigning.
- **Syntetisk:** flyets form (skalert etter kategorien det sender), og bevegelsen mellom oppdateringene (rett
  fram med samme fart og stigning, høyst 90 s). Det er opptil 45 s mellom oppdateringene, så fly i sving og
  under landing ligger litt feil.
- **Høyde:** flyene sender GPS-høyde over ellipsoiden. Geoidehøyden trekkes fra for å få NN2000: 40,7 m ved
  Kjevik, 43,8 ved Sola, 44,8 ved Flesland, 38,3 ved Gardermoen og 31,4 i Bodø (regnet med pyproj og
  Kartverkets høydereferansemodell, lagret i `data/geoid.json`). Mangler GPS-høyden, brukes trykkhøyden, som
  kan være over hundre meter feil; i prøven skilte de to 376 m for et fly i 36 000 fot.
- **Dekning:** avhenger av hvor frivillige har mottakere. Ikke kartlagt for Norge. Da prøven ble tatt (en
  lørdag kveld) var det 3 fly ved Gardermoen, 1 over Kjevik og ingen ved Flesland.
- **Kontroll:** PHP-koden gir samme resultat som en uavhengig tolking i Python med pyproj for tre lagrede svar.
  Prøven er liten (fire fly), så egne tilfeller dekker resten: bare trykkhøyde, uten høyde, gammel posisjon,
  utenfor ruta, rar tekst.

Undersøkt, ikke valgt: adsb.fi (raus grense, men «for personal, non-commercial use only»), OpenSky Network
(krever konto og hemmelig nøkkel; vilkårene lot seg ikke lese), airplanes.live (dokumentasjonen lot seg ikke
lese). Avinors flydata er rutetider og status, ikke posisjoner.

### Lyd: ElevenLabs (generert)

| | |
|---|---|
| Tjenester | `POST https://api.elevenlabs.io/v1/sound-generation` (lydeffekter) og `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` (tale, modell `eleven_multilingual_v2`). Verifisert 2026-11-20 |
| Nøkkel | `ELEVENLABS_API_KEY` i miljøet. Brukes bare av `pipeline/src/flypipe/audio.py` |
| Innhold | 11 lydeffekter (motor, vind, tårnrom, understell, klaff, luftbremser, landing, krasj, plask, varsel, radioklikk) og 18 taleklipp (høydeutrop, «retard», «too low, gear», «stall», og fire meldinger fra tårnet). Tekst og stemme per fil står i `web/public/audio/manifest.json` |
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
