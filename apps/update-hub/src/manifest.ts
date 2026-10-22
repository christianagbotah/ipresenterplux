export type FullPackageManifest = {
  url: string;
  size: number;
  sha256: string;
};

export type DeltaPackageManifest = FullPackageManifest & {
  fromVersion: string;
};

export type ReleaseManifestV1 = {
  schemaVersion: 1;
  product: string;
  version: string;
  channel: 'stable' | 'beta';
  platform: string;
  architecture: string;
  minimumVersion: string | null;
  publishedAt: string;
  releaseNotes: string;
  fullPackage: FullPackageManifest;
  deltaPackages: DeltaPackageManifest[];
  rollout: number;
};

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Manifest numbers must be finite.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`;
  }
  throw new Error(`Unsupported manifest value type: ${typeof value}`);
}

export function canonicalManifestBytes(manifest: ReleaseManifestV1): Buffer {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported manifest schema version.');
  if (!Number.isInteger(manifest.rollout) || manifest.rollout < 0 || manifest.rollout > 100)
    throw new Error('Manifest rollout must be between 0 and 100.');
  return Buffer.from(canonicalize(manifest), 'utf8');
}
