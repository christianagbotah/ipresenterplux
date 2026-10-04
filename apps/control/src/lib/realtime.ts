import { createClient } from "redis";

type EventPayload = Record<string, unknown>;

const globalForRealtime = globalThis as unknown as {
  ipresenterRedisPublisher?: ReturnType<typeof createClient>;
};

function publisher() {
  if (!globalForRealtime.ipresenterRedisPublisher) {
    globalForRealtime.ipresenterRedisPublisher = createClient({
      url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379"
    });

    globalForRealtime.ipresenterRedisPublisher.on("error", (error) => {
      console.error("iPresenterPlux realtime publisher error", error);
    });
  }

  return globalForRealtime.ipresenterRedisPublisher;
}

export function serviceEventChannel(serviceId: string) {
  return "ipresenterplux:service:" + serviceId;
}

export async function publishServiceEvent(
  serviceId: string,
  type: string,
  payload: EventPayload = {}
) {
  try {
    const client = publisher();
    if (!client.isOpen) {
      await client.connect();
    }

    await client.publish(
      serviceEventChannel(serviceId),
      JSON.stringify({
        type,
        serviceId,
        payload,
        emittedAt: new Date().toISOString()
      })
    );

    return true;
  } catch (error) {
    console.error("iPresenterPlux realtime publish skipped", error);
    return false;
  }
}
