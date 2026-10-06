import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import { sanitizeCommandError } from "@/lib/edge-commands";
import { publishServiceEvent } from "@/lib/realtime";
import { reconcileStreamCommandResult } from "@/lib/stream-session-authority";

type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({
  success: z.boolean(),
  resultingState: z.string().trim().min(1).max(500),
  error: z.string().max(500).nullable().optional(),
  completedAt: z.string().datetime()
});

export async function POST(request: Request, context: RouteContext) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "Invalid command id" }, { status: 400 });

  try {
    const payload = schema.parse(await request.json());
    const errorCode = sanitizeCommandError(payload.error);
    const targetState = payload.success ? "succeeded" : "failed";
    const client = await db.connect();
    let streamTransition: { sessionId: string; serviceId: string; status: string } | null = null;
    try {
      await client.query("begin");
      const found = await client.query<{
        organization_id: string; edge_device_id: string; command_type: string; state: string;
        resulting_state: string | null; error_code: string | null; service_id: string | null;
      }>(
        `select organization_id::text,edge_device_id::text,command_type,state,resulting_state,error_code,service_id::text
         from edge_control_commands where id=$1 for update`,
        [id]
      );
      const command = found.rows[0];
      if (!command || command.edge_device_id !== device.deviceId || command.organization_id !== device.organizationId) {
        await client.query("rollback");
        return NextResponse.json({ ok: false, error: "Command not found" }, { status: 404 });
      }
      if (["succeeded", "failed"].includes(command.state)) {
        const duplicate = command.state === targetState && command.resulting_state === payload.resultingState && command.error_code === errorCode;
        await client.query("commit");
        return duplicate
          ? NextResponse.json({ ok: true, duplicate: true, commandId: id, state: command.state })
          : NextResponse.json({ ok: false, error: "Command acknowledgement conflicts with the recorded result" }, { status: 409 });
      }
      await client.query(
        `update edge_control_commands
         set state=$2,completed_at=$3::timestamptz,resulting_state=$4,error_code=$5,updated_at=now()
         where id=$1`,
        [id, targetState, payload.completedAt, payload.resultingState, errorCode]
      );
      await client.query(
        `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
         values ($1,'edge_device',$2,'edge.command.completed','edge_command',$3,$4::jsonb)`,
        [device.organizationId, device.deviceId, id, JSON.stringify({ type: command.command_type, success: payload.success, resultingState: payload.resultingState, errorCode })]
      );

      if (command.service_id && (command.command_type === "stream.start" || command.command_type === "stream.stop")) {
        streamTransition = await reconcileStreamCommandResult(client, {
          serviceId: command.service_id,
          commandType: command.command_type,
          success: payload.success,
          errorCode
        });
        if (streamTransition && !payload.success) {
          await client.query(
            `insert into audit_events(organization_id,actor_type,actor_id,action,entity_type,entity_id,details)
             values ($1,'edge_device',$2,'stream.edge_command.failed','stream_session',$3,$4::jsonb)`,
            [
              device.organizationId,
              device.deviceId,
              streamTransition.sessionId,
              JSON.stringify({ commandId: id, type: command.command_type, errorCode })
            ]
          );
        }
      }

      await client.query("commit");
      // Publication is best-effort and must follow the committed result and audit record.
      if (command.service_id) {
        await publishServiceEvent(command.service_id, "edge.command.completed", {
          commandId: id,
          commandType: command.command_type,
          state: targetState,
          resultingState: payload.resultingState,
          errorCode,
          edgeDeviceId: device.deviceId
        });
        if (streamTransition) {
          await publishServiceEvent(command.service_id, "stream.session.changed", {
            streamSessionId: streamTransition.sessionId,
            status: streamTransition.status,
            commandType: command.command_type,
            commandState: targetState,
            errorCode
          });
        }
      }
      return NextResponse.json({ ok: true, duplicate: false, commandId: id, state: targetState });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "Invalid command acknowledgement", issues: error.issues }, { status: 400 });
    console.error("Edge command acknowledgement failed", error);
    return NextResponse.json({ ok: false, error: "Command acknowledgement failed" }, { status: 500 });
  }
}
