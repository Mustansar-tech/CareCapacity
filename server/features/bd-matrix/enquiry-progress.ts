import { AsyncLocalStorage } from 'node:async_hooks';
import type { EnquiryProgress } from '../../../shared/enquiry-progress';

const progress = new AsyncLocalStorage<{
  value: EnquiryProgress;
  send: (value: EnquiryProgress) => void;
}>();

export function withEnquiryProgress<T>(
  totalWeeks: number,
  send: (value: EnquiryProgress) => void,
  operation: () => Promise<T>,
): Promise<T> {
  return progress.run({
    value: { week: 0, totalWeeks, completedWeeks: 0, travelCompleted: 0, travelTotal: 0 },
    send,
  }, operation);
}

export function reportEnquiryWeek(week: number, completedWeeks: number): void {
  const state = progress.getStore();
  if (!state) return;
  Object.assign(state.value, { week, completedWeeks });
  state.send({ ...state.value });
}

// Totals grow as the matcher discovers uncached routes for subsequent weeks.
// Completed counts reflect successful checks, not timers or guessed progress.
export function planEnquiryTravel(count: number): () => void {
  const state = progress.getStore();
  if (!state || count === 0) return () => {};
  state.value.travelTotal += count;
  state.send({ ...state.value });
  return () => {
    state.value.travelCompleted++;
    state.send({ ...state.value });
  };
}
