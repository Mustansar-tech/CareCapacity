// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const state = vi.hoisted(() => ({
  delay: 15000,
  failWeek: -1,
  calls: 0,
  bulkLocations: vi.fn(async () => [{ employeeName: 'Test Carer', homeLat: '55', homeLng: '-4' }]),
  individualLocation: vi.fn(),
  auditWrite: vi.fn(async () => {}),
}));
vi.mock('../../server/repositories/audit.repository', () => ({ writeAuditEntry: state.auditWrite }));
vi.mock('../../server/infrastructure/db', () => ({ pool: {} }));
vi.mock('../../server/infrastructure/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../server/utils/helpers', () => ({ resolveBranch: async () => 'test-branch' }));
vi.mock('../../server/pipeline', () => ({ geocodeWithFallback: async () => ({ lat: '55', lng: '-4' }) }));
vi.mock('../../server/storage', () => ({ storage: {
  getAllEmployeeLocations: state.bulkLocations,
  getEmployeeLocationByName: state.individualLocation,
} }));
vi.mock('../../server/repositories/capacity.repository', () => ({
  getWindowedAnalyses: async () => Array.from({ length: 9 }, (_, index) => ({
    weekStartDate: new Date(Date.UTC(2026, 9, 5 + index * 7)).toISOString().slice(0, 10),
    employeeSummaryByDate: {},
  })),
}));
vi.mock('../../server/features/travel/travel-time-service', () => ({
  travelTimeService: { resetSourceStats: vi.fn() },
  withIsolatedTravelService: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('../../server/services/bd-matcher.service', () => ({
  buildScheduleMap: async () => new Map(),
  refineForwardTravelWithORS: async () => {},
  refineReturnHomeTravelWithORS: async () => {},
}));
vi.mock('../../server/features/bd-matrix/multiWeekConsistency', () => ({
  computeConsistentStars: () => ({ '2026-10-05': { test: true } }),
}));
vi.mock('../../server/features/bd-matrix/bdMatcher', async () => {
  const { planEnquiryTravel } = await import('../../server/features/bd-matrix/enquiry-progress');
  const { RoutingError } = await import('../../server/features/travel/routing-error');
  return {
    matchClientEnquiry: vi.fn(),
    matchMultiVisitEnquiry: async (_criteria: unknown, _analysis: unknown, branch: string, storage: any) => {
      state.calls++;
      expect(await storage.getEmployeeLocationByName(branch, 'Test Carer')).toMatchObject({ employeeName: 'Test Carer' });
      expect(await storage.getEmployeeLocationByName(branch, 'Missing Carer')).toBeUndefined();
      const complete = planEnquiryTravel(2);
      await new Promise(resolve => setTimeout(resolve, state.delay));
      if (state.calls === state.failWeek) throw new RoutingError('ROUTING_FREE_LIMIT', 'Allowance exhausted', 429);
      complete(); complete();
      return { totalVisits: 1, visitResults: [{ matches: [] }] };
    },
  };
});

import { bdMatchMultiWeek } from '../../server/controllers/bd-matcher.controller';
import { safeTravel } from '../../server/middleware/safe-travel';
import { preloadEnquiryLocations } from '../../server/features/bd-matrix/enquiry-locations';
import { auditRequests } from '../../server/middleware/audit-requests';

function response() {
  const events: any[] = [];
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    events,
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    statusCode: 200,
    locals: {} as Record<string, unknown>,
    setHeader: vi.fn(),
    flushHeaders() { this.headersSent = true; },
    write(line: string) { events.push(JSON.parse(line)); },
    end() { this.writableEnded = true; this.emit('finish'); },
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  });
}

const request = () => ({ body: {
  clientName: 'Test Enquiry', postcode: 'TEST', weekStartDate: '2026-10-05', stream: true,
  visits: [{ requiredDays: ['Monday'] }],
} }) as Request;

describe('multi-week enquiry stages and progress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.assign(state, { delay: 15000, failWeek: -1, calls: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it('finishes all nine weeks beyond the former 90-second cap, with one bulk location query and real progress', async () => {
    const res = response();
    const run = safeTravel(bdMatchMultiWeek, 15 * 60 * 1000)(request(), res as unknown as Response, vi.fn() as NextFunction);
    await vi.advanceTimersByTimeAsync(140000);
    await run;
    expect(state.calls).toBe(9);
    expect(state.bulkLocations).toHaveBeenCalledTimes(1);
    expect(state.individualLocation).not.toHaveBeenCalled();
    expect(res.events.some(event => event.type === 'heartbeat')).toBe(true);
    const progress = res.events.filter(event => event.type === 'progress').at(-1).progress;
    expect(progress).toMatchObject({ week: 9, completedWeeks: 9, totalWeeks: 9, travelCompleted: 18, travelTotal: 18 });
    const result = res.events.find(event => event.type === 'result').result;
    expect(result.weeks).toHaveLength(9);
    expect(result.recommendedStars).toEqual({ '2026-10-05': { test: true } });
    expect(res.writableEnded).toBe(true);
  });

  it('retains a 90-second individual week bound and never returns partial results', async () => {
    state.delay = 95000;
    const res = response();
    const run = safeTravel(bdMatchMultiWeek, 15 * 60 * 1000)(request(), res as unknown as Response, vi.fn() as NextFunction);
    await vi.advanceTimersByTimeAsync(96000);
    await run;
    expect(state.calls).toBe(1);
    expect(res.events.find(event => event.type === 'error')).toMatchObject({ code: 'ROUTING_REQUEST_TIMEOUT' });
    expect(res.events.some(event => event.type === 'result')).toBe(false);
  });

  it('stops on a routing quota error without presenting earlier weeks as a complete result', async () => {
    state.failWeek = 3;
    const res = response();
    const req = Object.assign(request(), {
      path: '/api/bd-matcher/multi-week', method: 'POST',
      session: { userId: 'test-user' }, get: () => undefined,
      params: {}, query: {},
    });
    let run: Promise<void> | undefined;
    auditRequests(req, res as unknown as Response, () => {
      run = safeTravel(bdMatchMultiWeek, 15 * 60 * 1000)(req, res as unknown as Response, vi.fn() as NextFunction);
    });
    await vi.advanceTimersByTimeAsync(50000);
    await run;
    expect(state.calls).toBe(3);
    expect(res.events.find(event => event.type === 'error')).toMatchObject({ code: 'ROUTING_FREE_LIMIT' });
    expect(res.events.some(event => event.type === 'result')).toBe(false);
    expect(res.statusCode).toBe(200); // Streaming transport was already opened.
    expect(state.auditWrite).toHaveBeenCalledWith(expect.objectContaining({ action: 'REQUEST_FAILED' }));
    expect(JSON.parse(state.auditWrite.mock.calls[0][0].detail)).toMatchObject({ outcome: 'failure' });
  });

  it('preserves cancellation when the browser disconnects between weeks', async () => {
    const res = response();
    const run = safeTravel(bdMatchMultiWeek, 15 * 60 * 1000)(request(), res as unknown as Response, vi.fn() as NextFunction);
    await vi.advanceTimersByTimeAsync(16000);
    res.emit('close');
    await vi.advanceTimersByTimeAsync(15000);
    await run;
    expect(state.calls).toBe(2);
    expect(res.events.some(event => event.type === 'result')).toBe(false);
  });

  it('never shares a location snapshot with another branch', async () => {
    const scoped = await preloadEnquiryLocations({
      getAllEmployeeLocations: state.bulkLocations,
      getEmployeeLocationByName: state.individualLocation,
    } as any, 'test-branch');
    await expect(scoped.getEmployeeLocationByName('other-branch', 'Test Carer')).rejects.toThrow('branch mismatch');
  });
});
