import pkg from 'pg';
const { Client } = pkg;

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS day_rate_franchises (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        group_name TEXT NOT NULL,
        area TEXT,
        office TEXT NOT NULL,
        franchise_name TEXT NOT NULL UNIQUE,
        is_live_in_care BOOLEAN NOT NULL DEFAULT FALSE,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✓ Created day_rate_franchises table');

    await client.query(`
      CREATE TABLE IF NOT EXISTS day_rate_entries (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        franchise_id VARCHAR NOT NULL REFERENCES day_rate_franchises(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        reporting_month TEXT NOT NULL,
        days_in_month INTEGER NOT NULL,
        revenue REAL NOT NULL DEFAULT 0,
        day_rate REAL NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'import',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT unique_day_rate_entry UNIQUE (franchise_id, date, reporting_month)
      );
    `);
    console.log('✓ Created day_rate_entries table');

    await client.query(`
      CREATE INDEX IF NOT EXISTS day_rate_franchise_idx ON day_rate_entries(franchise_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS day_rate_reporting_month_idx ON day_rate_entries(reporting_month);
    `);
    console.log('✓ Created indexes');

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
