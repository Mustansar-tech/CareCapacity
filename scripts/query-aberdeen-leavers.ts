import { db } from '../server/infrastructure/db';
import { leavers, branches } from '../shared/schema';
import { eq, ilike } from 'drizzle-orm';

const allBranches = await db.select({ id: branches.id, name: branches.name }).from(branches);
console.log('All branches:', JSON.stringify(allBranches, null, 2));

const aberdeenBranch = allBranches.find(b => b.name.toLowerCase().includes('aberdeen'));
console.log('Aberdeen branch:', aberdeenBranch);

if (aberdeenBranch) {
  const rows = await db.select({
    id: leavers.id,
    employeeName: leavers.employeeName,
    employeeNo: leavers.employeeNo,
    status: leavers.status,
    lastWorkingDay: leavers.lastWorkingDay,
    weeklyHours: leavers.weeklyHours,
  }).from(leavers).where(eq(leavers.branchId, aberdeenBranch.id));
  console.log('Leavers:', JSON.stringify(rows, null, 2));
}
process.exit(0);
