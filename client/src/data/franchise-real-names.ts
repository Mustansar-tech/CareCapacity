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
