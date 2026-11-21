<?php
/* Flytrafikk fra adsb.lol, til spillet.
 *
 * Kilde: adsb.lol, et åpent nettverk av frivillige ADS-B-mottakere. Data under Open Database License (ODbL) 1.0.
 * Dekningen avhenger av hvor det står mottakere, så fly kan mangle, særlig lavt og langt fra byene.
 *
 * Denne fila er ren tolking, uten nett og uten filer (testes i deploy/test_traffic.sh). index.php gjør resten.
 * Lengde/bredde gjøres om til UTM 33 med utm33() fra skipstjenesten: samme ene unntak fra regelen om at bare
 * pipeline transformerer koordinater.
 */
declare(strict_types=1);
require_once __DIR__ . '/../ais/lib.php';

const FT = 0.3048;
const AIRCRAFT_MAX_AGE_S = 60; // posisjoner eldre enn dette tas ikke med

/** Adressen for fly innen $area['radiusNm'] nautiske mil fra utsnittets sentrum. Bare tall fra areas.json. */
function traffic_url(array $area): string
{
    return sprintf('https://api.adsb.lol/v2/lat/%.4f/lon/%.4f/dist/%d', $area['lat'], $area['lon'], $area['radiusNm']);
}

/** Tolker svaret fra adsb.lol til flyene innenfor utsnittet. $area har 'box' ([west, south, east, north] i
 *  UTM 33) og 'geoidM' (hvor mye ellipsoiden ligger over havnivå der, fra pipeline).
 *
 *  HØYDE: 'alt_geom' er høyde over ellipsoiden (fra GPS), i fot. Spillet regner høyde over havet (NN2000), så
 *  geoidehøyden trekkes fra. Mangler den, brukes trykkhøyden 'alt_baro' som den er: den avhenger av lufttrykket
 *  og kan være over hundre meter feil. 'alt' sier hvilken som ble brukt. */
function traffic_parse(string $json, array $area): array
{
    $data = json_decode($json, true);
    if (!is_array($data) || !isset($data['ac']) || !is_array($data['ac'])) { return []; }
    $box = $area['box'];
    $out = [];
    foreach ($data['ac'] as $a) {
        $hex = strtolower((string) ($a['hex'] ?? ''));
        if (!preg_match('/^[0-9a-f]{6}$/', $hex) || !is_numeric($a['lat'] ?? null) || !is_numeric($a['lon'] ?? null)) { continue; }
        $age = is_numeric($a['seen_pos'] ?? null) ? (float) $a['seen_pos'] : 999.0;
        if ($age > AIRCRAFT_MAX_AGE_S) { continue; }
        [$e, $n] = utm33((float) $a['lon'], (float) $a['lat']);
        if ($e < $box[0] || $e >= $box[2] || $n <= $box[1] || $n > $box[3]) { continue; }
        $ground = ($a['alt_baro'] ?? null) === 'ground';
        $alt = null; $source = null;
        if (!$ground && is_numeric($a['alt_geom'] ?? null)) {
            $alt = (float) $a['alt_geom'] * FT - (float) $area['geoidM']; $source = 'geom';
        } elseif (!$ground && is_numeric($a['alt_baro'] ?? null)) {
            $alt = (float) $a['alt_baro'] * FT; $source = 'baro';
        } elseif (!$ground) {
            continue; // i lufta uten høyde: kan ikke plasseres
        }
        $rate = $a['baro_rate'] ?? $a['geom_rate'] ?? null;
        $out[] = [
            'id' => $hex,
            'e' => round($e, 1), 'n' => round($n, 1),
            'altM' => $alt === null ? null : round($alt, 1), 'alt' => $source, 'ground' => $ground,
            'gs' => is_numeric($a['gs'] ?? null) ? (float) $a['gs'] : null,          // knop
            'track' => is_numeric($a['track'] ?? null) ? (float) $a['track'] : null, // grader, sann
            'vr' => is_numeric($rate) ? (float) $rate : null,                        // fot per minutt
            'age' => round($age, 1),
            // kallesignal og flytype er det flyet selv sender. Registreringen tas ikke med: for småfly peker den på eieren.
            'flight' => substr(preg_replace('/[^A-Z0-9]/', '', strtoupper((string) ($a['flight'] ?? ''))), 0, 8),
            'type' => substr(preg_replace('/[^A-Z0-9]/', '', strtoupper((string) ($a['t'] ?? ''))), 0, 4),
            'cat' => substr(preg_replace('/[^A-D0-7]/', '', strtoupper((string) ($a['category'] ?? ''))), 0, 2),
        ];
    }
    usort($out, fn ($a, $b) => strcmp($a['id'], $b['id']));
    return $out;
}
