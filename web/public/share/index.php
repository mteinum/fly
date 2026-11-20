<?php
// Delingssiden for et diplom. Facebook, Messenger og iMessage leser taggene her og viser
// diplombildet (image.php) som forhåndsvisning. Folk som følger lenken ser diplomet og kan fly selv.
declare(strict_types=1);
require __DIR__ . '/lib.php';

$d = diploma($_GET);
if ($d === null) {
    header('Location: ' . SITE . '/', true, 302);
    exit;
}
$e = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$q = query($d);
$url = SITE . '/share/?' . $q;
$image = SITE . '/share/image.php?' . $q;
$who = $d['name'] !== '' ? $d['name'] : 'A pilot';
$stars = str_repeat('★', $d['stars']) . str_repeat('☆', 5 - $d['stars']);
$title = "$who landed an Airbus A320 at " . place($d['airport']) . ": $stars {$d['title']}";
$description = "Runway {$d['runway']} · {$d['kt']} kt · {$d['fpm']} ft/min · " . number_format($d['cross'], 1)
    . ' m off the centreline · ' . touchdown($d['past']) . '. Fly it yourself over real Norwegian terrain.';
$play = SITE . '/?apt=' . $d['icao'];
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=3600');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?= $e($title) ?> – teinum-fly</title>
<meta name="description" content="<?= $e($description) ?>">
<link rel="canonical" href="<?= $e($url) ?>">
<meta property="og:type" content="website">
<meta property="og:site_name" content="teinum-fly">
<meta property="og:locale" content="en_GB">
<meta property="og:url" content="<?= $e($url) ?>">
<meta property="og:title" content="<?= $e($title) ?>">
<meta property="og:description" content="<?= $e($description) ?>">
<meta property="og:image" content="<?= $e($image) ?>">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="<?= $e("Diploma: {$d['title']} at {$d['airport']}, runway {$d['runway']}.") ?>">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<?= $e($title) ?>">
<meta name="twitter:description" content="<?= $e($description) ?>">
<meta name="twitter:image" content="<?= $e($image) ?>">
<style>
  body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:16px;box-sizing:border-box;background:#0b0b14;color:#e8e2d0;font-family:system-ui,sans-serif;text-align:center}
  img{max-width:min(100%,900px);height:auto;border-radius:6px}
  a.play{padding:12px 22px;border-radius:6px;background:#8a5a12;border:1px solid #d9b25a;color:#fff;text-decoration:none;font-weight:600}
  p{margin:0;opacity:.75;font-size:14px}
</style>
</head>
<body>
<img src="<?= $e('image.php?' . $q) ?>" width="1200" height="630" alt="<?= $e("Diploma: {$d['title']} at {$d['airport']}, runway {$d['runway']}.") ?>">
<a class="play" href="<?= $e($play) ?>">Fly it yourself</a>
<p>A browser flight simulator over real Norwegian terrain. Map data © Kartverket.</p>
</body>
</html>
