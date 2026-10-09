import { pool } from '../../infrastructure/db';
import { RoutingError } from './routing-error';

export type RoutingEndpoint = 'ors-matrix' | 'ors-directions' | 'mapbox-directions';
// Leave headroom below published free allowances. A rolling window is more
// conservative than assuming either provider resets on our calendar boundary.
export const ROUTING_LIMITS = {
  'ors-matrix': { limit: 480, hours: 25, spacingMs: 1800 },
  'ors-directions': { limit: 1900, hours: 25, spacingMs: 1800 },
  'mapbox-directions': { limit: 90000, hours: 32 * 24, spacingMs: 1100 },
} as const;

let ready: Promise<unknown> | undefined;
export function ensureRoutingUsageTables(): Promise<unknown> {
  return ready ??= pool.query(`
    SELECT pg_advisory_xact_lock(hashtext('free-routing-schema'));
    CREATE TABLE IF NOT EXISTS routing_usage_counts (
      endpoint text NOT NULL,
      bucket_start timestamptz NOT NULL,
      requests integer NOT NULL DEFAULT 0,
      PRIMARY KEY (endpoint, bucket_start)
    );
    CREATE TABLE IF NOT EXISTS routing_usage_state (
      endpoint text PRIMARY KEY,
      next_request_at timestamptz NOT NULL DEFAULT NOW(),
      blocked_until timestamptz
    );
  `).catch(error => { ready = undefined; throw error; });
}

export async function reserveRoutingRequest(endpoint: RoutingEndpoint): Promise<number> {
  try {
    await ensureRoutingUsageTables();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`free-routing:${endpoint}`]);
      await client.query(`INSERT INTO routing_usage_state(endpoint) VALUES ($1) ON CONFLICT DO NOTHING`, [endpoint]);
      const { rows: [state] } = await client.query(`
        SELECT next_request_at, blocked_until, NOW() AS now
        FROM routing_usage_state WHERE endpoint = $1 FOR UPDATE`, [endpoint]);
      const now = new Date(state.now).getTime();
      const blocked = state.blocked_until ? new Date(state.blocked_until).getTime() : 0;
      if (blocked > now) throw new RoutingError('ROUTING_PROVIDER_LIMIT',
        'The routing provider is temporarily unavailable or its quota is exhausted. Please retry after the cooldown.',
        429, Math.ceil((blocked - now) / 1000));
      const limits = ROUTING_LIMITS[endpoint];
      const { rows: [usage] } = await client.query(`
        SELECT COALESCE(SUM(requests), 0)::int AS used,
          COALESCE(SUM(requests) FILTER (WHERE bucket_start >= date_trunc('minute', NOW() - interval '62 seconds')), 0)::int AS recent
        FROM routing_usage_counts
        WHERE endpoint = $1 AND bucket_start >= date_trunc('minute', NOW() - ($2 * interval '1 hour'))`,
      [endpoint, limits.hours]);
      if (usage.used >= limits.limit) throw new RoutingError('ROUTING_FREE_LIMIT',
        `${endpoint === 'mapbox-directions' ? 'Mapbox Directions' : 'ORS ' + (endpoint === 'ors-matrix' ? 'Matrix' : 'Directions')} free-routing safety allowance reached. No paid routing was used. Please wait for usage to leave the rolling quota window.`,
        429);
      const waitMs = Math.max(0, new Date(state.next_request_at).getTime() - now);
      if (usage.recent >= 35 || waitMs > 10000) throw new RoutingError('ROUTING_BUSY',
        'Routing is busy. Please wait a moment before trying again; no paid routing was used.', 429, 15);
      await client.query(`
        INSERT INTO routing_usage_counts(endpoint, bucket_start, requests)
        VALUES ($1, date_trunc('minute', NOW() + ($2 * interval '1 millisecond')), 1)
        ON CONFLICT (endpoint, bucket_start) DO UPDATE SET requests = routing_usage_counts.requests + 1`,
      [endpoint, waitMs]);
      await client.query(`UPDATE routing_usage_state
        SET next_request_at = NOW() + ($2 * interval '1 millisecond') WHERE endpoint = $1`,
      [endpoint, waitMs + limits.spacingMs]);
      await client.query(`DELETE FROM routing_usage_counts WHERE endpoint = $1 AND bucket_start < NOW() - interval '40 days'`, [endpoint]);
      await client.query('COMMIT');
      return waitMs;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  } catch (error) {
    if (error instanceof RoutingError) throw error;
    throw new RoutingError('ROUTING_GUARD_UNAVAILABLE',
      'Routing usage protection is unavailable. No routing request was sent; please retry later.');
  }
}

export async function blockRoutingEndpoint(endpoint: RoutingEndpoint, seconds: number): Promise<void> {
  await ensureRoutingUsageTables();
  await pool.query(`UPDATE routing_usage_state
    SET blocked_until = GREATEST(COALESCE(blocked_until, NOW()), NOW() + ($2 * interval '1 second'))
    WHERE endpoint = $1`, [endpoint, Math.min(86400, Math.max(30, seconds))]);
}
