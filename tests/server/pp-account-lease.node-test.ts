import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acquireAccountLease, type AccountLeaseStore } from "../../server/features/people-planner/account-lease";
import { describeAutomationFailure } from "../../server/features/people-planner/automation-failure";

function store() {
  const rows = new Map<string, { owner: string; until: number }>();
  return {
    rows,
    async claim(key: string, owner: string, ttl: number) {
      if ((rows.get(key)?.until ?? 0) > Date.now()) return false;
      rows.set(key, { owner, until: Date.now() + ttl });
      return true;
    },
    async renew(key: string, owner: string, ttl: number) {
      const row = rows.get(key);
      if (!row || row.owner !== owner || row.until <= Date.now()) return false;
      row.until = Date.now() + ttl;
      return true;
    },
    async release(key: string, owner: string) {
      if (rows.get(key)?.owner === owner) rows.delete(key);
    },
  } satisfies AccountLeaseStore & { rows: Map<string, { owner: string; until: number }> };
}
const options = { waitMs: 0, onLost: async () => {} };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("PP account ownership across independent API/worker owners", () => {
  it("allows only one owner, then allows another after release", async () => {
    const db = store();
    const api = await acquireAccountLease(db, "account-hash", "api", options);
    assert.ok(api);
    assert.equal(await acquireAccountLease(db, "account-hash", "worker", options), null);
    api.assertActive();
    await api.release();
    const worker = await acquireAccountLease(db, "account-hash", "worker", options);
    assert.ok(worker);
    await worker.release();
  });

  it("permits distinct dedicated accounts concurrently", async () => {
    const db = store();
    const [a, b] = await Promise.all([
      acquireAccountLease(db, "dedicated", "capacity", options),
      acquireAccountLease(db, "universal", "bi", options),
    ]);
    assert.ok(a); assert.ok(b);
    await Promise.all([a.release(), b.release()]);
  });

  it("waits for a busy account rather than attempting login", async () => {
    const db = store();
    const first = await acquireAccountLease(db, "account", "first", options);
    const pending = acquireAccountLease(db, "account", "second", { ...options, waitMs: 500, pollMs: 5 });
    await sleep(10);
    await first!.release();
    const second = await pending;
    assert.ok(second);
    await second.release();
  });

  it("recovers an expired crashed owner's lease; stale release cannot remove its replacement", async () => {
    const db = store();
    db.rows.set("account", { owner: "crashed", until: Date.now() - 1 });
    const replacement = await acquireAccountLease(db, "account", "replacement", options);
    assert.ok(replacement);
    await db.release("account", "crashed");
    assert.equal(db.rows.get("account")?.owner, "replacement");
    await replacement.release();
  });

  it("fails closed when the database cannot coordinate acquisition", async () => {
    const db = store();
    db.claim = async () => { throw new Error("Connection unavailable"); };
    await assert.rejects(acquireAccountLease(db, "account", "owner", options), /account lock unavailable/);
  });

  it("closes the browser and invalidates the lease when renewal fails", async () => {
    const db = store();
    let closed = 0;
    const lease = await acquireAccountLease(db, "account", "owner", {
      waitMs: 0, heartbeatMs: 10, ttlMs: 150, onLost: async () => { closed++; },
    });
    db.renew = async () => false;
    await sleep(35);
    assert.equal(closed, 1);
    assert.throws(() => lease!.assertActive(), /account lock lost/);
    await lease!.release();
  });

  it("stops the browser before expiry even if a renewal request hangs", async () => {
    const db = store();
    let finishRenew!: (ok: boolean) => void;
    let closed = false;
    db.renew = () => new Promise(resolve => { finishRenew = resolve; });
    const lease = await acquireAccountLease(db, "account", "owner", {
      waitMs: 0, heartbeatMs: 10, ttlMs: 80, onLost: async () => { closed = true; },
    });
    await sleep(110);
    assert.equal(closed, true);
    assert.throws(() => lease!.assertActive(), /account lock lost/);
    finishRenew(false);
    await lease!.release();
  });
});

describe("safe account-failure descriptions", () => {
  it("does not mislabel a download timeout as a bad password", () => {
    const failure = describeAutomationFailure("Download failed: Timeout 600000ms");
    assert.equal(failure.category, "download");
    assert.match(failure.action, /credentials may still be valid/);
  });

  it("never echoes raw identity URLs, tokens or credentials in notification descriptions", () => {
    const failure = describeAutomationFailure("Login failed at https://identity.accessacloud.com/auth/?token=FAKE_SECRET test@example.invalid");
    assert.equal(failure.category, "authentication");
    assert.doesNotMatch(JSON.stringify(failure), /FAKE_SECRET|https:|example\.invalid/);
  });
});
