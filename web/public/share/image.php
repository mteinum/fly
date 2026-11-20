<?php
// Diplombildet (1200 x 630 PNG), tegnet fra tallene i adressen. Samme oppsett som web/src/diploma.ts,
// men med et fast bakgrunnsbilde: bildet fra selve landingen finnes bare i spillerens nettleser.
declare(strict_types=1);
require __DIR__ . '/lib.php';

$d = diploma($_GET);
if ($d === null) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Unknown airport or runway.');
}

const W = 1200;
const H = 630;
$font = fn(string $name): string => __DIR__ . "/fonts/DejaVu$name.ttf";

$im = imagecreatetruecolor(W, H);
$bg = @imagecreatefromjpeg(__DIR__ . '/bg.jpg');
if ($bg) {
    imagecopyresampled($im, $bg, 0, 0, 0, 0, W, H, imagesx($bg), imagesy($bg));
} else {
    imagefilledrectangle($im, 0, 0, W, H, imagecolorallocate($im, 12, 22, 38));
}
imagefilledrectangle($im, 0, 0, W, H, imagecolorallocatealpha($im, 8, 14, 28, 41)); // 68 % dekkende

$gold = imagecolorallocate($im, 217, 178, 90);
$title = imagecolorallocate($im, 240, 212, 138);
$white = imagecolorallocate($im, 255, 255, 255);
$soft = imagecolorallocate($im, 230, 234, 242);
$muted = imagecolorallocate($im, 174, 184, 204);
$dim = imagecolorallocatealpha($im, 255, 255, 255, 99);
$star = imagecolorallocate($im, 255, 208, 74);

// dobbel gullramme
imagesetthickness($im, 5);
imagerectangle($im, 22, 22, W - 22, H - 22, $gold);
imagesetthickness($im, 2);
imagerectangle($im, 34, 34, W - 34, H - 34, $gold);

/** Tekst med gitt forankring: 0 = venstre, 0.5 = midtstilt, 1 = høyre. Krymper hvis den er bredere enn $max. */
$text = function (string $s, float $x, float $y, float $size, string $file, int $color, float $anchor = 0.5, float $max = W - 140) use ($im): void {
    $box = imagettfbbox($size, 0, $file, $s);
    $w = $box[2] - $box[0];
    if ($w > $max) {
        $size *= $max / $w;
        $box = imagettfbbox($size, 0, $file, $s);
        $w = $box[2] - $box[0];
    }
    imagettftext($im, $size, 0, (int) round($x - $w * $anchor - $box[0]), (int) round($y), $color, $file, $s);
};
/** Femtakket stjerne med sentrum i ($cx, $cy). */
$drawStar = function (float $cx, float $cy, float $r, int $color) use ($im): void {
    $pts = [];
    for ($i = 0; $i < 10; $i++) {
        $rad = $i % 2 ? $r * 0.42 : $r;
        $a = -M_PI / 2 + $i * M_PI / 5;
        $pts[] = (int) round($cx + cos($a) * $rad);
        $pts[] = (int) round($cy + sin($a) * $rad);
    }
    imagefilledpolygon($im, $pts, $color);
};

$text('D I P L O M A', W / 2, 114, 42, $font('Serif-Bold'), $title);
$text('awarded to', W / 2, 158, 18, $font('Serif-Italic'), $soft);
$text($d['name'] !== '' ? $d['name'] : 'a skilled pilot', W / 2, 222, 40, $font('Serif-Bold'), $white);
$text("for landing an Airbus A320 at {$d['airport']} ({$d['icao']}), runway {$d['runway']}", W / 2, 274, 19, $font('Serif'), $soft);
for ($i = 0; $i < 5; $i++) {
    $drawStar(W / 2 + ($i - 2) * 62, 334, 25, $i < $d['stars'] ? $star : $dim);
}
$text($d['title'], W / 2, 408, 26, $font('Serif-Bold'), $title);

$stats = [
    ['SPEED', "{$d['kt']} kt"],
    ['SINK RATE', "{$d['fpm']} ft/min"],
    ['OFF CENTRELINE', number_format($d['cross'], 1) . ' m'],
    ['TOUCHDOWN', touchdown($d['past'])],
];
$col = (W - 160) / count($stats);
foreach ($stats as $i => [$label, $value]) {
    $x = 80 + $col * ($i + 0.5);
    $text($label, $x, 474, 14, $font('Sans'), $muted, 0.5, $col - 16);
    $text($value, $x, 516, 22, $font('Sans-Bold'), $white, 0.5, $col - 16);
}
$text(date('j F Y', (int) strtotime($d['date'])), 62, H - 56, 15, $font('Sans'), $soft, 0);
$text('fly.teinum.no', W / 2, H - 56, 19, $font('Sans-Bold'), $title);
$text('Flight simulator · Map data © Kartverket', W - 62, H - 56, 13, $font('Sans'), $muted, 1);

header('Content-Type: image/png');
header('Cache-Control: public, max-age=86400');
imagepng($im, null, 6);
