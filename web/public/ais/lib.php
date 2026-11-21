<?php
/* Skipstrafikk fra Kystverkets åpne AIS-strøm, til spillet.
 *
 * Kilde: Kystverket, åpne AIS-data (NLOD), rå AIS-meldinger over TCP. Fiskefartøy under 15 m og
 * fritidsfartøy under 45 m er ikke med i de åpne dataene.
 *
 * Denne fila er ren regning og tolking, uten nett og uten filer, så den kan testes for seg
 * (deploy/test_ais.sh). index.php gjør resten.
 *
 * KOORDINATER: AIS gir lengde/bredde (WGS84). Spillet regner i EUREF89 UTM 33 og transformerer aldri selv.
 * For kartdata gjøres transformasjonen i pipeline (crs.py, pyproj). Skipene kommer mens spillet kjører, så
 * her må den gjøres på serveren: utm33() under er den eneste transformasjonen utenfor pipeline. Den er
 * kontrollert mot de samme fasitpunktene fra Kartverket som crs.py (tests/fixtures/reference_points.json).
 */
declare(strict_types=1);

const AIS_HOST = '153.44.253.27'; // oppgitt av Kystverket for åpne AIS-data
const AIS_PORT = 5631;
const SHIP_MAX_AGE_S = 900;   // skip som ikke er hørt på et kvarter vises ikke
const STATIC_MAX_AGE_S = 7200; // navn, type og mål huskes i to timer (sendes sjeldnere enn posisjon)

/** Lengde/bredde i grader (ETRS89/WGS84) -> [øst, nord] i EUREF89 UTM sone 33 (EPSG:25833), i meter.
 *  Krügers rekker for transversal Mercator på GRS80. Nøyaktig til under en millimeter i Norge. */
function utm33(float $lon, float $lat): array
{
    $a = 6378137.0; $f = 1 / 298.257222101; $k0 = 0.9996; $lon0 = deg2rad(15.0);
    $n = $f / (2 - $f);
    $A = $a / (1 + $n) * (1 + $n ** 2 / 4 + $n ** 4 / 64);
    $alpha = [$n / 2 - 2 * $n ** 2 / 3 + 5 * $n ** 3 / 16, 13 * $n ** 2 / 48 - 3 * $n ** 3 / 5, 61 * $n ** 3 / 240];
    $phi = deg2rad($lat); $dl = deg2rad($lon) - $lon0;
    $c = 2 * sqrt($n) / (1 + $n);
    $t = sinh(atanh(sin($phi)) - $c * atanh($c * sin($phi)));
    $xi = atan2($t, cos($dl));
    $eta = atanh(sin($dl) / sqrt(1 + $t * $t));
    $e = $eta; $nn = $xi;
    foreach ($alpha as $j => $aj) {
        $e += $aj * cos(2 * ($j + 1) * $xi) * sinh(2 * ($j + 1) * $eta);
        $nn += $aj * sin(2 * ($j + 1) * $xi) * cosh(2 * ($j + 1) * $eta);
    }
    return [500000.0 + $k0 * $A * $e, $k0 * $A * $nn];
}

/** AIS-nyttelasten (seks bit per tegn) som en streng av '0' og '1'. */
function ais_bits(string $payload): string
{
    $bits = '';
    for ($i = 0, $len = strlen($payload); $i < $len; $i++) {
        $v = ord($payload[$i]) - 48;
        if ($v > 40) { $v -= 8; }
        if ($v < 0 || $v > 63) { return ''; }
        $bits .= str_pad(decbin($v), 6, '0', STR_PAD_LEFT);
    }
    return $bits;
}

function ais_uint(string $bits, int $from, int $to): int
{
    return $to <= strlen($bits) ? (int) bindec(substr($bits, $from, $to - $from)) : 0;
}

function ais_int(string $bits, int $from, int $to): int
{
    $v = ais_uint($bits, $from, $to);
    return $v >= (1 << ($to - $from - 1)) ? $v - (1 << ($to - $from)) : $v;
}

/** Tekstfelt i AIS: seks bit per tegn, '@' er fyll. */
function ais_text(string $bits, int $from, int $to): string
{
    $s = '';
    for ($i = $from; $i + 6 <= min($to, strlen($bits)); $i += 6) {
        $v = (int) bindec(substr($bits, $i, 6));
        $s .= chr($v < 32 ? $v + 64 : $v);
    }
    return trim(str_replace('@', ' ', $s));
}

/** Posisjon fra en AIS-melding, eller null. Felter som mangler i meldingen (AIS har egne verdier for «ikke
 *  tilgjengelig») blir null. */
function ais_position(string $bits, int $type): ?array
{
    // hvor feltene ligger: [fart, lengde, bredde, kurs, baugretning] som bitposisjon der feltet starter
    $at = $type <= 3 ? [50, 61, 89, 116, 128] : [46, 57, 85, 112, 124];
    if (strlen($bits) < $at[4] + 9) { return null; }
    $lon = ais_int($bits, $at[1], $at[1] + 28) / 600000;
    $lat = ais_int($bits, $at[2], $at[2] + 27) / 600000;
    if (abs($lon) > 180 || abs($lat) > 90) { return null; } // 181/91 betyr «ukjent posisjon»
    $sog = ais_uint($bits, $at[0], $at[0] + 10);
    $cog = ais_uint($bits, $at[3], $at[3] + 12);
    $hdg = ais_uint($bits, $at[4], $at[4] + 9);
    return [
        'lon' => $lon, 'lat' => $lat,
        'sog' => $sog >= 1023 ? null : $sog / 10,   // knop
        'cog' => $cog >= 3600 ? null : $cog / 10,   // grader, sann
        'hdg' => $hdg >= 360 ? null : $hdg,         // grader, sann
    ];
}

/** Mål fra de fire avstandene til antenna: [lengde, bredde] i meter, eller [null, null]. */
function ais_size(string $bits, int $from): array
{
    $len = ais_uint($bits, $from, $from + 9) + ais_uint($bits, $from + 9, $from + 18);
    $beam = ais_uint($bits, $from + 18, $from + 24) + ais_uint($bits, $from + 24, $from + 30);
    return [$len > 0 ? $len : null, $beam > 0 ? $beam : null];
}

/** Les linjer fra strømmen inn i $state. $areas er [ICAO => [west, south, east, north]] i UTM 33.
 *  $state = ['ships' => [mmsi => posisjon], 'static' => [mmsi => navn/type/mål], 'parts' => halve meldinger].
 *  Bare skip innenfor et av utsnittene lagres. Returnerer antall meldinger som ble tolket. */
function ais_ingest(array $lines, array &$state, array $areas, int $now): int
{
    $state += ['ships' => [], 'static' => [], 'parts' => []];
    $count = 0;
    foreach ($lines as $line) {
        $bang = strpos($line, '!');
        if ($bang === false) { continue; }
        $f = explode(',', substr($line, $bang));
        if (count($f) < 7 || substr($f[0], -3) !== 'VDM') { continue; }
        // tidspunktet stasjonen mottok meldingen står i hodet foran (c:sekunder); ellers brukes klokka her
        $t = preg_match('/[\\\\,]c:(\d{9,11})/', substr($line, 0, $bang), $m) ? min((int) $m[1], $now) : $now;
        [$total, $num, $seq, $payload] = [(int) $f[1], (int) $f[2], $f[3] . $f[4], $f[5]];
        if ($total > 1) {
            // lange meldinger kommer i flere deler: samle dem til siste del er her
            if ($num === 1) { $state['parts'][$seq] = $payload; continue; }
            if (!isset($state['parts'][$seq])) { continue; }
            $payload = $state['parts'][$seq] . $payload;
            if ($num < $total) { $state['parts'][$seq] = $payload; continue; }
            unset($state['parts'][$seq]);
        }
        $bits = ais_bits($payload);
        if (strlen($bits) < 40) { continue; }
        $type = ais_uint($bits, 0, 6);
        $mmsi = ais_uint($bits, 8, 38);
        $count++;
        if ($type <= 3 || $type === 18 || $type === 19) {
            $p = ais_position($bits, $type);
            if ($p === null) { continue; }
            [$e, $n] = utm33($p['lon'], $p['lat']);
            $inside = false;
            foreach ($areas as $b) {
                if ($e >= $b[0] && $e < $b[2] && $n > $b[1] && $n <= $b[3]) { $inside = true; break; }
            }
            if (!$inside) { unset($state['ships'][$mmsi]); continue; } // har seilt ut av utsnittet
            $state['ships'][$mmsi] = ['e' => round($e, 1), 'n' => round($n, 1), 'sog' => $p['sog'], 'cog' => $p['cog'], 'hdg' => $p['hdg'], 't' => $t];
            if ($type === 19 && strlen($bits) >= 301) {
                [$len, $beam] = ais_size($bits, 271);
                $state['static'][$mmsi] = ['name' => ais_text($bits, 143, 263), 'type' => ais_uint($bits, 263, 271), 'len' => $len, 'beam' => $beam, 't' => $t];
            }
        } elseif ($type === 5 && strlen($bits) >= 270) {
            [$len, $beam] = ais_size($bits, 240);
            $state['static'][$mmsi] = ['name' => ais_text($bits, 112, 232), 'type' => ais_uint($bits, 232, 240), 'len' => $len, 'beam' => $beam, 't' => $t];
        } elseif ($type === 24 && strlen($bits) >= 160) {
            // klasse B sender navn (del A) og type/mål (del B) hver for seg
            $s = $state['static'][$mmsi] ?? ['name' => '', 'type' => 0, 'len' => null, 'beam' => null];
            if (ais_uint($bits, 38, 40) === 0) {
                $s['name'] = ais_text($bits, 40, 160);
            } elseif (strlen($bits) >= 162) {
                $s['type'] = ais_uint($bits, 40, 48);
                [$s['len'], $s['beam']] = ais_size($bits, 132);
            }
            $s['t'] = $t;
            $state['static'][$mmsi] = $s;
        }
    }
    // rydd: gamle skip, gamle faste opplysninger, og halve meldinger som aldri ble hele
    foreach ($state['ships'] as $mmsi => $s) { if ($now - $s['t'] > SHIP_MAX_AGE_S) { unset($state['ships'][$mmsi]); } }
    foreach ($state['static'] as $mmsi => $s) { if ($now - $s['t'] > STATIC_MAX_AGE_S) { unset($state['static'][$mmsi]); } }
    if (count($state['parts']) > 200) { $state['parts'] = []; }
    return $count;
}

/** Skipene i ett utsnitt, slik spillet får dem. $box er [west, south, east, north] i UTM 33. */
function ais_ships(array $state, array $box, int $now): array
{
    $out = [];
    foreach ($state['ships'] ?? [] as $mmsi => $s) {
        if ($s['e'] < $box[0] || $s['e'] >= $box[2] || $s['n'] <= $box[1] || $s['n'] > $box[3]) { continue; }
        $st = $state['static'][$mmsi] ?? [];
        $out[] = [
            'id' => (int) $mmsi,
            'e' => $s['e'], 'n' => $s['n'],
            'sog' => $s['sog'], 'cog' => $s['cog'], 'hdg' => $s['hdg'],
            'age' => max(0, $now - $s['t']),
            // navnet er sendt av skipet selv: bare bokstaver, tall og litt tegnsetting slipper gjennom
            'name' => substr(preg_replace('/[^A-Z0-9 .\-\/&]/', '', strtoupper($st['name'] ?? '')), 0, 20),
            'type' => (int) ($st['type'] ?? 0),
            'len' => $st['len'] ?? null, 'beam' => $st['beam'] ?? null,
        ];
    }
    usort($out, fn ($a, $b) => $a['id'] <=> $b['id']);
    return $out;
}
