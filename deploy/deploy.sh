#!/usr/bin/env bash
#
# Deploys origin/main to the site at APP_URL. musicplayer-deploy.service
# runs it, reading this file from origin/main rather than the working tree.
# GitHub's Deploy workflow starts that unit on every push to main; by hand:
#
#   ssh root@<server> systemctl start musicplayer-deploy
#
# Not by streaming this file over ssh any more: only the unit keeps two deploys
# from running at once.
#
# Backup, fast-forward-only pull, then the release: install, build, publish the
# pages, restart, smoke check. A release that fails at any step goes back to the
# commit that was running before, releases that again, and exits 1 either way.
# Touches no rows.
#
set -euo pipefail

APP=/root/musicplayer
BUN=/root/.bun/bin/bun
cd "$APP"

for tool in git curl rsync; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed" >&2; exit 1; }
done

# Read from the .env the service runs with, so the checks hit the port Bun listens on
# and the domain stays out of the repository: the site is APP_URL's host.
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }
PORT=$(env_value PORT)
DATABASE=$(env_value DATABASE_PATH)
SITE=$(env_value APP_URL | sed -E 's#^https://##')
if [ -z "$PORT" ] || [ -z "$DATABASE" ]; then
  echo "PORT and DATABASE_PATH must be set in $APP/.env" >&2
  exit 1
fi
case "$SITE" in
  "" | */* | *:*)
    echo "APP_URL in $APP/.env must be https://<domain>, with no port or path" >&2
    exit 1
    ;;
esac
WEB=/var/www/$SITE

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
BEFORE=$(git rev-parse HEAD)
git log --oneline -1

echo "=== pulling ==="
# --ff-only so a diverged tree fails loudly instead of opening a merge.
git pull --ff-only origin main --quiet
git log --oneline -1

# Every step returns on failure by hand: bash switches set -e off inside a
# function called as a condition, as release and smoke are below.
release() {
  echo "=== installing and building ==="
  # --production: the tools for writing the code are not needed to run it.
  # --ignore-scripts: `prepare` installs git hooks, which the server has no use for.
  "$BUN" install --frozen-lockfile --production --ignore-scripts || return 1
  "$BUN" scripts/buildClient.ts >/dev/null || return 1

  echo "=== publishing the pages ==="
  # The trailing slashes copy the folder's contents; --delete drops older builds' assets.
  rsync -a --delete dist/public/ "$WEB/" || return 1

  echo "=== restarting ==="
  systemctl restart musicplayer.service || return 1
  for _ in $(seq 1 40); do
    curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break
    sleep 0.25
  done
  systemctl is-active musicplayer.service || return 1
}

# Status codes only, and every path checked rather than stopping at the first
# failure, so the log shows all that is wrong at once.
failed=0
check() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$SITE:443:127.0.0.1" "https://$SITE$1" || true)
  printf '  %-44s %s\n' "$1" "$code"
  [ "$code" = 200 ] || failed=1
}

smoke() {
  echo "=== smoke check, through nginx ==="
  failed=0
  check /
  check /login
  check /admin
  check /api/health
  local asset
  for asset in $(grep -oh '/assets/[^"]*' "$WEB/room.html" "$WEB/login.html" "$WEB/admin.html" | sort -u); do
    check "$asset"
  done
  [ "$failed" -eq 0 ]
}

if release && smoke; then
  # Housekeeping runs at start: expired sessions, unused old tracks and month-old feed lines go.
  echo "=== row counts after ==="
  row_counts
  echo "deployed: $(git log --oneline -1)"
  exit 0
fi

# The database stays as the failed release left it: the migrator skips
# migrations it has no file for, so the older code runs on a schema that only
# gained things. The backup above is there for anything worse.
echo "DEPLOY FAILED at $(git log --oneline -1); rolling back to $(git log --oneline -1 "$BEFORE")" >&2
git reset --hard --quiet "$BEFORE"
if release && smoke; then
  echo "rolled back: running $(git log --oneline -1)" >&2
else
  echo "ROLLBACK FAILED: the site may be down" >&2
fi
exit 1
