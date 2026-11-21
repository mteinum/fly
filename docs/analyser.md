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
| Sola 10 / 28 / 18 / 36 | 76 / 43 / 80 / 60 m | ca. 1,0 km |
| Flesland 17 / 35 | 84 m / 94 m | 1,0 km |
| Gardermoen 01L / 19R / 01R / 19L | 87 / 67 / 72 / 58 m | ca. 1,0 km |
| Bodø 07 / 25 | 93 m / 51 m | ca. 1,0 km |

**Valgene som styrer svaret:**
- **Hvor målingen starter.** Nær banen skal klaringen gå mot null, så et sted må den begynne.
  Med 1000 m ligger laveste klaring nettopp der for de fleste baneendene: tallet sier da mest
  om valget. Bare Kjevik 21 har hinderet lenger ute.
- **Beltebredden.** ±150 m er valgt. Et bredere belte tar med mer terreng og gir lavere tall.
- **Glidebanen er syntetisk** (3° fra baneendene), ikke flyplassens ILS. Tallene er ikke
  hinderfrihet i flyoperativ forstand.
- Bygningshøyder under 10 m-oppløsning er nominelle for små hus, se docs/datakilder.md.

Samme geometri finnes i spillet (`web/src/guidance.ts`). En test sammenligner glidebanens høyde
8 km ute i de to utgavene for hver baneende.

## 3. Bygningsklynger (tetthet)

**Spørsmål:** hvilke hus hører sammen i en grend, og hvilke står for seg selv?

**Metode:** DBSCAN på N50-bygningene (punkter, og tyngdepunktet for bygninger som er flater),
med avstand 100 m og minst 5 bygninger. Avstanden er regnet i meter i UTM 33.

| Flyplass | Bygninger | Klynger | Andel i klynge | Største |
|---|---|---|---|---|
| Kjevik | 8 098 | 344 | 51 % | 144 |
| Sola | 8 407 | 315 | 39 % | 108 |
| Flesland | 12 726 | 537 | 64 % | 160 |
| Gardermoen | 6 481 | 242 | 42 % | 119 |
| Bodø | 2 922 | 115 | 52 % | 67 |

**Bruk i spillet:** nattlysene. Veier nær en klynge får gatelys, og hus i en klynge har oftere
lys i vinduet enn enslige hus. Ved Kjevik ga det 29 % flere lyse celler, alle utenfor de bebygde flatene eller langs veier nær en klynge.

**Valgene som styrer svaret:**
- **Avstanden.** SSB regner tettsted med høyst 50 m mellom husene. N50 er generalisert for
  1:50 000 og har ikke med alle hus, så 50 m ville delt grender i småbiter. 100 m er valgt, ikke målt.
- **Minste antall.** 5 bygninger er en grend her. SSBs tettsted krever 200 innbyggere.
- **Hva som mangler.** I by og tettsted tegner N50 bebyggelsen som flate, ikke som hus.
  Klyngene viser derfor spredt bebyggelse, ikke byene: «største klynge 144» er ikke Kristiansand.
  Byene får lys fra arealdekket som før.

## Kjøre selv

```bash
cd pipeline && uv run flypipe build kjevik10
```

Åpne `data/processed/kjevik10/tower_viewshed.tif` (meter over bakken et fly må ha for å ses) og
`building_clusters.gpkg` (kolonnen `cluster`, -1 = står for seg selv) i QGIS.
