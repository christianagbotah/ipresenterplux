#!/usr/bin/env bash
set -euo pipefail

ROOT=${UPDATE_HUB_ROOT:-/home/lightworld/update-hub}
LEGACY_DIST=${UPDATE_HUB_LEGACY_DIST:-/home/lightworld/dist}
NGINX_GROUP=${UPDATE_HUB_NGINX_GROUP:-nobody}
DRY_RUN=${UPDATE_HUB_DRY_RUN:-0}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'; else "$@"; fi
}

run install -d -o lightworld -g lightworld -m 0750 "$ROOT"
run install -d -o lightworld -g lightworld -m 0750 "$ROOT/app" "$ROOT/logs"
run install -d -o lightworld -g "$NGINX_GROUP" -m 0750 "$ROOT/public"
for dir in releases manifests deltas; do
  run install -d -o lightworld -g "$NGINX_GROUP" -m 0750 "$ROOT/public/$dir"
done

# Webuzo's ACME location still traverses the legacy vhost root. Execute-only on
# the parent permits traversal without making directory listings/content public.
if [[ -d "$LEGACY_DIST" ]]; then run chmod o+x "$LEGACY_DIST"; fi
if [[ -d "$LEGACY_DIST/updates" ]]; then
  run chgrp "$NGINX_GROUP" "$LEGACY_DIST/updates"
  run chmod 0750 "$LEGACY_DIST/updates"
fi
