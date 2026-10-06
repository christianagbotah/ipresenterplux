import { isIP } from "node:net";

export const SOCIAL_DESTINATION_TYPES = ["youtube", "facebook", "tiktok", "tiktok_rtmp", "custom_rtmp"] as const;
export type SocialDestinationType = (typeof SOCIAL_DESTINATION_TYPES)[number];

export function isSocialDestinationType(value: string): value is SocialDestinationType {
  return SOCIAL_DESTINATION_TYPES.includes(value as SocialDestinationType);
}

function hostnameIsPrivate(hostname: string) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  const family = isIP(lower);
  if (family === 4) {
    const parts = lower.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
  }
  if (family === 6) {
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") ||
      lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
  }
  return false;
}

export function normalizeRtmpsIngestUrl(raw: string) {
  const url = new URL(raw.trim());
  if (url.protocol !== "rtmps:") throw new Error("destination_ingest_protocol_invalid");
  if (!url.hostname || hostnameIsPrivate(url.hostname)) throw new Error("destination_ingest_host_invalid");
  if (url.username || url.password || url.search || url.hash) throw new Error("destination_ingest_url_must_not_contain_credentials_query_or_fragment");
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath || "/";
  return url.toString().replace(/\/$/, "");
}

export function buildRtmpsTarget(ingestUrl: string, streamKey: string) {
  const base = normalizeRtmpsIngestUrl(ingestUrl);
  const key = streamKey.trim();
  if (!key || /[\r\n\0]/.test(key)) throw new Error("destination_stream_key_invalid");
  return `${base}/${encodeURIComponent(key).replace(/%2F/gi, "/")}`;
}
