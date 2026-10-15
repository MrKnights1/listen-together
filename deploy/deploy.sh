#!/usr/bin/env bash
#
# Deploys origin/main to https://music.example.com:
#
#   ssh root@<server IP> 'bash -s' < deploy/deploy.sh
#
# Backup, fast-forward-only pull, install, build, publish the pages, restart,
# smoke check. Touches no rows.
#
set -euo pipefail

APP=/root/musicplayer
WEB=/var/www/music.example.com
SITE=music.example.com
BUN=/root/.bun/bin/bun
cd "$APP"

for tool in git curl rsync; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed" >&2; exit 1; }
done

# Read from the .env the service runs with, so the checks hit the port Bun listens on.
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }
PORT=$(env_value PORT)
DATABASE=$(env_value DATABASE_PATH)
if [ -z "$PORT" ] || [ -z "$DATABASE" ]; then
  echo "PORT and DATABASE_PATH must be set in $APP/.env" >&2
  exit 1
fi

row_counts() {
  "$BUN" -e '
const { Database } = require("bun:sqlite");
const db = new Database(process.argv[1], { readonly: true });
for (const table of ["users", "sessions", "tracks", "activity"]) {
  console.log(" ", table, "=", db.query(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}' "$DATABASE"
}

# VACUUM INTO rather than a copy: in WAL mode the main file alone can miss
# everything still in the -wal. This writes one consistent snapshot.
if [ -f "$DATABASE" ]; then
  mkdir -p data/backups
  BACKUP="data/backups/musicplayer.predeploy-$(date +%Y%m%d-%H%M%S).db"
  "$BUN" -e '
const { Database } = require("bun:sqlite");
new Database(process.argv[1], { readonly: true }).exec(`VACUUM INTO ${JSON.stringify(process.argv[2])}`);
' "$DATABASE" "$BACKUP"
  echo "backup written: $BACKUP ($(stat -c%s "$BACKUP") bytes)"
  echo "=== row counts before ==="
  row_counts
else
  echo "no database yet: this is the first deploy"
fi

echo "=== before ==="
git log --oneline -1

echo "=== pulling ==="
# --ff-only so a diverged tree fails loudly instead of opening a merge.
git pull --ff-only origin main --quiet
git log --oneline -1

echo "=== installing and building ==="
# --production: the tools for writing the code are not needed to run it.
# --ignore-scripts: `prepare` installs git hooks, which the server has no use for.
"$BUN" install --frozen-lockfile --production --ignore-scripts
"$BUN" scripts/buildClient.ts >/dev/null

echo "=== publishing the pages ==="
# The trailing slashes copy the folder's contents; --delete drops older builds' assets.
rsync -a --delete dist/public/ "$WEB/"

echo "=== restarting ==="
systemctl restart musicplayer.service
for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  sleep 0.25
done
systemctl is-active musicplayer.service

echo "=== smoke check, through nginx ==="
# Status codes only, and every failure counted rather than exiting on the
# first: under set -e a check that finds nothing would end the script after a
# deploy that worked, which reads like a failure.
failed=0
check() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$SITE:443:127.0.0.1" "https://$SITE$1" || true)
  printf '  %-44s %s\n' "$1" "$code"
  [ "$code" = 200 ] || failed=1
}
check /
check /login
check /api/health
for asset in $(grep -oh '/assets/[^"]*' "$WEB/room.html" "$WEB/login.html" | sort -u); do
  check "$asset"
done

# Housekeeping runs at start: expired sessions, unused old tracks and month-old feed lines go.
echo "=== row counts after ==="
row_counts

if [ "$failed" -ne 0 ]; then
  echo "SMOKE CHECK FAILED: the site is not answering as it should" >&2
  exit 1
fi
echo "deployed: $(git log --oneline -1)"
