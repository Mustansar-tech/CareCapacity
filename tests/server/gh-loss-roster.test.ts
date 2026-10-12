import { describe, expect, it } from 'vitest';
import { buildGhLossWeeklyRawSummary, normalizeName } from '../../server/features/imports/pipeline-utils';
import { calculateGhLossTotal } from '../../server/features/capacity/gh-loss-calculator';

const visit = (employee: string, hours = 2, extra: Record<string, unknown> = {}) => ({
  'Actual Employee Name': employee,
  'Actual Start Date And Time': '2026-10-06T10:00:00',
  'Actual End Date And Time': '2026-10-06T12:00:00',
  'Actual Pay Rate Hours': hours,
  'Actual Service Type Description': 'Personal Care',
  ...extra,
});
const roster = (...names: string[]) => new Set(names.map(normalizeName));

describe('GH loss requires membership in the current CG roster', () => {
  it('excludes former carers even when actual and planned visit rows remain', () => {
    const rows = [
      visit('Former, Carer (30GH)'),
      visit('', 1, { 'Planned Employee Name': 'Former, Carer (30GH)' }),
      visit('Active, Carer (37.5GH)'),
    ];
    const summary = buildGhLossWeeklyRawSummary(rows, roster('Carer Active'));
    expect(summary.targets).toEqual({
      [normalizeName('Active Carer')]: { hours: 37.5, displayName: 'Active, Carer' },
    });
    expect(summary.scheduled).toEqual({ [normalizeName('Active Carer')]: 2 });
    expect(calculateGhLossTotal({}, summary)).toBe(35.5);
  });

  it('keeps active carers without availability records, including paid cancellations and night visits', () => {
    const rows = [
      visit('Carer, Current (GH30)', 3, {
        'Actual Start Date And Time': '2026-10-06T22:00:00',
        'Actual End Date And Time': '2026-10-07T01:00:00',
      }),
      visit('Current Carer', 2, { 'Cancellation Description': 'Cancelled - Charge and Pay' }),
    ];
    const summary = buildGhLossWeeklyRawSummary(rows, roster('Ms Current Carer'));
    expect(Object.keys(summary.targets)).toEqual([normalizeName('Current Carer')]);
    expect(summary.scheduled[normalizeName('Current Carer')]).toBe(5);
    expect(calculateGhLossTotal({}, summary)).toBe(25);
  });

  it('rebuilds eligibility from each import rather than carrying forward earlier targets', () => {
    const rows = [visit('Leaving, Carer (30GH)'), visit('Staying, Carer (30GH)')];
    const before = buildGhLossWeeklyRawSummary(rows, roster('Leaving Carer', 'Staying Carer'));
    const after = buildGhLossWeeklyRawSummary(rows, roster('Staying Carer'));
    expect(Object.keys(before.targets)).toHaveLength(2);
    expect(Object.keys(after.targets)).toEqual([normalizeName('Staying Carer')]);
    expect(Object.keys(before.targets)).toHaveLength(2);
  });

  it('does not create obligations from template-only names or from an empty roster', () => {
    const rows = [visit('Current, Carer (30GH)', 2, {
      'Template Employee Name': 'Former, Carer (40GH)',
    })];
    const summary = buildGhLossWeeklyRawSummary(rows, roster('Current Carer'));
    expect(Object.keys(summary.targets)).toEqual([normalizeName('Current Carer')]);
    expect(buildGhLossWeeklyRawSummary(rows, roster())).toEqual({ targets: {}, scheduled: {} });
  });

  it('preserves cross-branch credits and foreign-carer exclusions for eligible carers', () => {
    const key = normalizeName('Current Carer');
    const summary = buildGhLossWeeklyRawSummary([visit('Current, Carer (30GH)')], roster('Current Carer'));
    expect(calculateGhLossTotal({}, summary, { [key]: { hours: 8, branches: { other: 8 } } })).toBe(20);
    expect(calculateGhLossTotal({}, summary, undefined, [key])).toBe(0);
  });
});
