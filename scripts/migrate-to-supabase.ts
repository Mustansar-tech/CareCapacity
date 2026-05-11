/**
 * Migration script: copies schema + data from Neon (DATABASE_URL) → Supabase (SUPABASE_DATABASE_URL)
 *
 * Run with:  npx tsx scripts/migrate-to-supabase.ts
 */

import pkg from "pg";
const { Client } = pkg;

const SOURCE_URL = process.env.DATABASE_URL!;
const TARGET_URL = process.env.SUPABASE_DATABASE_URL!;

if (!SOURCE_URL) throw new Error("DATABASE_URL is not set");
if (!TARGET_URL) throw new Error("SUPABASE_DATABASE_URL is not set");

// ---------------------------------------------------------------------------
// Extra DDL for tables not in the Drizzle schema (drizzle-kit push won't create these)
// ---------------------------------------------------------------------------
const EXTRA_DDL = `
CREATE TABLE IF NOT EXISTS client_enquiries (
  id                    VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id             VARCHAR   NOT NULL REFERENCES branches(id),
  client_name           TEXT      NOT NULL,
  postcode              TEXT      NOT NULL,
  gender_preference     TEXT,
  required_days         JSONB,
  preferred_time_window JSONB,
  visit_duration_minutes INTEGER,
  weekly_hours_needed   TEXT,
  match_count           INTEGER,
  top_match             TEXT,
  results               JSONB,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  visits                JSONB,
  is_multi_visit        INTEGER,
  starred_selections    JSONB
);

CREATE TABLE IF NOT EXISTS cp_scheduled_visits (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      VARCHAR NOT NULL REFERENCES branches(id),
  cp_name        TEXT,
  client_name    TEXT,
  client_lat     TEXT,
  client_lng     TEXT,
  client_postcode TEXT,
  date           TEXT,
  start_time     TEXT,
  end_time       TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id                 VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  type               TEXT,
  title              TEXT,
  description        TEXT,
  steps_to_reproduce TEXT,
  submitted_by_email TEXT,
  branch_id          VARCHAR   REFERENCES branches(id),
  submitted_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

// ---------------------------------------------------------------------------
// Tables to copy, in dependency order (parents before children)
// ---------------------------------------------------------------------------
const TABLES = [
  "branches",
  "users",
  "user_branches",
  "audit_logs",
  "capacity_analyses",
  "branch_uploads",
  "employee_locations",
  "client_locations",
  "visits",
  "route_plans",
  "route_stops",
  "geocode_cache",
  "weekly_schedules",
  "travel_time_cache",
  "client_enquiries",
  "cp_scheduled_visits",
  "feedback",
  "session",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function tableExists(client: Client, table: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1`,
    [table],
  );
  return res.rowCount! > 0;
}

async function getTableColumns(client: Client, table: string): Promise<string[]> {
  const res = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND table_schema='public' ORDER BY ordinal_position`,
    [table],
  );
  return res.rows.map((r) => r.column_name as string);
}

async function copyTable(src: Client, dst: Client, table: string): Promise<void> {
  const exists = await tableExists(src, table);
  if (!exists) {
    log(`  ${table}: not found on source — skipping`);
    return;
  }

  const countRes = await src.query(`SELECT COUNT(*) FROM "${table}"`);
  const total = parseInt(countRes.rows[0].count, 10);

  if (total === 0) {
    log(`  ${table}: 0 rows — skipping`);
    return;
  }

  log(`  ${table}: copying ${total} rows…`);

  // Only copy columns that exist in BOTH source and destination
  const srcCols = await getTableColumns(src, table);
  const dstCols = await getTableColumns(dst, table);
  const commonCols = srcCols.filter((c) => dstCols.includes(c));

  if (commonCols.length === 0) {
    log(`  ${table}: no common columns — skipping`);
    return;
  }

  const colList = commonCols.map((c) => `"${c}"`).join(", ");
  const { rows } = await src.query(`SELECT ${colList} FROM "${table}"`);
  const columns = colList;

  const CHUNK = 200;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    const valuePlaceholders: string[] = [];
    const flatParams: unknown[] = [];
    let paramIndex = 1;

    for (const row of chunk) {
      const rowPlaceholders = commonCols.map((col) => {
        let val = row[col];
        // pg driver returns JSONB as parsed objects — re-stringify for safe insert
        if (val !== null && val !== undefined && typeof val === "object" && !(val instanceof Date)) {
          val = JSON.stringify(val);
        }
        flatParams.push(val === undefined ? null : val);
        return `$${paramIndex++}`;
      });
      valuePlaceholders.push(`(${rowPlaceholders.join(", ")})`);
    }

    await dst.query(
      `INSERT INTO "${table}" (${columns}) VALUES ${valuePlaceholders.join(", ")} ON CONFLICT DO NOTHING`,
      flatParams,
    );

    inserted += chunk.length;
    if (rows.length > CHUNK) {
      process.stdout.write(`\r    → ${inserted}/${total}`);
    }
  }

  if (rows.length > CHUNK) process.stdout.write("\n");
  log(`  ${table}: ✓ ${inserted} rows copied`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const src = new Client({ connectionString: SOURCE_URL, ssl: { rejectUnauthorized: false } });
  const dst = new Client({ connectionString: TARGET_URL, ssl: { rejectUnauthorized: false } });

  log("Connecting to source (Neon)…");
  await src.connect();

  log("Connecting to target (Supabase)…");
  await dst.connect();

  // ── Step 1: apply extra schema for tables not covered by drizzle-kit push ──
  log("\n=== Step 1: Ensuring all tables exist on Supabase ===");
  const statements = EXTRA_DDL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await dst.query(stmt);
    } catch (err: any) {
      if (!err.message?.includes("already exists")) {
        log(`  Warning: ${err.message}`);
      }
    }
  }
  log("Extra tables ensured ✓");

  // ── Step 2: copy data ─────────────────────────────────────────────────────
  log("\n=== Step 2: Copying data ===");
  for (const table of TABLES) {
    try {
      await copyTable(src, dst, table);
    } catch (err: any) {
      log(`  ERROR on ${table}: ${err.message}`);
      throw err;
    }
  }

  log("\n=== Migration complete ✓ ===");

  await src.end();
  await dst.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
