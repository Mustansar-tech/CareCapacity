// node tests/scheduling-travel-regression.mjs — no real API calls or quota use.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry, mocks = {}) {
  const bundle = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'isolated-dependencies', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'mock' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const location = i => ({ lat: 55 + i / 1000, lng: -4 });
const { prefetchScheduleTravel } = await load('client/src/utils/prefetch-schedule-travel.ts');
const answer = ({ sources, destinations }) => ({
  results: sources.flatMap(from => destinations.map(to => ({
    fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng,
    mode: 'car', durationMinutes: 12, source: 'ors-matrix',
  }))),
  travelSources: { 'ors-matrix': sources.length * destinations.length },
});
const clients = Array.from({ length: 183 }, (_, i) => location(i));
const employees = [{ ...location(183), mode: 'car' }, { ...location(184), mode: 'walking' }];
let calls = 0, active = 0, maxActive = 0;
const progress = [];
const large = await prefetchScheduleTravel(employees, clients, async body => {
  assert.ok(body.sources.length <= 50 && body.destinations.length <= 50);
  assert.ok(body.sources.length * body.destinations.length <= 2500);
  calls++;
  maxActive = Math.max(maxActive, ++active);
  await Promise.resolve();
  active--;
  return answer(body);
}, event => progress.push(event));
assert.equal(calls, 16);
assert.equal(maxActive, 1);
assert.equal(large.results.length, 184 ** 2);
assert.equal(new Set(large.results.map(r => `${r.fromLat},${r.fromLng}-${r.toLat},${r.toLng}`)).size, 184 ** 2);
assert.deepEqual(progress.at(-1), { completed: 16, total: 16 });
for (const request of [
  async () => { throw new Error('provider unavailable'); },
  async () => ({ results: [] }),
  async body => ({ results: answer(body).results.map(r => ({ ...r, durationMinutes: NaN })) }),
  async body => ({ results: answer(body).results.map(r => ({ ...r, fromLat: 0 })) }),
  async body => ({ results: Array(4).fill(answer(body).results[0]) }),
]) await assert.rejects(prefetchScheduleTravel([{ ...location(0), mode: 'car' }], [location(1)], request, () => {}),
  /Generation stopped without replacing your saved schedule/);
let attempted = 0;
await assert.rejects(prefetchScheduleTravel(employees, clients, async body => {
  if (++attempted === 2) throw new Error('quota exhausted');
  return answer(body);
}, () => {}), /block 2\/16 failed/);
await prefetchScheduleTravel([{ ...location(0), mode: 'On Foot' }], clients,
  async () => assert.fail('No car request expected'), () => {});
assert.equal((await prefetchScheduleTravel([{ ...location(0), mode: 'Driver' }],
  [location(0), location(1), location(1)], async body => answer(body), () => {})).results.length, 4);
console.log('PASS: 16 sequential bounded blocks cover every large-branch route; progress, mode handling, deduplication and saved-schedule protection');

globalThis.__block = { allowed: true, valid: true, keys: true };
const { scheduleTravelBlock } = await load('server/controllers/travel-times.controller.ts', {
  '../utils/helpers': `export async function resolveBranch(){if(!globalThis.__block.allowed)throw new Error('403');}
    export const isUkBst=()=>false,ukScheduleTimeToUtc=()=>new Date();`,
  '../infrastructure/logger': 'export const logger={info:()=>{},warn:()=>{}};',
  '../features/travel/travel-time-service': `export class TravelTimeService {
    constructor(max,soft,timeout){if(timeout!==20000)throw new Error('timeout changed');}
    hasCarMatrixKey(){return globalThis.__block.keys;}
    async carMatrixBatch(){}
    hasValidRoadResponse(){return globalThis.__block.valid;}
    getCachedTravelTime(){return null;}
    getSourceStats(){return {};}
  } export const travelTimeService={};`,
});
async function block(body) {
  const res = { statusCode: 200, status(code){this.statusCode=code;return this;},json(body){this.body=body;} };
  await scheduleTravelBlock({ body }, res);
  return res;
}
for (const sources of [[], Array(51).fill(location(0)), [{ lat: NaN, lng: -4 }], [{ lat: 91, lng: -4 }], ['invalid']])
  assert.equal((await block({ sources, destinations: [location(1)] })).statusCode, 400);
globalThis.__block.allowed = false;
await assert.rejects(block({ sources: [location(0)], destinations: [location(1)] }), /403/);
globalThis.__block.allowed = true;
globalThis.__block.keys = false;
assert.equal((await block({ sources: [location(0)], destinations: [location(1)] })).statusCode, 503);
globalThis.__block.keys = true;
globalThis.__block.valid = false;
assert.equal((await block({ sources: [location(0)], destinations: [location(1)] })).statusCode, 503);
globalThis.__block.valid = true;
assert.equal((await block({ sources: [location(0)], destinations: [location(1)] })).body.results[0].durationMinutes, 9999);
delete globalThis.__block;
console.log('PASS: 50-location validation, branch authorization, provider failure versus valid unreachable routes');

const { TravelTimeService, withIsolatedTravelService, travelTimeService } = await load('server/features/travel/travel-time-service.ts', {
  '../../storage': 'export const storage={};',
  '../../infrastructure/logger': 'export const logger={info:()=>{},warn:()=>{},debug:()=>{}};',
  './routing-usage': 'export async function reserveRoutingRequest(){return 0;} export async function blockRoutingEndpoint(){}',
});
const originalFetch = globalThis.fetch, originalTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms >= 1000 ? 0 : ms, ...args);
const routing = () => {
  const s = new TravelTimeService(45, undefined, 20);
  s.ORS_API_KEY = 'test-placeholder'; s.MAPBOX_API_KEY = 'test-placeholder';
  return s;
};
const json = data => new Response(JSON.stringify(data), { status: 200 });
const directions = () => json({ routes: [{ duration: 600, distance: 1000, summary: { duration: 600, distance: 1000 } }] });
let endpoints = [];
try {
  globalThis.fetch = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(!url.includes('directions-matrix'), 'Paid Matrix must never be called');
    endpoints.push(url.includes('/matrix/') ? 'ors-matrix' : url.includes('mapbox') ? 'mapbox-directions' : 'ors-directions');
    if (url.includes('/matrix/')) {
      const body = JSON.parse(options.body);
      return json({ durations: body.sources.map(() => body.destinations.map(() => 600)),
        distances: body.sources.map(() => body.destinations.map(() => 1000)) });
    }
    return directions();
  };
  const s = routing();
  await s.carMatrixBatch(Array.from({ length: 123 }, (_, i) => location(i)), [location(150)]);
  assert.deepEqual(endpoints, ['ors-matrix', 'ors-matrix', 'ors-matrix'], 'Enquiries must batch 123 sources into 50/50/23');
  assert.equal(s.getCachedTravelTime(location(122), location(150), 'car').source, 'ors-matrix');
  await s.carMatrixBatch([location(122)], [location(150)]);
  assert.equal(endpoints.length, 3, 'Repeat lookups within the same run do not spend quota');

  endpoints = [];
  globalThis.fetch = async (url, options) => {
    endpoints.push(url.includes('mapbox') ? 'mapbox-directions' : 'ors-directions');
    if (!url.includes('mapbox')) {
      await new Promise(resolve => originalTimeout(resolve, 25));
      assert.equal(options.signal.aborted, true);
      throw new Error('ORS timeout');
    }
    return directions();
  };
  const single = routing();
  await single.carMatrixBatch([location(0)], [location(20)]);
  assert.deepEqual(endpoints, ['ors-directions', 'mapbox-directions']);
  assert.equal(single.getCachedTravelTime(location(0), location(20), 'car').source, 'mapbox');

  endpoints = [];
  globalThis.fetch = async url => {
    endpoints.push(url.includes('/matrix/') ? 'ors-matrix' : 'ors-directions');
    return url.includes('/matrix/') ? new Response('matrix limit reached', { status: 429 }) : directions();
  };
  const smallFallback = routing();
  await smallFallback.carMatrixBatch([location(0), location(1)], [location(20)]);
  assert.deepEqual(endpoints, ['ors-matrix', 'ors-directions', 'ors-directions']);
  assert.equal(smallFallback.getCachedTravelTime(location(1), location(20), 'car').source, 'ors');

  endpoints = [];
  globalThis.fetch = async url => { endpoints.push(url); return new Response('quota reached', { status: 429 }); };
  await assert.rejects(routing().carMatrixBatch(Array.from({ length: 50 }, (_, i) => location(i)), [location(150)]),
    /limit/);
  assert.equal(endpoints.length, 1, 'Bulk outage must not explode into paid matrix or thousands of Directions calls');
  await assert.rejects(routing().carMatrixBatch([location(0)], [location(20)]), /limit/);
  assert.ok(endpoints.every(url => !url.includes('directions-matrix')));

  globalThis.fetch = async () => json({ durations: [[null], [null]], distances: [[null], [null]] });
  const unreachable = routing();
  await unreachable.carMatrixBatch([location(0), location(1)], [location(20)]);
  assert.equal(unreachable.hasValidRoadResponse(), true);
  assert.equal(unreachable.getCachedTravelTime(location(0), location(20), 'car'), null);
  let scopedA, scopedB;
  await Promise.all([
    withIsolatedTravelService(async () => { scopedA = travelTimeService._sessionCache; await Promise.resolve(); assert.equal(travelTimeService._sessionCache, scopedA); }),
    withIsolatedTravelService(async () => { scopedB = travelTimeService._sessionCache; await Promise.resolve(); assert.equal(travelTimeService._sessionCache, scopedB); }),
  ]);
  assert.notEqual(scopedA, scopedB);
} finally {
  globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout;
}
console.log('PASS: enquiry batching, no Mapbox Matrix, Directions timeout fallback, quota failures, unreachable routes and concurrent request cache isolation');
