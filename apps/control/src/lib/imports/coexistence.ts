import type { PoolClient } from "pg";

export const COEXISTENCE_DESTINATION_TYPES = ["ndi", "web_webrtc", "custom_rtmp"] as const;
export type CoexistenceDestinationType = typeof COEXISTENCE_DESTINATION_TYPES[number];

export type CoexistenceBridgeSummary = {
  id: string;
  name: string;
  type: CoexistenceDestinationType;
  enabled: boolean;
  status: string;
  protocol: "NDI" | "WebRTC" | "RTMPS";
  purpose: string;
};

type Row = {
  id: string;
  name: string;
  destination_type: CoexistenceDestinationType;
  enabled: boolean;
  status: string;
  public_config: Record<string, unknown> | null;
};

function protocolFor(type: CoexistenceDestinationType, config: Record<string, unknown> | null) {
  if (type === "ndi") return "NDI" as const;
  if (type === "web_webrtc") return "WebRTC" as const;
  const protocol = typeof config?.protocol === "string" ? config.protocol.toUpperCase() : "";
  return protocol === "RTMP" ? "RTMPS" as const : "RTMPS" as const;
}

function purposeFor(type: CoexistenceDestinationType) {
  if (type === "ndi") return "Keep a standards-based local network Program feed available while your team transitions workflows.";
  if (type === "web_webrtc") return "Run the iPresenterPlux audience experience alongside the existing room-production path during phased adoption.";
  return "Send a standards-based RTMPS egress to a documented downstream endpoint that your existing workflow can receive.";
}

export async function listConfiguredCoexistenceBridges(client: Pick<PoolClient, "query">, organizationId: string) {
  const result = await client.query<Row>(
    `select id::text,name,destination_type,enabled,status,public_config
       from output_destinations
      where organization_id=$1
        and destination_type=any($2::text[])
      order by case destination_type when 'ndi' then 0 when 'web_webrtc' then 1 when 'custom_rtmp' then 2 else 9 end,name,id`,
    [organizationId, [...COEXISTENCE_DESTINATION_TYPES]]
  );
  return result.rows.map((row): CoexistenceBridgeSummary => ({
    id: row.id,
    name: row.name,
    type: row.destination_type,
    enabled: row.enabled,
    status: row.status,
    protocol: protocolFor(row.destination_type, row.public_config),
    purpose: purposeFor(row.destination_type)
  }));
}
