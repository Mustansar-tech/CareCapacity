import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/infrastructure/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../server/storage', () => ({ storage: {} }));
vi.mock('../../server/features/capacity/geographical-extraction', () => ({
  extractAndStoreGeographicalData: vi.fn(),
}));

import { processCapacityData } from '../../server/features/capacity/capacity-processor';
import { normalizeName } from '../../server/features/imports/pipeline-utils';

describe('shared ingestion pipeline GH roster eligibility', () => {
  it('uses CG membership, not visits or availability, for raw GH targets on every reprocess', async () => {
    const date = '2026-10-06';
    const guaranteed = [
      { 'Actual Employee Name': 'Former, Carer (30GH)', 'Actual Pay Rate Hours': 2 },
      { 'Actual Employee Name': 'Current, Carer (30GH)', 'Actual Pay Rate Hours': 3 },
    ].map(row => ({
      ...row,
      'Service Requirement Start Date And Time': `${date}T10:00:00`,
      'Service Requirement End Date And Time': `${date}T12:00:00`,
      'Actual Service Type Description': 'Personal Care',
    }));
    const cgData = [{ 'CAREGiver Name': 'Current Carer', 'Weekly Hours': 30 }];
    const result = await processCapacityData([], guaranteed as any, [], cgData, {
      guaranteedRaw: guaranteed as any,
    });
    expect(result.ghLossRawSummary?.targets).toEqual({
      [normalizeName('Current Carer')]: { hours: 30, displayName: 'Current, Carer' },
    });
    expect(result.ghLossRawSummary?.scheduled[normalizeName('Former Carer')]).toBeUndefined();
    expect(result.ghLossRawSummary?.scheduled[normalizeName('Current Carer')]).toBe(3);
    // Recorded visits still belong to the input; filtering obligations must not
    // remove worked hours or client demand from the source data.
    expect(guaranteed).toHaveLength(2);

    const nextImport = await processCapacityData([], guaranteed as any, [], [], {
      guaranteedRaw: guaranteed as any,
    });
    expect(nextImport.ghLossRawSummary?.targets).toEqual({});
    expect(result.ghLossRawSummary?.targets[normalizeName('Current Carer')]).toBeDefined();
  });
});
