<?php
/* Tester skipstjenesten (web/public/ais) mot et opptak av Kystverkets strøm og fasiten Python har laget.
 * Kjøres av deploy/test_ais.sh. Avslutter med feilkode hvis noe ikke stemmer. */
declare(strict_types=1);
[$root, $fixtures] = [$argv[1], $argv[2]];
require $root . '/lib.php';
$fail = function (string $m): void { fwrite(STDERR, "ais test: $m\n"); exit(1); };

// 1. UTM 33 mot Kartverkets transformasjons-API (de samme punktene pipeline testes mot)
$ref = json_decode((string) file_get_contents("$fixtures/reference_points.json"), true);
$worst = 0.0;
foreach ($ref['transform']['points'] as $p) {
    [$e, $n] = utm33((float) $p['lon'], (float) $p['lat']);
    $worst = max($worst, hypot($e - $p['east'], $n - $p['north']));
}
if (count($ref['transform']['points']) < 5 || $worst > 0.02) { $fail(sprintf('utm33 avviker %.3f m fra Kartverket', $worst)); }

// 2. Opptaket: samme skip, posisjoner og opplysninger som Python-tolkingen
$exp = json_decode((string) file_get_contents("$fixtures/ais_expected.json"), true);
$lines = file("$fixtures/ais_sample.txt", FILE_IGNORE_NEW_LINES);
$state = [];
$count = ais_ingest($lines, $state, $exp['areas'], (int) $exp['now']);
if ($count < 1000) { $fail("bare $count meldinger tolket"); }
$total = 0;
foreach ($exp['areas'] as $icao => $box) {
    $got = ais_ships($state, $box, (int) $exp['now']);
    $want = $exp['ships'][$icao];
    if (count($got) !== count($want)) { $fail("$icao: " . count($got) . ' skip, ventet ' . count($want)); }
    foreach ($want as $i => $w) {
        $g = $got[$i];
        if ($g['id'] !== $w['id']) { $fail("$icao: skip $i er {$g['id']}, ventet {$w['id']}"); }
        if (abs($g['e'] - $w['e']) > 0.15 || abs($g['n'] - $w['n']) > 0.15) { $fail("$icao {$w['id']}: posisjon ({$g['e']}, {$g['n']}), ventet ({$w['e']}, {$w['n']})"); }
        foreach (['sog', 'cog', 'hdg', 'age', 'name', 'dest', 'type', 'len', 'beam', 'fwd', 'stb'] as $k) {
            $same = is_float($w[$k]) || is_float($g[$k]) ? ($w[$k] !== null && $g[$k] !== null && abs($g[$k] - $w[$k]) < 1e-9) : $g[$k] == $w[$k] && ($g[$k] === null) === ($w[$k] === null);
            if (!$same) { $fail("$icao {$w['id']}: $k er " . json_encode($g[$k]) . ', ventet ' . json_encode($w[$k])); }
        }
        $total++;
    }
}
if ($total < 10) { $fail("bare $total skip i opptaket"); }

// 3. Søppel inn skal ikke velte noe, og gamle skip skal falle ut
$junk = ['', 'tull', '!BSVDM,1,1,,A,,0*00', '!BSVDM,1,1,,A,' . str_repeat("\x01", 30) . ',0*00', '!BSVDM,2,2,9,A,xyz,0*00', '\c:12\!BSVDM,1,1,,A,13aEOK?P00PD2wVMdLDRhgvL289?,0*26'];
ais_ingest($junk, $state, $exp['areas'], (int) $exp['now']);
ais_ingest([], $state, $exp['areas'], (int) $exp['now'] + SHIP_MAX_AGE_S + 60);
if (count($state['ships']) !== 0) { $fail('gamle skip ble ikke fjernet'); }

printf("ais test: ok (%d meldinger, %d skip ved kystflyplassene, utm33 innenfor %.1f mm av Kartverket)\n", $count, $total, $worst * 1000);
