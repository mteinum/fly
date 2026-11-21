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

**10. Antok arealdekke ut fra hva stedet «er»**
- Antatt: Kristiansand domkirke ligger i klassen bymessig bebyggelse eller
  tettbebyggelse.
- Riktig: N50 har Torvet rundt kirken som `ÅpentOmråde`. Kartverkets punkt-API
  hadde sagt det samme (`terreng: ÅpentOmråde`) da høydefasiten ble hentet.
- Oppdaget: testen feilet.
- Rettet: testen forventer det kilden sier. Lærdom: jeg skrev fasiten fra
  egen forestilling, selv om svaret alt lå i en tidligere API-respons.

**11. Feilsøkingsposisjoner inne i terreng og bygninger**
- For å ta skjermbilde av Varoddbrua fra cockpit gjettet jeg posisjoner «over
  fjorden sør for brua». Begge lå på land (én inne i en bygning), og flyet
  krasjet i første bilde. Åpent vann ligger nord for brua.
- Rettet: slo opp vannceller i landcover-flisen i stedet for å gjette.

**12. Lovet mer enn dataene holder: bygningshøyder fra DOM**
- Påstått (i forslaget til 3D-modus): «DOM minus DTM gir ekte bygningshøyder».
- Riktig: det holder bare for bygg som er store nok til å være flater i N50
  (758 av ca. 8100). Et bygningspunkt er mindre enn én 10 m-celle, og
  cella blander tak og trær. De har fortsatt nominell høyde 7 m.
- Oppdaget: da metoden skulle skrives. 71 % av bygningscellene i
  10 m-flisene har målt høyde, men det er de store byggene som teller mange
  celler hver.

**13. Avvik fra planen: sol fra formel, ikke fra MET sitt sunrise-API**
- Planen for fase 2 sa «sollys fra sunrise-API». Jeg regner i stedet solas
  posisjon lokalt. Begrunnelse: lyssetting trenger asimut og høyde
  kontinuerlig, og en formel gir det uten nettkall og uten User-Agent-kravet.
- Dette er et valg jeg tok uten å spørre, ikke en feil som ble rettet.
  Sunrise-API-et kan fortsatt brukes som fasit i en test.

**14. Veier ble til perlekjeder i første versjon av bakkedetaljene**
- Antatt: vei kunne behandles som en klasse som bare ikke støyforskyves.
- Riktig: en vei på skrå er rasterisert som celler som møtes hjørne mot
  hjørne. Med nærmeste-nabo-oppslag ble den en rekke løse ruter.
- Oppdaget: i første skjermbilde.
- Rettet: asfalt hentes fra en lineært filtrert maske med terskel ved
  0,36–0,46. Bilineær verdi i et felles hjørne er 0,5, så båndet henger sammen.

**15. Speilvendt tekstur på rullebanen (unngått, men bare så vidt)**
- Teksturen tegnes med y langs banen. Sett «framover» er da høyre side ved
  x = 0, altså speilvendt i forhold til lerretet. Banenummeret for ende 03
  måtte dreies en halv omdreining, og høyre kant fikk u = 0.
- Kontrollert i skjermbilde fra cockpit over terskelen: «03» leses riktig.
  «21» er tegnet etter samme resonnement, men ikke sett.

**16. Midtstolpe i frontruta skjulte rullebanen**
- Jeg tegnet midtstolpen fordi A320 har en. Men kameraet står i flyets
  midtlinje, ikke i kapteinssetet, så stolpen dekket nøyaktig det punktet
  man flyr mot. Oppdaget i skjermbilde (rullebanen var borte); fjernet.
  Lærdom: «realistisk» detalj kopiert uten å tenke på hvor øyet står.

**17. Tester som antok landingsoppsett og 50 m-rutenett**
- Da klaffer og understell fikk virkning, steilet flyet i to brutester
  (gass 11 % holdt ikke farten med full klaff), og to nye tester plasserte
  flyet i celle (600, 300) - utenfor 50 m-flisen, som bare er 512 celler bred.
  Flyet ble satt til «utenfor kartet» i første steg, og testen målte ingenting.
- Oppdaget: testene feilet. Den siste er samme feil som regelen i CLAUDE.md
  advarer mot: jeg tenkte i 10 m-celler mens testen brukte 50 m-flisen.

**18. Skjermen på tårnbenken var tom**
- Kikkertbildet tegnes av 3D-rendereren i et utsnitt, og 2D-laget oppå
  skulle ha et hull der. Jeg lot bare rammen stå igjen rundt hullet, men
  benken var alt tegnet over hele flaten.
- Oppdaget i skjermbilde. Rettet med `clearRect` før rammen tegnes.

**19. Lyd kan ikke kontrolleres slik bilder kan**
- Jeg kan ikke høre. Kontrollen av lydfilene er derfor målt: varighet,
  lydstyrke og forløp per fil (tårnrommet var 30 dB svakere enn resten og er
  forsterket i spillet). Om motoren *låter* som en motor vet jeg ikke.
- Forsøk på å kjøre spillet i nettleser med simulerte tastetrykk feilet
  (fjernstyring av Chrome er sperret i dette miljøet), og hodeløs Chrome med
  virtuell tid stoppet før lydfilene var dekodet, så ingen hendelser ble
  spilt. Det så ut som en feil i lydmotoren, men var en feil i testoppsettet.
- Løst ved å teste hendelseslogikken mot en liksom-lydkontekst der testen
  styrer klokka (`audioEngine.test.ts`): hva som spilles og når er
  kontrollert, hvordan det høres ut er det ikke.

**20. En test som bare virket på min maskin**
- `hd.test.ts` skulle hoppes over når 10 m-flisene mangler (de er ikke i
  git). Men `describe.skipIf` kjører fortsatt funksjonen for å finne testene,
  og den leste flisene på toppnivå. Første kjøring i GitHub Actions krasjet.
- Jeg hadde aldri kjørt testene uten flisene, så «hoppes over» var en
  påstand, ikke noe jeg hadde sett.
- Rettet, og kontrollert ved å flytte flisene bort lokalt og kjøre begge
  testsettene slik CI ser dem.

**21. Kode og tester som antok Kjevik (flere flyplasser lagt til)**
- Flere steder sto `runways[0]`, og en test pakket ut nøyaktig én rullebane.
  Sola og Gardermoen har to. Tårnmeldingene sa «Kjevik tower» uansett, og
  ankomststripa hadde «ENCN» som fast tekst.
- Oppdaget: ved gjennomgang før de nye flisene ble tatt i bruk, og av testen
  som krasjet. Rettet: alle baneender behandles likt, lyd og tekst følger
  flyplassen.

**22. Flaten utenfor kartet dekket terrenget på Gardermoen**
- I innlandet ender kartet ikke i hav, så jeg la en skogfarget flate rundt, i
  middelhøyden langs kartkanten. Men kanten ligger høyere enn Romerikssletta
  inne i kartet, så flaten la seg OVER terrenget foran flyet.
- Oppdaget i skjermbilde (en stor, jevn grønn flate). Rettet: flaten ligger
  under kartets laveste punkt.

**23. Et redigeringsskript stoppet halvveis, og jeg så det ikke først**
- Jeg gjør flere endringer i ett skript som stopper ved første tekst som ikke
  finnes. Det hendte to ganger i denne runden: én gang fordi teksten jeg lette
  etter var formatert annerledes enn jeg husket, én gang fordi en
  nettverkssjekk foran skriptet fikk tidsavbrudd. Endringene etter stoppet ble
  ikke gjort, mens de neste kommandoene kjørte videre.
- Oppdaget av typesjekken og testene (manglende felt, flyplass som ikke fantes).
- Lærdom: at en kommando «gikk» sier ikke at alle delene gikk. Typesjekk og
  tester rett etterpå fanget begge.

**24. Navnet på diplomet startet ny innflyging (meldt av bruker)**
- Jeg sperret spillets taster mens man skriver i navnefeltet, men glemte en
  egen lytter som lukker diplomet på R og T. En R i navnet lukket diplomet,
  feltet mistet fokus, og neste T gikk til spillet og startet ny innflyging.
- Jeg hadde bare sett diplomet i et skjermbilde, aldri skrevet i feltet.
- Rettet: alle tastelyttere bruker samme sjekk (`isTyping`).

**25. «Facebook kan ikke vise diplomet» var for raskt konkludert**
- Jeg sa at en nettside bare kan sende en lenke til Facebook, og at diplomet
  derfor måtte legges ved for hånd. Første halvdel er riktig, men lenka kan
  peke på en side som har diplomet som forhåndsvisningsbilde. Det krever at
  bildet lages på serveren, og webhotellet har PHP med bildestøtte.
- Jeg hadde ikke sjekket hva webhotellet kunne før jeg svarte. Brukeren
  viste med et skjermbilde at resultatet ikke var godt nok.
- Rettet: delingsside som tegner diplomet fra tallene i adressen.

**26. Oversatt tekst ble stående på norsk hos brukeren**
- Flyplassnavn og kreditering kommer fra metadata-filer. Jeg hadde gitt dem
  en times levetid i nettleseren, så etter oversettelsen viste spillet gamle
  navn mens serveren hadde nye. Jeg sjekket bare hva serveren leverte.
- Oppdaget i brukerens skjermbilde: «Oslo lufthavn» i spillet, «Oslo Airport»
  i Facebook-bildet fra serveren.
- Rettet: metadata og fliser sjekkes alltid mot serveren.

**27. Antok at kartteksten står der stedet er**
- Stedsnavnene i N50 er tekstplasseringer for det trykte kartet. Jeg la
  navnet midt i teksten. «Kristiansand» havnet 1,4 km fra sentrum, ute i
  havna, fordi kartografen har flyttet teksten dit det er plass.
- Oppdaget i første skjermbilde.
- Rettet: de største navnene hentes fra stedets eget punkt i
  stedsnavnregisteret. De små står fortsatt ved kartteksten.

**28. Avrunding flyttet et punkt til nabocella**
- Høyden for hvert stedsnavn ble slått opp før koordinatene ble avrundet til
  to desimaler for lagring. 123,996 ble 124,00 i fila, altså en annen celle
  enn den høyden kom fra. Seks navn fikk høyde opptil 8 m feil.
- Oppdaget av en ny test som sammenligner fila med høydekartet.
- Rettet: avrund først, slå opp etterpå.

**29. Bygget avhang av et API som ikke svarte fra GitHub**
- Stedets punkt ble slått opp i stedsnavn-API-et under bygging, med cache i
  en mappe som ikke er i git. Lokalt gikk det fint. I GitHub Actions svarte
  API-et 503, og publiseringen stoppet (nettsiden ble stående uendret).
- Jeg hadde skrevet «pipeline skal være reproduserbar» i CLAUDE.md og
  likevel lagt inn 262 nettkall uten reserve.
- Rettet: punktene ligger i en fil i git. API-et brukes bare for steder som
  mangler der, med nye forsøk og en feilmelding som sier hva man skal gjøre.

**30. Brukte avrundet sann kurs der prosjektets egen regel sier rutenettkurs fra endepunktene**
- Flyloggen fikk bare med banens publiserte sanne kurs. Gjennomgangen regnet
  avstand til senterlinja med «sann kurs minus konvergens».
- OurAirports oppgir kursen i hele grader (35°). Rutenettkursen fra
  baneendene er 40,84°, mens 35 + 5,89 gir 40,89°. Forskjellen på 0,05° ble
  6,4 m til siden på 8 km: flyet så ut til å starte ved siden av
  senterlinja det sto på.
- CRS-regel 5 i CLAUDE.md sier nettopp dette («regnes helst direkte fra
  transformerte endepunkter»). Jeg skrev regelen og brøt den i ny kode.
- Fanget av en test som krevde under 2 m. Rettet: loggen har
  `headingGridDeg`, og geometrien bruker den.

**31. Autopiloten strøk på mine egne kriterier**
- Første utgave satte ut full klaff 4 km fra banen. Gjennomgangen jeg skrev
  like etterpå krever landingsoppsett ved 1000 fot (ca. 5,5 km ute), og
  dømte autopiloten som «ikke stabilisert».
- Ingen av delene var feil hver for seg; de var bare ikke laget mot samme
  mål. Rettet: autopiloten setter ut alt før 1000 fot.

**32. Analysen svarte med min egen terskel**
- «Laveste klaring under glidebanen» fant først punktet rett ved terskelen,
  der flyet skal være lavt. Jeg satte en grense («fra 15 m over banen»), og
  da ble svaret selve grensen. Det samme skjedde med 1000 m: på 15 av 16
  baneender ligger laveste klaring innen 40 m fra den grensen.
- Tallet er riktig regnet, men det sier mest om hvor jeg satte grensen.
  Bare der hinderet ligger lenger ute (Kjevik 21: 70 m klaring 1,8 km ute)
  forteller det noe om terrenget.
- Ikke «rettet»: grensen står som konstant og i metadata, og
  docs/analyser.md sier hva tallet kan og ikke kan brukes til.

**33. Regnet feil for hånd i min egen test**
- Testen la et 150 m høyt bygg 4 km ute og ventet at det ga laveste
  klaring. Glidebanen er 230 m der, altså 80 m klaring, mens den er 68 m
  1 km ute uten noe bygg. Koden hadde rett; fasiten min var feil.
- Lærdom: en test som feiler er ikke bevis for at koden er feil. Regn
  fasiten på nytt før koden endres.

**34. Leste et skjermbilde feil**
- Jeg sammenlignet nattbilder før og etter de nye lysene og mente det var
  blitt færre lys. Telling av lyse piksler viste 39 % flere (og mer enn
  dobbelt så mange i den venstre, spredtbygde halvdelen av bildet).
- Et bilde er ikke en måling. Tell når det er mulig.

**35. Autopiloten tok på seg landinger den ikke kunne rekke**
- Meldt av brukeren: «autopilot lander helt i enden av rullebanen».
- Flyloggen viste hvorfor: autopiloten ble koblet inn 2,2 km før terskelen
  i 444 m høyde, 22 merker over glidebanen. Den gikk ned så bratt den kunne
  (1575 fot/min), nådde bakken 1,9 km inne på banen, slapp taket da banen
  tok slutt, og flyet traff bakken bak den.
- Testene mine startet alle fra innflygingens startpunkt eller litt til
  siden. Ingen prøvde å koble den inn sent og høyt, som er det en spiller
  gjør.
- Rettet: den avslår («too high to land, go around») når vinkelen ned mot
  siktepunktet er over 5,5°. Testen bruker tallene fra loggen.
- Første feil som ble funnet med flyloggen i stedet for med gjetting.

**36. Husene skjulte sine egne lys**
- Med alle bygg fra Matrikkelen la jeg et lys i cella til hvert hus. I
  spillet ble natta mørkere, ikke lysere: huset tegnes som en boks oppå
  cella og dekker lyset under. Sterke lyspunkter i samme bilde falt fra
  36 926 til 17 044.
- Med N50 var dette ikke synlig, fordi de fleste lysene var strødd i celler
  uten hus.
- Rettet: lyset legges på bakken i en ledig nabocelle, og boksene gløder
  svakere om natta. Etterpå: 26 489 sterke lyspunkter, og langt flere hus.
- Antallet lyse celler i lyskartet gikk opp hele veien. Det var først i
  bildet feilen viste seg: tell i det spilleren ser, ikke bare i fila.

**37. Bakken ble målt som kirketårn**
- Tårnhøyden ble først regnet som overflatemodellen minus terrenghøyden
  *ved kirkens punkt*. I en bakke ligger terrenget 20 m unna flere meter
  høyere, og det ble lagt til tårnet.
- Ikke oppdaget på Kjevik, der kirkene står flatt. Ved Sola forsvant to
  «tårn» og ved Flesland ett da terrenget ble trukket fra i hvert punkt.
- Det høyeste tårnet ved Flesland (58 m) så også mistenkelig ut. Oppslag i
  stedsnavnregisteret viste at det er Nykirken i Bergen, 9 m fra punktet.
  Den var altså riktig; mistanken var grunn til å sjekke, ikke til å rette.

**38. Tegnet tunnelen der spillet ikke ser**
- Flekkerøytunnelen ble først bakt inn i fargekartet som stiplet linje.
  Kartet var riktig, men i spillet var den borte: nær bakken tegner
  shaderen naturlige flater (også sjø) fra overflateklassene og bruker
  ikke fargekartet.
- Jeg skrev den shaderen selv og husket ikke hvordan den virket.
- Rettet: tunnelene er egen geometri oppå bakken, som bruene.

**39. Lagrede fliser for feil sted**
- Da Kjevik-utsnittet ble flyttet 3,5 km sørover, stoppet bygget på en
  kontroll: de lagrede høydeflisene var navngitt etter rad og kolonne, ikke
  etter hvor de ligger. Kontrollen (fra fase 1) fanget det; uten den ville
  terrenget blitt lagt 3,5 km feil uten feilmelding.
- Rettet: en lagret flis med annen georeferering kastes og hentes på nytt.

**40. Testen leste fra motsatt kartkant**
- Et fasitpunkt for arealdekke havnet utenfor kartet etter flyttingen.
  Testen feilet med «forventet innsjø, fikk hav»: negativ radindeks i
  Python leser fra den andre enden av tabellen, så den fant en celle 25 km
  unna i stedet for å si at punktet lå utenfor.
- Rettet: testen sier nå fra når et punkt er utenfor.

**41. Autopiloten landet ved siden av banen**
- Meldt av brukeren. Loggen: koblet inn 1,7 km til venstre for senterlinja
  3,6 km ute, med kurs bort fra banen. Den fløy inn mot linja i 30°, men
  rettet opp for sent og satte flyet ned 45 m til siden for senterlinja.
  Banen er 45 m bred, så det ble «Ground contact!».
- Årsak: den siktet alltid 900 m fram. Nær banen er det for langt; da
  hentes avviket inn først etter terskelen.
- Forrige feil (punkt 35) gjaldt høyde. Jeg la da inn en grense for høyde,
  men prøvde ikke det samme sideveis. Samme hull, andre akse.
- Rettet: sikteavstanden krymper mot banen (20 % av avstanden til
  terskelen, minst 350 m). Den avslår når flyet er mer enn halve
  avstanden til siden, og avbryter hvis den ikke er over banen 400 m før
  terskelen. Testene dekker nå et rutenett av avstander og sideavvik, og
  krever at den enten lander på senterlinja eller gir fra seg flyet.

**42. Hus uten tak, og jeg forklarte det bort**
- Byggene med omriss ble tegnet med alle flater vendt innover. Takene ble
  borte, og det som syntes var innsiden av veggene på motsatt side.
- Jeg så det på mitt eget skjermbilde av Kvadraturen: kvartaler med grønt i
  midten. Jeg bestemte meg for at det var bakgårder og gikk videre.
- Da brukeren sendte et bilde av mørke bygg, forklarte jeg det med lav sol
  og foreslo å endre lyset. Det var også feil.
- Testen min sjekket at trekantene dekket riktig areal, ikke hvilken vei de
  vendte. En flate som vender feil har samme areal.
- Rettet: omløpsretningen sjekkes per bygg, og en test krever at taket
  vender opp og at hver vegg vender ut, for omriss i begge retninger.
- Lærdom: to ganger fant jeg en forklaring som passet med at koden var
  riktig. Når noe ser rart ut, er «koden er feil» den første hypotesen
  som skal avkreftes, ikke den siste.

**43. Holmer som blinket i havfarge**
- Meldt av brukeren med et skjermopptak: «litt flikking».
- Jeg delte opptaket i enkeltbilder og lette etter piksler som hopper fram
  og tilbake fra bilde til bilde. Første treff var musepekeren. Det andre
  var ekte: lavt land og holmer flere kilometer unna ble til sjø i
  annethvert bilde.
- Årsak: flaten som fyller verden utenfor kartet lå også under hele kartet,
  en halv meter under havnivå. På avstand skiller ikke dybdebufferen en
  halv meter, så flaten og terrenget byttet på å ligge øverst.
- Feilen har vært der siden flaten kom inn. Den synes best over
  skjærgård, som kom med da Kjevik-kartet ble flyttet sørover.
- Rettet: flaten ligger bare utenfor kartet, og kameraets nærplan er
  flyttet fra 2 til 8 m, som gir fire ganger finere dybde på avstand.
- Ikke bekreftet: et stillbilde viser ikke flimmer. Brukeren må se om det
  er borte.

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

**Akser i 3D.** WebGL-verdenen er X = øst, Y = opp, Z = sør. Det er
høyrehendt (øst x opp = sør), så kartet blir ikke speilvendt, og kurs med
klokka blir negativ rotasjon om Y. Kontrollert i skjermbilder: rullebanen
ligger rett forut på innflyging 03, Kvadraturen ligger litt til høyre for
kurs 300° sett fra fjorden sørøst for byen (peiling 313°), og minikartet
viser samme posisjon. Ikke kontrollert ved å svinge: at høyre piltast
krenger flyet til høyre i bildet er bare utledet, ikke sett.

**Solas asimut: sann retning og fortegn på timevinkelen.** Formelen gir
asimut fra sann nord; i rutenettet trekkes meridiankonvergensen fra (samme
regel som for rullebanen). Kontrollert uten å stole på formelen selv:
middagshøyden skal være 90° − breddegrad ± 23,44° ved solverv, sola skal stå
i sør ved kulminasjon, stå opp i øst og gå ned i vest ved jevndøgn, og gå
med klokka i løpet av dagen. Alle testene gikk første gang. Skyggene i
3D-bildet er ikke sjekket mot et foto eller mot Kartverkets skyggerelieff.

**Negative øst-koordinater.** Sola og Flesland ligger så langt vest for
sentralmeridianen at øst i UTM 33 blir negativ (ca. -39 000). Ingenting i
koden antok positive verdier, men det var ikke prøvd. Kontrollert: pyproj
mot Kartverkets transformasjons-API i de tre nye referansepunktene (innenfor
1 cm), og høyden i flisene mot punkt-API-et i 15 punkter på rullebanene.

**16-bit PNG.** Oppgaven åpnet for 16-bit PNG som høydekart. Nettleserens
canvas leser bare 8 bit per kanal, så det ville gitt 256 høydenivåer uten
feilmelding. Valgte Float32.

**Bruer finnes ikke i terrengmodellen.** En DTM er bakken uten bruer, så
høyden under Varoddbrua er 0 (sjø). Første versjon tegnet derfor brua flatt
på vannet. Dekkhøyden hentes nå fra overflatemodellen (DOM), og brua er en
egen struktur: i skivestabelen ligger den bare i skiven i dekkhøyde, og i
Voxel Space tegnes dekket uten å flytte y-bufferen, så terrenget bak synes
under.

**Min egen påstand om at skiver ikke kan vise luft under en bru var feil.**
Jeg skrev det i oppsummeringen etter første N50-runde. Sprite stacking kan
det helt fint: en celle kan være med i én skive uten å være med i dem under.
Det er Voxel Space som trenger et unntak.

### Åpne spørsmål / ikke kontrollert

- OurAirports er ikke sjekket mot gjeldende AIP Norge, bare mot DTM og
  intern konsistens.
- Det visuelle er kontrollert med stillbilder i hodeløs Chrome, ikke ved
  faktisk spilling. Flyfølelse, landing, kameraskala og bildefrekvens i
  3D-modus er ikke prøvd for hånd.
