---
name: Drizzle push vs Supabase pooler
description: How to apply schema changes when drizzle-kit push fails against the Supabase pooler
---

`npm run db:push` fails against this project's Supabase pooler DATABASE_URL: first with "SSL connection is required", then (with `?sslmode=require`) with "self-signed certificate in chain", and finally hangs on interactive TUI prompts that ignore piped stdin.

**Why:** DATABASE_URL has no sslmode param and the pooler presents a cert Node rejects; drizzle-kit's prompts need a real TTY.

**How to apply:** For new tables, skip drizzle-kit and run the CREATE TABLE SQL directly with a small `node -e` script using `pg` with `ssl: { rejectUnauthorized: false }`. If drizzle-kit is really needed: `NODE_TLS_REJECT_UNAUTHORIZED=0 DATABASE_URL="${DATABASE_URL}?sslmode=require" npm run db:push` — but expect interactive prompts (e.g. an unrelated pending unique constraint on monthly_capacity_snapshots) that can't be answered non-interactively.
