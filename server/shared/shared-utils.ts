
// Shared utilities to prevent duplicate logic across modules

// ============ NAME NORMALIZATION ============
export function normalizeName(name: string): string {
  if (!name || name === "undefined" || name === "null") return "";
  let s = String(name).toLowerCase();
  s = s.replace(/\(.*?\)/g, ""); // remove parentheses content
  s = s.replace(/[^a-z\s]/g, " "); // keep letters and spaces
  s = s.replace(/\b(mr|mrs|miss|ms|dr)\b/g, " "); // remove titles
  s = s.replace(/\s+/g, " ").trim();
  return s.split(" ").filter(Boolean).sort().join(" ");
}

// ============ TIME CONVERSION ============
export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  let time = timeStr;
  if (timeStr.includes('T')) {
    time = timeStr.split('T')[1].split(':').slice(0, 2).join(':');
  }
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ============ VISIT FILTERING ============
export function isCancellationBlank(value: any): boolean {
  const s = (value ?? "").toString().trim().toLowerCase();
  return s === "" || s === "(blank)" || s === "na" || s === "n/a";
}

export function isSecondaryMultipleCare(serviceType: string): boolean {
  if (!serviceType) return false;
  const lower = serviceType.toLowerCase();
  return lower.includes("multiple care (secondary)") ||
         lower.includes("secondary") ||
         lower.includes("multiple care - secondary") ||
         lower.includes("(secondary)");
}

// ============ POSTCODE NORMALIZATION ============
export function normalizePostcode(pc: string): string {
  if (!pc) return "";
  const s = pc.toUpperCase().replace(/\s+/g, "");
  if (s.length < 5 || s.length > 7) return pc.toUpperCase().trim();
  return s.slice(0, s.length - 3) + " " + s.slice(-3);
}
