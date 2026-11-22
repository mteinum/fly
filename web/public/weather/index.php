<?php
/* Vinden på en flyplass akkurat nå: /weather/?apt=ENCN -> JSON.
 *
 * Svaret er siste METAR fra Meteorologisk institutt, og vinden lest ut av den. Meldingen lagres i ti minutter per
 * flyplass (flyplassene sender ny hver halvtime), så kilden får høyst seks forespørsler i timen per flyplass, og
 * bare mens noen spiller der. Ingenting om den som spør lagres; eneste inndata er flyplasskoden, som må finnes i
 * flytjenestens areas.json (skrevet av pipeline).
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

const REFRESH_S = 600;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('X-Robots-Tag: noindex');

$areasFile = getenv('FLY_WEATHER_AREAS') ?: __DIR__ . '/../traffic/areas.json';
$areas = is_file($areasFile) ? json_decode((string) file_get_contents($areasFile), true) : null;
$apt = strtoupper((string) ($_GET['apt'] ?? ''));
if (!is_array($areas) || !preg_match('/^[A-Z]{4}$/', $apt) || !isset($areas[$apt])) {
    http_response_code(404);
    echo json_encode(['error' => 'no weather for this airport']);
    exit;
}

$dir = getenv('FLY_WEATHER_CACHE') ?: __DIR__ . '/cache';
$file = "$dir/$apt.json"; // $apt er fire store bokstaver og finnes i areas.json
$read = function () use ($file): array {
    $s = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    return is_array($s) ? $s : ['updated' => 0, 'metar' => null];
};
$state = $read();

// For gammelt: hent nytt før svaret sendes (ett lite kall). Er noen andre i gang, brukes det som ligger der.
if (time() - (int) $state['updated'] >= REFRESH_S && !getenv('FLY_WEATHER_NO_FETCH') && (is_dir($dir) || @mkdir($dir, 0755, true))) {
    $lock = @fopen("$dir/lock", 'c+');
    if ($lock && flock($lock, LOCK_EX | LOCK_NB)) {
        $ctx = stream_context_create(['http' => [
            'timeout' => 4, 'ignore_errors' => true,
            'header' => "User-Agent: teinum-fly (https://fly.teinum.no, github.com/mteinum/fly)\r\nAccept: text/plain\r\n",
        ]]);
        $body = @file_get_contents(weather_url($apt), false, $ctx);
        $status = 0;
        foreach ($http_response_header ?? [] as $h) { if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) { $status = (int) $m[1]; } }
        // Også et mislykket forsøk stemples, så en tjeneste som er nede ikke spørres på nytt for hver spiller
        $state = ['updated' => time(), 'metar' => $status === 200 && is_string($body) ? metar_latest($body, $apt) : $state['metar']];
        $tmp = "$file." . getmypid();
        if (@file_put_contents($tmp, json_encode($state)) !== false) { @rename($tmp, $file); }
        flock($lock, LOCK_UN);
    }
}

$now = time();
$metar = is_string($state['metar']) ? $state['metar'] : null;
$observed = $metar === null ? null : metar_time($metar, $now);
$fresh = $observed !== null && $now - $observed <= METAR_MAX_AGE_S;
echo json_encode([
    't' => $now,
    'credit' => 'Weather: MET Norway (CC BY 4.0)',
    'metar' => $fresh ? $metar : null,
    'observed' => $fresh ? $observed : null,
    // en gammel eller uleselig melding gir ingen vind: da er det vindstille i spillet
    'wind' => $fresh ? metar_wind($metar) : null,
]);
