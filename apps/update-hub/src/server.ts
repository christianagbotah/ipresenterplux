import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig, type UpdateHubConfig } from './config.js';

export type UpdateHubServerDependencies = {
  config: UpdateHubConfig;
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

export function createUpdateHubServer({ config: _config }: UpdateHubServerDependencies): http.Server {
  return http.createServer((request: IncomingMessage, response: ServerResponse) => {
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
    json(response, 404, { error: 'not_found' });
  });
}

const launchedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (launchedDirectly) {
  const config = loadConfig();
  const server = createUpdateHubServer({ config });
  server.listen(config.port, config.host, () => {
    console.log(`Lightworld Update Hub listening on ${config.host}:${config.port}`);
  });
}
