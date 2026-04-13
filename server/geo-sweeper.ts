/**
 * Geo Sweeper — retroactively geocode any client_locations rows that have
 * a postcode but are still missing lat/lng coordinates.
 *
 * Runs once at server startup and is also exposed as an admin endpoint so it
 * can be triggered on-demand after a failed pipeline run.
 *
 * Postcodes are deduplicated before geocoding so that multiple clients at the
 * same address (e.g. a care home) only trigger one API call.
 */
import { geocodeWithFallback } from './pipeline';
import { logger } from './logger';

let sweepRunning = false;

export async function sweepMissingClientGeocode(): Promise<{ total: number; geocoded: number; failed: number }> {
  if (sweepRunning) {
    logger.info('geo-sweeper: already running, skipping duplicate invocation');
    return { total: 0, geocoded: 0, failed: 0 };
  }
  sweepRunning = true;

  let total = 0;
  let geocoded = 0;
  let failed = 0;

  try {
    const { storage } = await import('./storage');
    const branches = await storage.getAllBranches();

    for (const branch of branches) {
      const branchId = branch.id;
      const allClients = await storage.getAllClientLocations(branchId);
      const ungeocodedClients = allClients.filter(c => !c.lat || !c.lng);

      if (ungeocodedClients.length === 0) continue;

      logger.info(`geo-sweeper: branch ${branch.name} — ${ungeocodedClients.length} client(s) missing coordinates`);
      total += ungeocodedClients.length;

      // Group clients by normalised postcode so we only call the API once per postcode
      const byPostcode = new Map<string, typeof ungeocodedClients>();
      const noPostcode: typeof ungeocodedClients = [];

      for (const client of ungeocodedClients) {
        const pc = (client.postcode || '').trim().toUpperCase().replace(/\s+/g, ' ');
        if (!pc) {
          noPostcode.push(client);
        } else {
          if (!byPostcode.has(pc)) byPostcode.set(pc, []);
          byPostcode.get(pc)!.push(client);
        }
      }

      // Clients with no postcode — count as failed immediately
      for (const client of noPostcode) {
        logger.debug(`geo-sweeper: skipping "${client.clientName}" — no postcode`);
        failed++;
      }

      // Geocode each unique postcode once, then save for all clients at that postcode
      for (const [postcode, clients] of byPostcode.entries()) {
        try {
          const result = await geocodeWithFallback(postcode, storage, branchId);
          if (result && result.lat && result.lng) {
            for (const client of clients) {
              await storage.upsertClientLocation({
                branchId,
                clientName: client.clientName,
                addressLine: client.addressLine || '',
                postcode,
                lat: String(result.lat),
                lng: String(result.lng),
              });
              geocoded++;
            }
            if (clients.length > 1) {
              logger.info(`geo-sweeper: geocoded ${clients.length} clients @ ${postcode} → ${result.lat}, ${result.lng}`);
            } else {
              logger.info(`geo-sweeper: geocoded "${clients[0].clientName}" @ ${postcode} → ${result.lat}, ${result.lng}`);
            }
          } else {
            logger.warn(`geo-sweeper: postcodes.io returned no result for "${postcode}" (${clients.map(c => c.clientName).join(', ')})`);
            failed += clients.length;
          }
        } catch (err) {
          logger.error(`geo-sweeper: error geocoding "${postcode}"`, err);
          failed += clients.length;
        }
      }
    }

    logger.info(`geo-sweeper: complete — ${geocoded}/${total} geocoded, ${failed} failed`);
  } finally {
    sweepRunning = false;
  }

  return { total, geocoded, failed };
}
