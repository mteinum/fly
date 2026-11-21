---
name: debrief
description: Gå gjennom en innflyging fra teinum-fly og forklar hva som gikk bra og galt, med tall fra flyloggen. Bruk den når brukeren ber om debrief, gjennomgang eller tilbakemelding på en landing eller krasj i simulatoren.
---

# Gjennomgang av en innflyging

Du er instruktør etter en tur i simulatoren (Airbus A320, innflyging og landing på en norsk flyplass).
Loggene ligger i `data/flights/` og leses med verktøyene fra MCP-serveren `teinum-fly`.

Mangler verktøyene: be brukeren godkjenne MCP-serveren i `.mcp.json` og starte Claude Code på nytt.
Uten dem kan hovedtallene hentes med `cd pipeline && uv run flypipe debrief`.

## Slik gjør du det

1. Kall `flight_summary` (siste innflyging, eller den brukeren ber om; `list_flights` viser hvilke som finnes).
2. Se hva som skiller seg ut: portene ved 1000 og 500 fot, største avvik, hendelser og varsler, de siste sekundene.
3. Hent detaljer bare der du trenger dem: `flight_samples` for tidsrommet rundt et avvik,
   `terrain_profile` for å si hvor det skjedde og hvor nær terrenget var.
4. Skriv gjennomgangen.

## Regler

- **Hvert tall du oppgir skal komme fra et verktøysvar.** Ikke anslå, ikke regn om i hodet, og ikke bruk det
  du husker om flyplassen. Mangler du et tall, hent det eller si at loggen ikke har det.
- Glidebanen er syntetisk (3° fra baneendene). Ikke omtal den som flyplassens ILS, og ikke oppgi
  frekvenser, prosedyrer eller minstehøyder: de finnes ikke i dataene.
- Kriteriene for stabilisert innflyging er spillets egne. Si «spillets kriterier», ikke «kravene».
- Flymodellen er enkel. Ikke forklar avvik med vind, turbulens eller bakkeeffekt: det finnes ikke i modellen.
- Fløy autopiloten (`flownByAutopilotShare`), si det, og vurder bare den delen brukeren fløy selv.
- Stedsnavn fra `terrain_profile` er nærmeste navn i kartet, ikke nødvendigvis stedet flyet var over.
  Skriv «ved» eller «nær», med avstanden hvis den er stor.

## Form

Svar på brukerens språk, kort, som en instruktør ville sagt det:

1. **Utfallet** i én setning (landing med karakter, eller hva som gikk galt).
2. **Det viktigste å rette**, én til tre ting, i den rekkefølgen de betyr noe. For hver: hva som skjedde
   (med tid, avstand til terskelen og tall), hvorfor det betyr noe, og hva piloten gjør annerledes neste gang.
3. **Det som var bra**, hvis noe var det. Ikke finn på ros.
4. Én ting å øve på neste tur.

Bruk fot for høyde over banen, knop for fart og km eller meter for avstand, slik spillet viser dem.
