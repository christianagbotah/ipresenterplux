#!/usr/bin/env node

const [state, streamPath] = process.argv.slice(2);
const ready = state === "ready" ? "1" : state === "not-ready" ? "0" : null;
const pathPattern = /^service\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!ready || !streamPath || !pathPattern.test(streamPath)) {
  console.error("MediaMTX state callback rejected invalid arguments");
  process.exit(2);
}

const token = process.env.IPRESENTERPLUX_MEDIA_CALLBACK_TOKEN?.trim();
if (!token) {
  console.error("MediaMTX state callback token is not configured");
  process.exit(3);
}

const baseUrl = (process.env.IPRESENTERPLUX_CONTROL_INTERNAL_URL ?? "http://127.0.0.1:3011").replace(/\/$/, "");
const url = `${baseUrl}/api/v1/stream/router/state?path=${encodeURIComponent(streamPath)}&ready=${ready}`;

try {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(3_000)
  });

  if (!response.ok) {
    console.error(`MediaMTX state callback failed with HTTP ${response.status}`);
    process.exit(4);
  }
} catch (error) {
  console.error(`MediaMTX state callback failed: ${error instanceof Error ? error.name : "unknown"}`);
  process.exit(5);
}
