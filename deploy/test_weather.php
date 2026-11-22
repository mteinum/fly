<?php
/* Tester værtjenesten (web/public/weather): tolking av METAR-er hentet fra api.met.no 2026-11-22. */
declare(strict_types=1);
require $argv[1] . '/lib.php';
$fail = function (string $m): void { fwrite(STDERR, "weather test: $m\n"); exit(1); };

$wind = [
    'ENCN 220050Z 06007KT 9999 NCD M04/M07 Q1014' => ['dir' => 60, 'kt' => 7, 'gust' => null],
    'ENMH 220050Z 33021G33KT 9999 -SN NCD 02/01 Q1005' => ['dir' => 330, 'kt' => 21, 'gust' => 33],
    'ENCN 212150Z 34009KT 320V020 9999 NCD 03/M07 Q1012' => ['dir' => 340, 'kt' => 9, 'gust' => null],
    // vinden i høyden i merknaden skal ikke forveksles med vinden på bakken
    'ENTC 212150Z VRB02KT 2000 R36/1400U -SN VV006 M00/M01 Q1013 RMK WIND 2600FT 34029KT' => ['dir' => null, 'kt' => 2, 'gust' => null],
    'ENTC 212250Z 00000KT 9999 -SN SCT005 M00/M01 Q1014 RMK WIND 2600FT 34041KT' => ['dir' => 0, 'kt' => 0, 'gust' => null],
    'ENTC 212320Z 13005KT 040V180 9999 FEW005 M00/M01 Q1013 RMK WIND 2600FT 35036G48KT' => ['dir' => 130, 'kt' => 5, 'gust' => null],
    'ENXX 220050Z 36010KT 9999 Q1014' => ['dir' => 0, 'kt' => 10, 'gust' => null], // 360 er nord
    'ENXX 220050Z 24008MPS 9999 Q1014' => ['dir' => 240, 'kt' => 16, 'gust' => null],
    'ENXX 220050Z /////KT 9999 Q1014' => null,
    'ENXX 220050Z 9999 NCD Q1014 RMK WIND 2600FT 34041KT' => null,
    'ENXX 220050Z 99010KT 9999 Q1014' => null,
    '' => null,
];
foreach ($wind as $metar => $want) {
    $got = metar_wind($metar);
    if ($got !== $want) { $fail("vind i «{$metar}»: " . json_encode($got) . ', ventet ' . json_encode($want)); }
}

$text = "ENCN 212350Z 05005KT 020V080 9999 NCD M03/M07 Q1013=\nENCN 220020Z 06007KT 9999 NCD M04/M06 Q1014=\n\nENCN 220050Z 06007KT 9999 NCD M04/M07 Q1014=\n";
if (metar_latest($text, 'ENCN') !== 'ENCN 220050Z 06007KT 9999 NCD M04/M07 Q1014') { $fail('siste METAR: ' . json_encode(metar_latest($text, 'ENCN'))); }
if (metar_latest($text, 'ENGM') !== null || metar_latest('', 'ENCN') !== null || metar_latest('<html>503</html>', 'ENCN') !== null) { $fail('fant en METAR der det ikke var noen'); }

// Tidsgruppa: dag og klokkeslett, uten måned
$now = gmmktime(1, 10, 0, 11, 22, 2026);
$times = [
    'ENCN 220050Z 06007KT' => gmmktime(0, 50, 0, 11, 22, 2026),
    'ENCN 212350Z 05005KT' => gmmktime(23, 50, 0, 11, 21, 2026),
    'ENCN 302350Z 05005KT' => gmmktime(23, 50, 0, 10, 30, 2026), // den 30. har ikke vært i november ennå: forrige måned
    'ENCN 220200Z 06007KT' => null,                               // fram i tid: da er det den 22. forrige måned, som er for gammel til å bety noe
    'ENCN 06007KT 9999' => null,
    'ENCN 329999Z 06007KT' => null,
];
foreach ($times as $metar => $want) {
    $got = metar_time($metar, $now);
    if ($metar === 'ENCN 220200Z 06007KT') { if ($got !== null && $now - $got < METAR_MAX_AGE_S) { $fail("tid i «{$metar}» ble regnet som fersk"); } continue; }
    if ($got !== $want) { $fail("tid i «{$metar}»: " . json_encode($got) . ', ventet ' . json_encode($want)); }
}
// 1. januar: en melding fra 31. desember hører til året før
$ny = gmmktime(0, 20, 0, 1, 1, 2027);
if (metar_time('ENCN 312350Z 05005KT', $ny) !== gmmktime(23, 50, 0, 12, 31, 2026)) { $fail('årsskiftet'); }
if (strpos(weather_url('ENCN'), 'https://api.met.no/weatherapi/tafmetar/1.0/?content=metar&content_type=text/plain&icao=ENCN') !== 0) { $fail('adressen'); }
echo "weather test: tolkingen ok\n";
