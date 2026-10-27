/**
 * Opt-in integration check against the configured database.
 * Touches only a random test lock; no People Planner login or business data.
 * Run AFTER the additive lease migration:
 *   npx tsx scripts/verify-pp-account-leases.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ppAccountLeaseStore as store } from "../server/repositories/pp-automation-lease.repository";
import { pool } from "../server/infrastructure/db";

async function contender(key: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--contend", key], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.resume();
    child.on("error", reject);
    child.on("exit", code => {
      if (code !== 0) reject(new Error("Independent lease test process failed"));
      else resolve(stdout.includes("TEST_CLAIMED=true"));
    });
  });
}

async function main() {
  if (process.argv[2] === "--contend") {
    const key = process.argv[3];
    if (!key?.startsWith("reliability-test:")) throw new Error("Test lock prefix required");
    const owner = randomUUID();
    const claimed = await store.claim(key, owner, 15000);
    console.log(`TEST_CLAIMED=${claimed}`);
    if (claimed) await store.release(key, owner);
    return;
  }
  const key = `reliability-test:${randomUUID()}`;
  const owner = randomUUID();
  try {
    assert.equal(await store.claim(key, owner, 30000), true);
    assert.equal(await contender(key), false, "Another process must not steal an active account");
    assert.equal(await store.renew(key, "wrong-owner", 30000), false);
    await store.release(key, "wrong-owner");
    assert.equal(await store.renew(key, owner, 30000), true, "A stale owner cannot release the current lock");
    await store.release(key, owner);
    assert.equal(await contender(key), true, "A released account becomes available");
    assert.equal(await store.claim(key, owner, 1), true);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await contender(key), true, "A crashed owner's expired account becomes available");
    console.log("PASS: cross-process contention, owner-safe renewal/release, and crash-expiry recovery.");
  } finally {
    await store.release(key, owner);
  }
}

main().catch(() => {
  console.error("FAIL: account lease integration check. Check database availability and apply the lease migration.");
  process.exitCode = 1;
}).finally(() => pool.end());
