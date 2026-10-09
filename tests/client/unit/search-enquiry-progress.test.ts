// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { searchEnquiryWithProgress } from '../../../client/src/utils/search-enquiry-progress';

const progress = {
  week: 9, totalWeeks: 9, completedWeeks: 9, travelCompleted: 12, travelTotal: 12,
};
function stream(lines: unknown[], fragment = false) {
  const bytes = new TextEncoder().encode(lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  return new Response(new ReadableStream({
    start(controller) {
      if (fragment) for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      else controller.enqueue(bytes);
      controller.close();
    },
  }), { headers: { 'content-type': 'application/x-ndjson' } });
}

describe('enquiry search progress reader', () => {
  it('reads fragmented UTF-8 progress, heartbeats and a complete result', async () => {
    const update = vi.fn();
    const result = { clientName: 'Test Énquiry', weeks: Array(9).fill({}) };
    await expect(searchEnquiryWithProgress(async () => stream([
      { type: 'heartbeat' }, { type: 'progress', progress }, { type: 'result', result },
    ], true), update)).resolves.toEqual(result);
    expect(update).toHaveBeenCalledWith(progress);
  });
  it('rejects a stream that ends without a final result', async () => {
    await expect(searchEnquiryWithProgress(async () => stream([
      { type: 'progress', progress: { ...progress, completedWeeks: 4 } },
    ]), vi.fn())).rejects.toThrow('No incomplete result was saved');
  });
  it('rejects a result if not all weeks were completed', async () => {
    await expect(searchEnquiryWithProgress(async () => stream([
      { type: 'progress', progress: { ...progress, completedWeeks: 4 } },
      { type: 'result', result: { weeks: [] } },
    ]), vi.fn())).rejects.toThrow('before all weeks completed');
  });
  it('propagates a server routing error rather than returning previous results', async () => {
    await expect(searchEnquiryWithProgress(async () => stream([
      { type: 'progress', progress },
      { type: 'error', code: 'ROUTING_FREE_LIMIT', message: 'Allowance exhausted' },
    ]), vi.fn())).rejects.toThrow('ROUTING_FREE_LIMIT');
  });
  it('rejects a final payload with fewer weeks than the progress promised', async () => {
    await expect(searchEnquiryWithProgress(async () => stream([
      { type: 'progress', progress },
      { type: 'result', result: { weeks: Array(4).fill({}) } },
    ]), vi.fn())).rejects.toThrow('before all weeks completed');
  });
  it('rejects malformed progress instead of saving a partial enquiry', async () => {
    const response = new Response('{bad json}\n', { headers: { 'content-type': 'application/x-ndjson' } });
    await expect(searchEnquiryWithProgress(async () => response, vi.fn())).rejects.toThrow();
  });
});
