<?php
/* Vinden på en flyplass fra siste METAR, til spillet.
 *
 * Kilde: Meteorologisk institutt, api.met.no (tafmetar). Data under CC BY 4.0.
 * En METAR er flyplassens egen værobservasjon, sendt hver halvtime. Vinden står som «24015G27KT»: retningen den
 * kommer FRA i hele ti grader (sann, ikke magnetisk), middelvind og eventuelle kast i knop.
 *
 * Denne fila er ren tolking, uten nett og uten filer (testes i deploy/test_weather.sh). index.php gjør resten.
 */
declare(strict_types=1);

const METAR_MAX_AGE_S = 5400; // en observasjon eldre enn halvannen time er ikke «nå»

/** Adressen for dagens METAR-er på en flyplass. $icao er fire store bokstaver, sjekket av den som kaller. */
function weather_url(string $icao): string
{
    return 'https://api.met.no/weatherapi/tafmetar/1.0/?content=metar&content_type=text/plain&icao=' . $icao;
}

/** Siste METAR i svaret fra tjenesten (én per linje, eldste først), eller null. */
function metar_latest(string $text, string $icao): ?string
{
    $last = null;
    foreach (preg_split('/\R/', $text) ?: [] as $line) {
        $line = trim($line);
        if (strncmp($line, $icao . ' ', 5) === 0) { $last = rtrim($line, '='); }
    }
    return $last;
}

/** Når observasjonen ble gjort (unix-tid), fra «220050Z» = den 22. kl. 00:50 UTC. Måneden står ikke i meldingen:
 *  det er den siste slike dagen som ikke ligger fram i tid. Null hvis tidsgruppa mangler. */
function metar_time(string $metar, int $now): ?int
{
    if (!preg_match('/ (\d{2})(\d{2})(\d{2})Z /', $metar, $m)) { return null; }
    [$day, $hour, $min] = [(int) $m[1], (int) $m[2], (int) $m[3]];
    if ($day < 1 || $day > 31 || $hour > 23 || $min > 59) { return null; }
    [$y, $mo] = [(int) gmdate('Y', $now), (int) gmdate('n', $now)];
    for ($back = 0; $back < 2; $back++) {
        $t = gmmktime($hour, $min, 0, $mo - $back, $day, $y);
        // gmmktime ruller en dag som ikke finnes over i neste måned: da er det ikke denne måneden
        if ((int) gmdate('j', $t) === $day && $t <= $now + 600) { return $t; }
    }
    return null;
}

/** Vinden i en METAR: ['dir' => grader sann eller null når den er variabel (VRB), 'kt' => middelvind i knop,
 *  'gust' => kast i knop eller null]. Null når vindgruppa mangler eller ikke kan leses.
 *  Det letes bare før RMK: i merknadene står det ofte vind i høyden («RMK WIND 2600FT 32027KT»). */
function metar_wind(string $metar): ?array
{
    $body = preg_split('/\sRMK\b/', $metar)[0];
    if (!preg_match('/ (\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)(?: |$)/', $body, $m)) { return null; }
    $toKt = $m[4] === 'MPS' ? 1.943844 : 1.0;
    $dir = $m[1] === 'VRB' ? null : (int) $m[1];
    if ($dir !== null && $dir > 360) { return null; }
    return [
        'dir' => $dir === null ? null : $dir % 360,
        'kt' => (int) round((int) $m[2] * $toKt),
        'gust' => ($m[3] ?? '') === '' ? null : (int) round((int) $m[3] * $toKt),
    ];
}
