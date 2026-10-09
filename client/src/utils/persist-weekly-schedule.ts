import type { InsertWeeklySchedule, WeeklySchedule } from '@shared/schema';
import { apiRequest, queryClient } from '@/lib/queryClient';

type ScheduleSavePayload = Pick<InsertWeeklySchedule,
  'weekStartDate' | 'weekEndDate' | 'scheduleData' | 'unallocatedVisits' | 'metrics'>;

/** Update the displayed week's cache only after the database acknowledges the save. */
export async function persistWeeklySchedule(payload: ScheduleSavePayload): Promise<WeeklySchedule> {
  const response = await apiRequest('POST', '/api/weekly-schedule/save', payload);
  const persisted: WeeklySchedule = await response.json();
  const queryKey = ['/api/weekly-schedule', payload.weekStartDate];
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(queryKey, persisted);
  void queryClient.invalidateQueries({ queryKey: ['/api/weekly-schedule/latest'] });
  return persisted;
}
