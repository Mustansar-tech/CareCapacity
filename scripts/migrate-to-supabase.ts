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
// Schema DDL — generated from shared/schema.ts, ordered by dependency
// ---------------------------------------------------------------------------
const DDL = `
-- Enable pgcrypto for gen_random_uuid() if not already available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- branches (no foreign-key deps)
CREATE TABLE IF NOT EXISTS branches (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL UNIQUE,
  display_name TEXT   NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- users
CREATE TABLE IF NOT EXISTS users (
  id           VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT      NOT NULL UNIQUE,
  username     TEXT,
  password     TEXT      NOT NULL,
  display_name TEXT      NOT NULL,
  role         TEXT      NOT NULL DEFAULT 'viewer',
  is_active    INTEGER   NOT NULL DEFAULT 1,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- user_branches
CREATE TABLE IF NOT EXISTS user_branches (
  id        VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id VARCHAR NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT unique_user_branch UNIQUE (user_id, branch_id)
);

-- audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id          VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     VARCHAR   REFERENCES users(id),
  user_email  TEXT,
  branch_id   VARCHAR,
  action      TEXT      NOT NULL,
  detail      TEXT,
  "timestamp" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- capacity_analyses
CREATE TABLE IF NOT EXISTS capacity_analyses (
  id                        VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id                 VARCHAR   NOT NULL REFERENCES branches(id),
  week_start_date           TEXT      NOT NULL,
  week_end_date             TEXT      NOT NULL,
  uploaded_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  kpis                      JSONB     NOT NULL,
  daily_summary             JSONB     NOT NULL,
  employees_by_date         JSONB     NOT NULL,
  employee_summary_by_date  JSONB     NOT NULL DEFAULT '{}',
  warnings                  JSONB              DEFAULT '[]',
  gh_loss_raw_summary       JSONB,
  CONSTRAINT unique_week UNIQUE (branch_id, week_start_date, week_end_date)
);
CREATE INDEX IF NOT EXISTS branch_idx        ON capacity_analyses (branch_id);
CREATE INDEX IF NOT EXISTS week_start_idx    ON capacity_analyses (week_start_date);
CREATE INDEX IF NOT EXISTS uploaded_at_idx   ON capacity_analyses (uploaded_at);

-- branch_uploads
CREATE TABLE IF NOT EXISTS branch_uploads (
  id                 VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id          VARCHAR   NOT NULL REFERENCES branches(id),
  upload_type        TEXT      NOT NULL,
  file_buffer        TEXT      NOT NULL,
  original_file_name TEXT,
  file_size          INTEGER,
  sha256             TEXT,
  uploaded_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_branch_upload UNIQUE (branch_id, upload_type)
);
CREATE INDEX IF NOT EXISTS branch_upload_branch_idx  ON branch_uploads (branch_id);
CREATE INDEX IF NOT EXISTS upload_uploaded_at_idx    ON branch_uploads (uploaded_at);

-- employee_locations
CREATE TABLE IF NOT EXISTS employee_locations (
  id              VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       VARCHAR   NOT NULL REFERENCES branches(id),
  employee_name   TEXT      NOT NULL,
  home_postcode   TEXT      NOT NULL,
  home_lat        TEXT,
  home_lng        TEXT,
  transport_mode  TEXT               DEFAULT 'car',
  gender          TEXT,
  geocoded_at     TIMESTAMP,
  CONSTRAINT unique_employee_per_branch UNIQUE (branch_id, employee_name)
);
CREATE INDEX IF NOT EXISTS employee_branch_idx ON employee_locations (branch_id);
CREATE INDEX IF NOT EXISTS employee_name_idx   ON employee_locations (employee_name);
CREATE INDEX IF NOT EXISTS postcode_idx        ON employee_locations (home_postcode);

-- client_locations
CREATE TABLE IF NOT EXISTS client_locations (
  id            VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     VARCHAR   NOT NULL REFERENCES branches(id),
  client_name   TEXT      NOT NULL,
  address_line  TEXT      NOT NULL,
  postcode      TEXT      NOT NULL,
  lat           TEXT,
  lng           TEXT,
  geocoded_at   TIMESTAMP,
  CONSTRAINT unique_client_per_branch UNIQUE (branch_id, client_name)
);
CREATE INDEX IF NOT EXISTS client_branch_idx   ON client_locations (branch_id);
CREATE INDEX IF NOT EXISTS client_name_idx     ON client_locations (client_name);
CREATE INDEX IF NOT EXISTS client_postcode_idx ON client_locations (postcode);

-- visits
CREATE TABLE IF NOT EXISTS visits (
  id                   VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id            VARCHAR   NOT NULL REFERENCES branches(id),
  client_id            VARCHAR   NOT NULL REFERENCES client_locations(id),
  date                 TEXT      NOT NULL,
  duration_minutes     INTEGER   NOT NULL,
  preferred_start_time TEXT,
  preferred_end_time   TEXT,
  priority             INTEGER            DEFAULT 1,
  service_type         TEXT,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS visit_branch_idx      ON visits (branch_id);
CREATE INDEX IF NOT EXISTS visit_date_idx        ON visits (date);
CREATE INDEX IF NOT EXISTS visit_client_date_idx ON visits (client_id, date);

-- route_plans
CREATE TABLE IF NOT EXISTS route_plans (
  id                   VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id            VARCHAR   NOT NULL REFERENCES branches(id),
  date                 TEXT      NOT NULL,
  employee_id          VARCHAR   NOT NULL REFERENCES employee_locations(id),
  total_distance_km    TEXT,
  total_travel_minutes INTEGER,
  status               TEXT               DEFAULT 'optimized',
  warnings             JSONB              DEFAULT '[]',
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS route_branch_idx        ON route_plans (branch_id);
CREATE INDEX IF NOT EXISTS route_employee_date_idx ON route_plans (employee_id, date);
CREATE INDEX IF NOT EXISTS route_date_idx          ON route_plans (date);

-- route_stops
CREATE TABLE IF NOT EXISTS route_stops (
  id                       VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  route_plan_id            VARCHAR NOT NULL REFERENCES route_plans(id) ON DELETE CASCADE,
  visit_id                 VARCHAR NOT NULL REFERENCES visits(id),
  sequence                 INTEGER NOT NULL,
  scheduled_start          TEXT,
  scheduled_end            TEXT,
  travel_minutes_from_prev INTEGER,
  distance_km_from_prev    TEXT
);
CREATE INDEX IF NOT EXISTS route_stop_plan_seq_idx ON route_stops (route_plan_id, sequence);

-- geocode_cache
CREATE TABLE IF NOT EXISTS geocode_cache (
  id        VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id VARCHAR   NOT NULL REFERENCES branches(id),
  key       TEXT      NOT NULL,
  lat       TEXT      NOT NULL,
  lng       TEXT      NOT NULL,
  source    TEXT      NOT NULL,
  cached_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_cache_per_branch UNIQUE (branch_id, key)
);
CREATE INDEX IF NOT EXISTS geocode_branch_idx ON geocode_cache (branch_id);
CREATE INDEX IF NOT EXISTS geocode_key_idx    ON geocode_cache (key);

-- weekly_schedules
CREATE TABLE IF NOT EXISTS weekly_schedules (
  id                VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         VARCHAR   NOT NULL REFERENCES branches(id),
  week_start_date   TEXT      NOT NULL,
  week_end_date     TEXT      NOT NULL,
  generated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  schedule_data     JSONB     NOT NULL,
  unallocated_visits JSONB             DEFAULT '[]',
  metrics           JSONB     NOT NULL,
  CONSTRAINT unique_weekly_schedule UNIQUE (branch_id, week_start_date, week_end_date)
);
CREATE INDEX IF NOT EXISTS weekly_schedule_branch_idx    ON weekly_schedules (branch_id);
CREATE INDEX IF NOT EXISTS weekly_schedule_start_idx     ON weekly_schedules (week_start_date);
CREATE INDEX IF NOT EXISTS weekly_schedule_generated_idx ON weekly_schedules (generated_at);

-- travel_time_cache
CREATE TABLE IF NOT EXISTS travel_time_cache (
  id             VARCHAR   PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      VARCHAR   NOT NULL REFERENCES branches(id),
  from_lat       TEXT      NOT NULL,
  from_lng       TEXT      NOT NULL,
  to_lat         TEXT      NOT NULL,
  to_lng         TEXT      NOT NULL,
  transport_mode TEXT               DEFAULT 'car',
  duration_mins  INTEGER   NOT NULL,
  source         TEXT      NOT NULL,
  cached_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_travel_cache UNIQUE (branch_id, from_lat, from_lng, to_lat, to_lng, transport_mode)
);
CREATE INDEX IF NOT EXISTS travel_branch_idx    ON travel_time_cache (branch_id);
CREATE INDEX IF NOT EXISTS travel_coords_idx    ON travel_time_cache (from_lat, from_lng, to_lat, to_lng);

-- session (connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR   NOT NULL PRIMARY KEY,
  sess   JSON      NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
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
  "session",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function copyTable(src: Client, dst: Client, table: string): Promise<void> {
  const countRes = await src.query(`SELECT COUNT(*) FROM "${table}"`);
  const total = parseInt(countRes.rows[0].count, 10);

  if (total === 0) {
    log(`  ${table}: 0 rows — skipping`);
    return;
  }

  log(`  ${table}: copying ${total} rows…`);

  // Fetch all rows from source
  const { rows, fields } = await src.query(`SELECT * FROM "${table}"`);
  const columns = fields.map((f) => `"${f.name}"`).join(", ");

  const CHUNK = 200;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    // Build parameterised VALUES list
    const valuePlaceholders: string[] = [];
    const flatParams: unknown[] = [];
    let paramIndex = 1;

    for (const row of chunk) {
      const rowPlaceholders = fields.map((f) => {
        const val = row[f.name];
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

  // ── Step 1: apply schema ──────────────────────────────────────────────────
  log("\n=== Step 1: Creating schema on Supabase ===");
  const statements = DDL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await dst.query(stmt);
    } catch (err: any) {
      // Ignore "already exists" style errors — they come from CREATE TABLE IF NOT EXISTS
      // but some constraint / index ones still surface
      if (!err.message?.includes("already exists")) {
        throw err;
      }
    }
  }
  log("Schema applied ✓");

  // ── Step 2: copy data ─────────────────────────────────────────────────────
  log("\n=== Step 2: Copying data ===");
  for (const table of TABLES) {
    try {
      await copyTable(src, dst, table);
    } catch (err: any) {
      // Table might not exist on source yet — that's fine
      if (err.message?.includes("does not exist")) {
        log(`  ${table}: table not found on source — skipping`);
      } else {
        throw err;
      }
    }
  }

  log("\n=== Migration complete ✓ ===");

  await src.end();
  await dst.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
