export type PublicAudienceVideoStatus = "offline" | "connecting" | "live";

type StreamSessionSnapshot = {
  status: string;
  router_ready_at: string | null;
};

export function derivePublicAudienceVideoState(session: StreamSessionSnapshot | null): PublicAudienceVideoStatus {
  if (!session || session.status === "stopping") return "offline";
  if (session.status === "live" && session.router_ready_at) return "live";
  if (session.status === "starting" || session.status === "live") return "connecting";
  return "offline";
}
