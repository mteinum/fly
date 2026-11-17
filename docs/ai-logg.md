# AI-logg

Logg over feil, feilantakelser og rettelser gjort av KI-assistenten (Claude)
underveis. Til bruk i refleksjon for IS-930. Nyeste fase nederst.

Hver post: hva som ble antatt, hva som var riktig, hvordan det ble oppdaget,
og hva som ble endret.

## Fase 1 (2026-11-17)

### Feil som ble gjort og rettet

**1. Antok at avstand i rutenettet = publisert banelengde (målestokk)**
- Antatt: en test i `web/src/physics.test.ts` forventet at bane 21-innflygingen
  startet nøyaktig `lengthM + 4000` m fra baneende 03.
- Riktig: avstanden mellom baneendene i UTM 33 er 2041,5 m, mens publisert
  lengde er 2035,1 m. Geodetisk avstand mellom kildens koordinater er
  2038,2 m (3 m fra publisert lengde), og UTM 33 har målestokkfaktor 1,0016
  ved Kjevik, som legger på 3,3 m til.
- Oppdaget: testen feilet med 6,4 m avvik.
- Rettet: testen måler mot lengden i rutenettet. Regel 6 i CLAUDE.md.
- Lærdom: jeg hadde selv regnet ut målestokkfaktoren og skrevet den til
  metadata, og antok likevel eksakt likhet et annet sted.

**2. Antok at stedsnavnregisterets lon/lat og UTM-koordinater var utbyttbare**
- Antatt: pyproj(SSR lon/lat) skulle treffe SSR sin egen UTM 33-koordinat på
  centimeteren, og kunne brukes som fasit med toleranse 0,01 m.
- Riktig: SSR leverer lon/lat avrundet til 5 desimaler (ca. 1 m). Avviket var
  0,4 m for domkirken og 0,5 m for Moseidvarden.
- Oppdaget: ved å sammenligne tre verdier før fasiten ble skrevet: SSR-UTM,
  Kartverkets transformasjons-API og pyproj. De to siste var like til 0,1 mm.
- Rettet: transformasjons-API-et er fasit (0,01 m); SSR-UTM testes separat
  med 1 m toleranse.

**3. Antok at høyde-API-et alltid svarer med DTM**
- Antatt: `hoydedata/v1/punkt` kunne brukes som høydefasit overalt.
- Riktig: over sjø svarer det med dybde (−43,7 m i Topdalsfjorden, fra
  dybdekurver), og over regulert innsjø med reguleringshøyde (41,0 m der DTM
  har 38,1 m).
- Oppdaget: avvik på 3 m og 44 m i første sammenligning; feltet `datakilde`
  forklarte det.
- Rettet: bare punkter med `datakilde: dtm1` er med i fasiten.

**4. Antok at WCS-tjenesten nedsampler på en kjent måte**
- Antatt: 10 m fra tjenesten ville være enten punktsampling eller middel av
  1 m-dataene.
- Riktig: ingen av delene; standard interpolasjon avvek opptil 7,6 m fra
  blokkmiddel på flyplassområdet.
- Oppdaget: målt eksplisitt før metoden ble valgt (docs/resampling.md).
- Rettet: `INTERPOLATION=bilinear` (RMSE 0,25 m) og eget blokkmiddel til 50 m.

**5. Personopplysning i User-Agent**
- Første utkast av `USER_AGENT` inneholdt brukerens e-postadresse (tenkt på
  MET sine krav). Kartverket og OurAirports trenger ikke det. Fjernet før
  første pipeline-kjøring; adressen ble ikke sendt. MET krever kontaktinfo i
  fase 2 – da må brukeren velge hva som skal stå.

**6. Verktøy: `uv sync` før pakken hadde kildefiler**
- Første `uv run flypipe` ga `ModuleNotFoundError`, fordi pakken ble
  installert mens `src/flypipe/` var tom. Løst med
  `uv sync --reinstall-package flypipe`. Ikke GIS-relatert.

**7. Antok objekttypenavn i N50 (veier, bruer og bygninger lagt til etter fase 1)**
- Antatt: veier har `objtype = VegSenterlinje` (navnet fra SOSI-standarden).
- Riktig: i N50-filgeodatabasen heter det `Veglenke`.
- Oppdaget: filteret ga 0 veier og 0 bruer, uten feilmelding.
- Rettet: listet faktiske verdier (`groupby objtype, medium`) før filteret ble
  skrevet. Lærdom: et filter på en gjettet attributtverdi feiler stille.

**8. Bygningsflater mindre enn en celle**
- Antatt: bygningsflater kunne rasteriseres som polygoner.
- Riktig: medianflaten er 1700 m², en celle er 2500 m². Rasterisering tar
  bare celler med sentrum innenfor polygonet, så de fleste ville forsvunnet.
- Oppdaget: ved å se på arealfordelingen før koden ble kjørt.
- Rettet: hver flate brennes også inn som et punkt (`representative_point`).

**9. Antok at navnepunktet for en bru ligger midt på brua**
- Antatt: testen krevde sjø i DTM-en innen 100 m av SSR-punktet for Varoddbrua.
- Riktig: punktet ligger ved landkaret; cellene rundt er 0,3–11,5 m.
- Oppdaget: testen feilet. Brua selv lå riktig.
- Rettet: testen ser på hele brua innen 500 m og krever at minst 6 celler
  ligger over sjø.

### Feller som ble unngått (og hvordan det ble kontrollert)

Disse gikk riktig første gang, men er nettopp den typen feil loggen skal
fange. De er tatt med fordi «det ble riktig» ikke er det samme som «det ble
kontrollert».

**Rullebaneretning: sann kurs er ikke rutenettretning.** OurAirports oppgir
35° sann for bane 03. Brukt direkte i UTM 33 ville banen ligget 5,9° feil
(ca. 210 m sideveis i enden av banen). Retningen regnes i stedet fra de to
transformerte baneendene: 40,84°. Kontroll: 40,84 − 5,89 = 34,95°.

**Fortegn på meridiankonvergensen.** Definert som `sann = rutenett + konv`,
regnet numerisk (gå 1 km mot sann nord, mål retningen i rutenettet), og
testet mot PROJ sin analytiske verdi og mot fortegnsskifte over
sentralmeridianen (0 ved 15° Ø, positiv ved 20° Ø).

**Akseretning (y mot sør).** Rasterrad 0 er nord, og spillets y øker mot
sør, så nordover er `y -= cos(hdg)`. Kontroll: Moseidvarden er et lokalt
maksimum i riktig celle (speilvending ville lagt toppen et annet sted),
domkirken har mindre x og større y enn flyplassen, og bane 03 har økende x
og minkende y.

**Lon/lat-rekkefølge.** `always_xy=True` overalt, og en test som feiler hvis
øst/nord havner utenfor Kjevik-området.

**Solretning i hillshade.** Asimut 225° er sann retning og er korrigert til
230,9° i rutenettet. Syntetiske skråplan tester at sørvendt li er lysest med
sol i sør, vestvendt med sol i vest.

**16-bit PNG.** Oppgaven åpnet for 16-bit PNG som høydekart. Nettleserens
canvas leser bare 8 bit per kanal, så det ville gitt 256 høydenivåer uten
feilmelding. Valgte Float32.

**Bruer finnes ikke i terrengmodellen.** En DTM er bakken uten bruer, så
høyden under Varoddbrua er 0 (sjø). Brua er bare farge i fargekartet og
ligger flatt på vannet. Verken skiver eller Voxel Space kan vise noe med
luft under, så en bru i riktig høyde krever en egen tegnemåte.

### Åpne spørsmål / ikke kontrollert

- OurAirports er ikke sjekket mot gjeldende AIP Norge, bare mot DTM og
  intern konsistens.
- Det visuelle er kontrollert med to skjermbilder (ett per kamera) i
  hodeløs Chrome, ikke ved faktisk spilling. Flyfølelse, landing og
  kameraskala er ikke prøvd for hånd.
