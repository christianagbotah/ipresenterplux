import type { ServerResponse } from 'node:http';
import type { UpdateHubConfig } from '../config.js';
import { selectRelease, type ReleaseChannel, type UpdateIdentity } from '../release-model.js';
import type { ReleaseRepository } from './releases.js';

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function required(url: URL, key: string): string {
  const value = url.searchParams.get(key)?.trim();
  if (!value) throw new Error(`Missing ${key}.`);
  if (value.length > 200) throw new Error(`${key} is too long.`);
  return value;
}

function publicUrl(config: UpdateHubConfig, relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, '');
  return new URL(normalized, config.publicOrigin).toString();
}

export async function handleUpdateCheck(
  url: URL,
  product: string,
  response: ServerResponse,
  config: UpdateHubConfig,
  repository: ReleaseRepository
): Promise<void> {
  try {
    const channel = required(url, 'channel') as ReleaseChannel;
    if (channel !== 'stable' && channel !== 'beta') throw new Error('Unsupported channel.');
    const identity: UpdateIdentity = {
      product,
      version: required(url, 'version'),
      channel,
      platform: required(url, 'platform'),
      architecture: required(url, 'architecture'),
      installationId: required(url, 'installationId')
    };
    const releases = await repository.listForProduct(product);
    const selected = selectRelease(releases, identity);
    if (!selected) {
      json(response, 200, { status: 'no-update' });
      return;
    }
    if (!selected.manifestPath || !selected.signaturePath) {
      json(response, 503, { error: 'release_incomplete' });
      return;
    }
    json(response, 200, {
      status: 'update',
      version: selected.version,
      manifestUrl: publicUrl(config, selected.manifestPath),
      signatureUrl: publicUrl(config, selected.signaturePath)
    });
  } catch (error) {
    json(response, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid request.' });
  }
}
