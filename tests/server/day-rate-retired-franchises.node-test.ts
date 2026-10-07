import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const active = {
  id: 'active', franchiseName: 'Glasgow North', office: 'Glasgow North',
  groupName: 'SUR Group', area: 'Megan', isLiveInCare: false, displayOrder: 0,
};
const retired = { ...active, id: 'retired', franchiseName: 'Glasgow North Kirkintilloch', displayOrder: 1 };
const missingActive = { ...active, id: 'missing', franchiseName: 'Glasgow South' };

// Use Node's test runner because the installed Vitest/Vite versions are incompatible.
// Transpile the real modules, replacing only their external dependencies.
function loadModule(path: string, dependencies: Record<string, unknown>) {
  const module = { exports: {} as any };
  class FixedDate extends Date {
    constructor(value: any = '2026-10-07T12:00:00Z') { super(value); }
  }
  runInNewContext(transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, Date: FixedDate, Map, Set,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

function entry(franchiseId: string, date: string) {
  return { franchiseId, date, reportingMonth: '2026-10', daysInMonth: 31, revenue: 310, dayRate: 10 };
}

describe('retired Day Rate franchises', () => {
  let repository: any;
  let results: unknown[][];
  beforeEach(() => {
    results = [];
    repository = loadModule('server/repositories/day-rate.repository.ts', {
      '../infrastructure/db': {
        db: {
          select: () => ({
            from: () => ({
              orderBy: async () => results.shift(),
              where: async () => results.shift(),
            }),
          }),
        },
      },
      '@shared/schema': { dayRateFranchises: {}, dayRateEntries: {} },
      'drizzle-orm': { asc: () => null, eq: () => null, sql: () => null },
    });
  });

  it('keeps retired franchises in the historical reference list', async () => {
    results.push([active, retired]);
    assert.deepEqual(await repository.getAllFranchises(), [active, retired]);
  });

  it('excludes retired franchises from the automation reference list', async () => {
    results.push([active, retired, missingActive]);
    assert.deepEqual(await repository.getActiveFranchises(), [active, missingActive]);
  });

  it('retains historical figures and totals for retired franchises', async () => {
    results.push([active, retired], [entry('active', '2026-07-01'), entry('retired', '2026-07-01')]);
    const grid = await repository.getDayRateGrid('2026-07');
    assert.ok(grid.franchises.some((f: any) => f.id === 'retired'));
    assert.equal(grid.franchises.find((f: any) => f.id === 'retired').entries['2026-07-01'].revenue, 310);
    assert.equal(grid.totals['2026-07-01'].revenue, 620);
  });

  it('hides retired franchises without monthly records while retaining genuine missing warnings', async () => {
    results.push([active, retired, missingActive], [entry('active', '2026-10-07')]);
    const grid = await repository.getDayRateGrid('2026-10');
    assert.deepEqual(Array.from(grid.franchises, (f: any) => f.id), ['active']);
    assert.deepEqual(Array.from(grid.missingTodayFranchises), ['Glasgow South']);
  });

  it('does not flag a retired franchise with earlier monthly records as missing today', async () => {
    results.push([active, retired], [entry('active', '2026-10-07'), entry('retired', '2026-10-01')]);
    const grid = await repository.getDayRateGrid('2026-10');
    assert.ok(grid.franchises.some((f: any) => f.id === 'retired'));
    assert.equal(grid.missingTodayFranchises.length, 0);
  });

  it('never queues current or forward automation jobs for retired franchises', async () => {
    results.push([active, retired]);
    const scheduler = loadModule('server/features/people-planner/day-rate-scheduler.ts', {
      '../../infrastructure/logger': { logger: {} },
      '../../repositories/day-rate.repository': repository,
      '../../repositories/day-rate-automation.repository': {},
      './automation-routes': { getBranchIdForDayRateOffice: () => 'glasgow-north' },
    });
    const { jobsByBranch } = await scheduler.buildDayRateJobGroups(new Date('2026-10-07T12:00:00Z'));
    const jobs = Array.from(jobsByBranch.values()).flat() as any[];
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every(job => job.franchiseId === active.id));
  });
});
