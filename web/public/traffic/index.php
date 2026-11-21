<?php
/* Flyene ved en flyplass akkurat nå: /traffic/?apt=ENCN -> JSON.
 *
 * Som skipstjenesten: svaret er det som ligger lagret, og er det for gammelt, hentes nytt fra adsb.lol ETTER
 * at svaret er sendt. Kilden tillater 500 forespørsler i døgnet uten nøkkel, så det hentes høyst hvert 45.
 * sekund per flyplass, bare mens noen spiller der, og aldri mer enn DAILY_BUDGET i døgnet til sammen.
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

const REFRESH_S = 45;
const DAILY_BUDGET = 440; // under kildens grense på 500 per døgn (UTC)

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('X-Robots-Tag: noindex');

$areasFile = getenv('FLY_TRAFFIC_AREAS') ?: __DIR__ . '/areas.json';
$areas = is_file($areasFile) ? json_decode((string) file_get_contents($areasFile), true) : null;
$apt = strtoupper((string) ($_GET['apt'] ?? ''));
if (!is_array($areas) || !preg_match('/^[A-Z]{4}$/', $apt) || !isset($areas[$apt])) {
    http_response_code(404);
    echo json_encode(['error' => 'no air traffic for this airport']);
    exit;
}

$dir = getenv('FLY_TRAFFIC_CACHE') ?: __DIR__ . '/cache';
$file = "$dir/$apt.json"; // $apt er fire store bokstaver og finnes i areas.json
$now = time();
$state = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
if (!is_array($state)) { $state = ['updated' => 0, 'aircraft' => []]; }
$age = $now - (int) $state['updated'];

echo json_encode([
    't' => $now,
    'updated' => (int) $state['updated'],
    'credit' => 'Aircraft positions: adsb.lol (ODbL)',
    // eldre enn to minutter er ikke «nå» for et fly: da er lista tom
    'aircraft' => $age <= 120 ? $state['aircraft'] : [],
]);

if ($age < REFRESH_S || getenv('FLY_TRAFFIC_NO_FETCH')) { exit; }

ignore_user_abort(true);
set_time_limit(30);
if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); } else { flush(); }

if (!is_dir($dir) && !@mkdir($dir, 0755, true)) { exit; }
$lock = @fopen("$dir/lock", 'c+');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { exit; } // noen andre henter allerede

// Døgnregnskapet ligger i låsefila: dato (UTC), antall forespørsler, og når vi tidligst kan spørre igjen
$budget = json_decode((string) stream_get_contents($lock), true);
$today = gmdate('Y-m-d');
if (!is_array($budget) || ($budget['day'] ?? '') !== $today) { $budget = ['day' => $today, 'count' => 0, 'wait' => 0]; }
clearstatcache();
$fresh = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
$stillStale = !is_array($fresh) || time() - (int) $fresh['updated'] >= REFRESH_S;
if ($stillStale && $budget['count'] < DAILY_BUDGET && time() >= $budget['wait']) {
    $budget['count']++;
    $ctx = stream_context_create(['http' => [
        'timeout' => 8, 'ignore_errors' => true,
        'header' => "User-Agent: teinum-fly (https://fly.teinum.no, github.com/mteinum/fly)\r\nAccept: application/json\r\n",
    ]]);
    $body = @file_get_contents(traffic_url($areas[$apt]), false, $ctx);
    $status = 0; $retry = 0;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) { $status = (int) $m[1]; }
        if (preg_match('/^Retry-After:\s*(\d+)/i', $h, $m)) { $retry = (int) $m[1]; }
    }
    if ($status === 200 && is_string($body)) {
        $tmp = "$file." . getmypid();
        $new = ['updated' => time(), 'aircraft' => traffic_parse($body, $areas[$apt])];
        if (@file_put_contents($tmp, json_encode($new)) !== false) { @rename($tmp, $file); }
    } else {
        // avvist eller nede: vent minst fem minutter (eller så lenge kilden ber om) før neste forsøk
        $budget['wait'] = time() + max(300, min($retry, 86400));
    }
}
ftruncate($lock, 0); rewind($lock); fwrite($lock, json_encode($budget));
flock($lock, LOCK_UN);
