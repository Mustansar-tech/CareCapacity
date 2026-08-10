/**
 * Real public-facing Home Instead franchise/territory names for each Scottish
 * branch, as opposed to the shorter internal display names used elsewhere in
 * the app (e.g. "Ayr" vs the real "South Ayrshire and Kilmarnock"). Sourced
 * from Home Instead's public site (homeinstead.co.uk/local-care/scotland).
 * Keyed by the branch's internal slug (the `name` field on the Branch record,
 * not its UUID id).
 */
export const FRANCHISE_REAL_NAMES: Record<string, string> = {
  'aberdeen': 'Aberdeen',
  'south-ayrshire': 'South Ayrshire and Kilmarnock',
  'east-lothian': 'East Lothian and Midlothian',
  'glasgow-north': 'Glasgow North',
  'glasgow-south': 'Glasgow South',
  'north-lanarkshire': 'North Lanarkshire and Glasgow East',
  'perthshire': 'Perthshire',
  'scottish-borders': 'Scottish Borders',
  'stirling-falkirk': 'Stirling and Falkirk',
  'west-fife-kinross': 'West Fife and Kinross',
};

export function getRealFranchiseName(branchSlug: string, fallback: string): string {
  return FRANCHISE_REAL_NAMES[branchSlug] ?? fallback;
}

/**
 * Fixed, hand-picked border color per franchise for the territory map —
 * one per known branch slug, chosen to be visually distinct (evenly spread
 * hues, no near-duplicates) and bright enough to read against the map
 * (no dark/near-black shades). Keyed explicitly (not hashed) so colors never
 * collide even as the branch list changes.
 */
export const FRANCHISE_COLORS: Record<string, string> = {
  'aberdeen': '#f43f5e',           // rose
  'south-ayrshire': '#f97316',     // orange
  'perthshire': '#eab308',         // amber/yellow
  'north-lanarkshire': '#22c55e',  // green
  'glasgow-south': '#10b981',      // emerald
  'glasgow-north': '#06b6d4',      // cyan
  'stirling-falkirk': '#3b82f6',   // blue
  'east-lothian': '#8b5cf6',       // violet
  'scottish-borders': '#d946ef',   // fuchsia
  'west-fife-kinross': '#ec4899',  // pink
};

const FALLBACK_COLORS = ['#f43f5e', '#f97316', '#eab308', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899'];

export function getFranchiseColor(branchSlug: string): string {
  if (FRANCHISE_COLORS[branchSlug]) return FRANCHISE_COLORS[branchSlug];
  // Unknown branch (not one of the 10 mapped franchises) — fall back to a
  // stable pick from the same palette so it's still bright and distinct.
  let hash = 0;
  for (let i = 0; i < branchSlug.length; i++) hash = (hash * 31 + branchSlug.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}
