import { createHash, randomBytes, randomUUID } from "node:crypto";

const SESSION_TTL_MS = 5 * 60 * 1000;

export type EdgeContributionGrant = {
  sessionId: string;
  protocol: "srt";
  publishUrl: string;
  tokenHash: string;
  routerAuthority: string;
  expiresAt: string;
};

export function createEdgeContributionGrant(routerBaseUrl: string, now = new Date()): EdgeContributionGrant {
  const router = new URL(routerBaseUrl);
  if (router.protocol !== "srt:") throw new Error("stream_router_protocol_invalid");
  if (!router.hostname) throw new Error("stream_router_host_invalid");
  if (router.username || router.password || router.search || router.hash) {
    throw new Error("stream_router_base_must_not_contain_credentials_or_query");
  }

  const sessionId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  router.searchParams.set("streamid", `publish:${sessionId}:${token}`);

  return {
    sessionId,
    protocol: "srt",
    publishUrl: router.toString(),
    tokenHash,
    routerAuthority: router.port ? `${router.hostname}:${router.port}` : router.hostname,
    expiresAt
  };
}
