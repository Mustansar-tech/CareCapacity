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
  'aberdeen': '#0A0A0A',           // Midnight Black
  'south-ayrshire': '#1A1D21',     // Rich Charcoal
  'perthshire': '#2A2F36',         // Graphite
  'north-lanarkshire': '#0B1F3A',  // Deep Navy
  'glasgow-south': '#14213D',      // Oxford Blue
  'glasgow-north': '#1E293B',      // Dark Slate
  'stirling-falkirk': '#0F3D2E',   // Forest Green
  'east-lothian': '#4A0E1A',       // Deep Burgundy
  'scottish-borders': '#312244',   // Dark Plum
  'west-fife-kinross': '#3B2414',  // Espresso Brown
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
