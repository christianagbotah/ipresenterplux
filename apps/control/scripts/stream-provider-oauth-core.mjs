import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const SECRET_VERSION = "v1";

function decodeKey(raw) {
  if (!raw?.trim()) throw new Error("provider_secret_key_missing");
  const value = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64url");
  if (key.length !== 32) throw new Error("provider_secret_key_invalid_length");
  return key;
}

export function decryptProviderTokenEnvelope(envelope, rawKey) {
  const [version, ivPart, tagPart, cipherPart, extra] = String(envelope ?? "").split(".");
  if (extra || version !== SECRET_VERSION || !ivPart || !tagPart || !cipherPart) throw new Error("provider_secret_envelope_invalid");
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(cipherPart, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) throw new Error("provider_secret_envelope_invalid");
  const decipher = createDecipheriv("aes-256-gcm", decodeKey(rawKey), iv);
  decipher.setAuthTag(tag);
  const parsed = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  if (typeof parsed?.accessToken !== "string" || !parsed.accessToken.trim()) throw new Error("provider_secret_payload_invalid");
  if (typeof parsed?.refreshToken !== "string" || !parsed.refreshToken.trim()) throw new Error("provider_secret_payload_invalid");
  return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
}

export function encryptProviderTokenEnvelope(payload, rawKey) {
  const accessToken = String(payload?.accessToken ?? "").trim();
  const refreshToken = String(payload?.refreshToken ?? "").trim();
  if (!accessToken || accessToken.length > 8192) throw new Error("provider_access_token_invalid");
  if (!refreshToken || refreshToken.length > 8192) throw new Error("provider_refresh_token_invalid");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(rawKey), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ accessToken, refreshToken }), "utf8"), cipher.final()]);
  return [SECRET_VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function failureCode(status) {
  if (status === 400 || status === 401) return "provider_auth_failed";
  if (status === 403) return "provider_api_forbidden";
  if (status === 429) return "provider_quota_limited";
  if (status >= 500) return "provider_api_unavailable";
  return "provider_api_failed";
}

export async function refreshGoogleAccessToken({ refreshToken, clientId, clientSecret, fetchImpl = globalThis.fetch, signal }) {
  const refresh = String(refreshToken ?? "").trim();
  const id = String(clientId ?? "").trim();
  const secret = String(clientSecret ?? "").trim();
  if (!refresh || !id || !secret) return { ok: false, errorCode: "provider_auth_missing" };
  let response;
  try {
    response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ refresh_token: refresh, client_id: id, client_secret: secret, grant_type: "refresh_token" }),
      signal
    });
  } catch (error) {
    return { ok: false, errorCode: error?.name === "AbortError" || error?.name === "TimeoutError" ? "provider_api_timeout" : "provider_api_unavailable" };
  }
  if (!response?.ok) return { ok: false, errorCode: failureCode(Number(response?.status) || 0) };
  try {
    const payload = await response.json();
    const accessToken = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
    const expiresIn = typeof payload?.expires_in === "number" && Number.isFinite(payload.expires_in) ? Math.max(60, Math.floor(payload.expires_in)) : 3600;
    if (!accessToken) return { ok: false, errorCode: "provider_api_invalid_response" };
    return { ok: true, accessToken, expiresIn };
  } catch {
    return { ok: false, errorCode: "provider_api_invalid_response" };
  }
}

export async function findYouTubeStreamIdByKey({ accessToken, streamKey, fetchImpl = globalThis.fetch, signal }) {
  const token = String(accessToken ?? "").trim();
  const key = String(streamKey ?? "").trim();
  if (!token) return { ok: false, errorCode: "provider_auth_missing" };
  if (!key) return { ok: false, errorCode: "provider_stream_key_missing" };
  let pageToken = null;
  for (let page = 0; page < 4; page += 1) {
    const url = new URL("https://www.googleapis.com/youtube/v3/liveStreams");
    url.searchParams.set("part", "id,cdn");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    let response;
    try {
      response = await fetchImpl(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal });
    } catch (error) {
      return { ok: false, errorCode: error?.name === "AbortError" || error?.name === "TimeoutError" ? "provider_api_timeout" : "provider_api_unavailable" };
    }
    if (!response?.ok) return { ok: false, errorCode: failureCode(Number(response?.status) || 0) };
    try {
      const payload = await response.json();
      for (const item of Array.isArray(payload?.items) ? payload.items : []) {
        const streamName = typeof item?.cdn?.ingestionInfo?.streamName === "string" ? item.cdn.ingestionInfo.streamName : "";
        if (streamName && streamName === key && typeof item?.id === "string" && item.id.trim()) return { ok: true, streamId: item.id.trim() };
      }
      pageToken = typeof payload?.nextPageToken === "string" && payload.nextPageToken.trim() ? payload.nextPageToken.trim() : null;
      if (!pageToken) break;
    } catch {
      return { ok: false, errorCode: "provider_api_invalid_response" };
    }
  }
  return { ok: false, errorCode: "provider_stream_not_found" };
}
