import { db } from './server/infrastructure/db';
import { cpScheduledVisits } from './shared/schema';
import { ilike, sql } from 'drizzle-orm';

async function main() {
  const total = await db.select({ c: sql<number>`count(*)` }).from(cpScheduledVisits);
  console.log('total rows', total);
  const rows = await db.select().from(cpScheduledVisits).where(ilike(cpScheduledVisits.cpName, '%jamie%'));
  console.log('jamie rows', JSON.stringify(rows, null, 2));
  const dates = await db.select({ d: cpScheduledVisits.date, c: sql<number>`count(*)` }).from(cpScheduledVisits).groupBy(cpScheduledVisits.date).orderBy(cpScheduledVisits.date);
  console.log('date distribution', JSON.stringify(dates));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
