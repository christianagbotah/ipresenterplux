export type UpdateHubConfig = {
  publicOrigin: URL;
  databaseUrl: string;
  publicRoot: string;
  host: string;
  port: number;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): UpdateHubConfig {
  const rawOrigin = env.UPDATE_HUB_PUBLIC_ORIGIN?.trim();
  if (!rawOrigin) throw new Error('UPDATE_HUB_PUBLIC_ORIGIN is required.');
  const publicOrigin = new URL(rawOrigin);
  const isLoopback = publicOrigin.hostname === '127.0.0.1' || publicOrigin.hostname === 'localhost' || publicOrigin.hostname === '::1';
  if (publicOrigin.protocol !== 'https:' && !(publicOrigin.protocol === 'http:' && isLoopback))
    throw new Error('The Update Hub public origin must use HTTPS.');

  const databaseUrl = env.UPDATE_HUB_DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('UPDATE_HUB_DATABASE_URL is required.');
  const publicRoot = env.UPDATE_HUB_PUBLIC_ROOT?.trim();
  if (!publicRoot) throw new Error('UPDATE_HUB_PUBLIC_ROOT is required.');

  const portText = env.UPDATE_HUB_PORT?.trim() || '3041';
  const port = Number.parseInt(portText, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('UPDATE_HUB_PORT must be between 0 and 65535.');

  return {
    publicOrigin,
    databaseUrl,
    publicRoot,
    host: env.UPDATE_HUB_HOST?.trim() || '127.0.0.1',
    port
  };
}
