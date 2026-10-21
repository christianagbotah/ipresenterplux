#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=${UPDATE_HUB_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)}
ROOT=${UPDATE_HUB_ROOT:-/home/lightworld/update-hub}
APP_ROOT="$ROOT/app"
APP_DIR="$APP_ROOT/apps/update-hub"
APP_USER=${UPDATE_HUB_USER:-lightworld}
APP_GROUP=${UPDATE_HUB_GROUP:-lightworld}
APP_HOME=${UPDATE_HUB_USER_HOME:-/home/lightworld}
PUBLIC_ROOT="$ROOT/public"
BACKUP_DIR=${UPDATE_HUB_BACKUP_DIR:-$ROOT/backups}
SERVICE_UNIT=${UPDATE_HUB_SERVICE_UNIT:-/etc/systemd/system/lightworld-update-hub.service}
NGINX_INCLUDE=${UPDATE_HUB_NGINX_INCLUDE:-}
NGINX_BIN=${UPDATE_HUB_NGINX_BIN:-/usr/local/apps/nginx/sbin/nginx}
PSQL_BIN=${UPDATE_HUB_PSQL_BIN:-psql}
PG_DUMP_BIN=${UPDATE_HUB_PG_DUMP_BIN:-pg_dump}
PNPM_BIN=${UPDATE_HUB_PNPM_BIN:-pnpm}
DRY_RUN=${UPDATE_HUB_DRY_RUN:-0}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}

run_as_app() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'DRY-RUN: runuser -u %q -- env HOME=%q' "$APP_USER" "$APP_HOME"
    printf ' %q' "$@"; printf '\n'
  else
    runuser -u "$APP_USER" -- env HOME="$APP_HOME" "$@"
  fi
}

need_file() {
  [[ -f "$1" ]] || { echo "Required file missing: $1" >&2; exit 1; }
}

need_file "$REPO_ROOT/apps/update-hub/package.json"
need_file "$REPO_ROOT/apps/update-hub/pnpm-lock.yaml"
need_file "$REPO_ROOT/apps/update-hub/db/001_update_hub.sql"
need_file "$REPO_ROOT/deploy/systemd/lightworld-update-hub.service"
need_file "$REPO_ROOT/deploy/nginx/updates.lightworldtech.com.conf"

if [[ "$DRY_RUN" != "1" ]]; then
  [[ -n "${UPDATE_HUB_DATABASE_URL:-}" ]] || { echo "UPDATE_HUB_DATABASE_URL is required for migration." >&2; exit 1; }
  [[ -f "$APP_ROOT/.env" ]] || { echo "$APP_ROOT/.env must exist before deployment." >&2; exit 1; }
  mode=$(stat -c '%a' "$APP_ROOT/.env")
  case "$mode" in 600|640) ;; *) echo "$APP_ROOT/.env must be mode 0600 or 0640; found $mode" >&2; exit 1 ;; esac
fi

# Creates only the controlled app/log/public roots; it never deletes release storage.
UPDATE_HUB_DRY_RUN="$DRY_RUN" "$REPO_ROOT/ops/update-hub/bootstrap-vps.sh"
run install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$BACKUP_DIR"

run install -d -o "$APP_USER" -g "$APP_GROUP" -m 0750 "$APP_DIR"
# Deploy the service source while preserving $APP_ROOT/.env and $PUBLIC_ROOT.
run rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  "$REPO_ROOT/apps/update-hub/" "$APP_DIR/"
run chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY-RUN: runuser -u $APP_USER -- cd $APP_DIR && pnpm install --frozen-lockfile"
  echo "DRY-RUN: runuser -u $APP_USER -- cd $APP_DIR && pnpm build"
else
  run_as_app bash -c 'cd "$1" && exec "$2" install --frozen-lockfile' _ "$APP_DIR" "$PNPM_BIN"
  run_as_app bash -c 'cd "$1" && exec "$2" build' _ "$APP_DIR" "$PNPM_BIN"
fi

# Back up release metadata before any schema migration. The URL is never echoed.
BACKUP_PATH="$BACKUP_DIR/update-hub-$(date -u '+%Y%m%dT%H%M%SZ').dump"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY-RUN: pg_dump --format=custom --file=<timestamped-backup> <UPDATE_HUB_DATABASE_URL>"
else
  "$PG_DUMP_BIN" --format=custom --file="$BACKUP_PATH" "$UPDATE_HUB_DATABASE_URL"
  chown "$APP_USER:$APP_GROUP" "$BACKUP_PATH"
  chmod 0640 "$BACKUP_PATH"
fi

# The migration is additive/idempotent. No release row or public artifact is deleted here.
if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY-RUN: $PSQL_BIN <UPDATE_HUB_DATABASE_URL> -v ON_ERROR_STOP=1 -f $APP_DIR/db/001_update_hub.sql"
else
  "$PSQL_BIN" "$UPDATE_HUB_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/db/001_update_hub.sql"
fi

run install -o root -g root -m 0644 "$REPO_ROOT/deploy/systemd/lightworld-update-hub.service" "$SERVICE_UNIT"
if [[ -n "$NGINX_INCLUDE" ]]; then
  run install -o root -g root -m 0644 "$REPO_ROOT/deploy/nginx/updates.lightworldtech.com.conf" "$NGINX_INCLUDE"
else
  echo "NOTE: UPDATE_HUB_NGINX_INCLUDE is unset; existing Webuzo custom include is left unchanged."
fi

run systemctl daemon-reload
run "$NGINX_BIN" -t
run systemctl enable lightworld-update-hub
run systemctl restart lightworld-update-hub
run systemctl is-active --quiet lightworld-update-hub
if [[ -n "$NGINX_INCLUDE" ]]; then run systemctl reload nginx; fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY-RUN: curl -fsS http://127.0.0.1:3041/health"
else
  for attempt in {1..20}; do
    if curl -fsS --max-time 3 http://127.0.0.1:3041/health >/dev/null; then
      echo "Lightworld Update Hub deployment healthy."
      exit 0
    fi
    sleep 1
  done
  echo "Lightworld Update Hub did not become healthy on 127.0.0.1:3041." >&2
  journalctl -u lightworld-update-hub -n 60 --no-pager >&2 || true
  exit 1
fi
