#!/usr/bin/env bash
# Tester flytjenesten (web/public/traffic): tolking av svar fra adsb.lol, og selve endepunktet uten nett.
# Bruk: bash deploy/test_traffic.sh <mappe for resultatet>
# Uten PHP på maskinen: podman run --rm -v "$PWD":/w -w /w docker.io/library/php:8.1-cli bash deploy/test_traffic.sh /tmp/traffic-test
set -Eeuo pipefail
out=${1:?mappe for resultatet}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
root="$here/web/public/traffic"
mkdir -p "$out/cache"
fail() { printf 'traffic test: %s\n' "$*" >&2; exit 1; }
command -v php >/dev/null || fail 'php mangler'
for f in lib.php index.php; do php -l "$root/$f" >/dev/null || fail "syntaksfeil i $f"; done

php "$here/deploy/test_traffic.php" "$root" "$here/tests/fixtures"

export FLY_TRAFFIC_AREAS="$out/areas.json" FLY_TRAFFIC_CACHE="$out/cache" FLY_TRAFFIC_NO_FETCH=1
php -r '$e = json_decode(file_get_contents($argv[1]), true); file_put_contents($argv[2], json_encode($e["areas"]));' "$here/tests/fixtures/adsb_expected.json" "$FLY_TRAFFIC_AREAS"
page() { Q=$1 php -r '$_GET = json_decode(getenv("Q"), true); include $argv[1];' "$root/index.php"; }

page '{"apt":"ENGM"}' > "$out/empty.json"
php -r '$j = json_decode(file_get_contents($argv[1]), true); exit(is_array($j) && $j["aircraft"] === [] && $j["credit"] === "Aircraft positions: adsb.lol (ODbL)" ? 0 : 1);' "$out/empty.json" || fail 'tomt lager skal gi tom liste og kreditering'

# Et ferskt lager vises; et lager som er eldre enn to minutter gir tom liste (et fly er ikke der lenger)
php -r 'file_put_contents($argv[1], json_encode(["updated" => time() - 10, "aircraft" => [["id" => "abc123"]]]));' "$out/cache/ENGM.json"
page '{"apt":"ENGM"}' | grep -q '"abc123"' || fail 'ferskt lager ble ikke vist'
php -r 'file_put_contents($argv[1], json_encode(["updated" => time() - 500, "aircraft" => [["id" => "abc123"]]]));' "$out/cache/ENGM.json"
! page '{"apt":"ENGM"}' | grep -q '"abc123"' || fail 'gammelt lager ble vist'

for q in '{}' '{"apt":"ENZZ"}' '{"apt":"../lock"}' '{"apt":["ENGM"]}' '{"apt":"engm<script>"}'; do
  page "$q" > "$out/bad.json" 2>/dev/null || true
  grep -q '"error"' "$out/bad.json" || fail "avviste ikke $q"
done
echo 'traffic test: endepunktet ok'
