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
    ];
}

/** Adressefeltene for et avgrenset diplom, i fast rekkefølge. */
function query(array $d): string {
    return http_build_query(['n' => $d['name'], 'a' => $d['icao'], 'r' => $d['runway'], 's' => $d['stars'], 'k' => $d['kt'],
        'f' => $d['fpm'], 'c' => $d['cross'], 't' => $d['past'], 'd' => $d['date']]);
}

/** «Kjevik» fra «Kristiansand Airport, Kjevik». */
function place(string $airport): string {
    $parts = explode(',', $airport);
    return trim(end($parts));
}

function touchdown(int $past): string {
    return $past >= 0 ? "$past m past threshold" : (-$past) . ' m before threshold';
}
