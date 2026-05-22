import pkg from 'pg';
const { Client } = pkg;

async function migrate() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE joiners ADD COLUMN IF NOT EXISTS hired_at TEXT;
    `);
    console.log('✓ Added hired_at to joiners');

    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_capacity_snapshots (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        branch_id VARCHAR NOT NULL REFERENCES branches(id),
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        hours_in REAL NOT NULL DEFAULT 0,
        heads_in INTEGER NOT NULL DEFAULT 0,
        hours_out REAL NOT NULL DEFAULT 0,
        heads_out INTEGER NOT NULL DEFAULT 0,
        snapshot_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(branch_id, year, month)
      );
    `);
    console.log('✓ Created monthly_capacity_snapshots table');

    await client.query(`
      CREATE INDEX IF NOT EXISTS snapshot_branch_idx ON monthly_capacity_snapshots(branch_id);
    `);
    console.log('✓ Created snapshot_branch_idx');

    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
