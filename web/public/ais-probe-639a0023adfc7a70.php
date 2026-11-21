<?php
// MIDLERTIDIG prøve: kan PHP på webhotellet nå Kystverkets åpne AIS-strøm? Slutter å virke av seg selv
// (se $expires), og erstattes av en tom fil etterpå. Publiseringen sletter aldri filer på serveren.
declare(strict_types=1);
$expires = 1795302984;
if (time() > $expires) { http_response_code(404); exit; }
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
$off = array_map('trim', explode(',', (string) ini_get('disable_functions')));
$out = [
    'php' => PHP_VERSION,
    'sapi' => PHP_SAPI,
    'max_execution_time' => (int) ini_get('max_execution_time'),
    'fsockopen' => function_exists('fsockopen') && !in_array('fsockopen', $off, true),
    'stream_socket_client' => function_exists('stream_socket_client') && !in_array('stream_socket_client', $off, true),
    'set_time_limit' => function_exists('set_time_limit') && !in_array('set_time_limit', $off, true),
    'can_write_next_to_script' => is_writable(__DIR__),
    'can_write_tmp' => is_writable(sys_get_temp_dir()),
];
$t0 = microtime(true);
$errno = 0; $errstr = '';
// Adressen og porten er de Kystverket oppgir for sine åpne AIS-data (kystverket.no, «Tilgang på AIS-data»)
$s = @fsockopen('153.44.253.27', 5631, $errno, $errstr, 6);
$out['connect_ms'] = (int) round((microtime(true) - $t0) * 1000);
if (!$s) {
    $out['connected'] = false;
    $out['error'] = $errno . ' ' . $errstr;
} else {
    $out['connected'] = true;
    stream_set_timeout($s, 1);
    $bytes = 0; $messages = 0; $end = microtime(true) + 4;
    while (microtime(true) < $end && !feof($s)) {
        $line = fgets($s, 512);
        if ($line === false) { continue; }
        $bytes += strlen($line);
        if (strpos($line, 'VDM') !== false) { $messages++; }
    }
    fclose($s);
    $out['listened_s'] = 4;
    $out['bytes'] = $bytes;
    $out['ais_messages'] = $messages;
}
echo json_encode($out, JSON_PRETTY_PRINT);
