import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { adminActor, requireAdminToken, verifyAdminBearer } from './admin-auth.js';
import { loadConfig, type UpdateHubConfig } from './config.js';
import { createPool } from './db.js';
import {
  AdminReleaseService,
  PostgresAdminReleaseRepository,
  type AdminArtifactInput,
  type AdminReleaseCreateInput,
  type AdminReleaseRepository
} from './routes/admin-releases.js';
import { handleUpdateCheck } from './routes/check-update.js';
import { PostgresReleaseRepository, type ReleaseRepository } from './routes/releases.js';

export type UpdateHubServerDependencies = {
  config: UpdateHubConfig;
  releaseRepository?: ReleaseRepository;
  adminRepository?: AdminReleaseRepository;
  adminToken?: string;
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

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    total += chunk.length;
    if (total > maxBytes) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('invalid_json');
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body_invalid');
  return value as Record<string, unknown>;
}

function adminError(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : 'internal_error';
  if (message === 'release_not_found') return json(response, 404, { error: 'release_not_found' });
  if (message === 'artifact_path_conflict') return json(response, 409, { error: 'artifact_path_conflict' });
  if (message === 'request_too_large') return json(response, 413, { error: 'request_too_large' });
  if (message === 'invalid_json' || message === 'body_invalid' ||
      message.endsWith('_invalid') || message.endsWith('_required'))
    return json(response, 400, { error: message });
  json(response, 500, { error: 'internal_error' });
}

async function handleAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  repository: AdminReleaseRepository,
  token: string
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/admin/')) return false;
  const authorization = firstHeader(request.headers.authorization);
  if (!verifyAdminBearer(authorization, token)) {
    json(response, 401, { error: 'unauthorized' });
    return true;
  }

  const actor = adminActor(request.headers['x-update-hub-actor']);
  const service = new AdminReleaseService(repository);
  try {
    if (request.method === 'POST' && url.pathname === '/api/v1/admin/releases') {
      const body = objectBody(await readJsonBody(request));
      const created = await service.create(body as unknown as AdminReleaseCreateInput, actor);
      json(response, 201, created);
      return true;
    }

    const artifacts = /^\/api\/v1\/admin\/releases\/([0-9]+)\/artifacts$/.exec(url.pathname);
    if (request.method === 'POST' && artifacts) {
      const body = objectBody(await readJsonBody(request));
      await service.registerArtifact(artifacts[1], body as unknown as AdminArtifactInput, actor);
      json(response, 201, { ok: true });
      return true;
    }

    const publish = /^\/api\/v1\/admin\/releases\/([0-9]+)\/publish$/.exec(url.pathname);
    if (request.method === 'POST' && publish) {
      const body = objectBody(await readJsonBody(request));
      json(response, 200, await service.publish(publish[1], Number(body.rollout ?? 100), actor));
      return true;
    }

    const rollout = /^\/api\/v1\/admin\/releases\/([0-9]+)\/rollout$/.exec(url.pathname);
    if (request.method === 'POST' && rollout) {
      const body = objectBody(await readJsonBody(request));
      json(response, 200, await service.setRollout(rollout[1], Number(body.rollout), actor));
      return true;
    }

    const pause = /^\/api\/v1\/admin\/releases\/([0-9]+)\/pause$/.exec(url.pathname);
    if (request.method === 'POST' && pause) {
      json(response, 200, await service.pause(pause[1], actor));
      return true;
    }

    const withdraw = /^\/api\/v1\/admin\/releases\/([0-9]+)\/withdraw$/.exec(url.pathname);
    if (request.method === 'POST' && withdraw) {
      json(response, 200, await service.withdraw(withdraw[1], actor));
      return true;
    }

    const rollbackTarget = /^\/api\/v1\/admin\/releases\/([0-9]+)\/rollback-target$/.exec(url.pathname);
    if (request.method === 'POST' && rollbackTarget) {
      const body = objectBody(await readJsonBody(request));
      json(response, 200, await service.setRollbackTarget(
        rollbackTarget[1],
        String(body.rollbackReleaseId ?? ''),
        actor
      ));
      return true;
    }

    json(response, 404, { error: 'not_found' });
    return true;
  } catch (error) {
    adminError(response, error);
    return true;
  }
}

export function createUpdateHubServer({
  config,
  releaseRepository,
  adminRepository,
  adminToken
}: UpdateHubServerDependencies): http.Server {
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

    if (url.pathname.startsWith('/api/v1/admin/')) {
      if (!adminRepository || !adminToken) {
        json(response, 503, { error: 'admin_unavailable' });
        return;
      }
      await handleAdminRequest(request, response, url, adminRepository, adminToken);
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
  const server = createUpdateHubServer({
    config,
    releaseRepository: new PostgresReleaseRepository(pool),
    adminRepository: new PostgresAdminReleaseRepository(pool),
    adminToken: requireAdminToken()
  });
  server.listen(config.port, config.host, () => {
    console.log(`Lightworld Update Hub listening on ${config.host}:${config.port}`);
  });
}
