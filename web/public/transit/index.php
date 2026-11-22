<?php
/* Bussene og togene ved en flyplass akkurat nå: /transit/?apt=ENCN -> JSON.
 *
 * Som flytjenesten: svaret er det som ligger lagret, og er det for gammelt, hentes nytt fra Entur ETTER at svaret
 * er sendt. Det hentes høyst hvert 20. sekund per flyplass, bare mens noen spiller der, og aldri mer enn
 * DAILY_BUDGET ganger i døgnet til sammen. Utsnittene er de samme som flytjenesten bruker (areas.json fra pipeline).
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

const REFRESH_S = 20;
const DAILY_BUDGET = 6000; // ni flyplasser spilt døgnet rundt ville vært 39 000: dette er et tak mot løpske klienter

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('X-Robots-Tag: noindex');

$areasFile = getenv('FLY_TRANSIT_AREAS') ?: __DIR__ . '/../traffic/areas.json';
$areas = is_file($areasFile) ? json_decode((string) file_get_contents($areasFile), true) : null;
$apt = strtoupper((string) ($_GET['apt'] ?? ''));
if (!is_array($areas) || !preg_match('/^[A-Z]{4}$/', $apt) || !isset($areas[$apt])) {
    http_response_code(404);
    echo json_encode(['error' => 'no public transport for this airport']);
    exit;
}

$dir = getenv('FLY_TRANSIT_CACHE') ?: __DIR__ . '/cache';
$file = "$dir/$apt.json"; // $apt er fire store bokstaver og finnes i areas.json
$now = time();
$state = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
if (!is_array($state)) { $state = ['updated' => 0, 'vehicles' => []]; }
$age = $now - (int) $state['updated'];

echo json_encode([
    't' => $now,
    'updated' => (int) $state['updated'],
    'credit' => 'Buses and trains: Entur (NLOD)',
    // eldre enn to minutter er ikke «nå» for en buss: da er lista tom
    'vehicles' => $age <= 120 ? $state['vehicles'] : [],
]);

if ($age < REFRESH_S || getenv('FLY_TRANSIT_NO_FETCH')) { exit; }

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
        'method' => 'POST', 'timeout' => 8, 'ignore_errors' => true, 'content' => transit_query($areas[$apt]),
        'header' => "Content-Type: application/json\r\nAccept: application/json\r\nET-Client-Name: " . TRANSIT_CLIENT . "\r\nUser-Agent: teinum-fly (https://fly.teinum.no, github.com/mteinum/fly)\r\n",
    ]]);
    $body = @file_get_contents(TRANSIT_URL, false, $ctx);
    $status = 0; $retry = 0;
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) { $status = (int) $m[1]; }
        if (preg_match('/^Retry-After:\s*(\d+)/i', $h, $m)) { $retry = (int) $m[1]; }
    }
    if ($status === 200 && is_string($body)) {
        $tmp = "$file." . getmypid();
        $new = ['updated' => time(), 'vehicles' => transit_parse($body, $areas[$apt], time())];
        if (@file_put_contents($tmp, json_encode($new)) !== false) { @rename($tmp, $file); }
    } else {
        // avvist eller nede: vent minst fem minutter (eller så lenge kilden ber om) før neste forsøk.
        // Entur ber om at klienter ikke prøver på nytt av seg selv når kvoten er brukt opp.
        $budget['wait'] = time() + max(300, min($retry, 86400));
    }
}
ftruncate($lock, 0); rewind($lock); fwrite($lock, json_encode($budget));
flock($lock, LOCK_UN);
