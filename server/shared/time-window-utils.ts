// === Minimal utilities to populate Time Window(s) from Availability ===

// Accepts Excel time serials, Date objects, "HH:mm", or "HH:mm:ss" (optionally with AM/PM).
export function timeToString(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const excelEpoch = new Date(1899, 11, 30);
  const toHHMM = (h: number, m: number) =>
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

  try {
    if (value instanceof Date) return toHHMM(value.getHours(), value.getMinutes());

    if (typeof value === "number") {
      if (value < 1) {
        const totalMin = Math.round(value * 24 * 60);
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        return toHHMM(h, m);
      }
      const d = new Date(excelEpoch.getTime() + value * 86400000);
      return toHHMM(d.getHours(), d.getMinutes());
    }

    if (typeof value === "string") {
      const s = value.trim();
      // HH:mm or HH:mm:ss (optional AM/PM)
      const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])?$/);
      if (m) {
        let h = Number(m[1]);
        const min = Number(m[2]);
        const ampm = m[4]?.toUpperCase();
        if (ampm === "AM" && h === 12) h = 0;
        if (ampm === "PM" && h < 12) h += 12;
        return toHHMM(h, min);
      }
      const d = new Date(s);
      if (!isNaN(d.getTime())) return toHHMM(d.getHours(), d.getMinutes());
    }

    const d = new Date(value as any);
    if (!isNaN(d.getTime())) return toHHMM(d.getHours(), d.getMinutes());
  } catch {
    // ignore
  }
  return "";
}

// Builds a single Time Window string "HH:mm-HH:mm" from common column patterns.
// Uses separate Start/End Time if present; otherwise tries a combined "Time Window" style field.
export function buildTimeWindow(row: Record<string, any>): string {
  const st = timeToString(row["Start Time"]);
  const et = timeToString(row["End Time"]);
  if (st && et) return `${st}-${et}`;

  // fallback: combined cell (e.g., "08:00 - 12:00", "08:00–12:00", "08:00—12:00")
  const keys = Object.keys(row || {});
  const combinedKey =
    keys.find((k) => /^(time\s*window\(s\)?|time\s*window|time\s*range|time)$/i.test(k)) ??
    keys.find((k) => /window/i.test(k));
  if (combinedKey && row[combinedKey]) {
    const txt = String(row[combinedKey]);
    const m = txt.match(/(\d{1,2}:\d{2})\s*[\-–—]\s*(\d{1,2}:\d{2})/);
    if (m) return `${m[1].padStart(5, "0")}-${m[2].padStart(5, "0")}`;
  }

  return "";
}

// Enhanced date parsing for guaranteed hours dates
export function parseGuaranteedDate(value: unknown): Date {
  if (value === null || value === undefined || value === "") {
    return new Date('1970-01-01'); // Invalid date fallback
  }

  try {
    // Handle Excel serial dates (numeric values)
    if (typeof value === "number") {
      const excelEpoch = new Date(1899, 11, 30);
      return new Date(excelEpoch.getTime() + value * 86400000);
    }

    // Handle string dates
    if (typeof value === "string") {
      const trimmed = value.trim();
      
      // Try direct parsing first
      const directDate = new Date(trimmed);
      if (!isNaN(directDate.getTime()) && directDate.getFullYear() > 1970) {
        return directDate;
      }

      // Handle various date formats
      const dateFormats = [
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})/, // MM/DD/YYYY or M/D/YYYY
        /^(\d{4})-(\d{1,2})-(\d{1,2})/, // YYYY-MM-DD
        /^(\d{1,2})-(\d{1,2})-(\d{4})/, // MM-DD-YYYY
      ];

      for (const format of dateFormats) {
        const match = trimmed.match(format);
        if (match) {
          if (format.source.startsWith('^(\\d{4})')) {
            // YYYY-MM-DD format
            return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
          } else {
            // MM/DD/YYYY or MM-DD-YYYY format
            return new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
          }
        }
      }
    }

    // Handle Date objects
    if (value instanceof Date) {
      return value;
    }

    // Last resort: try to convert to Date
    const lastTry = new Date(value as any);
    if (!isNaN(lastTry.getTime())) {
      return lastTry;
    }
  } catch (error) {
    // Date parsing failed silently - returns epoch fallback
  }

  // Return epoch date if all parsing fails
  return new Date('1970-01-01');
}