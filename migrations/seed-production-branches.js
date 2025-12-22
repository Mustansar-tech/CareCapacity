
import { Pool, neonConfig } from '@neondatabase/serverless';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import ws from 'ws';
import XLSX from 'xlsx';

neonConfig.webSocketConstructor = ws;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function seedBranches() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('✅ Connected to production database\n');

    // Read the Excel file
    const excelPath = join(__dirname, '..', 'attached_assets', 'branches_1766416279114.xlsx');
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log(`📊 Found ${data.length} branches in Excel file\n`);

    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    // Insert each branch
    for (const row of data) {
      const name = row.name || row.Name || row.NAME;
      const displayName = row.display_name || row['Display Name'] || row.displayName || row['Display_Name'];
      const region = row.region || row.Region || row.REGION || 'Scotland';

      if (!name || !displayName) {
        console.log(`⚠️  Skipping row - missing name or display_name:`, row);
        skippedCount++;
        continue;
      }

      try {
        const result = await pool.query(`
          INSERT INTO branches (id, name, display_name, created_at)
          VALUES (gen_random_uuid(), $1, $2, NOW())
          ON CONFLICT (name) DO UPDATE 
          SET display_name = EXCLUDED.display_name
          RETURNING (xmax = 0) AS inserted
        `, [name, displayName]);

        if (result.rows[0].inserted) {
          console.log(`✅ Inserted: ${displayName} (${name})`);
          insertedCount++;
        } else {
          console.log(`🔄 Updated: ${displayName} (${name})`);
          updatedCount++;
        }
      } catch (error) {
        console.error(`❌ Failed to insert/update ${name}:`, error.message);
        skippedCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Inserted: ${insertedCount}`);
    console.log(`   🔄 Updated: ${updatedCount}`);
    console.log(`   ⚠️  Skipped: ${skippedCount}`);
    console.log(`   📋 Total processed: ${data.length}`);
    console.log('\n✅ Branch seeding completed successfully');

    // Verify branches in database
    const verifyResult = await pool.query('SELECT id, name, display_name FROM branches ORDER BY display_name');
    console.log(`\n📋 Current branches in production database (${verifyResult.rows.length}):`);
    verifyResult.rows.forEach(branch => {
      console.log(`   - ${branch.display_name} (${branch.name})`);
    });

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedBranches();
