import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistWeeklySchedule } from '@/utils/persist-weekly-schedule';
import { apiRequest, queryClient } from '@/lib/queryClient';

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn(),
  queryClient: {
    cancelQueries: vi.fn().mockResolvedValue(undefined),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
}));

const payload = {
  weekStartDate: '2026-10-05',
  weekEndDate: '2026-10-11',
  scheduleData: { '2026-10-05': {} },
  unallocatedVisits: [],
  metrics: { totalVisitsAssigned: 0 },
};
const persisted = {
  ...payload,
  id: 'saved-schedule',
  branchId: 'test-branch',
  generatedAt: '2026-10-09T07:43:00.000Z',
};

describe('weekly schedule persistence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('waits for the save before updating the selected-week cache', async () => {
    let confirmSave!: (response: Response) => void;
    vi.mocked(apiRequest).mockReturnValue(new Promise(resolve => { confirmSave = resolve; }));
    const saving = persistWeeklySchedule(payload);
    expect(queryClient.setQueryData).not.toHaveBeenCalled();

    confirmSave(new Response(JSON.stringify(persisted)));
    const result = await saving;
    expect(apiRequest).toHaveBeenCalledWith('POST', '/api/weekly-schedule/save', payload);
    expect(queryClient.cancelQueries).toHaveBeenCalledWith({
      queryKey: ['/api/weekly-schedule', '2026-10-05'],
    });
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      ['/api/weekly-schedule', '2026-10-05'], persisted,
    );
    expect(result.generatedAt).toBe(persisted.generatedAt);
  });

  it('rejects a failed save without marking the generated schedule as persisted', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('500: Database unavailable'));
    await expect(persistWeeklySchedule(payload)).rejects.toThrow('Database unavailable');
    expect(queryClient.setQueryData).not.toHaveBeenCalled();
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('does not replace cached data when the save response is invalid', async () => {
    vi.mocked(apiRequest).mockResolvedValue(new Response('not JSON'));
    await expect(persistWeeklySchedule(payload)).rejects.toThrow();
    expect(queryClient.setQueryData).not.toHaveBeenCalled();
  });
});
