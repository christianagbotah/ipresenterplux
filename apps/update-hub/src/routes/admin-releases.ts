import type pg from 'pg';

export type AdminReleaseCreateInput = {
  product: string;
  version: string;
  channel: 'stable' | 'beta';
  platform: string;
  architecture: string;
  minimumVersion: string | null;
  releaseNotes: string;
  manifestPath: string;
  signaturePath: string;
  rollout?: number;
};

export type AdminArtifactInput = {
  artifactType: 'full' | 'delta' | 'installer';
  sourceVersion: string | null;
  publicPath: string;
  sizeBytes: number;
  sha256: string;
};

export type AdminReleaseMutation = {
  action: string;
  patch: {
    state?: 'draft' | 'published' | 'paused' | 'withdrawn';
    rollout?: number;
    rollbackReleaseId?: string | null;
    publishedAt?: string | null;
  };
  detail?: Record<string, unknown>;
};

export interface AdminReleaseRepository {
  createRelease(input: AdminReleaseCreateInput, actor: string): Promise<Record<string, unknown>>;
  registerArtifact(releaseId: string, artifact: AdminArtifactInput, actor: string): Promise<void>;
  mutateRelease(releaseId: string, mutation: AdminReleaseMutation, actor: string): Promise<Record<string, unknown>>;
}

function bounded(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string') throw new Error(`${name}_required`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${name}_invalid`);
  return normalized;
}

function safeRelativePath(value: unknown, name: string): string {
  const normalized = bounded(value, name, 500).replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '..'))
    throw new Error(`${name}_invalid`);
  return normalized;
}

function rollout(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100) throw new Error('rollout_invalid');
  return Number(value);
}

function actorName(actor: string): string {
  return bounded(actor, 'actor', 120);
}

export class AdminReleaseService {
  constructor(private readonly repository: AdminReleaseRepository) {}

  create(input: AdminReleaseCreateInput, actor: string): Promise<Record<string, unknown>> {
    const channel = input.channel;
    if (channel !== 'stable' && channel !== 'beta') throw new Error('channel_invalid');
    const normalized: AdminReleaseCreateInput = {
      product: bounded(input.product, 'product', 100).toLowerCase(),
      version: bounded(input.version, 'version', 80),
      channel,
      platform: bounded(input.platform, 'platform', 40).toLowerCase(),
      architecture: bounded(input.architecture, 'architecture', 40).toLowerCase(),
      minimumVersion: input.minimumVersion == null ? null : bounded(input.minimumVersion, 'minimum_version', 80),
      releaseNotes: typeof input.releaseNotes === 'string' ? input.releaseNotes.slice(0, 20000) : '',
      manifestPath: safeRelativePath(input.manifestPath, 'manifest_path'),
      signaturePath: safeRelativePath(input.signaturePath, 'signature_path'),
      rollout: input.rollout == null ? 100 : rollout(input.rollout)
    };
    return this.repository.createRelease(normalized, actorName(actor));
  }

  registerArtifact(releaseId: string, artifact: AdminArtifactInput, actor: string): Promise<void> {
    const artifactType = artifact.artifactType;
    if (!['full', 'delta', 'installer'].includes(artifactType)) throw new Error('artifact_type_invalid');
    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) throw new Error('artifact_size_invalid');
    const sha256 = bounded(artifact.sha256, 'artifact_sha256', 64).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('artifact_sha256_invalid');
    return this.repository.registerArtifact(bounded(releaseId, 'release_id', 40), {
      artifactType,
      sourceVersion: artifact.sourceVersion == null ? null : bounded(artifact.sourceVersion, 'source_version', 80),
      publicPath: safeRelativePath(artifact.publicPath, 'public_path'),
      sizeBytes: artifact.sizeBytes,
      sha256
    }, actorName(actor));
  }

  publish(releaseId: string, percentage: number, actor: string): Promise<Record<string, unknown>> {
    const value = rollout(percentage);
    return this.repository.mutateRelease(bounded(releaseId, 'release_id', 40), {
      action: 'release.published',
      patch: { state: 'published', rollout: value, publishedAt: new Date().toISOString() },
      detail: { rollout: value }
    }, actorName(actor));
  }

  setRollout(releaseId: string, percentage: number, actor: string): Promise<Record<string, unknown>> {
    const value = rollout(percentage);
    return this.repository.mutateRelease(bounded(releaseId, 'release_id', 40), {
      action: 'release.rollout_changed', patch: { rollout: value }, detail: { rollout: value }
    }, actorName(actor));
  }

  pause(releaseId: string, actor: string): Promise<Record<string, unknown>> {
    return this.repository.mutateRelease(bounded(releaseId, 'release_id', 40), {
      action: 'release.paused', patch: { state: 'paused' }
    }, actorName(actor));
  }

  withdraw(releaseId: string, actor: string): Promise<Record<string, unknown>> {
    return this.repository.mutateRelease(bounded(releaseId, 'release_id', 40), {
      action: 'release.withdrawn', patch: { state: 'withdrawn' }
    }, actorName(actor));
  }

  setRollbackTarget(releaseId: string, rollbackReleaseId: string, actor: string): Promise<Record<string, unknown>> {
    const target = bounded(rollbackReleaseId, 'rollback_release_id', 40);
    return this.repository.mutateRelease(bounded(releaseId, 'release_id', 40), {
      action: 'release.rollback_target_changed', patch: { rollbackReleaseId: target }, detail: { rollbackReleaseId: target }
    }, actorName(actor));
  }
}

export class PostgresAdminReleaseRepository implements AdminReleaseRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createRelease(input: AdminReleaseCreateInput, actor: string): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const product = await client.query({
        text: `INSERT INTO products(product_key, display_name) VALUES($1,$2)
               ON CONFLICT(product_key) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id`,
        values: [input.product, input.product]
      });
      const result = await client.query({
        text: `INSERT INTO releases(product_id,version,channel,platform,architecture,state,rollout,minimum_version,release_notes,manifest_path,signature_path)
               VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10)
               RETURNING id,version,channel,platform,architecture,state,rollout,minimum_version AS "minimumVersion",
                         release_notes AS "releaseNotes",manifest_path AS "manifestPath",signature_path AS "signaturePath",
                         rollback_release_id AS "rollbackReleaseId",published_at AS "publishedAt"`,
        values: [product.rows[0].id, input.version, input.channel, input.platform, input.architecture,
          input.rollout ?? 100, input.minimumVersion, input.releaseNotes, input.manifestPath, input.signaturePath]
      });
      const row = { ...result.rows[0], id: String(result.rows[0].id), product: input.product };
      await this.audit(client, row.id, actor, 'release.created', { version: input.version });
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async registerArtifact(releaseId: string, artifact: AdminArtifactInput, actor: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query({
        text: `INSERT INTO release_artifacts(release_id,artifact_type,source_version,public_path,size_bytes,sha256)
               VALUES($1,$2,$3,$4,$5,$6)`,
        values: [releaseId, artifact.artifactType, artifact.sourceVersion, artifact.publicPath, artifact.sizeBytes, artifact.sha256]
      });
      await this.audit(client, releaseId, actor, 'artifact.registered', { artifactType: artifact.artifactType, publicPath: artifact.publicPath });
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') throw new Error('artifact_path_conflict');
      throw error;
    } finally {
      client.release();
    }
  }

  async mutateRelease(releaseId: string, mutation: AdminReleaseMutation, actor: string): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const assignments: string[] = [];
      const values: unknown[] = [];
      const add = (column: string, value: unknown) => {
        values.push(value);
        assignments.push(`${column}=$${values.length}`);
      };
      if (mutation.patch.state !== undefined) add('state', mutation.patch.state);
      if (mutation.patch.rollout !== undefined) add('rollout', mutation.patch.rollout);
      if (mutation.patch.rollbackReleaseId !== undefined) add('rollback_release_id', mutation.patch.rollbackReleaseId);
      if (mutation.patch.publishedAt !== undefined) add('published_at', mutation.patch.publishedAt);
      if (!assignments.length) throw new Error('empty_release_mutation');
      values.push(releaseId);
      const result = await client.query({
        text: `UPDATE releases SET ${assignments.join(',')} WHERE id=$${values.length}
               RETURNING id,version,channel,platform,architecture,state,rollout,minimum_version AS "minimumVersion",
                         release_notes AS "releaseNotes",manifest_path AS "manifestPath",signature_path AS "signaturePath",
                         rollback_release_id AS "rollbackReleaseId",published_at AS "publishedAt"`,
        values
      });
      if (!result.rowCount) throw new Error('release_not_found');
      const row = { ...result.rows[0], id: String(result.rows[0].id) };
      await this.audit(client, releaseId, actor, mutation.action, mutation.detail ?? {});
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async audit(client: pg.PoolClient, releaseId: string, actor: string, action: string, detail: Record<string, unknown>): Promise<void> {
    await client.query({
      text: `INSERT INTO release_events(release_id,actor,action,detail) VALUES($1,$2,$3,$4::jsonb)`,
      values: [releaseId, actor, action, JSON.stringify(detail)]
    });
  }
}
