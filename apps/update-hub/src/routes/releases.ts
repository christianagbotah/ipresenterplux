import type pg from 'pg';
import type { ReleaseCandidate } from '../release-model.js';

export interface ReleaseRepository {
  listForProduct(product: string): Promise<ReleaseCandidate[]>;
}

export class PostgresReleaseRepository implements ReleaseRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listForProduct(product: string): Promise<ReleaseCandidate[]> {
    const result = await this.pool.query({
      text: `
        SELECT r.id, p.product_key AS product, r.version, r.channel, r.platform, r.architecture,
               r.state, r.rollout, r.published_at, r.manifest_path, r.signature_path
        FROM releases r
        JOIN products p ON p.id = r.product_id
        WHERE p.product_key = $1 AND r.state IN ('published','paused','withdrawn')
      `,
      values: [product]
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      product: row.product,
      version: row.version,
      channel: row.channel,
      platform: row.platform,
      architecture: row.architecture,
      state: row.state,
      rollout: Number(row.rollout),
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      manifestPath: row.manifest_path,
      signaturePath: row.signature_path
    }));
  }
}
