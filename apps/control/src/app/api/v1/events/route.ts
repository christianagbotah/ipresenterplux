import { createClient } from "redis";
import { z } from "zod";
import { serviceEventChannel } from "@/lib/realtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const serviceId = url.searchParams.get("serviceId");

  if (!serviceId || !z.string().uuid().safeParse(serviceId).success) {
    return new Response("Invalid serviceId", { status: 400 });
  }

  const encoder = new TextEncoder();
  const subscriber = createClient({
    url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379"
  });

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const closeSubscriber = async () => {
    if (closed) return;
    closed = true;

    if (heartbeat) clearInterval(heartbeat);

    try {
      if (subscriber.isOpen) {
        await subscriber.unsubscribe(serviceEventChannel(serviceId));
        await subscriber.quit();
      }
    } catch {
      try {
        subscriber.destroy();
      } catch {
        // Connection is already gone.
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      subscriber.on("error", () => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode("event: transport\ndata: {\"status\":\"degraded\"}\n\n")
          );
        } catch {
          void closeSubscriber();
        }
      });

      try {
        await subscriber.connect();
        controller.enqueue(encoder.encode("retry: 3000\n\n"));

        await subscriber.subscribe(serviceEventChannel(serviceId), (message) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode("event: update\ndata: " + message + "\n\n"));
          } catch {
            void closeSubscriber();
          }
        });

        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            void closeSubscriber();
          }
        }, 15_000);
      } catch {
        try {
          controller.enqueue(
            encoder.encode("event: transport\ndata: {\"status\":\"unavailable\"}\n\n")
          );
        } finally {
          controller.close();
          await closeSubscriber();
        }
      }

      request.signal.addEventListener("abort", () => {
        void closeSubscriber();
        try {
          controller.close();
        } catch {
          // Stream is already closed.
        }
      });
    },
    async cancel() {
      await closeSubscriber();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
