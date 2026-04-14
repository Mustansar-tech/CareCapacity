import { logger } from '../../infrastructure/logger';

// ─── Branch detection helpers ─────────────────────────────────────────────────

export function extractBranchFromRow(row: any): string | null {
  const branchColumns = [
    "CAREGiver Franchise",
    "Customer Branch",
    "Branch",
    "Franchise",
    "Office"
  ];

  for (const col of branchColumns) {
    if (row[col]) {
      return String(row[col]).trim();
    }
  }

  return null;
}

export function normalizeBranchName(branchName: string): string {
  const normalized = branchName.toLowerCase().trim();

  const branchMap: Record<string, string> = {
    'north lanarkshire & glasgow east': 'north-lanarkshire',
    'north lanarkshire': 'north-lanarkshire',
    'glasgow east': 'north-lanarkshire',
    'glasgow north': 'glasgow-north',
    'glasgow south': 'glasgow-south',
    'stirling & falkirk': 'stirling-falkirk',
    'stirling': 'stirling-falkirk',
    'falkirk': 'stirling-falkirk',
    'perthshire': 'perthshire',
    'perth': 'perthshire',
    'south ayrshire': 'south-ayrshire',
    'ayrshire': 'south-ayrshire',
    'ayr': 'south-ayrshire',
    'aberdeen': 'aberdeen',
    'east lothian & midlothian': 'east-lothian',
    'east lothian': 'east-lothian',
    'midlothian': 'east-lothian',
    'scottish borders': 'scottish-borders',
    'borders': 'scottish-borders',
    'west fife and kinross': 'west-fife-kinross',
    'west fife & kinross': 'west-fife-kinross',
    'west fife': 'west-fife-kinross',
    'kinross': 'west-fife-kinross',
    'home instead west fife and kinross': 'west-fife-kinross',
  };

  return branchMap[normalized] || normalized.replace(/\s+/g, '-');
}

// ─── Postcode normalization ───────────────────────────────────────────────────

export function normalisePostcode(pc: string) {
  if (!pc) return "";
  const s = pc.toUpperCase().replace(/\s+/g, "");
  if (s.length < 5 || s.length > 7) return pc.toUpperCase().trim();
  return s.slice(0, s.length - 3) + " " + s.slice(-3);
}

// ─── Transport mode normalization ─────────────────────────────────────────────

export function toTransportMode(raw: string | null | undefined): 'car' | 'walking' | 'public' | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase().trim();
  if (normalized.includes('car') || normalized.includes('driver') || normalized.includes('driv')) {
    return 'car';
  }
  if (normalized.includes('walk') || normalized.includes('pedestrian') || normalized.includes('foot')) {
    return 'walking';
  }
  if (normalized.includes('public') || normalized.includes('bus') || normalized.includes('train')) {
    return 'public';
  }
  return 'car';
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

export async function geocodeWithFallback(postcode: string, storage: any, branchId: string): Promise<any> {
  const normalizedPostcode = postcode.trim().toUpperCase();

  const cached = await storage.getGeocode(branchId, `postcode:${normalizedPostcode}`);
  if (cached) {
    return {
      query: normalizedPostcode,
      type: 'postcode',
      lat: cached.lat,
      lng: cached.lng,
      source: 'cache',
      approximate: false
    };
  }

  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(normalizedPostcode)}`);
    const data = await response.json();

    // Active postcode — use result directly.
    if (data.status === 200 && data.result?.latitude != null) {
      const lat = data.result.latitude.toString();
      const lng = data.result.longitude.toString();

      await storage.saveGeocode({
        branchId: branchId!,
        key: `postcode:${normalizedPostcode}`,
        lat,
        lng,
        source: 'postcodes.io'
      });

      return { query: normalizedPostcode, type: 'postcode', lat, lng, source: 'postcodes.io', approximate: false };
    }

    // Terminated postcode — postcodes.io still returns last-known coordinates.
    if (data.status === 404 && data.terminated?.latitude != null) {
      const lat = data.terminated.latitude.toString();
      const lng = data.terminated.longitude.toString();

      logger.info(`Geocoding "${normalizedPostcode}" via terminated postcode coordinates (terminated ${data.terminated.year_terminated}/${data.terminated.month_terminated})`);

      await storage.saveGeocode({
        branchId: branchId!,
        key: `postcode:${normalizedPostcode}`,
        lat,
        lng,
        source: 'postcodes.io-terminated'
      });

      return { query: normalizedPostcode, type: 'postcode', lat, lng, source: 'postcodes.io-terminated', approximate: true };
    }
  } catch (err) {
    logger.warn(`Geocoding API call failed for ${normalizedPostcode}: ${err}`);
  }

  logger.warn(`Geocoding failed for postcode "${normalizedPostcode}" — no coordinates stored`);
  return null;
}
