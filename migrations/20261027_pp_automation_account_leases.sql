-- Additive: applies to the existing external PostgreSQL/Supabase database.
-- All API/worker instances must run the matching application version.
CREATE TABLE IF NOT EXISTS pp_automation_account_leases (
  account_key text PRIMARY KEY,
  owner_id text NOT NULL,
  expires_at timestamptz NOT NULL
);
ALTER TABLE pp_automation_account_leases ENABLE ROW LEVEL SECURITY;
