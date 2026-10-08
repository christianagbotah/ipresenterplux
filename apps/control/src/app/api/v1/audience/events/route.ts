import { createClient } from "redis";
import { z } from "zod";
import { query } from "@/lib/db";
import { serviceEventChannel } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const publicRefreshEvents = new Set([
  "scripture.state.changed",
  "service.state.changed",
  "language.channel.changed",
  "audience.program.changed",
  "transcript.updated",
  "translation.completed",
  "tts.completed",
  "tts.failed"
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const serviceId = url.searchParams.get("serviceId");

  if (!serviceId || !z.string().uuid().safeParse(serviceId).success) {
    return new Response("Invalid serviceId", { status: 400 });
  }

  const service = await query<{ id: string }>(
    "select id from services where id=$1 limit 1",
    [serviceId]
  );
  if (!service.rowCount) {
    return new Response("Service not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const subscriber = createClient({
    url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379"
  });

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    try {
      if (subscriber.isOpen) {
        await subscriber.unsubscribe(serviceEventChannel(serviceId));
        await subscriber.quit();
      }
    } catch {
      subscriber.destroy();
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      subscriber.on("error", () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": transport degraded\n\n"));
        } catch {
          void close();
        }
      });

      await subscriber.connect();
      controller.enqueue(encoder.encode("retry: 3000\n\n"));

      await subscriber.subscribe(serviceEventChannel(serviceId), (message) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(message) as { type?: string };
          if (!parsed.type || !publicRefreshEvents.has(parsed.type)) return;
          controller.enqueue(encoder.encode("event: refresh\ndata: {}\n\n"));
        } catch {
          // Internal payloads are intentionally never forwarded to public clients.
        }
      });

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          void close();
        }
      }, 15_000);
    },
    async cancel() {
      await close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
