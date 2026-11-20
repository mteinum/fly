#!/usr/bin/env bash
# Kjører delingssiden (web/public/share) med PHP på kommandolinja og sjekker det den lager.
# Bruk: bash deploy/test_share.sh <mappe for resultatet>
set -Eeuo pipefail
out=${1:?mappe for resultatet}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../web/public/share" && pwd)
mkdir -p "$out"
fail() { printf 'share test: %s\n' "$*" >&2; exit 1; }
command -v php >/dev/null || fail 'php mangler'
php -r 'exit(function_exists("imagettftext") ? 0 : 1);' || fail 'PHP mangler GD med FreeType'
for f in lib.php image.php index.php; do php -l "$root/$f" >/dev/null || fail "syntaksfeil i $f"; done

# Indeksen skrives av pipeline og finnes ikke i et rent repo: lag en for testen
export FLY_INDEX="$out/index.json"
printf '%s' '{"areas":[{"id":"bodo10","name":"Bodø Airport","icao":"ENBO","cellSize":10},{"id":"kjevik","name":"x","icao":"ENCN","cellSize":50}]}' > "$FLY_INDEX"
# Kjør en av sidene med gitte adressefelt (JSON i Q), som om den ble hentet av en nettleser
page() { Q=$2 php -r '$_GET = json_decode(getenv("Q"), true); include $argv[1];' "$root/$1"; }

good='{"n":"Morten Ø","a":"ENBO","r":"25","s":"5","k":"111","f":"183","c":"0.0","t":"153","d":"2026-11-20"}'
page image.php "$good" > "$out/diploma.png"
php -r '$s = getimagesize($argv[1]); exit($s && $s[0] === 1200 && $s[1] === 630 && $s["mime"] === "image/png" ? 0 : 1);' "$out/diploma.png" || fail 'diplombildet er ikke en PNG på 1200 x 630'

page index.php "$good" > "$out/share.html"
grep -q 'property="og:image" content="https://fly.teinum.no/share/image.php?n=Morten+%C3%98&amp;a=ENBO&amp;r=25&amp;s=5&amp;k=111&amp;f=183&amp;c=0&amp;t=153&amp;d=2026-11-20"' "$out/share.html" || fail 'og:image peker ikke på diplombildet'
grep -q 'property="og:title" content="Morten Ø landed an Airbus A320 at Bodø Airport: ★★★★★ Butter landing"' "$out/share.html" || fail 'og:title er feil'

# Alt i adressen skal avgrenses: ingen HTML slipper gjennom, tall holdes innenfor grensene
evil='{"n":"<script>alert(1)</script>\" onload=x","a":"enbo","r":"25","s":"99","k":"1e9","f":"-5","c":"abc","t":"-99999"}'
page index.php "$evil" > "$out/evil.html"
! grep -q '<script' "$out/evil.html" || fail 'HTML fra navnet slapp gjennom'
grep -q 's=5&amp;k=400&amp;f=0&amp;c=0&amp;t=-3000' "$out/evil.html" || fail 'tallene ble ikke avgrenset'
page image.php "$evil" > "$out/evil.png"
php -r 'exit(getimagesize($argv[1]) ? 0 : 1);' "$out/evil.png" || fail 'bildet tålte ikke rare verdier'

# Ukjent flyplass (også 50 m-utsnittet, som ikke er en flyplass i spillet) og ugyldig bane gir ikke noe diplom
for bad in '{"a":"XXXX","r":"25"}' '{"a":"ENCN","r":"03"}' '{"a":"ENBO","r":"99X"}' '{}'; do
  [[ "$(page image.php "$bad")" == 'Unknown airport or runway.' ]] || fail "laget bilde for $bad"
  [[ -z "$(page index.php "$bad")" ]] || fail "laget side for $bad"
done
printf 'share test: ok (%s)\n' "$out/diploma.png"
