<?php
// Felles for delingssiden (index.php) og diplombildet (image.php).
//
// Et diplom deles som en lenke med resultatet i adressen:
//   /share/?n=Navn&a=ENBO&r=25&s=5&k=111&f=183&c=0.0&t=153&d=2026-11-20
// Facebook, Messenger og iMessage henter denne siden og bildet den peker på. Ingenting lastes
// opp eller lagres: bildet tegnes fra tallene hver gang, og alt i adressen sjekkes og avgrenses
// her før det brukes. Hvem som helst kan skrive sine egne tall i adressen; diplomet er en
// spillpremie, ikke et bevis.
declare(strict_types=1);

const TITLES = [1 => 'You got it down', 2 => 'Hard landing', 3 => 'Acceptable landing', 4 => 'Nice landing', 5 => 'Butter landing'];
const SITE = 'https://fly.teinum.no';

/** Flyplassene spillet har, ICAO => navn, fra indeksen pipeline skriver. */
function airports(): array {
    $path = getenv('FLY_INDEX') ?: __DIR__ . '/../data/index.json';
    $index = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
    $out = [];
    foreach (($index['areas'] ?? []) as $a) {
        if (($a['cellSize'] ?? 0) == 10 && preg_match('/^[A-Z]{4}$/', (string) ($a['icao'] ?? ''))) {
            $out[$a['icao']] = (string) $a['name'];
        }
    }
    return $out;
}

function clamp(float $v, float $lo, float $hi): float {
    return max($lo, min($hi, $v));
}

/** Les og avgrens resultatet fra adressen. Returnerer null hvis flyplass eller bane ikke gir mening. */
function diploma(array $q): ?array {
    $airports = airports();
    $icao = strtoupper((string) ($q['a'] ?? ''));
    $runway = strtoupper((string) ($q['r'] ?? ''));
    if (!isset($airports[$icao]) || !preg_match('/^[0-3][0-9][LRC]?$/', $runway)) {
        return null;
    }
    // Navn: bare bokstaver, tall, mellomrom og noen få tegn; maks 40 tegn
    $name = preg_replace('/[^\p{L}\p{N} .,\'’-]/u', '', (string) ($q['n'] ?? '')) ?? '';
    $name = mb_substr(trim(preg_replace('/\s+/u', ' ', $name) ?? ''), 0, 40);
    $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($q['d'] ?? '')) && strtotime((string) $q['d']) ? (string) $q['d'] : gmdate('Y-m-d');
    $stars = (int) clamp((float) ($q['s'] ?? 3), 1, 5);
    $g = $q['g'] ?? '';
    $m = $q['m'] ?? '';
    $taxi = is_string($g) && is_string($m) && preg_match('/^[0-9]{1,3}[A-Za-z]?$/', $g) && preg_match('/^[0-9]{1,4}$/', $m) && (int) $m >= 1 && (int) $m <= 3600;
    return [
        'name' => $name,
        'icao' => $icao,
        'airport' => $airports[$icao],
        'runway' => $runway,
        'stars' => $stars,
        'title' => TITLES[$stars],
        'kt' => (int) round(clamp((float) ($q['k'] ?? 0), 0, 400)),
        'fpm' => (int) round(clamp((float) ($q['f'] ?? 0), 0, 3000)),
        'cross' => round(clamp((float) ($q['c'] ?? 0), 0, 100), 1),
        'past' => (int) round(clamp((float) ($q['t'] ?? 0), -3000, 5000)),
        'date' => $date,
        // Takset til en stand etter landingen: standens nummer og sekundene det tok. Begge må være med og gyldige.
        'stand' => $taxi ? strtoupper((string) $q['g']) : null,
        'taxi' => $taxi ? (int) $q['m'] : null,
        // Sightseeing: funnet (v) av i alt (w), og sekundene (x) når alle ble funnet. Ugyldige tall gir ingen linje.
        'sights' => sights($q),
    ];
}

/** Sightseeing fra adressen: ['found', 'total', 'seconds'] eller null. Tiden gjelder bare når alle er funnet. */
function sights(array $q): ?array {
    $v = $q['v'] ?? ''; $w = $q['w'] ?? ''; $x = $q['x'] ?? null;
    if (!is_string($v) || !is_string($w) || !preg_match('/^[0-9]{1,2}$/', $v) || !preg_match('/^[0-9]{1,2}$/', $w)) return null;
    $found = (int) $v; $total = (int) $w;
    if ($total < 3 || $total > 40 || $found < 1 || $found > $total) return null;
    $timed = $found === $total && is_string($x) && preg_match('/^[0-9]{1,4}$/', $x) && (int) $x >= 1 && (int) $x <= 7200;
    return ['found' => $found, 'total' => $total, 'seconds' => $timed ? (int) $x : null];
}

/** «and found all 9 sights in 6:40», «and found 4 of 9 sights», eller tom tekst. Samme ordlyd som sightsLine i web/src/sights.ts. */
function sights_line(array $d): string {
    $s = $d['sights'];
    if ($s === null) return '';
    return $s['seconds'] !== null ? sprintf('and found all %d sights in %d:%02d', $s['total'], intdiv($s['seconds'], 60), $s['seconds'] % 60)
        : sprintf('and found %d of %d sights', $s['found'], $s['total']);
}

/** Linja under karakteren: taksing og sightseeing, de som finnes. */
function extra_line(array $d): string {
    return implode(' · ', array_filter([taxi_line($d), sights_line($d)]));
}

/** «and taxied to stand 17 in 3:02», eller tom tekst. Samme ordlyd som taxiLine i web/src/diploma.ts. */
function taxi_line(array $d): string {
    return $d['stand'] === null ? '' : sprintf('and taxied to stand %s in %d:%02d', $d['stand'], intdiv($d['taxi'], 60), $d['taxi'] % 60);
}

/** Flyplassene til velgeren: [['icao', 'name', 'id'], ...] i indeksens rekkefølge. `id` er mappa flisene ligger i,
 *  og brukes til oversiktskartet (data/<id>/thumb.jpg). Alt kommer fra indeksen pipeline skriver, og avgrenses her. */
function airport_cards(): array {
    $path = getenv('FLY_INDEX') ?: __DIR__ . '/../data/index.json';
    $index = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
    $out = [];
    foreach (($index['areas'] ?? []) as $a) {
        if (($a['cellSize'] ?? 0) == 10 && preg_match('/^[A-Z]{4}$/', (string) ($a['icao'] ?? '')) && preg_match('/^[a-z0-9]{2,24}$/', (string) ($a['id'] ?? ''))) {
            $out[] = ['icao' => $a['icao'], 'name' => (string) $a['name'], 'id' => $a['id']];
        }
    }
    return $out;
}

/** Adressefeltene for et avgrenset diplom, i fast rekkefølge. */
function query(array $d): string {
    return http_build_query(['n' => $d['name'], 'a' => $d['icao'], 'r' => $d['runway'], 's' => $d['stars'], 'k' => $d['kt'],
        'f' => $d['fpm'], 'c' => $d['cross'], 't' => $d['past'], 'd' => $d['date']]
        + ($d['stand'] === null ? [] : ['g' => $d['stand'], 'm' => $d['taxi']])
        + ($d['sights'] === null ? [] : ['v' => $d['sights']['found'], 'w' => $d['sights']['total']] + ($d['sights']['seconds'] === null ? [] : ['x' => $d['sights']['seconds']])));
}

/** «Kjevik» fra «Kristiansand Airport, Kjevik». */
function place(string $airport): string {
    $parts = explode(',', $airport);
    return trim(end($parts));
}

/** «Kristiansand» fra «Kristiansand Airport, Kjevik»: byen flyplassen hører til. */
function city(string $airport): string {
    return trim(preg_replace('/\s+Airport\b.*$/u', '', $airport) ?? $airport);
}

function touchdown(int $past): string {
    return $past >= 0 ? "$past m past threshold" : (-$past) . ' m before threshold';
}
