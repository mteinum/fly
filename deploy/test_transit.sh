#!/usr/bin/env bash
# Tester kollektivtjenesten (web/public/transit): tolking av svar fra Entur, og selve endepunktet uten nett.
# Bruk: bash deploy/test_transit.sh <mappe for resultatet>
# Uten PHP på maskinen: podman run --rm -v "$PWD":/w -w /w docker.io/library/php:8.1-cli bash deploy/test_transit.sh /tmp/transit-test
set -Eeuo pipefail
out=${1:?mappe for resultatet}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
root="$here/web/public/transit"
mkdir -p "$out/cache"
fail() { printf 'transit test: %s\n' "$*" >&2; exit 1; }
command -v php >/dev/null || fail 'php mangler'
for f in lib.php index.php; do php -l "$root/$f" >/dev/null || fail "syntaksfeil i $f"; done

php "$here/deploy/test_transit.php" "$root" "$here/tests/fixtures"

export FLY_TRANSIT_AREAS="$out/areas.json" FLY_TRANSIT_CACHE="$out/cache" FLY_TRANSIT_NO_FETCH=1
php -r '$e = json_decode(file_get_contents($argv[1]), true); file_put_contents($argv[2], json_encode(["ENCN" => $e["area"]]));' "$here/tests/fixtures/entur_sample.json" "$FLY_TRANSIT_AREAS"
page() { Q=$1 php -r '$_GET = json_decode(getenv("Q"), true); include $argv[1];' "$root/index.php"; }

page '{"apt":"ENCN"}' > "$out/empty.json"
php -r '$j = json_decode(file_get_contents($argv[1]), true); exit(is_array($j) && $j["vehicles"] === [] && $j["credit"] === "Buses and trains: Entur (NLOD)" ? 0 : 1);' "$out/empty.json" || fail 'tomt lager ga ikke tom liste med kreditering'

# Et ferskt lager vises; et lager som er eldre enn to minutter gir tom liste
php -r 'file_put_contents($argv[1], json_encode(["updated" => time() - 10, "vehicles" => [["id" => "AKT:1"]]]));' "$out/cache/ENCN.json"
page '{"apt":"ENCN"}' | grep -q '"AKT:1"' || fail 'ferskt lager ble ikke vist'
php -r 'file_put_contents($argv[1], json_encode(["updated" => time() - 500, "vehicles" => [["id" => "AKT:1"]]]));' "$out/cache/ENCN.json"
! page '{"apt":"ENCN"}' | grep -q '"AKT:1"' || fail 'gammelt lager ble vist'

for q in '{}' '{"apt":"ENZZ"}' '{"apt":"../lock"}' '{"apt":["ENCN"]}' '{"apt":"encn<script>"}'; do
  page "$q" > "$out/bad.json" 2>/dev/null || true
  grep -q '"error"' "$out/bad.json" || fail "avviste ikke $q"
done
echo 'transit test: endepunktet ok'
