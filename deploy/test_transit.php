<?php
/* Tester kollektivtjenesten (web/public/transit) mot et lagret svar fra Entur og fasiten Python har laget. */
declare(strict_types=1);
[$root, $fixtures] = [$argv[1], $argv[2]];
require $root . '/lib.php';
$fail = function (string $m): void { fwrite(STDERR, "transit test: $m\n"); exit(1); };

$sample = json_decode((string) file_get_contents("$fixtures/entur_sample.json"), true);
$want = json_decode((string) file_get_contents("$fixtures/entur_expected.json"), true)['vehicles'];
$area = $sample['area']; $now = (int) $sample['now'];
$got = transit_parse(json_encode($sample['response']), $area, $now);
if (count($got) !== count($want)) { $fail(count($got) . ' kjøretøy, ventet ' . count($want)); }
foreach ($want as $i => $w) {
    foreach ($w as $k => $v) {
        $g = $got[$i][$k];
        $same = in_array($k, ['e', 'n'], true) ? abs($g - $v) <= 0.15 : (is_float($v) || is_float($g) ? abs((float) $g - (float) $v) < 1e-9 : $g === $v);
        if (!$same) { $fail("{$w['id']}: $k er " . json_encode($g) . ', ventet ' . json_encode($v)); }
    }
}
if (count($want) < 4) { $fail('for få kjøretøy i fasiten'); }
foreach ($got as $v) { if ($v['mode'] === 'ferry') { $fail('en ferge slapp gjennom'); } }

// Egne tilfeller: søppel, rar tekst, kurs utenfor 0-360, tid i framtida
$ok = ['vehicleId' => 'a1', 'mode' => 'BUS', 'codespace' => ['codespaceId' => 'AKT'], 'line' => ['publicCode' => 'M1'],
       'lastUpdated' => gmdate('Y-m-d\TH:i:s\Z', $now - 5), 'location' => ['latitude' => 58.146, 'longitude' => 7.995], 'bearing' => 370.0];
$one = fn (array $v): array => transit_parse(json_encode(['data' => ['vehicles' => [$v]]]), $area, $now);
$r = $one($ok);
if (count($r) !== 1 || $r[0]['bearing'] !== 10.0 || $r[0]['age'] !== 5 || $r[0]['id'] !== 'AKT:a1') { $fail('enkelt tilfelle: ' . json_encode($r)); }
$r = $one(['vehicleId' => '<script>x', 'line' => ['publicCode' => '"><b>Å1']] + $ok);
if ($r[0]['id'] !== 'AKT:scriptx' || $r[0]['line'] !== 'bÅ1') { $fail('rar tekst ble ikke vasket: ' . json_encode($r)); }
foreach (['mode' => 'FERRY', 'lastUpdated' => 'i går en gang', 'location' => ['latitude' => 'x', 'longitude' => 8]] as $k => $bad) {
    if ($one([$k => $bad] + $ok) !== []) { $fail("slapp gjennom med $k = " . json_encode($bad)); }
}
if ($one(['lastUpdated' => gmdate('Y-m-d\TH:i:s\Z', $now + 600)] + $ok) !== []) { $fail('en posisjon fra framtida slapp gjennom'); }
foreach (['', 'tull', '{"errors":[{"message":"x"}]}', '{"data":{"vehicles":"nei"}}'] as $junk) {
    if (transit_parse($junk, $area, $now) !== []) { $fail('søppel ga kjøretøy'); }
}
// Spørringen: en boks rundt sentrum, bare tall
$q = json_decode(transit_query($area), true)['query'];
if (!preg_match('/^\{ vehicles\(boundingBox:\{minLat:[\d.]+,minLon:[\d.]+,maxLat:[\d.]+,maxLon:[\d.]+\}\) \{[\w\s{}]+\} \}$/', $q)) { $fail("uventet spørring: $q"); }
echo "transit test: tolkingen ok (" . count($want) . " kjøretøy)\n";
