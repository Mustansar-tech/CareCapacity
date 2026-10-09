// Standalone checks: node tests/scheduling-travel-regression.mjs
// Does not depend on the project's currently incompatible Vite/Vitest versions.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry, mocks = {}) {
  const bundle = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{
      name: 'isolated-test-dependencies',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args =>
          mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, args =>
          ({ contents: mocks[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}

const { prefetchScheduleTravel } = await load('client/src/utils/prefetch-schedule-travel.ts');
const location = index => ({ lat: 55 + index / 1000, lng: -4 });
const answer = ({ sources, destinations }) => ({
  results: sources.flatMap(from => destinations.map(to => ({
    fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng,
    mode: 'car', durationMinutes: 12, source: 'mapbox-matrix',
  }))),
  travelSources: { 'mapbox-matrix': sources.length * destinations.length },
});

// Large branch: every pair in both directions, sequential blocks <=12×12.
let active = 0, maxActive = 0, calls = 0;
const progress = [];
const employees = [{ ...location(183), mode: 'car' }, { ...location(184), mode: 'walking' }];
const clients = Array.from({ length: 183 }, (_, index) => location(index));
const large = await prefetchScheduleTravel(employees, clients, async body => {
  assert.ok(body.sources.length <= 12 && body.destinations.length <= 12);
  maxActive = Math.max(maxActive, ++active);
  calls++;
  await Promise.resolve();
  active--;
  return answer(body);
}, event => progress.push(event));
assert.equal(calls, 256);
assert.equal(maxActive, 1);
assert.equal(large.results.length, 184 ** 2);
assert.equal(large.travelSources['mapbox-matrix'], 184 ** 2);
assert.deepEqual(progress.at(-1), { completed: 256, total: 256 });
assert.equal(new Set(large.results.map(r => `${r.fromLat},${r.fromLng}-${r.toLat},${r.toLng}`)).size, 184 ** 2);

// Home/client duplicates do not multiply calls; legacy driver labels work.
calls = 0;
const deduped = await prefetchScheduleTravel(
  [{ ...location(0), mode: 'Driver' }], [location(0), location(1), location(1)],
  async body => { calls++; return answer(body); }, () => {},
);
assert.equal(calls, 1);
assert.equal(deduped.results.length, 4);

// Walker/public-only generations retain their existing local estimates.
await prefetchScheduleTravel([{ ...location(0), mode: 'On Foot' }, { ...location(1), mode: 'Public Transport' }],
  clients, async () => assert.fail('No car API requests expected'), () => {});

// Failure/malformed/missing/duplicate responses stop, rather than returning a partial cache.
for (const request of [
  async () => { throw new Error('503 provider unavailable'); },
  async () => ({ results: [] }),
  async body => ({ results: answer(body).results.map(r => ({ ...r, durationMinutes: NaN })) }),
  async body => ({ results: answer(body).results.map(r => ({ ...r, fromLat: 0 })) }),
  async body => ({ results: Array(4).fill(answer(body).results[0]) }),
]) {
  await assert.rejects(
    prefetchScheduleTravel([{ ...location(0), mode: 'car' }], [location(1)], request, () => {}),
    /Generation stopped without replacing your saved schedule/,
  );
}
let attempted = 0;
await assert.rejects(prefetchScheduleTravel(employees, clients, async body => {
  if (++attempted === 2) throw new Error('network failure');
  return answer(body);
}, () => {}), /block 2\/256 failed/);
assert.equal(attempted, 2);
console.log('PASS: large-branch coverage, sequential requests, progress, mode handling, deduplication, fail-closed responses');

// Exercise the real controller with isolated branch authorization and routing dependencies.
globalThis.__roadTest = { allowed: true, valid: true, keys: true, calls: 0 };
const { scheduleTravelBlock } = await load('server/controllers/travel-times.controller.ts', {
  '../utils/helpers': `export async function resolveBranch() { if (!globalThis.__roadTest.allowed) throw new Error('403 denied'); return 'test'; }
    export const isUkBst=()=>false, ukScheduleTimeToUtc=()=>new Date();`,
  '../infrastructure/logger': 'export const logger={info:()=>{},warn:()=>{}};',
  '../features/travel/travel-time-service': `export class TravelTimeService {
    constructor(max, soft, timeout) { if(timeout!==20000) throw new Error('timeout missing'); }
    hasCarMatrixKey(){return globalThis.__roadTest.keys;}
    async carMatrixBatch(){globalThis.__roadTest.calls++;}
    hasValidRoadResponse(){return globalThis.__roadTest.valid;}
    getCachedTravelTime(){return globalThis.__roadTest.cached ? {durationMinutes:12,source:'mapbox-matrix'} : null;}
    getSourceStats(){return {};}
  } export const travelTimeService={};`,
});
async function controller(body) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await scheduleTravelBlock({ body }, res);
  return res;
}
for (const sources of [[], Array(13).fill(location(0)), [{ lat: NaN, lng: -4 }], [{ lat: 91, lng: -4 }], ['invalid']]) {
  assert.equal((await controller({ sources, destinations: [location(1)] })).statusCode, 400);
}
assert.equal(globalThis.__roadTest.calls, 0);
globalThis.__roadTest.allowed = false;
await assert.rejects(controller({ sources: [location(0)], destinations: [location(1)] }), /403 denied/);
globalThis.__roadTest.allowed = true;
globalThis.__roadTest.keys = false;
assert.equal((await controller({ sources: [location(0)], destinations: [location(1)] })).statusCode, 503);
globalThis.__roadTest.keys = true;
globalThis.__roadTest.valid = false;
assert.equal((await controller({ sources: [location(0)], destinations: [location(1)] })).statusCode, 503);
globalThis.__roadTest.valid = true;
const unreachable = await controller({ sources: [location(0)], destinations: [location(1)] });
assert.equal(unreachable.statusCode, 200);
assert.equal(unreachable.body.results[0].durationMinutes, 9999);
globalThis.__roadTest.cached = true;
const success = await controller({ sources: [location(0)], destinations: [location(1)] });
assert.equal(success.body.results[0].durationMinutes, 12);
delete globalThis.__roadTest;
console.log('PASS: controller limits, branch authorization, provider failure vs genuinely unreachable routes');

// Real routing service: primary/backup order, opt-in upstream timeout, unchanged defaults.
const { TravelTimeService } = await load('server/features/travel/travel-time-service.ts', {
  '../../storage': 'export const storage={};',
  '../../infrastructure/logger': 'export const logger={info:()=>{},warn:()=>{}};',
});
const originalFetch = globalThis.fetch;
try {
  const service = new TravelTimeService(45, undefined, 20);
  service.MAPBOX_API_KEY = 'test-placeholder';
  service.ORS_API_KEY = 'test-placeholder';
  const endpoints = [];
  globalThis.fetch = async (url, options) => {
    endpoints.push(url.includes('mapbox') ? 'mapbox' : 'ors');
    assert.ok(options.signal instanceof AbortSignal);
    if (url.includes('mapbox')) {
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(options.signal.aborted, true);
      throw new Error('test timeout');
    }
    return { ok: true, json: async () => ({ routes: [{ summary: { duration: 600, distance: 1000 } }] }) };
  };
  await service.carMatrixBatch([location(0)], [location(1)]);
  assert.deepEqual(endpoints, ['mapbox', 'ors']);
  assert.equal(service.getCachedTravelTime(location(0), location(1), 'car').durationMinutes, 10);
  assert.equal(service.hasValidRoadResponse(), true);
  const legacy = new TravelTimeService();
  legacy.MAPBOX_API_KEY = 'test-placeholder';
  globalThis.fetch = async (url, options) => {
    assert.equal(options.signal, undefined);
    return { ok: true, json: async () => ({ routes: [{ duration: 600, distance: 1000 }] }) };
  };
  await legacy.fetchMapboxDirections(location(0), location(1));

  const matrixService = new TravelTimeService(45, undefined, 20_000);
  matrixService.MAPBOX_API_KEY = 'test-placeholder';
  matrixService.ORS_API_KEY = undefined;
  globalThis.fetch = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ durations: [[null], [null]], distances: [[null], [null]] }) };
  };
  await matrixService.carMatrixBatch([location(0), location(1)], [location(2)]);
  assert.equal(matrixService.hasValidRoadResponse(), true, 'Valid null routes are not provider failures');
  assert.equal(matrixService.getCachedTravelTime(location(0), location(2), 'car'), null);
  matrixService.resetSourceStats();
  assert.equal(matrixService.hasValidRoadResponse(), false);
  globalThis.fetch = async () => ({
    ok: true, json: async () => ({ durations: [], distances: [] }),
  });
  await matrixService.carMatrixBatch([location(0), location(1)], [location(2)]);
  assert.equal(matrixService.hasValidRoadResponse(), false, 'Malformed matrices must not masquerade as unreachable routes');
  assert.equal(new TravelTimeService().getCachedTravelTime(location(0), location(1), 'car'), null, 'Request caches remain isolated');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('PASS: existing Mapbox→ORS fallback, timeout abort signal, legacy defaults, null/malformed matrices, isolated caches');
