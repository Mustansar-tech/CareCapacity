
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applyMigration() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('✅ Connected to database');

    // Read the migration SQL file
    const migrationSQL = readFileSync(
      join(__dirname, '0001_update_branch_display_names.sql'),
      'utf-8'
    );

    // Execute the migration
    await pool.query(migrationSQL);

    console.log('✅ Display names updated successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyMigration();
