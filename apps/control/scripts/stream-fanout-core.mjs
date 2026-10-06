import { createDecipheriv } from "node:crypto";
import { isIP } from "node:net";

const SECRET_VERSION = "v1";
const SOCIAL_TYPES = new Set(["youtube", "facebook", "tiktok", "tiktok_rtmp", "custom_rtmp"]);

function decodeKey(raw) {
  if (!raw?.trim()) throw new Error("destination_secret_key_missing");
  const value = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64url");
  if (key.length !== 32) throw new Error("destination_secret_key_invalid_length");
  return key;
}

export function decryptSecretEnvelope(envelope, rawKey) {
  const [version, ivPart, tagPart, cipherPart, extra] = String(envelope ?? "").split(".");
  if (extra || version !== SECRET_VERSION || !ivPart || !tagPart || !cipherPart) throw new Error("destination_secret_envelope_invalid");
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(cipherPart, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) throw new Error("destination_secret_envelope_invalid");
  const decipher = createDecipheriv("aes-256-gcm", decodeKey(rawKey), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext);
  if (typeof parsed?.streamKey !== "string" || !parsed.streamKey.trim()) throw new Error("destination_secret_payload_invalid");
  return { streamKey: parsed.streamKey };
}

function hostnameIsPrivate(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  const family = isIP(lower);
  if (family === 4) {
    const parts = lower.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
  }
  if (family === 6) {
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower);
  }
  return false;
}

export function normalizeRtmpsIngestUrl(raw) {
  const url = new URL(String(raw ?? "").trim());
  if (url.protocol !== "rtmps:") throw new Error("destination_ingest_protocol_invalid");
  if (!url.hostname || hostnameIsPrivate(url.hostname)) throw new Error("destination_ingest_host_invalid");
  if (url.username || url.password || url.search || url.hash) throw new Error("destination_ingest_url_must_not_contain_credentials_query_or_fragment");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export function buildRtmpsTarget(ingestUrl, streamKey) {
  const base = normalizeRtmpsIngestUrl(ingestUrl);
  const key = String(streamKey ?? "").trim();
  if (!key || /[\r\n\0]/.test(key)) throw new Error("destination_stream_key_invalid");
  return `${base}/${encodeURIComponent(key).replace(/%2F/gi, "/")}`;
}

export function buildRtspSource(routerPath, baseUrl = "rtsp://127.0.0.1:8554") {
  if (!/^service\/[0-9a-f-]{36}$/i.test(String(routerPath ?? ""))) throw new Error("fanout_router_path_invalid");
  return `${baseUrl.replace(/\/$/, "")}/${routerPath}`;
}

export function buildFfmpegArgs(sourceUrl, targetUrl) {
  return [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-loglevel", "warning",
    "-stats_period", "2",
    "-progress", "pipe:1",
    "-rtsp_transport", "tcp",
    "-i", sourceUrl,
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c", "copy",
    "-flvflags", "no_duration_filesize",
    "-f", "flv",
    targetUrl
  ];
}

export function destinationTypeIsFanout(type) {
  return SOCIAL_TYPES.has(type);
}

export function redactSensitiveText(text, secrets = []) {
  let safe = String(text ?? "");
  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join("[REDACTED]");
  }
  safe = safe.replace(/rtmps:\/\/[^\s]+/gi, "rtmps://[REDACTED]");
  return safe;
}
