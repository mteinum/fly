<?php
/* Busser og tog fra Entur, til spillet.
 *
 * Kilde: Enturs åpne tjeneste for kjøretøyposisjoner (Vehicle Positions, GraphQL), lisens NLOD. Entur krever at
 * den som spør sier hvem den er, i hodet ET-Client-Name.
 * Dekningen er det selskapene sender inn: i november 2026 mangler Ruter (buss, trikk og T-bane i Oslo) og Bybanen
 * i Bergen helt, og mange kjøretøy står med en gammel posisjon. Bare ferske posisjoner tas med.
 * Ferger tas ikke med: de kommer alt fra Kystverkets AIS i skipstjenesten.
 *
 * Denne fila er ren tolking, uten nett og uten filer (testes i deploy/test_transit.sh). index.php gjør resten.
 * Lengde/bredde gjøres om til UTM 33 med utm33() fra skipstjenesten.
 */
declare(strict_types=1);
require_once __DIR__ . '/../ais/lib.php';

const TRANSIT_URL = 'https://api.entur.io/realtime/v2/vehicles/graphql';
const TRANSIT_CLIENT = 'teinum-fly'; // ET-Client-Name: hvem vi er, slik Entur ber om
const TRANSIT_MAX_AGE_S = 120;       // en buss i rute melder seg med få sekunders mellomrom; en som står, sjeldnere
const TRANSIT_MAX = 400;
const TRANSIT_MODES = ['BUS' => 'bus', 'COACH' => 'coach', 'RAIL' => 'rail', 'TRAM' => 'tram', 'METRO' => 'metro'];

/** Spørringen for kjøretøy i en boks rundt utsnittets sentrum. Bare tall fra areas.json settes inn. */
function transit_query(array $area): string
{
    $dLat = $area['radiusNm'] / 60.0;
    $dLon = $dLat / cos(deg2rad((float) $area['lat']));
    $box = sprintf('{minLat:%.4f,minLon:%.4f,maxLat:%.4f,maxLon:%.4f}', $area['lat'] - $dLat, $area['lon'] - $dLon, $area['lat'] + $dLat, $area['lon'] + $dLon);
    return json_encode(['query' => "{ vehicles(boundingBox:$box) { vehicleId mode codespace { codespaceId } line { publicCode } lastUpdated location { latitude longitude } bearing } }"]);
}

/** Tolker svaret fra Entur til kjøretøyene innenfor utsnittet. $area har 'box' ([west, south, east, north] i UTM 33).
 *  $now er klokka (sekunder) alderen regnes mot. */
function transit_parse(string $json, array $area, int $now): array
{
    $data = json_decode($json, true);
    $list = is_array($data) ? ($data['data']['vehicles'] ?? null) : null;
    if (!is_array($list)) { return []; }
    $box = $area['box'];
    $out = [];
    foreach ($list as $v) {
        if (!is_array($v)) { continue; }
        $mode = TRANSIT_MODES[(string) ($v['mode'] ?? '')] ?? null;
        $lat = $v['location']['latitude'] ?? null; $lon = $v['location']['longitude'] ?? null;
        $seen = is_string($v['lastUpdated'] ?? null) ? strtotime($v['lastUpdated']) : false;
        if ($mode === null || !is_numeric($lat) || !is_numeric($lon) || $seen === false) { continue; }
        $age = $now - $seen;
        if ($age > TRANSIT_MAX_AGE_S || $age < -60) { continue; }
        [$e, $n] = utm33((float) $lon, (float) $lat);
        if ($e < $box[0] || $e >= $box[2] || $n <= $box[1] || $n > $box[3]) { continue; }
        $id = preg_replace('/[^A-Za-z0-9:_-]/', '', (string) ($v['codespace']['codespaceId'] ?? '') . ':' . (string) ($v['vehicleId'] ?? ''));
        if (strlen($id) < 3) { continue; }
        $bearing = $v['bearing'] ?? null;
        $out[] = [
            'id' => substr($id, 0, 40),
            'mode' => $mode,
            // linjenummeret slik det står på skiltet: «M3», «40», «R14»
            'line' => mb_substr(preg_replace('/[^\p{L}\p{N}]/u', '', (string) ($v['line']['publicCode'] ?? '')), 0, 6),
            'e' => round($e, 1), 'n' => round($n, 1),
            'bearing' => is_numeric($bearing) ? round(fmod((float) $bearing + 360.0, 360.0), 1) : null, // grader, sann
            'age' => max(0, $age),
        ];
    }
    usort($out, fn ($a, $b) => strcmp($a['id'], $b['id']));
    return array_slice($out, 0, TRANSIT_MAX);
}
