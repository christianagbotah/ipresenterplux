const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type GoogleTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
};

function required(name: "IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID" | "IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET" | "IPRESENTERPLUX_PUBLIC_BASE_URL") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("youtube_oauth_not_configured");
  return value;
}

export function youtubeOAuthConfigured() {
  try {
    required("IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID");
    required("IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET");
    youtubeOAuthRedirectUri();
    return true;
  } catch {
    return false;
  }
}

export function youtubeOAuthRedirectUri() {
  const base = new URL(required("IPRESENTERPLUX_PUBLIC_BASE_URL"));
  if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
    throw new Error("youtube_oauth_public_url_invalid");
  }
  base.pathname = "/api/v1/provider/youtube/oauth/callback";
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function streamingStudioUrl(status?: string) {
  const base = new URL(required("IPRESENTERPLUX_PUBLIC_BASE_URL"));
  base.pathname = "/streaming";
  base.search = status ? new URLSearchParams({ provider: status }).toString() : "";
  base.hash = "";
  return base.toString();
}

export function buildYouTubeAuthorizationUrl(state: string) {
  if (!state || state.length > 512) throw new Error("youtube_oauth_state_invalid");
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", required("IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID"));
  url.searchParams.set("redirect_uri", youtubeOAuthRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params: URLSearchParams, fetchImpl: typeof fetch) {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: params,
      cache: "no-store"
    });
  } catch {
    throw new Error("youtube_oauth_token_unavailable");
  }
  if (!response.ok) throw new Error(response.status === 429 ? "youtube_oauth_quota_limited" : "youtube_oauth_token_rejected");
  let payload: GoogleTokenResponse;
  try {
    payload = await response.json() as GoogleTokenResponse;
  } catch {
    throw new Error("youtube_oauth_token_invalid_response");
  }
  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
  const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) ? Math.max(60, Math.floor(payload.expires_in)) : 3600;
  const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean).slice(0, 8) : [];
  if (!accessToken) throw new Error("youtube_oauth_access_token_missing");
  return { accessToken, refreshToken, expiresIn, scopes };
}

export async function exchangeYouTubeAuthorizationCode(code: string, fetchImpl: typeof fetch = fetch) {
  const value = code.trim();
  if (!value || value.length > 4096) throw new Error("youtube_oauth_code_invalid");
  const params = new URLSearchParams({
    code: value,
    client_id: required("IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: required("IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET"),
    redirect_uri: youtubeOAuthRedirectUri(),
    grant_type: "authorization_code"
  });
  return tokenRequest(params, fetchImpl);
}

export async function refreshYouTubeAccessToken(refreshToken: string, fetchImpl: typeof fetch = fetch) {
  const value = refreshToken.trim();
  if (!value || value.length > 8192) throw new Error("youtube_oauth_refresh_token_invalid");
  const params = new URLSearchParams({
    refresh_token: value,
    client_id: required("IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: required("IPRESENTERPLUX_GOOGLE_OAUTH_CLIENT_SECRET"),
    grant_type: "refresh_token"
  });
  return tokenRequest(params, fetchImpl);
}

export const youtubeOAuthScope = YOUTUBE_READONLY_SCOPE;
