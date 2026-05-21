import pkg from 'pg';
const { Client } = pkg;

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE joiners ADD COLUMN IF NOT EXISTS postcode text;`);
    console.log('✓ added postcode column');

    await client.query(`ALTER TABLE joiners ADD COLUMN IF NOT EXISTS contracted_hours real;`);
    console.log('✓ added contracted_hours column');

    await client.query(`ALTER TABLE joiners ALTER COLUMN expected_start_date DROP NOT NULL;`);
    console.log('✓ made expected_start_date nullable');

    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
