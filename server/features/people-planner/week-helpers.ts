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
 * Window: current week + 13 future weeks = 14 weeks total.
 * When includesPrevious is true (fired on a Monday), the previous week is
 * prepended so that the just-completed week is also refreshed.
 *
 * @param firingDate       - The date the sync is firing (or any date in the firing day).
 * @param includesPrevious - Prepend the previous week's Monday (true on Mondays).
 * @returns Array of ISO "YYYY-MM-DD" Monday strings.
 */
export function getWeeksToSync(firingDate: Date, includesPrevious: boolean): string[] {
  const currentMonday = snapToMonday(firingDate);
  const fmt = (d: Date) => d.toISOString().split("T")[0];

  const weeks: string[] = [];
  const cursor = new Date(currentMonday);
  // Current week + 13 future weeks = 14 entries
  for (let i = 0; i < 14; i++) {
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
