import pkg from 'pg';
const { Client } = pkg;

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(`ALTER TABLE joiners ADD COLUMN IF NOT EXISTS training_day2_date TEXT;`);
    console.log('✓ Added training_day2_date to joiners');
  } finally {
    await client.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
