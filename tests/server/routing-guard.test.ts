// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  used: 0, recent: 0, wait: 0, blocked: 0, databaseFailed: false,
  queries: [] as string[],
}));
vi.mock('../../server/infrastructure/db', () => ({
  pool: {
    query: vi.fn(async () => {
      if (mock.databaseFailed) throw new Error('database unavailable');
      return { rows: [] };
    }),
    connect: vi.fn(async () => ({
      release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        mock.queries.push(sql);
        if (mock.databaseFailed) throw new Error('database unavailable');
        if (sql.includes('SELECT next_request_at')) return { rows: [{
          now: new Date(), next_request_at: new Date(Date.now() + mock.wait),
          blocked_until: new Date(Date.now() + mock.blocked),
        }] };
        if (sql.includes('AS used')) return { rows: [{ used: mock.used, recent: mock.recent }] };
        if (sql.includes('INSERT INTO routing_usage_counts')) mock.used++;
        return { rows: [] };
      }),
    })),
  },
}));
import { reserveRoutingRequest, ROUTING_LIMITS } from '../../server/features/travel/routing-usage';

describe('persistent free-routing quota guard', () => {
  beforeEach(() => Object.assign(mock, { used: 0, recent: 0, wait: 0, blocked: 0, databaseFailed: false, queries: [] }));
  it.each(Object.entries(ROUTING_LIMITS))('stops %s at its safety ceiling before a request is reserved', async (endpoint, limits) => {
    mock.used = limits.limit;
    await expect(reserveRoutingRequest(endpoint as keyof typeof ROUTING_LIMITS)).rejects.toMatchObject({ code: 'ROUTING_FREE_LIMIT', statusCode: 429 });
    expect(mock.queries.some(q => q.includes('INSERT INTO routing_usage_counts'))).toBe(false);
    expect(mock.queries).toContain('ROLLBACK');
  });
  it('reserves with a database lock, increments before dispatch and commits', async () => {
    await reserveRoutingRequest('ors-matrix');
    expect(mock.used).toBe(1);
    expect(mock.queries.some(q => q.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(mock.queries).toContain('COMMIT');
  });
  it('does not send another request during provider cooldown', async () => {
    mock.blocked = 60000;
    await expect(reserveRoutingRequest('ors-directions')).rejects.toMatchObject({ code: 'ROUTING_PROVIDER_LIMIT' });
  });
  it('rejects an overloaded per-minute budget', async () => {
    mock.recent = 35;
    await expect(reserveRoutingRequest('ors-matrix')).rejects.toMatchObject({ code: 'ROUTING_BUSY' });
  });
  it('does not hold a request waiting indefinitely in the rate queue', async () => {
    mock.wait = 11000;
    await expect(reserveRoutingRequest('ors-directions')).rejects.toMatchObject({ code: 'ROUTING_BUSY' });
  });
  it('fails closed if the database guard is unavailable', async () => {
    mock.databaseFailed = true;
    await expect(reserveRoutingRequest('mapbox-directions')).rejects.toMatchObject({ code: 'ROUTING_GUARD_UNAVAILABLE' });
  });
});

describe('request timeout and cancellation', () => {
  beforeEach(() => Object.assign(mock, { used: 0, recent: 0, wait: 0, blocked: 0, databaseFailed: false, queries: [] }));
  afterEach(() => vi.unstubAllGlobals());
  it('does not dispatch a routing fetch when quota is exhausted', async () => {
    mock.used = ROUTING_LIMITS['ors-matrix'].limit;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { safeRoutingRequest } = await import('../../server/features/travel/safe-routing-request');
    await expect(safeRoutingRequest('ors-matrix', 'https://example.test/matrix')).rejects.toMatchObject({ code: 'ROUTING_FREE_LIMIT' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels before reserving or fetching after the browser disconnects', async () => {
    const { safeRoutingRequest, withRoutingDeadline } = await import('../../server/features/travel/safe-routing-request');
    const cancellation = new AbortController(); cancellation.abort();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(withRoutingDeadline(cancellation.signal, () => safeRoutingRequest('ors-matrix', 'https://example.test/matrix')))
      .rejects.toMatchObject({ code: 'ROUTING_REQUEST_TIMEOUT' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the timeout active while reading a stalled response body', async () => {
    const { safeRoutingRequest } = await import('../../server/features/travel/safe-routing-request');
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({
      ok: true,
      text: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('body read aborted')), { once: true });
      }),
    })));
    await expect(safeRoutingRequest('ors-matrix', 'https://example.test/matrix', {}, 20))
      .rejects.toMatchObject({ code: 'ROUTING_PROVIDER_TIMEOUT', statusCode: 504 });
  });
});
