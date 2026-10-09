export interface EnquiryProgress {
  week: number;
  totalWeeks: number;
  completedWeeks: number;
  travelCompleted: number;
  travelTotal: number;
}

export type EnquiryStreamEvent<T = unknown> =
  | { type: 'progress'; progress: EnquiryProgress }
  | { type: 'heartbeat' }
  | { type: 'result'; result: T }
  | { type: 'error'; message: string; code?: string };
