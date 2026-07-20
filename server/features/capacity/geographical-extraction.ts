import * as XLSX from "../../shared/xlsx-compat.js";
import { logger } from '../../infrastructure/logger';
import { format } from "date-fns";
import { storage } from "../../storage";
import {
  CLIENT_COLS,
  ADDRESS_COLS_GH,
  pickCol,
  parseDate,
  isCancellationBlank,
  isSecondaryMultipleCare,
} from "../imports/pipeline-utils";
import {
  geocodeWithFallback,
  normalisePostcode,
  toTransportMode,
} from "../imports/geocoding";

export async function extractAndStoreGeographicalData(
  cgData: any[],
  guaranteed: any[],
  branchId: string,
  ghWorkbookBuffer?: Buffer,
  weekStartDate?: string,
): Promise<void> {
  logger.debug(`EXTRACTING GEOGRAPHICAL DATA FOR SCHEDULING OPTIMIZATION...`);
  logger.debug(`CG Data rows to process: ${cgData.length}`);
  logger.debug(`Branch ID: ${branchId}`);

  try {
    const employeeLocationsMap = new Map<string, any>();

    logger.debug(`Starting to iterate through ${cgData.length} CG Data rows...`);
    for (const row of cgData) {
      const employeeName = row["CAREGiver Name"];
      const postcode = row["PostCode"];
      const transportMode = row["TransportModeDescription"]?.toLowerCase();

      const title = pickCol(row, ["Title", "Employee Title", "Title Description"]) || "";
      const titleLower = title.toLowerCase().trim();

      let gender: "male" | "female" | undefined = undefined;
      if (titleLower === "mr") {
        gender = "male";
      } else if (["miss", "ms", "mrs"].includes(titleLower)) {
        gender = "female";
      }

      if (employeeName && postcode) {
        const normalizedTransport = toTransportMode(transportMode);
        const geocoded = await geocodeWithFallback(postcode, storage, branchId);
        const locationData: any = {
          branchId,
          employeeName,
          homePostcode: postcode,
          transportMode: normalizedTransport,
          gender,
        };

        if (geocoded && geocoded.lat && geocoded.lng) {
          locationData.homeLat = geocoded.lat;
          locationData.homeLng = geocoded.lng;
          logger.debug(`Geocoded ${employeeName} at ${postcode}`);
        } else {
          logger.debug(`Could not geocode ${employeeName} at ${postcode}`);
        }

        employeeLocationsMap.set(employeeName, locationData);
      }
    }

    logger.debug(`Employee locations: ${employeeLocationsMap.size} from current upload file`);

    for (const locationData of Array.from(employeeLocationsMap.values())) {
      await storage.upsertEmployeeLocation(locationData);
    }

    // Only prune stale locations when this upload is for the latest (or a newer) week.
    // If an older week is re-uploaded after a newer one exists, skip pruning so the
    // map continues to reflect the most recently processed week.
    let shouldPrune = true;
    if (weekStartDate) {
      try {
        const [latestAnalysis] = await storage.getLatestWeeksAnalyses(branchId, 1);
        if (latestAnalysis && latestAnalysis.weekStartDate > weekStartDate) {
          shouldPrune = false;
          logger.info(
            `Skipping stale-location pruning: uploading week ${weekStartDate} but latest stored week is ${latestAnalysis.weekStartDate}`,
          );
        }
      } catch {
        // If we can't determine the latest week, default to pruning (safe fallback)
      }
    }

    if (shouldPrune && employeeLocationsMap.size > 0) {
      try {
        const activeEmployeeNames = Array.from(employeeLocationsMap.keys());
        const removedEmp = await storage.deleteEmployeeLocationsNotIn(branchId, activeEmployeeNames);
        if (removedEmp > 0) {
          logger.info(`Removed ${removedEmp} care pro location(s) no longer present in the latest export (e.g. terminated care pros)`);
        }
      } catch (err) {
        logger.warn(`Failed to prune stale care pro locations (non-fatal)`, err);
      }
    }

    logger.debug(`Extracting client locations from raw GH Excel workbook`);

    const clientLocationsMap = new Map<string, {
      branchId: string;
      clientName: string;
      addressLine: string;
      postcode: string;
      lat: string | null;
      lng: string | null;
    }>();
    const clientsToGeocode: Array<{
      branchId: string;
      clientName: string;
      addressLine: string;
      postcode: string;
      lat: string | null;
      lng: string | null;
    }> = [];

    let rawGHRows: any[] = [];
    if (ghWorkbookBuffer) {
      const wb = await XLSX.read(ghWorkbookBuffer, { type: 'buffer' });
      const sheetName = wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0];
      const rows2d = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], {
        header: 1,
        raw: true,
        blankrows: false
      }) as any[][];

      const headerIdx = rows2d.findIndex(r => r.some(cell => String(cell ?? '').trim() !== ''));
      if (headerIdx >= 0) {
        const headers = rows2d[headerIdx].map(v => String(v ?? '').trim());
        rawGHRows = rows2d.slice(headerIdx + 1).map(r => {
          const o: Record<string, any> = {};
          headers.forEach((h, i) => (o[h] = r[i]));
          return o;
        });
        logger.debug(`Parsed ${rawGHRows.length} raw GH rows for client location extraction`);
      }
    }

    for (const row of rawGHRows) {
      if (!isCancellationBlank(row["Cancellation Description"])) continue;
      if (isSecondaryMultipleCare(row["Actual Service Type Description"])) continue;

      const clientName = pickCol(row, CLIENT_COLS);

      const ADDRESS_COLS = [
        'Service Location Address',
        'Client Address',
        'Address',
        'Service Address',
        'Location Address'
      ];
      const serviceLocationAddress = pickCol(row, ADDRESS_COLS);

      let postcode = "";
      let addressLine = serviceLocationAddress || "";

      if (serviceLocationAddress && typeof serviceLocationAddress === 'string') {
        const addressStr = serviceLocationAddress.trim();
        logger.debug(`DEBUG: Processing address for ${clientName}: "${addressStr}"`);

        const postcodePatterns = [
          /\b([A-Z]{1,2}[0-9R][0-9A-Z]?\s*[0-9][A-Z]{2})\b/i,
          /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i,
          /([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})$/i,
          /\b([A-Z]{2}\d\s*\d[A-Z]{2})\b/i,
          /\b([A-Z]\d{1,2}\s*\d[A-Z]{2})\b/i,
          /\b([A-Z]{2}\d{1,2}\s*\d[A-Z]{2})\b/i,
        ];

        let postcodeMatch = null;
        for (const pattern of postcodePatterns) {
          postcodeMatch = addressStr.match(pattern);
          if (postcodeMatch) {
            logger.debug(`DEBUG: Postcode pattern matched: ${pattern} -> "${postcodeMatch[1]}"`);
            break;
          }
        }

        if (postcodeMatch) {
          postcode = normalisePostcode(postcodeMatch[1]);
          addressLine = addressStr.replace(postcodeMatch[0], "").trim().replace(/,\s*$/, "").replace(/\s+/g, " ");
          logger.debug(`DEBUG: Extracted postcode "${postcode}" from address, remaining: "${addressLine}"`);
        } else {
          const parts = addressStr.split(',').map(p => p.trim());
          if (parts.length >= 2) {
            const lastPart = parts[parts.length - 1];
            const secondLastPart = parts[parts.length - 2];
            const simplePostcodeCheck = /^[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}$/i;
            if (simplePostcodeCheck.test(lastPart)) {
              postcode = normalisePostcode(lastPart);
              addressLine = parts.slice(0, -1).join(', ');
              logger.debug(`DEBUG: Manual postcode extraction: "${postcode}" from "${lastPart}", address: "${addressLine}"`);
            } else if (simplePostcodeCheck.test(secondLastPart)) {
              postcode = normalisePostcode(secondLastPart);
              addressLine = parts.slice(0, -2).join(', ') + (parts.length > 2 ? ', ' + parts[parts.length - 1] : '');
              logger.debug(`DEBUG: Manual postcode extraction from second-last: "${postcode}", address: "${addressLine}"`);
            } else {
              addressLine = addressStr;
              logger.debug(`DEBUG: Manual parsing failed, no postcode pattern found in parts: ${JSON.stringify(parts)}`);
            }
          } else {
            addressLine = addressStr;
            logger.debug(`DEBUG: No postcode found in address: "${addressStr}" for client: ${clientName}`);
          }
        }
      }

      if (!postcode && row["Postcode"]) postcode = String(row["Postcode"]).trim().toUpperCase();
      if (!postcode && row["Post Code"]) postcode = String(row["Post Code"]).trim().toUpperCase();
      if (!postcode && row["Postal Code"]) postcode = String(row["Postal Code"]).trim().toUpperCase();

      if (clientName) {
        const clientKey = clientName.trim();

        if (!addressLine && !postcode) {
          logger.debug(`Client "${clientKey}" has no address or postcode - will save without geocoding`);
        }

        const existingClient = await storage.getClientLocationByName(branchId, clientKey);

        if (!clientLocationsMap.has(clientKey)) {
          const clientData = {
            branchId,
            clientName: clientKey,
            addressLine: addressLine || "",
            postcode: postcode || "",
            lat: existingClient?.lat || null,
            lng: existingClient?.lng || null,
          };

          clientLocationsMap.set(clientKey, clientData);

          if (addressLine || postcode) {
            if (!existingClient?.lat || !existingClient?.lng) {
              logger.debug(`Cache miss for client "${clientKey}" - needs geocoding`);
              clientsToGeocode.push(clientData);
            } else {
              logger.debug(`Cache hit for client "${clientKey}" - using existing coordinates`);
            }
          }
        } else {
          const existing = clientLocationsMap.get(clientKey)!;
          if (!existing.postcode && postcode) existing.postcode = postcode;
          if (!existing.addressLine && addressLine) existing.addressLine = addressLine;
        }
      }
    }

    logger.debug(`Client locations: ${clientLocationsMap.size} total (${clientsToGeocode.length} need geocoding, ${clientLocationsMap.size - clientsToGeocode.length} cached)`);

    for (const locationData of Array.from(clientLocationsMap.values())) {
      await storage.upsertClientLocation(locationData);
    }

    if (shouldPrune && clientLocationsMap.size > 0) {
      try {
        const activeClientNames = Array.from(clientLocationsMap.keys());
        const removed = await storage.deleteClientLocationsNotIn(branchId, activeClientNames);
        if (removed > 0) {
          logger.info(`Removed ${removed} client location(s) no longer present in the latest export (e.g. terminated clients)`);
        }
      } catch (err) {
        logger.warn(`Failed to prune stale client locations (non-fatal)`, err);
      }
    }

    logger.debug(`Starting enhanced batch geocoding for locations...`);

    // Employee second-pass geocoding
    {
      const employeeByPostcode = new Map<string, string[]>();
      for (const [name, data] of Array.from(employeeLocationsMap.entries())) {
        const pc = normalisePostcode(data.homePostcode || "");
        if (!pc) continue;
        if (!employeeByPostcode.has(pc)) employeeByPostcode.set(pc, []);
        employeeByPostcode.get(pc)!.push(name);
      }

      let empSaved = 0;
      const uniqueEmpPostcodes = Array.from(
        new Set(Array.from(employeeLocationsMap.values()).map(v => normalisePostcode(v.homePostcode || "")).filter(Boolean))
      );
      for (const pc of uniqueEmpPostcodes) {
        const names = employeeByPostcode.get(pc) ?? [];
        const anyMissingCoords = names.some(n => {
          const e = employeeLocationsMap.get(n);
          return !e?.homeLat || !e?.homeLng;
        });
        if (!anyMissingCoords) continue;
        try {
          const geocoded = await geocodeWithFallback(pc, storage, branchId);
          if (!geocoded?.lat || !geocoded?.lng) continue;
          for (const employeeName of names) {
            const base = employeeLocationsMap.get(employeeName) || {};
            await storage.upsertEmployeeLocation({
              branchId,
              employeeName,
              homePostcode: pc,
              homeLat: String(geocoded.lat),
              homeLng: String(geocoded.lng),
              transportMode: (base as any).transportMode || "car",
              gender: (base as any).gender,
            });
            empSaved++;
          }
        } catch (err) {
          logger.warn(`Employee geocoding error for postcode "${pc}"`, err);
        }
      }
      if (empSaved > 0) logger.info(`Employee geocoding (second-pass): saved ${empSaved} records`);
    }

    // Client geocoding
    if (clientsToGeocode.length > 0) {
      logger.info(`Client geocoding: ${clientsToGeocode.length} clients need coordinates (${clientLocationsMap.size - clientsToGeocode.length} already cached)`);

      const clientByPostcode = new Map<string, string[]>();
      for (const v of Array.from(clientLocationsMap.values())) {
        const pc = normalisePostcode(v.postcode || "");
        if (pc) {
          if (!clientByPostcode.has(pc)) clientByPostcode.set(pc, []);
          clientByPostcode.get(pc)!.push(v.clientName);
        }
      }

      const uniqueClientPostcodes = Array.from(
        new Set(clientsToGeocode.map(c => normalisePostcode(c.postcode || "")).filter(Boolean))
      );

      let clientSaved = 0;
      let clientFailed = 0;

      for (const pc of uniqueClientPostcodes) {
        try {
          const geocoded = await geocodeWithFallback(pc, storage, branchId);
          if (!geocoded?.lat || !geocoded?.lng) {
            logger.warn(`Geocoding failed for postcode "${pc}" — no coordinates stored`);
            clientFailed++;
            continue;
          }

          const sharedClients = clientByPostcode.get(pc) ?? [];
          for (const cName of sharedClients) {
            await storage.upsertClientLocation({
              branchId,
              clientName: cName,
              addressLine: clientLocationsMap.get(cName)?.addressLine || "",
              postcode: pc,
              lat: String(geocoded.lat),
              lng: String(geocoded.lng),
            });
            clientSaved++;
          }
        } catch (err) {
          logger.warn(`Client geocoding error for postcode "${pc}"`, err);
          clientFailed++;
        }
      }

      logger.info(`Client geocoding complete: ${clientSaved} saved, ${clientFailed} failed out of ${uniqueClientPostcodes.length} unique postcodes`);
    } else {
      logger.debug(`All client locations already cached — skipping geocoding`);
    }

    // Visit data extraction
    const visitsMap = new Map<string, any>();
    const visitsByDate = new Map<string, any[]>();

    logger.debug(`DEBUG: Processing visit data from ${rawGHRows.length} raw GH rows`);

    for (const row of rawGHRows) {
      if (!isCancellationBlank(row["Cancellation Description"])) continue;

      const serviceType = row["Actual Service Type Description"] || row["Service Type Description"] || "";
      if (serviceType) {
        const lowerType = String(serviceType).toLowerCase();
        const excludedTypes = ['office hours', 'multiple care (secondary)', 'secondary', 'training', 'shadowing',
          'nights - sleep in', 'sleep in', 'nights - waking nights', 'waking nights', 'night', 'overnight', 'sleepover'];
        if (excludedTypes.some(excluded => lowerType.includes(excluded))) continue;
      }

      const clientName = pickCol(row, CLIENT_COLS);
      const plannedStartTime = row["Planned Start Date And Time"];
      const plannedEndTime = row["Planned End Date And Time"];
      const actualStartTime = row["Actual Start Date And Time"];
      const actualEndTime = row["Actual End Date And Time"];
      const startTime = row["Service Requirement Start Date And Time"];
      const endTime = row["Service Requirement End Date And Time"];

      if (clientName && (plannedStartTime || actualStartTime || startTime)) {
        const visitStart = plannedStartTime || actualStartTime || startTime;
        const visitEnd = plannedEndTime || actualEndTime || endTime;

        if (visitStart) {
          try {
            const startDate = parseDate(visitStart);
            const visitDate = format(startDate, "yyyy-MM-dd");

            const endDate = visitEnd ? parseDate(visitEnd) : null;
            const duration = endDate ?
              Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60)) : 60;

            if (endDate) {
              const endDateStr = format(endDate, "yyyy-MM-dd");
              if (visitDate !== endDateStr) {
                logger.debug(`REJECTING overnight visit in extractAndStoreGeographicalData: ${clientName} starts ${visitDate} ends ${endDateStr} - crosses midnight boundary`);
                continue;
              }
            }

            const visitKey = `${clientName}-${visitDate}-${visitStart}`;
            const clientLocation = await storage.getClientLocationByName(branchId, clientName);

            if (clientLocation && !visitsMap.has(visitKey)) {
              const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
              const effectiveEndDate = endDate || new Date(startDate.getTime() + duration * 60000);
              const endMinutes = endDate ? endDate.getHours() * 60 + endDate.getMinutes() : startMinutes + duration;

              const visitData = {
                branchId,
                clientId: clientLocation.id,
                date: visitDate,
                durationMinutes: Math.max(duration, 15),
                preferredStartTime: visitStart,
                preferredEndTime: visitEnd || format(effectiveEndDate, "yyyy-MM-dd HH:mm:ss"),
                serviceType,
                priority: 1,
                startMinutes,
                endMinutes,
                clientName,
                location: clientLocation.lat && clientLocation.lng ? {
                  lat: parseFloat(clientLocation.lat),
                  lng: parseFloat(clientLocation.lng)
                } : null
              };

              visitsMap.set(visitKey, visitData);
              if (!visitsByDate.has(visitDate)) visitsByDate.set(visitDate, []);
              visitsByDate.get(visitDate)!.push(visitData);
              logger.debug(`DEBUG: Added visit ${clientName} on ${visitDate} at ${startMinutes}-${endMinutes} minutes`);
            } else if (!clientLocation) {
              logger.debug(`DEBUG: Client location not found for ${clientName}, skipping visit.`);
            }
          } catch (dateError) {
            logger.warn(`Skipping visit with invalid date: ${visitStart}`);
          }
        }
      }
    }

    const serviceTypeSummary = new Map<string, number>();
    for (const visitData of Array.from(visitsMap.values())) {
      const sType = visitData.serviceType || 'Unknown';
      const durationHours = (visitData.durationMinutes || 0) / 60;
      serviceTypeSummary.set(sType, (serviceTypeSummary.get(sType) || 0) + durationHours);
    }

    logger.debug(`\n===== VISIT EXTRACTION SERVICE TYPE SUMMARY =====`);
    logger.debug(`Found ${visitsMap.size} visits across ${visitsByDate.size} dates for route optimization`);
    logger.debug(`\nTotal Hours by Service Type:`);
    Array.from(serviceTypeSummary.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([sType, hours]) => {
        logger.debug(`  ${sType}: ${Math.round(hours * 100) / 100} hours`);
      });
    logger.debug(`====================================================\n`);

    for (const visitData of Array.from(visitsMap.values())) {
      await storage.saveVisit(visitData);
    }

    const empLocs = storage.getAllEmployeeLocations ? await storage.getAllEmployeeLocations(branchId) : [];
    const cliLocs = storage.getAllClientLocations ? await storage.getAllClientLocations(branchId) : [];
    logger.debug(`\nGEOCODING RESULTS:`);
    logger.debug(`  Employee locations stored: ${empLocs.length}`);
    logger.debug(`  Client locations stored: ${cliLocs.length}`);
    logger.debug(`  Total visits stored: ${visitsMap.size}`);

  } catch (error) {
    logger.error('Error extracting geographical data:', error);
  }
}
