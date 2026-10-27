import { pool } from "../infrastructure/db";
import type { AccountLeaseStore } from "../features/people-planner/account-lease";

function boundedQuery(text: string, values: Array<string | number>) {
  // pg supports per-query read timeouts; this project's @types/pg version only
  // declares the equivalent connection-level option. Keep the runtime option
  // without weakening the result type or changing timeouts for business queries.
  const config = { text, values, query_timeout: 10000 };
  return pool.query(config);
}

/** No emails, passwords, cookies or report data are stored in this table. */
export const ppAccountLeaseStore: AccountLeaseStore = {
  async claim(key, owner, ttlMs) {
    const result = await boundedQuery(`
      INSERT INTO pp_automation_account_leases (account_key, owner_id, expires_at)
      VALUES ($1, $2, clock_timestamp() + $3 * interval '1 millisecond')
      ON CONFLICT (account_key) DO UPDATE
        SET owner_id = EXCLUDED.owner_id, expires_at = EXCLUDED.expires_at
        WHERE pp_automation_account_leases.expires_at <= clock_timestamp()
      RETURNING account_key
    `, [key, owner, ttlMs]);
    return result.rowCount === 1;
  },
  async renew(key, owner, ttlMs) {
    const result = await boundedQuery(`
      UPDATE pp_automation_account_leases
      SET expires_at = clock_timestamp() + $3 * interval '1 millisecond'
      WHERE account_key = $1 AND owner_id = $2 AND expires_at > clock_timestamp()
      RETURNING account_key
    `, [key, owner, ttlMs]);
    return result.rowCount === 1;
  },
  async release(key, owner) {
    await boundedQuery(
      "DELETE FROM pp_automation_account_leases WHERE account_key = $1 AND owner_id = $2",
      [key, owner],
    );
  },
};
