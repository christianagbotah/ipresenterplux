#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "This VPS deployment self-test must run as root so it can exercise the lightworld privilege drop." >&2
  exit 1
fi

SOURCE_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ipresenterplux-deploy.sh"
BASE="$(mktemp -d /tmp/ipresenterplux-deploy-selftest.XXXXXX)"
REMOTE="$BASE/remote.git"
SEED="$BASE/seed"
APP="$BASE/app"
STATE="$BASE/state"
TMPBASE="$BASE/tmp"
FAKEBIN="$BASE/fakebin"
LOCK="$BASE/deploy.lock"
SYSTEMCTL_LOG="$BASE/systemctl.log"
APP_USER="lightworld"
APP_GROUP="lightworld"
APP_HOME="/home/lightworld"

cleanup() {
  rm -rf "$BASE"
}
trap cleanup EXIT

mkdir -p "$SEED" "$STATE" "$TMPBASE" "$FAKEBIN"
chown -R "$APP_USER:$APP_GROUP" "$BASE"

as_app() {
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" "$@"
}

as_app git init --bare "$REMOTE" >/dev/null
as_app git -C "$SEED" init -b main >/dev/null
as_app git -C "$SEED" config user.name "iPresenterPlux Deploy Test"
as_app git -C "$SEED" config user.email "deploy-test@localhost"
as_app mkdir -p "$SEED/apps/control"
as_app bash -c "printf '%s\n' '.env.local' 'node_modules/' '.next/' > '$SEED/.gitignore'"
as_app bash -c "printf '%s\n' '{\"name\":\"control\",\"private\":true}' > '$SEED/apps/control/package.json'"
as_app bash -c "printf '%s\n' 'v1' > '$SEED/version.txt'"
as_app git -C "$SEED" add .
as_app git -C "$SEED" commit -m "v1" >/dev/null
as_app git -C "$SEED" remote add origin "$REMOTE"
as_app git -C "$SEED" push -u origin main >/dev/null
as_app git clone "$REMOTE" "$APP" >/dev/null
as_app git -C "$APP" checkout main >/dev/null
as_app bash -c "printf '%s\n' 'DATABASE_URL=postgres://example.invalid/test' > '$APP/apps/control/.env.local'"
as_app mkdir -p "$APP/apps/control/node_modules" "$APP/apps/control/.next"
as_app bash -c "printf '%s\n' 'old-build' > '$APP/apps/control/.next/build-marker'"

cat > "$FAKEBIN/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *" install "* || "$*" == *" install" ]]; then
  mkdir -p apps/control/node_modules
  printf '%s\n' "candidate-modules" > apps/control/node_modules/test-marker
fi
if [[ "$*" == *" build"* ]]; then
  mkdir -p apps/control/.next
  printf '%s\n' "candidate-build" > apps/control/.next/build-marker
fi
if [[ "$*" == *"db:migrate"* ]]; then
  printf '%s\n' '{"ok":true,"applied":[]}'
fi
EOF

cat > "$FAKEBIN/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_SYSTEMCTL_LOG:?}"
exit 0
EOF

cat > "$FAKEBIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while (($#)); do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -w|--max-time)
      shift 2
      ;;
    -sS|-fsS|-f|-s|-S)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
if [[ -z "$out" ]]; then
  out=/dev/null
fi
if [[ "$url" == https://* && "${FAKE_PUBLIC_FAIL:-0}" == "1" ]]; then
  printf '%s\n' '{"ok":false,"product":"iPresenterPlux"}' > "$out"
  printf '503'
else
  printf '%s\n' '{"ok":true,"product":"iPresenterPlux"}' > "$out"
  printf '200'
fi
EOF

cat > "$FAKEBIN/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "$FAKEBIN/mv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${FAKE_SWAP_FAIL:-0}" == "1" && "${2:-}" == "${FAKE_APP:?}/apps/control/.next" && "${1:-}" != "${FAKE_APP}/apps/control/.next" ]]; then
  exit 42
fi
exec /usr/bin/mv "$@"
EOF

chmod +x "$FAKEBIN"/*
chown -R "$APP_USER:$APP_GROUP" "$FAKEBIN"

push_release() {
  local version="$1"
  as_app bash -c "printf '%s\n' '$version' > '$SEED/version.txt'"
  as_app git -C "$SEED" add version.txt
  as_app git -C "$SEED" commit -m "$version" >/dev/null
  as_app git -C "$SEED" push origin main >/dev/null
}

run_deployer() {
  env \
    PATH="$FAKEBIN:$PATH" \
    FAKE_SYSTEMCTL_LOG="$SYSTEMCTL_LOG" \
    FAKE_PUBLIC_FAIL="${FAKE_PUBLIC_FAIL:-0}" \
    FAKE_SWAP_FAIL="${FAKE_SWAP_FAIL:-0}" \
    FAKE_APP="$APP" \
    IPRESENTERPLUX_DEPLOY_ALLOW_TEST_PATH=1 \
    IPRESENTERPLUX_DEPLOY_APP="$APP" \
    IPRESENTERPLUX_DEPLOY_USER="$APP_USER" \
    IPRESENTERPLUX_DEPLOY_GROUP="$APP_GROUP" \
    IPRESENTERPLUX_DEPLOY_HOME="$APP_HOME" \
    IPRESENTERPLUX_DEPLOY_STATE="$STATE" \
    IPRESENTERPLUX_DEPLOY_TMP="$TMPBASE" \
    IPRESENTERPLUX_DEPLOY_LOCK="$LOCK" \
    IPRESENTERPLUX_DEPLOY_SERVICE="ipresenterplux-test.service" \
    IPRESENTERPLUX_DEPLOY_ENV_FILE="$APP/apps/control/.env.local" \
    "$SOURCE_SCRIPT"
}

push_release v2
run_deployer
expected_v2="$(as_app git -C "$SEED" rev-parse HEAD)"
actual_v2="$(as_app git -C "$APP" rev-parse HEAD)"
[[ "$actual_v2" == "$expected_v2" ]]
[[ "$(cat "$APP/version.txt")" == "v2" ]]
[[ "$(cat "$STATE/last_successful_sha")" == "$expected_v2" ]]
grep -q '^candidate-build$' "$APP/apps/control/.next/build-marker"
grep -q '^candidate-modules$' "$APP/apps/control/node_modules/test-marker"

push_release v3
expected_v3="$(as_app git -C "$SEED" rev-parse HEAD)"
set +e
FAKE_PUBLIC_FAIL=1 run_deployer
rollback_rc=$?
set -e
[[ "$rollback_rc" -ne 0 ]]
actual_after_rollback="$(as_app git -C "$APP" rev-parse HEAD)"
[[ "$actual_after_rollback" == "$expected_v2" ]]
[[ "$(cat "$APP/version.txt")" == "v2" ]]
[[ "$(cat "$STATE/last_failed_candidate_sha")" == "$expected_v3" ]]
grep -q '^candidate-build$' "$APP/apps/control/.next/build-marker"
grep -q 'stop ipresenterplux-test.service' "$SYSTEMCTL_LOG"
grep -q 'restart ipresenterplux-test.service' "$SYSTEMCTL_LOG"

push_release v4
expected_v4="$(as_app git -C "$SEED" rev-parse HEAD)"
set +e
FAKE_SWAP_FAIL=1 run_deployer
swap_rc=$?
set -e
[[ "$swap_rc" -ne 0 ]]
actual_after_swap_failure="$(as_app git -C "$APP" rev-parse HEAD)"
[[ "$actual_after_swap_failure" == "$expected_v2" ]]
[[ "$(cat "$APP/version.txt")" == "v2" ]]
[[ "$(cat "$STATE/last_failed_candidate_sha")" == "$expected_v4" ]]
grep -q '^candidate-build$' "$APP/apps/control/.next/build-marker"

echo "VPS pull-deployer self-test passed (fast-forward success + public-health rollback + swap-failure rollback)."
