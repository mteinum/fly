# Analyser

Tre romlige analyser kjøres som del av `flypipe build` (`pipeline/src/flypipe/analysis.py`).
Alt regnes i EUREF89 UTM 33 på spillrutenettet (10 m). Resultatene står i hvert utsnitts
`metadata.json` under `analysis` og per baneende under `approach`, og som filer i
`data/processed/<utsnitt>/` for kontroll i QGIS.

Tallene under er fra byggingen 2026-11-21.

## 1. Synlighet fra tårnet (dekning)

**Spørsmål:** hvor høyt må et fly være over et punkt for å ses fra kontrolltårnet?

**Metode:** terrenget leses langs stråler ut fra tårnets øyepunkt, én stråle per celle langs
ytterkanten av kartet. Langs hver stråle holdes største høydevinkel så langt; et punkt lenger
ut ses hvis det ligger over den. Jordkrumning og standard brytning (k = 0,13) er med: på 18 km
utgjør de 22 m.

**Kontroll:** flatt hav gir horisont på 21,0 km fra 30 m øyehøyde, som formelen sier. En vegg
gir skygge med riktig høyde bak seg og ingen til siden. På ekte terreng (Kjevik) stemmer
rasteret med en uavhengig siktlinje, regnet punkt for punkt, i over 90 % av 400 tilfeldige celler.
Resten ligger ved kanten av en skygge, der de to metodene leser terrenget i ulike punkter.

| Flyplass | Bakken ses | Fly i 300 m ses |
|---|---|---|
| Kjevik | 4 % | 73 % |
| Sola | 22 % | 99 % |
| Flesland | 13 % | 86 % |
| Gardermoen | 24 % | 100 % |
| Bodø | 39 % | 89 % |

Andelene gjelder kartutsnittet på 25,6 x 25,6 km.

**Hva det ikke sier:**
- Trær og bygninger sperrer ikke sikten i denne modellen. Virkeligheten er dårligere.
- Tårnets plassering og øyehøyde (32 m) er antatt, se docs/datakilder.md. Tallene flytter seg
  med dem.
- Alle 16 innflyginger ses fra tårnet hele veien fra 8 km. Det var ikke et spennende funn, men
  det er svaret.

## 2. Klaring under innflygingen (nærhet)

**Spørsmål:** hvor nær kommer 3°-glidebanen terreng, bygninger og bruer?

**Metode:** for hver 10. meter langs forlenget senterlinje, fra 1000 til 8000 m før baneenden,
sammenlignes glidebanens høyde med det høyeste punktet i et belte på ±150 m. Overflaten er
terrenget med bygninger og bruer fra `structures.json` lagt oppå.

| Baneende | Laveste klaring | Avstand fra baneenden |
|---|---|---|
| Kjevik 03 / 21 | 86 m / 70 m | 1,0 km / 1,8 km |
| Sola 10 / 28 / 18 / 36 | 76 / 42 / 80 / 60 m | ca. 1,0 km |
| Flesland 17 / 35 | 84 m / 94 m | 1,0 km |
| Gardermoen 01L / 19R / 01R / 19L | 87 / 67 / 72 / 56 m | ca. 1,0 km |
| Bodø 07 / 25 | 93 m / 51 m | ca. 1,0 km |
| Mehamn 17 / 35 | 75 m / **9 m** | 1,0 km / 3,4 km |

Mehamn bane 35 er det ene stedet analysen fant noe: glidebanen stryker 9 m over en ås 3,4 km sør for banen.

**Valgene som styrer svaret:**
- **Hvor målingen starter.** Nær banen skal klaringen gå mot null, så et sted må den begynne.
  Med 1000 m ligger laveste klaring nettopp der for de fleste baneendene: tallet sier da mest
  om valget. Bare Kjevik 21 har hinderet lenger ute.
- **Beltebredden.** ±150 m er valgt. Et bredere belte tar med mer terreng og gir lavere tall.
- **Glidebanen er syntetisk** (3° fra baneendene), ikke flyplassens ILS. Tallene er ikke
  hinderfrihet i flyoperativ forstand.
- Høyden på småhus er antatt ut fra bygningstypen, se docs/datakilder.md. To av tallene endret seg med
  et par meter da bygningene fra Matrikkelen kom inn (Sola 28 og Gardermoen 19L).

Samme geometri finnes i spillet (`web/src/guidance.ts`). En test sammenligner glidebanens høyde
8 km ute i de to utgavene for hver baneende.

## 3. Bygningsklynger (tetthet)

**Spørsmål:** hvilke hus hører sammen i en grend eller by, og hvilke står for seg selv?

**Metode:** DBSCAN på bygningspunktene fra Matrikkelen (bygg som står, uten garasjer, uthus og
naust), med avstand 50 m og minst 5 bygninger. Avstanden er regnet i meter i UTM 33.

| Flyplass | Bygninger | Klynger | Andel i klynge | Største |
|---|---|---|---|---|
| Kjevik | 35 751 | 661 | 76 % | 1 516 |
| Sola | 77 319 | 746 | 86 % | 5 946 |
| Flesland | 68 501 | 1 169 | 79 % | 3 314 |
| Gardermoen | 25 008 | 594 | 68 % | 1 257 |
| Bodø | 13 841 | 142 | 81 % | 2 354 |

**Bruk i spillet:** nattlysene. Veier nær en klynge får gatelys; enslige hus har bare lys ved huset.

**Valgene som styrer svaret:**
- **Avstanden.** 50 m er SSBs grense for tettsted (høyst 50 m mellom husene). Med N50, som bare har
  et utvalg av husene, måtte den være 100 m for at grender skulle henge sammen. Da var det
  344 klynger ved Kjevik og 51 % av byggene i klynge; tallene over er ikke sammenlignbare med de gamle.
- **Minste antall.** 5 bygninger er en grend her. SSBs tettsted krever 200 innbyggere.
- **Hva som telles.** Garasjer og uthus er holdt utenfor. Med dem ville nesten hvert hus vært en
  «klynge» på to-tre bygg, og flere ville nådd grensen på 5.
- **Én klynge er ikke én by.** DBSCAN kjeder sammen alt som ligger tett nok. Den største klyngen
  ved Sola (5 946 bygg) er sammenhengende bebyggelse, ikke en kommune eller et tettsted med navn.

## Kjøre selv

```bash
cd pipeline && uv run flypipe build kjevik10
```

Åpne `data/processed/kjevik10/tower_viewshed.tif` (meter over bakken et fly må ha for å ses) og
`building_clusters.gpkg` (kolonnen `cluster`, -1 = står for seg selv) i QGIS.

## Startsted for sightseeingturen

**Spørsmål:** hvor bør en tur over byens signalbygg starte, så flyet kommer inn med byen foran seg og ikke en fjellrygg?

**Metode** (`analysis.sightseeing_start`): midten av signalbyggene er medianen av posisjonene. Fra 16 retninger
prøves en rett linje fra 3,5 km før midten til 4 km forbi. Retningen med lavest høyeste terreng langs linja
velges, og starthøyden er det terrenget pluss 300 m, minst 450 m.

| By | Kurs inn (sann) | Starthøyde |
|---|---|---|
| Kristiansand | 219° | 450 m |
| Stavanger | 105° | 450 m |
| Bergen | 307° | 560 m |
| Ålesund | 307° | 450 m |
| Bodø | 157° | 450 m |
| Tromsø | 26° | 450 m |

Oslo har en tur lagt inn for hånd. Gardermoen og Mehamn har færre enn tre signalbygg og får ingen.

**Valgene som styrer svaret:** avstanden (3,5 km), hvor langt forbi midten linja sjekkes, klaringen og
minstehøyden. Med 2 km forbi midten valgte metoden for Bergen en kurs rett mot Ulriken i 450 m; med 4 km
kommer turen i stedet ned dalen fra sørøst og ut over Vågen. Linja er rett: metoden vet ingenting om hva
som er pent å se, bare hva som er lavt.

