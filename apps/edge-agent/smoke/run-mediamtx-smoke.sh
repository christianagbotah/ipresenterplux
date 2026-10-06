#!/usr/bin/env bash
set -euo pipefail

version="1.21.1"
expected_sha256="25e20ed41611f1f3103b8359585210b29b11b69fa0d9e11bd11b92f7bbcb42ef"
archive="$RUNNER_TEMP/mediamtx-$version-darwin-arm64.tar.gz"
extract="$RUNNER_TEMP/mediamtx-$version-darwin-arm64"
url="https://github.com/bluenviron/mediamtx/releases/download/v${version}/mediamtx_v${version}_darwin_arm64.tar.gz"

curl -fsSL "$url" -o "$archive"
printf '%s  %s\n' "$expected_sha256" "$archive" | shasum -a 256 -c -
rm -rf "$extract"
mkdir -p "$extract"
tar -xzf "$archive" -C "$extract"
server="$(find "$extract" -type f -name mediamtx | head -n 1)"
test -n "$server"
chmod +x "$server"
config="$(pwd)/smoke/mediamtx-smoke.yml"
log="$RUNNER_TEMP/mediamtx-smoke-macos.log"
"$server" "$config" >"$log" 2>&1 &
pid=$!

cleanup() {
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "MediaMTX exited before the API became ready." >&2
    cat "$log" >&2 || true
    exit 1
  fi
  if curl -fsS --max-time 1 http://127.0.0.1:9997/v3/info >/dev/null; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" -ne 1 ]; then
  echo "MediaMTX API did not become ready." >&2
  cat "$log" >&2 || true
  exit 1
fi

publish="publish/srt-smoke/macos"
dotnet publish smoke/iPresenterPlux.Edge.SrtSmoke/iPresenterPlux.Edge.SrtSmoke.csproj -c Release -o "$publish"
mkdir -p "$publish/libSrt"
cp -R publish/libsrt-stage/. "$publish/libSrt/"

set +e
dotnet "$publish/iPresenterPlux.Edge.SrtSmoke.dll"
status=$?
set -e
if [ "$status" -ne 0 ]; then
  echo "SRT/MediaMTX smoke failed; MediaMTX log follows:" >&2
  cat "$log" >&2 || true
  exit "$status"
fi

echo "MediaMTX smoke log:"
cat "$log" || true
