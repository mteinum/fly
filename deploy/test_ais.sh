#!/usr/bin/env bash
# Tester skipstjenesten (web/public/ais): tolking av AIS og UTM-formelen, og selve endepunktet.
# Bruk: bash deploy/test_ais.sh <mappe for resultatet>
# Uten PHP på maskinen: podman run --rm -v "$PWD":/w -w /w docker.io/library/php:8.1-cli bash deploy/test_ais.sh ais-test
set -Eeuo pipefail
out=${1:?mappe for resultatet}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
root="$here/web/public/ais"
mkdir -p "$out/cache"
fail() { printf 'ais test: %s\n' "$*" >&2; exit 1; }
command -v php >/dev/null || fail 'php mangler'
for f in lib.php index.php; do php -l "$root/$f" >/dev/null || fail "syntaksfeil i $f"; done

php "$here/deploy/test_ais.php" "$root" "$here/tests/fixtures"

# Endepunktet, uten å lytte på nettet: utsnittene skrives av pipeline og finnes ikke i et rent repo
export FLY_AIS_AREAS="$out/areas.json" FLY_AIS_CACHE="$out/cache" FLY_AIS_NO_LISTEN=1
php -r '$e = json_decode(file_get_contents($argv[1]), true); file_put_contents($argv[2], json_encode($e["areas"]));' "$here/tests/fixtures/ais_expected.json" "$FLY_AIS_AREAS"
page() { Q=$1 php -r '$_GET = json_decode(getenv("Q"), true); include $argv[1];' "$root/index.php"; }

page '{"apt":"ENCN"}' > "$out/empty.json"
php -r '$j = json_decode(file_get_contents($argv[1]), true); exit(is_array($j) && $j["ships"] === [] && $j["updated"] === 0 && $j["credit"] === "AIS data: Kystverket (NLOD)" ? 0 : 1);' "$out/empty.json" || fail 'tomt lager skal gi tom liste og kreditering'

# Alt annet enn en kjent flyplass avvises, uansett hva som står i adressen
for q in '{}' '{"apt":"ENGM"}' '{"apt":"../../etc/passwd"}' '{"apt":["ENCN"]}' '{"apt":"encn<script>"}'; do
  page "$q" > "$out/bad.json" 2>/dev/null || true
  grep -q '"error"' "$out/bad.json" || fail "avviste ikke $q"
  ! grep -q -i 'script\|passwd' "$out/bad.json" || fail "ekko av inndata for $q"
done
echo 'ais test: endepunktet ok'
