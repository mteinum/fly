<?php
/* Skipene ved en flyplass akkurat nå: /ais/?apt=ENCN -> JSON.
 *
 * Svaret er alltid det som ligger lagret. Er det eldre enn REFRESH_S, lytter denne forespørselen på
 * Kystverkets strøm ETTER at svaret er sendt, og oppdaterer lageret. Slik holdes det ferskt så lenge noen
 * spiller, og ingen forbindelse står åpen når ingen gjør det. Bare én lytter om gangen (fillås).
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

const REFRESH_S = 20; // eldre lager enn dette utløser en ny lytting
const LISTEN_S = 22;  // hvor lenge det lyttes

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *'); // åpne data; lar også utviklingsserveren hente herfra
header('X-Robots-Tag: noindex');

$areasFile = getenv('FLY_AIS_AREAS') ?: __DIR__ . '/areas.json';
$areas = is_file($areasFile) ? json_decode((string) file_get_contents($areasFile), true) : null;
$apt = strtoupper((string) ($_GET['apt'] ?? ''));
if (!is_array($areas) || !preg_match('/^[A-Z]{4}$/', $apt) || !isset($areas[$apt])) {
    http_response_code(404);
    echo json_encode(['error' => 'no ship traffic for this airport']);
    exit;
}

$dir = getenv('FLY_AIS_CACHE') ?: __DIR__ . '/cache';
$stateFile = $dir . '/state.json';
$now = time();
$state = is_file($stateFile) ? json_decode((string) file_get_contents($stateFile), true) : null;
if (!is_array($state)) { $state = ['updated' => 0]; }

echo json_encode([
    't' => $now,
    'updated' => (int) ($state['updated'] ?? 0),
    'credit' => 'AIS data: Kystverket (NLOD)',
    'ships' => ais_ships($state, $areas[$apt], $now),
]);

if ($now - (int) ($state['updated'] ?? 0) < REFRESH_S || getenv('FLY_AIS_NO_LISTEN')) { exit; }

// Resten skjer etter at nettleseren har fått svaret
ignore_user_abort(true);
set_time_limit(LISTEN_S + 20);
if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); } else { flush(); }

if (!is_dir($dir) && !@mkdir($dir, 0755, true)) { exit; }
$lock = @fopen($dir . '/lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { exit; } // noen andre lytter allerede
// lageret kan ha blitt oppdatert mens vi ventet på låsen
clearstatcache();
$fresh = is_file($stateFile) ? json_decode((string) file_get_contents($stateFile), true) : null;
if (is_array($fresh)) { $state = $fresh; }
if (time() - (int) ($state['updated'] ?? 0) >= REFRESH_S) {
    $sock = @fsockopen(AIS_HOST, AIS_PORT, $errno, $errstr, 6);
    if ($sock) {
        stream_set_timeout($sock, 2);
        $lines = [];
        $end = microtime(true) + LISTEN_S;
        while (microtime(true) < $end && !feof($sock) && count($lines) < 20000) {
            $line = fgets($sock, 1024);
            if ($line !== false) { $lines[] = $line; }
        }
        fclose($sock);
        ais_ingest($lines, $state, $areas, time());
        $state['updated'] = time();
        $state['parts'] = []; // halve meldinger gir ingen mening etter at forbindelsen er lukket
        // skriv til en midlertidig fil og bytt navn, så ingen leser en halvskrevet fil
        $tmp = $stateFile . '.' . getmypid();
        if (@file_put_contents($tmp, json_encode($state)) !== false) { @rename($tmp, $stateFile); }
    }
}
flock($lock, LOCK_UN);
