import type { EnquiryProgress, EnquiryStreamEvent } from '@shared/enquiry-progress';

/** Read real server progress, rejecting interrupted or incomplete searches. */
export async function searchEnquiryWithProgress<T>(
  request: (signal: AbortSignal) => Promise<Response>,
  onProgress: (progress: EnquiryProgress) => void,
): Promise<T> {
  const cancellation = new AbortController();
  // Whole search is bounded, but each streamed update refreshes the idle timer.
  const overall = setTimeout(() => cancellation.abort(), 16 * 60 * 1000);
  let idle = setTimeout(() => cancellation.abort(), 100000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await request(cancellation.signal);
    if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
      return await response.json() as T; // Compatibility with an older server.
    }
    if (!response.body) throw new Error('The enquiry progress stream is unavailable.');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let result: T | undefined;
    let latestProgress: EnquiryProgress | undefined;
    const parseLine = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as EnquiryStreamEvent<T>;
      if (event.type === 'error') throw new Error(JSON.stringify({ message: event.message, code: event.code }));
      if (event.type === 'progress') {
        latestProgress = event.progress;
        onProgress(event.progress);
      } else if (event.type === 'result') result = event.result;
      else if (event.type !== 'heartbeat') throw new Error('Unexpected enquiry progress response.');
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(idle);
      idle = setTimeout(() => cancellation.abort(), 100000);
      buffered += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        parseLine(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
      }
    }
    buffered += decoder.decode();
    if (buffered.trim()) parseLine(buffered);
    const weeks = (result as { weeks?: unknown[] } | undefined)?.weeks;
    if (result === undefined || !latestProgress || latestProgress.completedWeeks !== latestProgress.totalWeeks
      || !Array.isArray(weeks) || weeks.length !== latestProgress.totalWeeks) {
      throw new Error('The enquiry ended before all weeks completed. No incomplete result was saved. Please retry.');
    }
    return result;
  } catch (error) {
    if (cancellation.signal.aborted) {
      throw new Error('The enquiry stopped responding or took too long. No incomplete result was saved. Please retry.');
    }
    throw error;
  } finally {
    clearTimeout(overall);
    clearTimeout(idle);
    await reader?.cancel().catch(() => {});
    cancellation.abort();
  }
}
