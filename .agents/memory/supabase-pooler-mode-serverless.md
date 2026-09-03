---
name: Supabase pooler mode for serverless (Vercel) vs Replit dev
description: Session-mode Supabase pooler (port 5432) caps the whole project at ~15 connections; serverless multi-instance concurrency blows past it even with small per-pool max settings.
---

Production (Vercel, serverless) intermittently failed requests that touch the DB (e.g. Enquiry Matcher) with a generic "unexpected error", while Replit dev worked fine. Root cause: DATABASE_URL used Supabase's pooler on port 5432 (session mode), which holds a connection for the life of each request and caps the whole project at a small fixed number of sessions (15 on this project's tier).

The app opens two separate pg.Pool instances per process (main pool in server/infrastructure/db.ts, session-store pool in server/index.ts), so even one warm serverless instance can hold up to PGPOOL_MAX + SESSION_POOL_MAX connections. A second concurrent instance is enough to exceed the session-mode cap — tuning PGPOOL_MAX/SESSION_POOL_MAX/WORKER_POOL_MAX down further does not fix this, it only delays it.

**Why:** Replit dev is one long-running process with one shared pool, so it rarely approaches the cap. Vercel spins up separate instances per concurrent invocation, each with its own pools, so the same code hits the ceiling in production even though it "works on Replit."

**How to apply:** the fix is the connection string, not pool-size env vars. Switch DATABASE_URL to Supabase's transaction-mode pooler: change port 5432 → 6543 and add `?pgbouncer=true` (or `&pgbouncer=true`). Verified this works against the live DB with node-postgres/drizzle with no code changes needed, since the app doesn't use session-level Postgres features (LISTEN/NOTIFY, advisory locks, SET). Apply this to every process's DATABASE_URL that talks to Supabase in production (Vercel web app, and any separate PM2 worker host) — Replit dev can stay on session mode since it's low-concurrency by design (user declined switching it, on 2026-09-03).
