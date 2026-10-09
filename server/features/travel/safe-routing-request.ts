import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { RoutingError } from './routing-error';
import { reserveRoutingRequest, blockRoutingEndpoint, type RoutingEndpoint } from './routing-usage';

const requests = new AsyncLocalStorage<{ signal: AbortSignal; deadline: number }>();

export function withRoutingDeadline<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  return requests.run({ signal, deadline: Date.now() + 90000 }, operation);
}

export function assertRoutingActive(): void {
  const context = requests.getStore();
  if (context && (context.signal.aborted || Date.now() >= context.deadline)) {
    throw new RoutingError('ROUTING_REQUEST_TIMEOUT',
      'The travel check was cancelled or took too long. No incomplete result was saved. Please retry.', 504);
  }
}

export async function safeRoutingRequest(
  endpoint: RoutingEndpoint, url: string, options: RequestInit = {}, timeoutMs = 20000,
): Promise<Response> {
  assertRoutingActive();
  const waitMs = await reserveRoutingRequest(endpoint);
  const context = requests.getStore();
  try {
    await sleep(waitMs, undefined, { signal: context?.signal });
    assertRoutingActive();
    const remaining = context ? context.deadline - Date.now() : timeoutMs;
    const timeout = AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, remaining)));
    const signal = context ? AbortSignal.any([timeout, context.signal]) : timeout;
    const response = await fetch(url, { ...options, signal });
    // Read the body within the same deadline, not just the response headers.
    const body = await response.text();
    if (!response.ok) {
      if (response.status === 429) {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        const retry = Number(response.headers.get('retry-after'));
        const seconds = Number.isFinite(reset) && reset > Date.now() / 1000
          ? Math.ceil(reset - Date.now() / 1000)
          : (retry > 0 ? retry : 60);
        await blockRoutingEndpoint(endpoint, seconds);
      } else if (response.status >= 500) {
        await blockRoutingEndpoint(endpoint, 30);
      } else if (response.status === 401 || response.status === 403) {
        await blockRoutingEndpoint(endpoint, 300);
      }
      throw new RoutingError(response.status === 429 ? 'ROUTING_PROVIDER_LIMIT' : 'ROUTING_PROVIDER_ERROR',
        response.status === 429
          ? 'The routing provider has reached its limit. Please wait for the quota to reset; no paid matrix fallback was used.'
          : 'The routing provider is unavailable. Please retry; no incomplete result was saved.',
        response.status === 429 ? 429 : 503);
    }
    // ORS can return an incorrect remaining quota (including zero) on a
    // successful response. Only actual 429 responses establish quota cooldowns;
    // our shared request ledger continues to enforce the free-tier budget.
    return new Response(body, { status: response.status, headers: response.headers });
  } catch (error) {
    if (error instanceof RoutingError) throw error;
    // A short shared cooldown avoids repeatedly spending the full timeout on
    // the same unavailable provider across a multi-pair check or concurrent users.
    if (!context?.signal.aborted) await blockRoutingEndpoint(endpoint, 30);
    throw new RoutingError('ROUTING_PROVIDER_TIMEOUT',
      'The routing provider timed out or could not be reached. No incomplete result was saved. Please retry.', 504);
  }
}
