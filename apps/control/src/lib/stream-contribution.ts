import { createHash, randomBytes, randomUUID } from "node:crypto";

const SESSION_TTL_MS = 5 * 60 * 1000;
const STREAM_PATH_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;

export type EdgeContributionGrant = {
  sessionId: string;
  streamPath: string;
  protocol: "srt";
  publishUrl: string;
  tokenHash: string;
  routerAuthority: string;
  expiresAt: string;
};

export function hashContributionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createEdgeContributionGrant(
  routerBaseUrl: string,
  now = new Date(),
  authoritativeStreamPath?: string
): EdgeContributionGrant {
  const router = new URL(routerBaseUrl);
  if (router.protocol !== "srt:") throw new Error("stream_router_protocol_invalid");
  if (!router.hostname) throw new Error("stream_router_host_invalid");
  if (router.username || router.password || router.search || router.hash) {
    throw new Error("stream_router_base_must_not_contain_credentials_or_query");
  }

  const sessionId = randomUUID();
  const streamPath = authoritativeStreamPath ?? `edge-${sessionId}`;
  if (!STREAM_PATH_PATTERN.test(streamPath) || streamPath.includes("..") || streamPath.startsWith("/") || streamPath.endsWith("/")) {
    throw new Error("stream_router_path_invalid");
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashContributionToken(token);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  // MediaMTX SRT custom syntax: publish:path:user:password.
  // The path identifies the authoritative broadcast session while the short-lived
  // token is the credential. The raw token is never persisted.
  router.searchParams.set("streamid", `publish:${streamPath}:edge:${token}`);
  router.searchParams.set("pkt_size", "1316");

  return {
    sessionId,
    streamPath,
    protocol: "srt",
    publishUrl: router.toString(),
    tokenHash,
    routerAuthority: router.port ? `${router.hostname}:${router.port}` : router.hostname,
    expiresAt
  };
}
