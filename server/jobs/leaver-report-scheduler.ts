/**
 * Monthly Leaver Report Scheduler
 *
 * Re-arms daily at 08:00 UTC. On the 1st of each month it sends the leaver
 * report for the previous calendar month. Idempotent — safe to restart.
 */

import { logger } from '../infrastructure/logger';
import { sendLeaverReport } from './leaver-report';

let timer: ReturnType<typeof setTimeout> | null = null;

function nextDailyFireUTC(targetHour = 8): Date {
  const now = new Date();
  const candidate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    targetHour, 0, 0, 0,
  ));
  if (candidate <= now) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

async function runDaily(): Promise<void> {
  const now = new Date();
  const isFirstOfMonth = now.getUTCDate() === 1;

  if (!isFirstOfMonth) {
    logger.info('Leaver report scheduler: not the 1st — skipping', {
      utcDate: now.toISOString(),
    });
    return;
  }

  logger.info('Leaver report scheduler: 1st of month — sending report', {
    utcDate: now.toISOString(),
  });

  try {
    const result = await sendLeaverReport();
    logger.info('Leaver report scheduler: done', result);
  } catch (err) {
    logger.error('Leaver report scheduler: send failed', err instanceof Error ? err : undefined);
  }
}

function armTimer(): void {
  if (timer) clearTimeout(timer);

  const next = nextDailyFireUTC();
  const delay = next.getTime() - Date.now();

  logger.info('Leaver report scheduler armed', {
    nextRunAt: next.toISOString(),
    delayHours: +(delay / 1000 / 60 / 60).toFixed(2),
  });

  timer = setTimeout(async () => {
    try {
      await runDaily();
    } finally {
      armTimer();
    }
  }, delay);

  timer!.unref?.();
}

export function initLeaverReportScheduler(): void {
  armTimer();
  logger.info('Leaver report scheduler initialised', {
    nextRun: nextDailyFireUTC().toISOString(),
  });
}

export function destroyLeaverReportScheduler(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  logger.info('Leaver report scheduler destroyed');
}
