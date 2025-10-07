// Shared name normalization utility
// Used for matching employee names across different formats

export function normalizeName(name: string): string {
  if (!name || name === "undefined" || name === "null") return "";
  let s = String(name).toLowerCase();
  s = s.replace(/\(.*?\)/g, ""); // remove parentheses content
  s = s.replace(/[^a-z\s]/g, " "); // keep letters and spaces
  s = s.replace(/\b(mr|mrs|miss|ms|dr)\b/g, " "); // remove titles
  s = s.replace(/\s+/g, " ").trim();
  return s.split(" ").filter(Boolean).sort().join(" ");
}

// Check if two names match using normalized comparison
export function namesMatch(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  const normalized1 = normalizeName(name1);
  const normalized2 = normalizeName(name2);
  return normalized1 === normalized2;
}
