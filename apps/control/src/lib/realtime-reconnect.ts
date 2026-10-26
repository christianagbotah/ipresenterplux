export type RealtimeConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000] as const;
const states = new Map<string, RealtimeConnectionState>();
const listeners = new Map<string, Set<() => void>>();

export function reconnectDelayMs(attempt: number) {
  const index = Math.max(0, Math.min(RECONNECT_DELAYS_MS.length - 1, Math.floor(attempt)));
  return RECONNECT_DELAYS_MS[index];
}

export function getRealtimeConnectionState(serviceId: string) {
  return states.get(serviceId) ?? "connecting";
}

export function setRealtimeConnectionState(serviceId: string, state: RealtimeConnectionState) {
  if (states.get(serviceId) === state) return;
  states.set(serviceId, state);
  for (const listener of listeners.get(serviceId) ?? []) listener();
}

export function subscribeRealtimeConnection(serviceId: string, listener: () => void) {
  const scoped = listeners.get(serviceId) ?? new Set<() => void>();
  scoped.add(listener);
  listeners.set(serviceId, scoped);
  return () => {
    scoped.delete(listener);
    if (scoped.size === 0) listeners.delete(serviceId);
  };
}
