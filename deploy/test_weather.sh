#!/usr/bin/env bash
# Tester værtjenesten (web/public/weather): tolking av METAR, og selve endepunktet uten nett.
# Bruk: bash deploy/test_weather.sh <mappe for resultatet>
# Uten PHP på maskinen: podman run --rm -v "$PWD":/w -w /w docker.io/library/php:8.1-cli bash deploy/test_weather.sh /tmp/weather-test
set -Eeuo pipefail
out=${1:?mappe for resultatet}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
root="$here/web/public/weather"
mkdir -p "$out/cache"
fail() { printf 'weather test: %s\n' "$*" >&2; exit 1; }
command -v php >/dev/null || fail 'php mangler'
for f in lib.php index.php; do php -l "$root/$f" >/dev/null || fail "syntaksfeil i $f"; done

php "$here/deploy/test_weather.php" "$root"

export FLY_WEATHER_AREAS="$out/areas.json" FLY_WEATHER_CACHE="$out/cache" FLY_WEATHER_NO_FETCH=1
echo '{"ENCN":{},"ENMH":{}}' > "$FLY_WEATHER_AREAS"
page() { Q=$1 php -r '$_GET = json_decode(getenv("Q"), true); include $argv[1];' "$root/index.php"; }
check() { php -r '$j = json_decode(file_get_contents($argv[1]), true); exit(is_array($j) && eval("return " . $argv[2] . ";") ? 0 : 1);' "$1" "$2"; }

page '{"apt":"ENCN"}' > "$out/empty.json"
check "$out/empty.json" '$j["wind"] === null && $j["metar"] === null && $j["credit"] === "Weather: MET Norway (CC BY 4.0)"' || fail 'tomt lager skal gi ingen vind, og kreditering'

# En fersk melding gir vind; en gammel melding gir ingen
stamp=$(php -r 'echo gmdate("dHi", time() - 600);')
php -r 'file_put_contents($argv[1], json_encode(["updated" => time(), "metar" => "ENMH " . $argv[2] . "Z 33021G33KT 9999 -SN NCD 02/01 Q1005"]));' "$out/cache/ENMH.json" "$stamp"
page '{"apt":"ENMH"}' > "$out/fresh.json"
check "$out/fresh.json" '$j["wind"] === ["dir" => 330, "kt" => 21, "gust" => 33] && strpos($j["metar"], "33021G33KT") !== false' || fail 'fersk melding ga ikke vinden'
old=$(php -r 'echo gmdate("dHi", time() - 3 * 3600);')
php -r 'file_put_contents($argv[1], json_encode(["updated" => time(), "metar" => "ENMH " . $argv[2] . "Z 33021G33KT 9999 Q1005"]));' "$out/cache/ENMH.json" "$old"
page '{"apt":"ENMH"}' > "$out/old.json"
check "$out/old.json" '$j["wind"] === null && $j["metar"] === null' || fail 'en tre timer gammel melding ga vind'

for q in '{}' '{"apt":"ENZZ"}' '{"apt":"../lock"}' '{"apt":["ENCN"]}' '{"apt":"encn<script>"}'; do
  page "$q" > "$out/bad.json" 2>/dev/null || true
  grep -q '"error"' "$out/bad.json" || fail "avviste ikke $q"
done
echo 'weather test: endepunktet ok'
