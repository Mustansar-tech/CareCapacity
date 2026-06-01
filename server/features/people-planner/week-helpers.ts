/**
 * Pure calendar helpers for computing the forward-week sync window.
 * Kept in a separate module so both scheduler.ts and automation-routes.ts
 * can import from here without creating circular dependencies.
 */

/**
 * Snap an arbitrary date to its UTC Monday (start of ISO week).
 */
export function snapToMonday(d: Date): Date {
  const m = new Date(d);
  const day = m.getUTCDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  m.setUTCDate(m.getUTCDate() + diff);
  m.setUTCHours(0, 0, 0, 0);
  return m;
}

/**
 * Returns the last day (UTC) of the given UTC year/month.
 * month is 0-based JS convention. JS Date handles month overflow automatically.
 */
export function lastDayOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0));
}

/**
 * Compute the list of week-start Mondays to sync.
 *
 * @param firingDate   - The date the sync is firing (or any date in the firing day).
 * @param includesPrevious - Include the previous week's Monday (true on Mondays).
 * @returns Array of ISO "YYYY-MM-DD" Monday strings.
 *
 * Window logic:
 *   - Normal weeks  (this Monday is not the last Monday of the month):
 *       window end = last day of next month → typically 5–8 forward Mondays.
 *   - Last week of month (next Monday falls in the following month):
 *       window end = last day of month-after-next → typically 9–13 forward Mondays.
 */
export function getWeeksToSync(firingDate: Date, includesPrevious: boolean): string[] {
  const currentMonday = snapToMonday(firingDate);
  const fmt = (d: Date) => d.toISOString().split("T")[0];

  const nextMonday = new Date(currentMonday);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  const isLastMondayOfMonth = nextMonday.getUTCMonth() !== currentMonday.getUTCMonth();

  const curMonth = currentMonday.getUTCMonth();
  const curYear  = currentMonday.getUTCFullYear();
  const windowEnd = isLastMondayOfMonth
    ? lastDayOfMonth(curYear, curMonth + 2)
    : lastDayOfMonth(curYear, curMonth + 1);

  const weeks: string[] = [];
  const cursor = new Date(currentMonday);
  while (cursor <= windowEnd) {
    weeks.push(fmt(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  if (includesPrevious) {
    const prev = new Date(currentMonday);
    prev.setUTCDate(prev.getUTCDate() - 7);
    weeks.unshift(fmt(prev));
  }

  return weeks;
}
