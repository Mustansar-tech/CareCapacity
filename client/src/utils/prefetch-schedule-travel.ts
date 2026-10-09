type Location = { lat: number; lng: number };
type TravelResult = {
  fromLat: number; fromLng: number; toLat: number; toLng: number;
  mode: string; durationMinutes: number; source: string;
};
export type TravelPrefetchProgress = { completed: number; total: number };
type BlockResponse = { results: TravelResult[]; travelSources?: Record<string, number> };

// Match the backend's mode normalization, including legacy labels.
function isCarMode(raw: string): boolean {
  const mode = raw.toLowerCase().trim();
  if (mode.includes('car') || mode.includes('driv')) return true;
  if (['public', 'bus', 'train', 'transit', 'walk', 'foot', 'pedestrian'].some(label => mode.includes(label))) return false;
  return true;
}

export async function prefetchScheduleTravel(
  employees: Array<Location & { mode: string }>,
  clients: Location[],
  requestBlock: (body: { sources: Location[]; destinations: Location[] }) => Promise<BlockResponse>,
  onProgress: (progress: TravelPrefetchProgress) => void,
): Promise<BlockResponse> {
  const carHomes = employees.filter(employee => isCarMode(employee.mode));
  if (!carHomes.length || !clients.length) return { results: [], travelSources: {} };
  const locations = Array.from(new Map(
    [...clients, ...carHomes].map(({ lat, lng }) => [`${lat},${lng}`, { lat, lng }]),
  ).values());
  const blocks: Location[][] = [];
  for (let index = 0; index < locations.length; index += 12) blocks.push(locations.slice(index, index + 12));
  const total = blocks.length ** 2;
  const results: TravelResult[] = [];
  const travelSources: Record<string, number> = {};
  let completed = 0;
  onProgress({ completed, total });
  // Sequential requests preserve the existing provider rate-limit spacing.
  // Both directions and home-return journeys are included, as before.
  for (const sources of blocks) {
    for (const destinations of blocks) {
      try {
        const block = await requestBlock({ sources, destinations });
        if (!Array.isArray(block.results) || block.results.length !== sources.length * destinations.length ||
          block.results.some(result => result.mode !== 'car' ||
            !Number.isFinite(result.durationMinutes) || result.durationMinutes < 0 ||
            !sources.some(from => from.lat === result.fromLat && from.lng === result.fromLng) ||
            !destinations.some(to => to.lat === result.toLat && to.lng === result.toLng)) ||
          new Set(block.results.map(result => `${result.fromLat},${result.fromLng}-${result.toLat},${result.toLng}`)).size !== block.results.length) {
          throw new Error('Incomplete or invalid road-travel response');
        }
        results.push(...block.results);
        for (const [source, count] of Object.entries(block.travelSources ?? {})) {
          travelSources[source] = (travelSources[source] ?? 0) + count;
        }
      } catch (error) {
        throw new Error(`Road-travel block ${completed + 1}/${total} failed. Generation stopped without replacing your saved schedule. ${error instanceof Error ? error.message : ''}`);
      }
      onProgress({ completed: ++completed, total });
    }
  }
  return { results, travelSources };
}
