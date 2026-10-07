#!/usr/bin/env bash
set -euo pipefail

EXPECTED_APP="/home/lightworld/webapps/ipresenterplux"
APP="${IPRESENTERPLUX_DEPLOY_APP:-$EXPECTED_APP}"
APP_USER="${IPRESENTERPLUX_DEPLOY_USER:-lightworld}"
APP_GROUP="${IPRESENTERPLUX_DEPLOY_GROUP:-lightworld}"
APP_HOME="${IPRESENTERPLUX_DEPLOY_HOME:-/home/lightworld}"
STATE="${IPRESENTERPLUX_DEPLOY_STATE:-/home/lightworld/deployments/ipresenterplux}"
TMPBASE="${IPRESENTERPLUX_DEPLOY_TMP:-/home/lightworld/tmp}"
LOCK="${IPRESENTERPLUX_DEPLOY_LOCK:-/home/lightworld/.ipresenterplux-deploy.lock}"
SERVICE="${IPRESENTERPLUX_DEPLOY_SERVICE:-ipresenterplux.service}"
LOCAL_HEALTH_URL="${IPRESENTERPLUX_LOCAL_HEALTH_URL:-http://127.0.0.1:3011/api/v1/health}"
PUBLIC_HEALTH_URL="${IPRESENTERPLUX_PUBLIC_HEALTH_URL:-https://ipresenterplux.lightworldtech.com/api/v1/health}"
ENV_FILE="${IPRESENTERPLUX_DEPLOY_ENV_FILE:-$APP/apps/control/.env.local}"

if [[ "$APP" != "$EXPECTED_APP" && "${IPRESENTERPLUX_DEPLOY_ALLOW_TEST_PATH:-0}" != "1" ]]; then
  echo "ABORT: refusing deployment target outside $EXPECTED_APP" >&2
  exit 1
fi

mkdir -p "$STATE" "$TMPBASE"
touch "$STATE/deploy.log"
chown root:"$APP_GROUP" "$STATE" "$STATE/deploy.log" 2>/dev/null || true
chmod 0750 "$STATE" 2>/dev/null || true
chmod 0640 "$STATE/deploy.log" 2>/dev/null || true

exec 9>"$LOCK"
flock -n 9 || exit 0

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" | tee -a "$STATE/deploy.log"
}

run_as_app() {
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" "$@"
}

run_as_app_in() {
  local dir="$1"
  shift
  (
    cd "$dir"
    runuser -u "$APP_USER" -- env HOME="$APP_HOME" "$@"
  )
}

record_value() {
  local path="$1"
  local value="$2"
  printf '%s\n' "$value" > "$path"
  chown root:"$APP_GROUP" "$path" 2>/dev/null || true
  chmod 0640 "$path" 2>/dev/null || true
}

health_probe() {
  local url="$1"
  local output="$2"
  local attempts="${3:-10}"
  local delay="${4:-2}"
  local code=""
  local tmp_output="${output}.tmp"

  rm -f "$tmp_output"
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    code="$(curl -sS -o "$tmp_output" -w '%{http_code}' --max-time 12 "$url" || true)"
    if [[ "$code" == "200" ]] \
      && grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$tmp_output" \
      && grep -Eq '"product"[[:space:]]*:[[:space:]]*"iPresenterPlux"' "$tmp_output"; then
      mv -f "$tmp_output" "$output"
      return 0
    fi
    sleep "$delay"
  done

  [[ -f "$tmp_output" ]] && mv -f "$tmp_output" "$output"
  log "HEALTH: $url did not become healthy (last HTTP ${code:-none})"
  return 1
}

if [[ ! -d "$APP/.git" ]]; then
  log "ABORT: deployment target is not the approved Git repository"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  log "ABORT: required runtime environment file is missing"
  exit 1
fi

if [[ -n "$(run_as_app_in "$APP" git status --porcelain --untracked-files=normal)" ]]; then
  log "ABORT: tracked working tree changes exist or untracked files are present"
  exit 1
fi

run_as_app_in "$APP" git fetch --prune origin main
current="$(run_as_app_in "$APP" git rev-parse HEAD)"
target="$(run_as_app_in "$APP" git rev-parse origin/main)"

if [[ "$current" == "$target" ]]; then
  log "NOOP: already at ${target:0:7}"
  exit 0
fi

if ! run_as_app_in "$APP" git merge-base --is-ancestor "$current" "$target"; then
  log "ABORT: origin/main is not a fast-forward of deployed ${current:0:7}"
  exit 1
fi

candidate="$(mktemp -d "$TMPBASE/ipresenterplux-release.XXXXXX")"
chown "$APP_USER:$APP_GROUP" "$candidate"
chmod 0750 "$candidate"
previous_next="$candidate/.rollback-next"
previous_modules="$candidate/.rollback-node-modules"
cleanup() {
  rm -rf "$candidate"
}
trap cleanup EXIT

run_as_app_in "$APP" git archive "$target" | tar -x -C "$candidate"
chown -R "$APP_USER:$APP_GROUP" "$candidate"
ln -s "$ENV_FILE" "$candidate/apps/control/.env.local"
chown -h "$APP_USER:$APP_GROUP" "$candidate/apps/control/.env.local" 2>/dev/null || true

run_as_app_in "$APP" git diff --name-status "$current" "$target" > "$STATE/last_manifest.txt"
record_value "$STATE/previous_sha" "$current"
record_value "$STATE/candidate_sha" "$target"

log "VALIDATE: ${current:0:7} -> ${target:0:7}"

run_as_app_in "$candidate" pnpm --dir apps/control install --frozen-lockfile
run_as_app_in "$candidate" pnpm --dir apps/control build

if [[ ! -d "$candidate/apps/control/.next" || ! -d "$candidate/apps/control/node_modules" ]]; then
  log "ABORT: candidate Control Plane build artifacts are incomplete"
  exit 1
fi

# Migrations run only after the candidate has built successfully. The existing
# production service stays online until migration and release preparation pass.
run_as_app_in "$candidate" pnpm --dir apps/control db:migrate > "$STATE/last_migration.json"
chown root:"$APP_GROUP" "$STATE/last_migration.json" 2>/dev/null || true
chmod 0640 "$STATE/last_migration.json" 2>/dev/null || true

rollback() {
  local reason="$1"
  trap - ERR
  set +e
  log "ROLLBACK: $reason"
  systemctl stop "$SERVICE"
  run_as_app_in "$APP" git reset --hard "$current" >/dev/null

  rm -rf "$APP/apps/control/.next" "$APP/apps/control/node_modules"
  if [[ -d "$previous_next" ]]; then
    mv "$previous_next" "$APP/apps/control/.next"
  fi
  if [[ -d "$previous_modules" ]]; then
    mv "$previous_modules" "$APP/apps/control/node_modules"
  fi

  if [[ ! -d "$APP/apps/control/node_modules" ]]; then
    run_as_app_in "$APP" pnpm --dir apps/control install --frozen-lockfile
  fi
  if [[ ! -d "$APP/apps/control/.next" ]]; then
    run_as_app_in "$APP" pnpm --dir apps/control build
  fi

  systemctl restart "$SERVICE"
  if health_probe "$LOCAL_HEALTH_URL" "$STATE/rollback_health.json" 10 2; then
    log "ROLLBACK: restored ${current:0:7} and local health is green"
  else
    log "ROLLBACK FAILED: ${current:0:7} did not recover local health"
  fi
  record_value "$STATE/last_failed_candidate_sha" "$target"
  exit 1
}

trap 'rc=$?; rollback "unexpected deploy step failed at line $LINENO (exit $rc)"' ERR

log "DEPLOY: stopping only $SERVICE for atomic code/build swap"
systemctl stop "$SERVICE"

if ! run_as_app_in "$APP" git merge --ff-only "$target" >/dev/null; then
  rollback "fast-forward failed after candidate validation"
fi

if [[ -d "$APP/apps/control/.next" ]]; then
  mv "$APP/apps/control/.next" "$previous_next"
fi
if [[ -d "$APP/apps/control/node_modules" ]]; then
  mv "$APP/apps/control/node_modules" "$previous_modules"
fi

mv "$candidate/apps/control/.next" "$APP/apps/control/.next"
mv "$candidate/apps/control/node_modules" "$APP/apps/control/node_modules"
chown -R "$APP_USER:$APP_GROUP" "$APP/apps/control/.next" "$APP/apps/control/node_modules"

if ! systemctl restart "$SERVICE"; then
  rollback "service restart failed"
fi

if ! health_probe "$LOCAL_HEALTH_URL" "$STATE/last_local_health.json" 12 2; then
  rollback "local health check failed"
fi

if ! health_probe "$PUBLIC_HEALTH_URL" "$STATE/last_public_health.json" 8 3; then
  rollback "public health check failed"
fi

trap - ERR
record_value "$STATE/last_successful_sha" "$target"
record_value "$STATE/last_successful_at" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
log "SUCCESS: deployed ${target:0:7}; local and public health are green"
