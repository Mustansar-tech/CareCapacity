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
 * Fixed border color per franchise for the territory map — one per known
 * branch slug, taken from the app's dark brand palette (per user request).
 * Keyed explicitly (not hashed) so colors never collide even as the branch
 * list changes.
 */
export const FRANCHISE_COLORS: Record<string, string> = {
  'aberdeen': '#B71C1C',           // Dark Red
  'south-ayrshire': '#0D47A1',     // Dark Blue
  'perthshire': '#1B5E20',         // Dark Green
  'north-lanarkshire': '#6A1B9A',  // Dark Purple
  'glasgow-south': '#E65100',      // Dark Orange
  'glasgow-north': '#004D40',      // Dark Teal
  'stirling-falkirk': '#AD1457',   // Dark Pink
  'east-lothian': '#5D4037',       // Dark Brown
  'scottish-borders': '#006064',   // Dark Cyan
  'west-fife-kinross': '#827717',  // Dark Olive
};

const FALLBACK_COLORS = Object.values(FRANCHISE_COLORS);

export function getFranchiseColor(branchSlug: string): string {
  if (FRANCHISE_COLORS[branchSlug]) return FRANCHISE_COLORS[branchSlug];
  // Unknown branch (not one of the 10 mapped franchises) — fall back to a
  // stable pick from the same palette so it's still bright and distinct.
  let hash = 0;
  for (let i = 0; i < branchSlug.length; i++) hash = (hash * 31 + branchSlug.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}
