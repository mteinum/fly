#!/usr/bin/env bash
# Publiserer det ferdig bygde spillet (web/dist) til fly.teinum.no med SSH og rsync.
# Bygget på deploy-cpanel.sh fra morten.teinum.no. Kjøres av GitHub Actions med CPANEL_*
# fra repository variables/secrets; bruker aldri et cPanel API-token.
set -Eeuo pipefail
fail() { printf 'Deployment error: %s\n' "$*" >&2; exit 1; }
mode=${1:---dry-run}
[[ $# -le 2 && ( "$mode" == --dry-run || "$mode" == --deploy ) ]] || fail 'Usage: deploy-cpanel.sh [--dry-run|--deploy] [static-directory]'
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
site_dir=${2:-$script_dir/../web/dist}
for name in CPANEL_HOST CPANEL_USERNAME CPANEL_DEPLOY_PATH CPANEL_SSH_KEY CPANEL_SSH_KNOWN_HOSTS; do
  [[ -n "${!name:-}" ]] || fail "Set $name in GitHub Actions secrets/variables."
done
host=$CPANEL_HOST
user=$CPANEL_USERNAME
port=${CPANEL_PORT:-22}
destination=$CPANEL_DEPLOY_PATH
[[ "$host" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'CPANEL_HOST must be a plain hostname.'
[[ "$user" =~ ^[A-Za-z0-9_][A-Za-z0-9_-]*$ ]] || fail 'CPANEL_USERNAME must be an SSH account username.'
[[ "$port" =~ ^[0-9]{1,5}$ ]] || fail 'Invalid SSH port.'
port=$((10#$port))
((port >= 1 && port <= 65535 && port != 2083)) || fail 'Use the SSH port (usually 22), not cPanel HTTPS port 2083.'
while [[ "$destination" == */ ]]; do destination=${destination%/}; done
[[ "$destination" =~ ^/([A-Za-z0-9_-][A-Za-z0-9._-]*/)+fly\.teinum\.no$ ]] || fail 'Use the verified absolute document root ending in /fly.teinum.no.'
for command in ssh ssh-agent ssh-add ssh-keygen rsync find; do
  command -v "$command" >/dev/null || fail "Install $command before deploying."
done

# Det som skal ut må være et komplett bygg, og ikke inneholde annet enn det.
[[ -d "$site_dir" ]] || fail "Build the game first: $site_dir does not exist."
for required in index.html .htaccess data/kjevik10/metadata.json data/kjevik10/heightmap.f32 data/kjevik10/colormap.png data/kjevik10/surface.bin audio/manifest.json; do
  [[ -s "$site_dir/$required" ]] || fail "Missing $required in the build. Run the pipeline (flypipe build kjevik10) and npm run build."
done
unexpected=$(find "$site_dir" \( -name '.*' ! -name '.htaccess' ! -path "$site_dir" \) -o -name '*.map' -o -name '*.env' -o -name '*.tif' | head -5)
[[ -z "$unexpected" ]] || fail "Unexpected files in the build: $unexpected"

umask 077
ssh_dir=$(mktemp -d "${TMPDIR:-/tmp}/fly-deploy.XXXXXXXX")
agent_started=false
pending_remote_file=''
cleanup() {
  if [[ -n "$pending_remote_file" ]]; then
    ssh -n -F "$ssh_dir/config" fly-deploy "rm -f -- '$pending_remote_file'" >/dev/null 2>&1 || true
  fi
  if [[ "$agent_started" == true ]]; then ssh-agent -k >/dev/null 2>&1 || true; fi
  rm -rf -- "$ssh_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' "$CPANEL_SSH_KEY" | tr -d '\r' > "$ssh_dir/id"
printf '%s\n' "$CPANEL_SSH_KNOWN_HOSTS" | tr -d '\r' > "$ssh_dir/known_hosts"
lookup=$host
if ((port != 22)); then lookup="[$host]:$port"; fi
ssh-keygen -F "$lookup" -f "$ssh_dir/known_hosts" >/dev/null || fail 'No verified host key entry for the configured SSH host and port.'
cat > "$ssh_dir/askpass" <<'ASKPASS'
#!/usr/bin/env bash
# ssh-add otherwise retries a wrong passphrase indefinitely with forced askpass.
marker="${0%/*}/asked"
[[ ! -e "$marker" ]] || exit 1
: > "$marker"
printf '%s\n' "${CPANEL_PASSWORD:-}"
ASKPASS
chmod 700 "$ssh_dir/askpass"
agent_settings=$(ssh-agent -a "$ssh_dir/agent.sock" -s) || fail 'Unable to start the isolated SSH agent.'
eval "$agent_settings" >/dev/null
agent_started=true
export CPANEL_PASSWORD=${CPANEL_PASSWORD:-}
SSH_ASKPASS="$ssh_dir/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=fly:0 \
  ssh-add "$ssh_dir/id" </dev/null >/dev/null 2>&1 || fail 'Unable to load the SSH key. Check key format and passphrase.'
ssh-add -L > "$ssh_dir/id.pub"
unset CPANEL_SSH_KEY CPANEL_PASSWORD
cat > "$ssh_dir/config" <<CONFIG
Host fly-deploy
  HostName $host
  User $user
  Port $port
  IdentityFile "$ssh_dir/id"
  UserKnownHostsFile "$ssh_dir/known_hosts"
  GlobalKnownHostsFile /dev/null
  StrictHostKeyChecking yes
  IdentitiesOnly yes
  BatchMode yes
  ConnectTimeout 20
  ServerAliveInterval 15
  ServerAliveCountMax 4
CONFIG
export FLY_CI_SSH_CONFIG="$ssh_dir/config"
cat > "$ssh_dir/transport" <<'TRANSPORT'
#!/usr/bin/env bash
exec ssh -F "$FLY_CI_SSH_CONFIG" "$@"
TRANSPORT
chmod 700 "$ssh_dir/transport"

# Domenet må være opprettet i cPanel på forhånd. Lag aldri en dokumentrot herfra.
resolved=$(ssh -n -F "$ssh_dir/config" fly-deploy \
  "# FLY_VERIFY_ROOT
   command -v rsync >/dev/null && test -d '$destination' && test ! -L '$destination' && test -w '$destination' &&
   (cd -- '$destination' && pwd -P)") || fail 'The dedicated document root must exist, be writable and support rsync.'
[[ "$resolved" == "$destination" ]] || fail 'The canonical document root differs from the configured destination.'
options=(-rz --delay-updates --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r --no-perms --no-owner --no-group --itemize-changes --rsh="$ssh_dir/transport")
if [[ "$mode" == --dry-run ]]; then
  rsync "${options[@]}" --dry-run -- "$site_dir/" "fly-deploy:$destination/"
  printf 'Dry run complete; no files published.\n'
  exit 0
fi

# Sletter ingenting på webhotellet. Fliser, lyd og skript først; index.html byttes til slutt,
# så en besøkende aldri får en side som peker på filer som ikke er lastet opp ennå.
rsync "${options[@]}" --exclude='*.html' -- "$site_dir/" "fly-deploy:$destination/"
pending_remote_file="$destination/.index.html-$(basename "$ssh_dir")"
rsync "${options[@]}" -- "$site_dir/index.html" "fly-deploy:$pending_remote_file"
ssh -n -F "$ssh_dir/config" fly-deploy "mv -f -- '$pending_remote_file' '$destination/index.html'"
pending_remote_file=''
printf 'Published game to https://fly.teinum.no/\n'
