import { db } from './server/infrastructure/db';
import { cpScheduledVisits } from './shared/schema';
import { ilike, eq, and } from 'drizzle-orm';

async function main() {
  const rows = await db.select().from(cpScheduledVisits).where(
    and(ilike(cpScheduledVisits.cpName, '%jamie%lee%kane%'), eq(cpScheduledVisits.date, '2026-09-23'))
  );
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
