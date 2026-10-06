import type { PoolClient } from "pg";
import type { EdgeCommandType } from "@/lib/edge-commands";

type ServiceEdgeCommand = {
  organizationId: string;
  serviceId: string;
  edgeDeviceId?: string;
  type: EdgeCommandType;
  arguments?: Record<string, string>;
  issuedBy: string;
  source: string;
  ttlSeconds?: number;
};

export async function enqueueServiceEdgeCommand(client: PoolClient, command: ServiceEdgeCommand) {
  const ttlSeconds = Math.max(10, Math.min(command.ttlSeconds ?? 60, 300));
  const inserted = await client.query<{ id: string; edge_device_id: string }>(
    `insert into edge_control_commands
      (organization_id,edge_device_id,service_id,command_type,arguments,issued_by,expires_at)
     select d.organization_id,d.id,$2,$3,$4::jsonb,$5,clock_timestamp()+($6::text || ' seconds')::interval
     from edge_devices d
     where d.organization_id=$1
       and d.active_service_id=$2
       and d.status='active'
       and ($7::uuid is null or d.id=$7::uuid)
     returning id::text,edge_device_id::text`,
    [
      command.organizationId,
      command.serviceId,
      command.type,
      JSON.stringify(command.arguments ?? {}),
      command.issuedBy,
      ttlSeconds,
      command.edgeDeviceId ?? null
    ]
  );

  const ids = inserted.rows.map((row) => row.id);
  if (ids.length) {
    await client.query(
      `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
       select c.organization_id,'operator',$2,'edge.command.issued','edge_command',c.id::text,
              jsonb_build_object('deviceId',c.edge_device_id,'serviceId',c.service_id,'type',c.command_type,'source',$3::text)
       from edge_control_commands c
       where c.id=any($1::uuid[])`,
      [ids, command.issuedBy, command.source]
    );
  }

  return inserted.rowCount ?? 0;
}
