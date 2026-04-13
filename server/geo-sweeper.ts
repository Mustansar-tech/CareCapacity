/**
 * Geo Sweeper — retroactively geocode any client_locations rows that have
 * a postcode but are still missing lat/lng coordinates.
 *
 * Runs once at server startup and is also exposed as an admin endpoint so it
 * can be triggered on-demand after a failed pipeline run.
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

      logger.info(`geo-sweeper: branch ${branchId} — ${ungeocodedClients.length} client(s) missing coordinates`);
      total += ungeocodedClients.length;

      for (const client of ungeocodedClients) {
        const postcode = (client.postcode || '').trim();
        if (!postcode) {
          logger.debug(`geo-sweeper: skipping "${client.clientName}" — no postcode`);
          failed++;
          continue;
        }

        try {
          const result = await geocodeWithFallback(postcode, storage, branchId);
          if (result && result.lat && result.lng) {
            await storage.upsertClientLocation({
              branchId,
              clientName: client.clientName,
              addressLine: client.addressLine || '',
              postcode,
              lat: String(result.lat),
              lng: String(result.lng),
            });
            logger.info(`geo-sweeper: geocoded "${client.clientName}" @ ${postcode} → ${result.lat}, ${result.lng}`);
            geocoded++;
          } else {
            logger.warn(`geo-sweeper: postcodes.io returned no result for "${postcode}" (client: ${client.clientName})`);
            failed++;
          }
        } catch (err) {
          logger.error(`geo-sweeper: error geocoding "${client.clientName}" @ "${postcode}"`, err);
          failed++;
        }
      }
    }

    logger.info(`geo-sweeper: complete — ${geocoded}/${total} geocoded, ${failed} failed`);
  } finally {
    sweepRunning = false;
  }

  return { total, geocoded, failed };
}
