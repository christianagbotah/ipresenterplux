import { createHash } from 'node:crypto';

export type ReleaseState = 'draft' | 'published' | 'paused' | 'withdrawn';
export type ReleaseChannel = 'stable' | 'beta';

export type ReleaseCandidate = {
  id: number | string;
  product: string;
  version: string;
  channel: ReleaseChannel;
  platform: string;
  architecture: string;
  state: ReleaseState;
  rollout: number;
  publishedAt: string | null;
  manifestPath?: string | null;
  signaturePath?: string | null;
};

export type UpdateIdentity = {
  product: string;
  version: string;
  channel: ReleaseChannel;
  platform: string;
  architecture: string;
  installationId: string;
};

type Semver = { major: number; minor: number; patch: number; prerelease: string[] | null };

function parseSemver(value: string): Semver {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : null
  };
}

export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av) ? Number(av) : null;
    const bn = /^\d+$/.test(bv) ? Number(bv) : null;
    if (an !== null && bn !== null) return an < bn ? -1 : 1;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    return av < bv ? -1 : 1;
  }
  return 0;
}

export function rolloutBucket(installationId: string, releaseId: string): number {
  const digest = createHash('sha256').update(installationId).update('\0').update(releaseId).digest();
  return digest.readUInt32BE(0) % 100;
}

export function selectRelease(releases: readonly ReleaseCandidate[], identity: UpdateIdentity): ReleaseCandidate | null {
  parseSemver(identity.version);
  const eligible = releases.filter((release) => {
    if (release.product !== identity.product) return false;
    if (release.channel !== identity.channel) return false;
    if (release.platform !== identity.platform || release.architecture !== identity.architecture) return false;
    if (release.state !== 'published') return false;
    if (compareSemver(release.version, identity.version) <= 0) return false;
    if (release.rollout <= 0) return false;
    if (release.rollout < 100 && rolloutBucket(identity.installationId, String(release.id)) >= release.rollout) return false;
    return true;
  });
  eligible.sort((a, b) => compareSemver(b.version, a.version));
  return eligible[0] ?? null;
}
