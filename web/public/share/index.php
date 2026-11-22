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
    . ' m off the centreline · ' . touchdown($d['past']) . (extra_line($d) === '' ? '' : ' · ' . extra_line($d)) . '. Fly it yourself over real Norwegian terrain.';
// Flyplassene å velge mellom, med den diplomet gjelder først
$cards = airport_cards();
usort($cards, fn ($a, $b) => ($b['icao'] === $d['icao']) <=> ($a['icao'] === $d['icao']));
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
  h2{margin:8px 0 0;font-size:20px;font-weight:600;color:#f0d48a}
  .airports{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;width:min(100%,900px)}
  .airports a{display:block;border-radius:6px;overflow:hidden;background:#15151f;border:1px solid #2c2c3a;color:#e8e2d0;text-decoration:none}
  .airports a:hover,.airports a:focus{border-color:#d9b25a}
  .airports a.same{border-color:#d9b25a;box-shadow:0 0 0 1px #d9b25a}
  .airports img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:0}
  .airports b{display:block;padding:8px 6px 2px;font-size:15px}
  .airports span{display:block;padding:0 6px 8px;font-size:12px;opacity:.7}
  p{margin:0;opacity:.75;font-size:14px}
</style>
</head>
<body>
<img src="<?= $e('image.php?' . $q) ?>" width="1200" height="630" alt="<?= $e("Diploma: {$d['title']} at {$d['airport']}, runway {$d['runway']}.") ?>">
<h2>Fly it yourself</h2>
<p>Choose an airport</p>
<div class="airports">
<?php foreach ($cards as $c): ?>
  <a<?= $c['icao'] === $d['icao'] ? ' class="same"' : '' ?> href="<?= $e(SITE . '/?apt=' . $c['icao']) ?>">
    <img src="<?= $e('../data/' . $c['id'] . '/thumb.jpg') ?>" width="320" height="320" loading="lazy" alt="<?= $e('Map of the area around ' . $c['name']) ?>">
    <b><?= $e(city($c['name'])) ?></b>
    <span><?= $e((place($c['name']) !== $c['name'] ? place($c['name']) . ' · ' : '') . $c['icao']) ?></span>
  </a>
<?php endforeach; ?>
</div>
<p>A browser flight simulator over real Norwegian terrain. Map data © Kartverket, © OpenStreetMap contributors.</p>
</body>
</html>
