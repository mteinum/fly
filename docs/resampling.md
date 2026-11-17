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
