<?php
/* Tester flytjenesten (web/public/traffic) mot lagrede svar fra adsb.lol og fasiten Python har laget. */
declare(strict_types=1);
[$root, $fixtures] = [$argv[1], $argv[2]];
require $root . '/lib.php';
$fail = function (string $m): void { fwrite(STDERR, "traffic test: $m\n"); exit(1); };

$sample = json_decode((string) file_get_contents("$fixtures/adsb_sample.json"), true);
$exp = json_decode((string) file_get_contents("$fixtures/adsb_expected.json"), true);
$total = 0;
foreach ($exp['areas'] as $icao => $area) {
    $got = traffic_parse(json_encode($sample['responses'][$icao]), $area);
    $want = $exp['aircraft'][$icao];
    if (count($got) !== count($want)) { $fail("$icao: " . count($got) . ' fly, ventet ' . count($want)); }
    foreach ($want as $i => $w) {
        foreach ($w as $k => $v) {
            $g = $got[$i][$k];
            $same = (is_float($v) || is_float($g)) && $v !== null && $g !== null ? abs($g - $v) <= (in_array($k, ['e', 'n', 'altM'], true) ? 0.15 : 1e-9) : $g === $v;
            if (!$same) { $fail("$icao {$w['id']}: $k er " . json_encode($g) . ', ventet ' . json_encode($v)); }
        }
        $total++;
    }
}
if ($total < 3) { $fail("bare $total fly i fasiten"); }

// Egne tilfeller: søppel, fly uten høyde, bare trykkhøyde, utenfor ruta, for gammel posisjon, rar tekst
$area = $exp['areas']['ENGM'];
$ok = ['hex' => 'abc123', 'lat' => 60.2, 'lon' => 11.1, 'seen_pos' => 1, 'alt_baro' => 3000, 'gs' => 140, 'track' => 10];
$cases = [
    'bare trykkhøyde' => [$ok, 1],
    'uten høyde' => [array_diff_key($ok, ['alt_baro' => 1]), 0],
    'gammel' => [['seen_pos' => 90] + $ok, 0],
    'utenfor ruta' => [['lat' => 61.5] + $ok, 0],
    'ikke-ICAO-adresse' => [['hex' => '~abc12'] + $ok, 0],
    'uten posisjon' => [array_diff_key($ok, ['lat' => 1]), 0],
];
foreach ($cases as $name => [$ac, $n]) {
    $r = traffic_parse(json_encode(['ac' => [$ac]]), $area);
    if (count($r) !== $n) { $fail("$name: ga " . count($r) . " fly, ventet $n"); }
}
$r = traffic_parse(json_encode(['ac' => [$ok]]), $area)[0];
if ($r['alt'] !== 'baro' || abs($r['altM'] - 914.4) > 0.01) { $fail('trykkhøyde i fot skal bli meter uten geoidekorreksjon'); }
$r = traffic_parse(json_encode(['ac' => [['flight' => "sas<b>4 12\n", 't' => 'a32<0', 'category' => 'A3"x', 'r' => 'LN-ABC'] + $ok]]), $area)[0];
if ($r['flight'] !== 'SASB412' || $r['type'] !== 'A320' || $r['cat'] !== 'A3' || isset($r['r'])) { $fail('tekst fra flyet ble ikke avgrenset: ' . json_encode($r)); }
foreach (['', 'tull', '[]', '{"ac":"x"}', '{"ac":[1,null,"a"]}'] as $junk) {
    if (traffic_parse($junk, $area) !== []) { $fail("søppel ga fly: $junk"); }
}
if (traffic_url($area) !== 'https://api.adsb.lol/v2/lat/60.1939/lon/11.1004/dist/10') { $fail('feil adresse: ' . traffic_url($area)); }
printf("traffic test: ok (%d fly i fasiten, %d egne tilfeller)\n", $total, count($cases));
