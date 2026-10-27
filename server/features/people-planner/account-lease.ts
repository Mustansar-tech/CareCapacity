/**
 * Cross-process account ownership. The store must implement compare-and-set
 * using database time; in-memory reservations alone cannot protect API + cron.
 */
export interface AccountLeaseStore {
  claim(key: string, owner: string, ttlMs: number): Promise<boolean>;
  renew(key: string, owner: string, ttlMs: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
}

export interface AccountLease {
  assertActive(): void;
  release(): Promise<void>;
}

export const ACCOUNT_LEASE_TTL_MS = 120_000;
export const ACCOUNT_LEASE_HEARTBEAT_MS = 15_000;

export async function acquireAccountLease(
  store: AccountLeaseStore,
  key: string,
  owner: string,
  options: {
    waitMs: number;
    onLost: () => Promise<void>;
    ttlMs?: number;
    heartbeatMs?: number;
    pollMs?: number;
  },
): Promise<AccountLease | null> {
  const ttl = options.ttlMs ?? ACCOUNT_LEASE_TTL_MS;
  const heartbeat = options.heartbeatMs ?? ACCOUNT_LEASE_HEARTBEAT_MS;
  const deadline = Date.now() + options.waitMs;
  let lastConfirmedAt = Date.now();
  while (true) {
    // Use the request START time as the conservative local lease expiry.
    lastConfirmedAt = Date.now();
    let claimed: boolean;
    try {
      claimed = await store.claim(key, owner, ttl);
    } catch {
      throw new Error("Automation account lock unavailable: database coordination failed; no login attempted.");
    }
    if (claimed) break;
    if (Date.now() >= deadline) return null;
    await new Promise(resolve => setTimeout(resolve, Math.min(options.pollMs ?? 1000, Math.max(1, deadline - Date.now()))));
  }

  let lost = false;
  let stopped = false;
  let renewing: Promise<void> | undefined;
  let stoppingBrowser: Promise<void> | undefined;
  let releasePromise: Promise<void> | undefined;
  const invalidate = () => {
    if (lost || stopped) return;
    lost = true;
    // Stop the browser, not just the heartbeat, when coordination is uncertain.
    stoppingBrowser = options.onLost().catch(() => {});
  };
  const timer = setInterval(() => {
    if (stopped || lost) return;
    const started = Date.now();
    if (started - lastConfirmedAt >= ttl - heartbeat) {
      invalidate();
      return;
    }
    if (renewing) return;
    renewing = (async () => {
      try {
        if (started - lastConfirmedAt >= ttl - heartbeat ||
            !await store.renew(key, owner, ttl)) {
          invalidate();
          return;
        }
        lastConfirmedAt = started;
      } catch {
        invalidate();
      }
    })().finally(() => { renewing = undefined; });
  }, heartbeat);
  timer.unref?.();

  return {
    assertActive() {
      if (Date.now() - lastConfirmedAt >= ttl - heartbeat) invalidate();
      if (stopped || lost) throw new Error("Automation account lock lost; stopped safely instead of sharing the login.");
    },
    release() {
      if (!releasePromise) {
        stopped = true;
        clearInterval(timer);
        releasePromise = (async () => {
          await renewing;
          await stoppingBrowser;
          await store.release(key, owner);
        })();
      }
      return releasePromise;
    },
  };
}

