import path from 'node:path';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function safeSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!SAFE_SEGMENT.test(normalized) || normalized === '.' || normalized === '..')
    throw new Error(`Invalid ${label} path segment.`);
  return normalized;
}

export function publicPath(publicRoot: string, family: 'releases' | 'manifests' | 'deltas', ...segments: string[]): string {
  const root = path.resolve(publicRoot);
  const result = path.resolve(root, family, ...segments.map((value, index) => safeSegment(value, `segment ${index + 1}`)));
  if (!result.startsWith(root + path.sep)) throw new Error('Public storage path traversal is not allowed.');
  return result;
}

export function releaseArtifactPath(
  publicRoot: string,
  product: string,
  platform: string,
  architecture: string,
  version: string,
  filename: string
): string {
  return publicPath(publicRoot, 'releases', product, platform, architecture, version, filename);
}
