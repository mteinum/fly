# Resampling av DTM: 1 m -> 50 m

## Metode

1. **1 m -> 10 m: tjenesten (WCS, `INTERPOLATION=bilinear`).**
   Utsnittet er 25,6 x 25,6 km. I 1 m ville det vært 655 millioner celler
   (2,6 GB), så vi lar tjenesten levere 10 m (2560 x 2560, fire kall).
2. **10 m -> 50 m: blokkmiddel 5 x 5 i pipeline** (`terrain.block_mean`).
   Hver spillcelle er det aritmetiske middelet av de 25 kildecellene den dekker.

Rutenettet er snappet til hele 50 m i UTM 33, så blokkene faller nøyaktig på
kildens cellekanter. Ingen reprojisering og ingen forskyvning: kilden er
allerede i EPSG:25833.

## Hvorfor blokkmiddel

- En 50 m-celle i spillet representerer en flate, ikke et punkt. Middelverdien
  er den beste enkeltverdien for flaten (minst kvadratfeil) og bevarer volumet.
- Nearest neighbour (ett punkt per celle) gir aliasing: en celle kan tilfeldig
  treffe en knaus eller en bekkedal, og terrenget blir «saltet».
- Bilineær/kubisk fra 10 m til 50 m bruker bare 4/16 nærmeste punkter og
  kaster resten – i praksis punktsampling med en liten utjevning.
- Maks (for å bevare topper) ville vært tryggere for flyging, men løfter hele
  terrenget og ødelegger kystlinja og rullebanehøyden.

Ulempen er at **topper og rygger kuttes** og daler fylles. Eksempel:
Moseidvarden er 315,2 m i DTM 1 m og 312,7 m i spillet. I brattere terreng
enn Sørlandet blir avviket større; det må vurderes på nytt i fase 3.

## Hva tjenesten gjør (målt)

Trinn 1 er en svart boks: ArcGIS ImageServer velger selv pyramidenivå og
interpolerer derfra. Vi målte den mot fasiten vi egentlig ville hatt
(blokkmiddel 10 x 10 av 1 m-data) på 1 km² ved Kjevik (93500–94500 Ø,
6472000–6473000 N):

| `INTERPOLATION` | RMSE mot blokkmiddel | Maks avvik |
|---|---|---|
| (standard = nearest) | 0,92 m | 7,6 m |
| `bilinear` | 0,25 m | 3,2 m |
| `bicubic` | 0,20 m | 2,4 m |

Ingen av variantene er eksakt lik verken blokkmiddel eller punktsampling av
1 m-dataene. Vi bruker `bilinear`: nær blokkmiddel, og uten oversving
(kubisk kan gi verdier utenfor kildens verdiområde ved skrenter). Feilen
midles videre ned i trinn 2.

## Kontroll

- `pipeline/tests/test_tiles.py::test_heightmap_equals_block_mean_of_source`:
  hele flisen er lik blokkmiddelet av rådataene (fanger mosaikk-, rad- og
  byte-rekkefølgefeil).
- `test_game_height_matches_kartverket_points` og `web/src/terrain.test.ts`:
  høyden spillet bruker er innenfor ±5 m av Kartverkets punkt-API (DTM 1 m)
  i fem punkter. Faktiske avvik: 0,2–0,4 m på flatmark, 2,5 m på Moseidvarden.

±5 m holder her fordi punktene ligger på flater eller en slak topp. Det er
ikke en garanti for hele kartet: i en bratt skrent kan middelet over 50 m
avvike mer enn 5 m fra et enkeltpunkt, uten at noe er feil.

## Flisformat

`heightmap.f32` er rå Float32 (little-endian), ikke 16-bit PNG. Canvas-API-et
i nettleseren leser bilder som 8 bit per kanal, så en 16-bit PNG ville krevd
egen PNG-dekoder. Float32 leses direkte med `new Float32Array(buffer)` og
beholder desimalene.

## Arealdekke: vektor -> 50 m (flertall)

Arealdekke er kategorisk, så middelverdi gir ikke mening (middelet av «skog»
og «innsjø» er ikke «myr»). Polygonene fra N50 rasteriseres først til 10 m
(celle = klassen i cellesenteret), og hver 50 m-celle får klassen som dekker
flest av de 25 delcellene (`landcover.majority`). Ved likt antall vinner
laveste kode.

Alternativet, å ta klassen i sentrum av 50 m-cella, er nearest neighbour og
gir samme aliasing som for høyde: en smal elv treffes eller bommes tilfeldig.

Ulempen med flertall er at smale objekter kan forsvinne når de aldri dekker
flest delceller. I Kjevik-utsnittet holder Topdalselva og Otra seg
sammenhengende, men bekker og småtjern under ca. 1 dekar blir borte.

## Vektor -> rutenett for veier, bruer og bygninger

- Veier: linjer brennes som sammenhengende 1-celle-streker. En 50 m-celle er
  mye bredere enn veien, så veinettet er sterkt overdrevet i bredde.
- Bygninger: én celle per bygningspunkt. Flere bygninger i samme celle blir
  én.
- Bruer: cellene senterlinja går gjennom, med høyde fra DOM.

## 10 m-flisene (3D-modus)

- **Høyde:** tjenestens 10 m-rutenett (`bilinear`) brukes direkte, uten eget
  blokkmiddel. Det er samme rådata som 50 m-flisene bygger på, så de to
  flissettene er konsistente: 50 m-flisen er nøyaktig blokkmiddelet av
  10 m-flisen. Avviket mot Kartverkets punkt-API er under 2 m i alle fem
  fasitpunktene. Prisen er at hele resamplingen fra 1 m er tjenestens (målt
  RMSE 0,25 m mot blokkmiddel, se over).
- **Arealdekke:** rasteriseres direkte til 10 m (klassen i cellesenteret).
  Flertall fra et finere rutenett ville ikke gitt mer: N50 er generalisert
  for 1:50 000 og er grovere enn 10 m i utgangspunktet.
- **Bygningshøyde:** DOM og DTM i 10 m, differansen tatt per celle og
  medianen innenfor hver bygningsflate. Fungerer for bygg som dekker minst
  tre celler; et enkelt hus er mindre enn en celle og kan ikke skilles fra
  trærne rundt i 10 m-data.

## Skygge: fra bakt hillshade til normalkart

Med tid på døgnet kan ikke skyggen ligge i fargekartet (den var regnet for
sol i sørvest, 28° høyde). 10 m-fargekartet er derfor ren flatefarge, og
spillet regner et normalkart fra høydekartet ved oppstart: flatenormal fra
sentraldifferanser i samme 10 m-rutenett, med helningen overdrevet 1,5 x så
det lave terrenget får synlig relieff. Lyset er vanlig Lambert-skygge mot
solretningen, omregnet fra sann asimut til rutenettet med
meridiankonvergensen. 50 m-flisene har fortsatt bakt hillshade.
