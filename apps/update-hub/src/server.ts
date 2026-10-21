import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig, type UpdateHubConfig } from './config.js';
import { createPool } from './db.js';
import { handleUpdateCheck } from './routes/check-update.js';
import { PostgresReleaseRepository, type ReleaseRepository } from './routes/releases.js';

export type UpdateHubServerDependencies = {
  config: UpdateHubConfig;
  releaseRepository?: ReleaseRepository;
};

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store'
  });
  response.end(payload);
}

export function createUpdateHubServer({ config, releaseRepository }: UpdateHubServerDependencies): http.Server {
  return http.createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') {
      json(response, 200, { ok: true, service: 'lightworld-update-hub' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Lightworld Update Hub\n');
      return;
    }
    const match = /^\/api\/v1\/products\/([A-Za-z0-9._-]+)\/updates\/check$/.exec(url.pathname);
    if (request.method === 'GET' && match) {
      if (!releaseRepository) {
        json(response, 503, { error: 'service_unavailable' });
        return;
      }
      await handleUpdateCheck(url, match[1], response, config, releaseRepository);
      return;
    }
    json(response, 404, { error: 'not_found' });
  });
}

const launchedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (launchedDirectly) {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const server = createUpdateHubServer({ config, releaseRepository: new PostgresReleaseRepository(pool) });
  server.listen(config.port, config.host, () => {
    console.log(`Lightworld Update Hub listening on ${config.host}:${config.port}`);
  });
}
