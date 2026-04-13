import * as XLSX from "../../shared/xlsx-compat.js";
import { logger } from '../../infrastructure/logger';
import { format } from "date-fns";
import { parseGuaranteedDate, timeToString } from "../../shared/utils/time-window-utils";
import { computeCapacityWindows } from "./capacity-windows";
import { extractCancelledWindowsFromGHWorkbook } from "../cancelled-visits/cancelled-visits-from-gh";
import {
  AvailabilityRow,
  GuaranteedHoursRow,
  ClientDemandRow,
  CleanedEmployeeRecord,
  DailySummaryRecord,
  EmployeeDailyDetail,
  ProcessingResult,
  InsertCapacityAnalysis,
} from "@shared/schema";
import { storage } from "../../storage";
import {
  ParsedAvailabilityRow,
  CGDataRow,
  CLIENT_COLS,
  CANCEL_COLS,
  EMPLOYEE_NAME_COLS,
  START_TIME_COLS,
  ADDRESS_COLS_GH,
  LEAVE_TYPES,
  STATUS_PRIORITY,
  DAY_KILLERS,
  TIME_KILLERS,
  pickCol,
  normalizeName,
  canonicalStatus,
  resolveServiceTimestamps,
  parseDate,
  hoursBetween,
  toMin,
  fromMin,
  mergeIntervals,
  windowListToPairs,
  pairsToWindowList,
  subtractIntervals,
  filterMinDuration,
  isAllDayTimeKiller,
  buildAdHocWindowsMap,
  buildDisplayNameMap,
  buildScheduledHoursLookup,
  buildClientScheduledHoursLookup,
  getScheduledHoursForEmployeeAndDate,
  isCancellationBlank,
  isSecondaryMultipleCare,
} from "../imports/pipeline-utils";
import {
  geocodeWithFallback,
  normalisePostcode,
  toTransportMode,
} from "../imports/geocoding";

// ─── Private helpers: string matching ────────────────────────────────────────

function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(null));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1,
        );
      }
    }
  }
  return matrix[len1][len2];
}

function phonetic(name: string): string {
  if (!name) return "";

  let code = name.toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";

  let result = code[0];
  const mapping: Record<string, string> = {
    BFPV: "1",
    CGJKQSXZ: "2",
    DT: "3",
    L: "4",
    MN: "5",
    R: "6",
  };

  for (let i = 1; i < code.length; i++) {
    const char = code[i];
    let found = false;
    for (const [chars, num] of Object.entries(mapping)) {
      if (chars.includes(char)) {
        if (result[result.length - 1] !== num) {
          result += num;
        }
        found = true;
        break;
      }
    }
    if (!found && "AEIOUHYW".includes(char)) {
      // Skip vowels except at start
    }
  }

  return result.padEnd(4, "0").substring(0, 4);
}

function getCloseMatches(
  target: string,
  choices: string[],
  cutoff: number = 0.7,
): Array<{ choice: string; score: number; confidence: number }> {
  if (!target) return [];

  const matches: Array<{ choice: string; score: number; confidence: number }> = [];
  const targetPhonetic = phonetic(target);

  for (const choice of choices) {
    if (!choice) continue;

    const targetTokens = new Set(target.split(" "));
    const choiceTokens = new Set(choice.split(" "));
    const intersection = new Set(
      Array.from(targetTokens).filter((x) => choiceTokens.has(x)),
    );
    const union = new Set([
      ...Array.from(targetTokens),
      ...Array.from(choiceTokens),
    ]);
    const tokenSimilarity = intersection.size / union.size;

    const maxLen = Math.max(target.length, choice.length);
    const editSimilarity =
      maxLen === 0 ? 1 : 1 - levenshteinDistance(target, choice) / maxLen;

    const choicePhonetic = phonetic(choice);
    const phoneticSimilarity = targetPhonetic === choicePhonetic ? 1 : 0;

    const combinedScore =
      tokenSimilarity * 0.4 + editSimilarity * 0.4 + phoneticSimilarity * 0.2;

    const methodScores = [tokenSimilarity, editSimilarity, phoneticSimilarity];
    const avgScore =
      methodScores.reduce((a, b) => a + b, 0) / methodScores.length;
    const variance =
      methodScores.reduce(
        (sum, score) => sum + Math.pow(score - avgScore, 2),
        0,
      ) / methodScores.length;
    const confidence = Math.max(0, 1 - Math.sqrt(variance));

    if (combinedScore >= cutoff) {
      matches.push({ choice, score: combinedScore, confidence });
    }
  }

  matches.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  return matches;
}

// ─── Private: geographical data extraction ────────────────────────────────────

async function extractAndStoreGeographicalData(cgData: any[], guaranteed: any[], branchId?: string, ghWorkbookBuffer?: Buffer) {
  logger.debug(`EXTRACTING GEOGRAPHICAL DATA FOR SCHEDULING OPTIMIZATION...`);
  logger.debug(`CG Data rows to process: ${cgData.length}`);
  logger.debug(`Branch ID: ${branchId || 'NONE'}`);

  if (!branchId) {
    logger.debug(` WARNING: No branchId provided - geographical data will not be saved to database`);
    return;
  }

  try {
    const clearedEmployees = await storage.clearEmployeeLocations(branchId);
    const clearedClients = await storage.clearClientLocations(branchId);
    logger.debug(`Cleared ${clearedEmployees} old employee locations and ${clearedClients} old client locations for branch ${branchId} — repopulating fresh from uploaded files`);

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
      if (!isCancellationBlank(row["Cancellation Description"])) {
        continue;
      }
      if (isSecondaryMultipleCare(row["Actual Service Type Description"])) {
        continue;
      }

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

      if (!postcode && row["Postcode"]) {
        postcode = String(row["Postcode"]).trim().toUpperCase();
      }
      if (!postcode && row["Post Code"]) {
        postcode = String(row["Post Code"]).trim().toUpperCase();
      }
      if (!postcode && row["Postal Code"]) {
        postcode = String(row["Postal Code"]).trim().toUpperCase();
      }

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
          if (!existing.postcode && postcode) {
            existing.postcode = postcode;
          }
          if (!existing.addressLine && addressLine) {
            existing.addressLine = addressLine;
          }
        }
      }
    }

    logger.debug(`Client locations: ${clientLocationsMap.size} total (${clientsToGeocode.length} need geocoding, ${clientLocationsMap.size - clientsToGeocode.length} cached)`);

    for (const locationData of Array.from(clientLocationsMap.values())) {
      await storage.upsertClientLocation(locationData);
    }

    logger.debug(`Starting enhanced batch geocoding for locations...`);

    const employeeByPostcode = new Map<string, string[]>();
    for (const [name, data] of Array.from(employeeLocationsMap.entries())) {
      const pc = normalisePostcode(data.homePostcode || "");
      if (!pc) continue;
      if (!employeeByPostcode.has(pc)) employeeByPostcode.set(pc, []);
      employeeByPostcode.get(pc)!.push(name);
    }

    const clientByPostcode = new Map<string, string[]>();
    const clientByAddress = new Map<string, string>();
    const clientKeyMap = new Map<string, string>();

    for (const v of Array.from(clientLocationsMap.values())) {
      const pc = normalisePostcode(v.postcode || "");
      const addr = (v.addressLine || "").trim().toUpperCase();

      if (pc) {
        if (!clientByPostcode.has(pc)) clientByPostcode.set(pc, []);
        clientByPostcode.get(pc)!.push(v.clientName);
      }

      if (addr) {
        clientByAddress.set(addr, v.clientName);
      }

      clientKeyMap.set(`${addr}|${pc}`, v.clientName);
    }

    // Employee geocoding second pass
    {
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
          const geocoded = await geocodeWithFallback(pc, storage, branchId!);
          if (!geocoded?.lat || !geocoded?.lng) continue;
          for (const employeeName of names) {
            const base = employeeLocationsMap.get(employeeName) || {};
            await storage.upsertEmployeeLocation({
              branchId: branchId!,
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
      if (empSaved > 0) {
        logger.info(`Employee geocoding (second-pass): saved ${empSaved} records`);
      }
    }

    // Client geocoding
    if (clientsToGeocode.length > 0) {
      logger.info(`Client geocoding: ${clientsToGeocode.length} clients need coordinates (${clientLocationsMap.size - clientsToGeocode.length} already cached)`);

      const uniqueClientPostcodes = Array.from(
        new Set(clientsToGeocode.map(c => normalisePostcode(c.postcode || "")).filter(Boolean))
      );

      let clientSaved = 0;
      let clientFailed = 0;

      for (const pc of uniqueClientPostcodes) {
        try {
          const geocoded = await geocodeWithFallback(pc, storage, branchId!);
          if (!geocoded?.lat || !geocoded?.lng) {
            logger.warn(`Geocoding failed for postcode "${pc}" — no coordinates stored`);
            clientFailed++;
            continue;
          }

          const sharedClients = clientByPostcode.get(pc) ?? [];
          for (const cName of sharedClients) {
            await storage.upsertClientLocation({
              branchId: branchId!,
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
        if (excludedTypes.some(excluded => lowerType.includes(excluded))) {
          continue;
        }
      }

      const clientName = pickCol(row, CLIENT_COLS);
      const serviceLocationAddress = pickCol(row, ADDRESS_COLS_GH);

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
              Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60)) :
              60;

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
              let endMinutes = endDate ? endDate.getHours() * 60 + endDate.getMinutes() : startMinutes + duration;

              const effectiveEndDate = endDate || new Date(startDate.getTime() + duration * 60000);

              const visitData = {
                branchId: branchId,
                clientId: clientLocation.id,
                date: visitDate,
                durationMinutes: Math.max(duration, 15),
                preferredStartTime: visitStart,
                preferredEndTime: visitEnd || format(effectiveEndDate, "yyyy-MM-dd HH:mm:ss"),
                serviceType: serviceType,
                priority: 1,
                startMinutes: startMinutes,
                endMinutes: endMinutes,
                clientName: clientName,
                location: clientLocation.lat && clientLocation.lng ? {
                  lat: parseFloat(clientLocation.lat),
                  lng: parseFloat(clientLocation.lng)
                } : null
              };

              visitsMap.set(visitKey, visitData);

              if (!visitsByDate.has(visitDate)) {
                visitsByDate.set(visitDate, []);
              }
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

    const sortedServiceTypes = Array.from(serviceTypeSummary.entries())
      .sort((a, b) => b[1] - a[1]);

    sortedServiceTypes.forEach(([sType, hours]) => {
      logger.debug(`  ${sType}: ${Math.round(hours * 100) / 100} hours`);
    });
    logger.debug(`====================================================\n`);

    for (const visitData of Array.from(visitsMap.values())) {
      await storage.saveVisit(visitData);
    }

    const empLocs = branchId && storage.getAllEmployeeLocations ? await storage.getAllEmployeeLocations(branchId) : [];
    const cliLocs = branchId && storage.getAllClientLocations ? await storage.getAllClientLocations(branchId) : [];
    logger.debug(`\nGEOCODING RESULTS:`);
    logger.debug(`  Employee locations stored: ${empLocs.length}`);
    logger.debug(`  Client locations stored: ${cliLocs.length}`);
    logger.debug(`  Total visits stored: ${visitsMap.size}`);

  } catch (error) {
    logger.error('Error extracting geographical data:', error);
  }
}

// ─── Public export ────────────────────────────────────────────────────────────

export async function processCapacityData(
  availability: ParsedAvailabilityRow[],
  guaranteed: GuaranteedHoursRow[],
  demand: ClientDemandRow[],
  cgData: CGDataRow[],
  options?: { ghWorkbookBuffer?: Buffer; branchId?: string },
): Promise<ProcessingResult & { cleanedRecords: CleanedEmployeeRecord[] }> {
  const warnings: string[] = [];
  const branchId = options?.branchId;

  logger.debug(`\n🚀 ===== USING CG DATA AS MASTER EMPLOYEE LIST =====`);
  logger.debug(`Total employees in CG Data: ${cgData.length}`);

  if (cgData.length > 0) {
    logger.debug(`Sample CG Data entries:`);
    cgData.slice(0, 3).forEach((emp, idx) => {
      logger.debug(
        `  ${idx + 1}. ${emp["CAREGiver Name"]} - ${emp["Weekly Hours"]} hours/week`,
      );
    });
  }

  logger.debug(`\n===== RECEIVED DEMAND DATA =====`);
  let totalDemandHours = 0;
  demand.forEach((row) => {
    logger.debug(`  - ${row.Date}: ${row["Required Client Hours"]} hours`);
    totalDemandHours += row["Required Client Hours"];
  });
  logger.debug(
    `TOTAL DEMAND HOURS FROM FILTERING: ${Math.round(totalDemandHours * 100) / 100} (Expected: 400.33)`,
  );
  logger.debug(`================================\n`);

  logger.debug(`\nDEBUG: About to call buildScheduledHoursLookup with ${guaranteed.length} guaranteed rows`);

  const officeRows = guaranteed.filter(row => {
    const serviceType = (row["Actual Service Type Description"] || "").toString().toLowerCase();
    return serviceType.includes("office");
  });
  logger.debug(`DEBUG: Found ${officeRows.length} office hours rows in guaranteed data`);
  if (officeRows.length > 0) {
    logger.debug(`DEBUG: Sample office hours rows:`, officeRows.slice(0, 3).map(r => ({
      employee: r["Actual Employee Name"],
      serviceType: r["Actual Service Type Description"],
      hours: r["Actual Pay Rate Hours"]
    })));
  }

  const scheduledHoursMap = buildScheduledHoursLookup(guaranteed);
  const clientScheduledHoursMap = buildClientScheduledHoursLookup(guaranteed);

  logger.debug(`\nSCHEDULED HOURS MAP VERIFICATION:`);
  logger.debug(`  Total entries in map: ${scheduledHoursMap.size}`);

  let count = 0;
  for (const [key, hours] of Array.from(scheduledHoursMap.entries())) {
    if (count < 10) {
      logger.debug(`  ${key}: ${hours}h`);
      count++;
    }
  }
  logger.debug(`=========================================\n`);

  if (guaranteed.length > 0) {
    logger.debug("=== GUARANTEED HOURS DEBUGGING ===");
    logger.debug("First row raw data:", guaranteed[0]);
    logger.debug(
      "Service Start Date raw:",
      guaranteed[0]["Service Requirement Start Date And Time"],
    );
    logger.debug(
      "Service End Date raw:",
      guaranteed[0]["Service Requirement End Date And Time"],
    );
  }

  logger.debug(`CG Data debugging:`);
  logger.debug(`  - Total CG Data rows: ${cgData.length}`);
  if (cgData.length > 0) {
    logger.debug(`  - First row keys:`, Object.keys(cgData[0]));
    logger.debug(`  - First row:`, cgData[0]);
  }

  // Step 1: Create master employee list from CG Data
  const masterEmployees = cgData
    .map((row) => ({
      name: row["CAREGiver Name"],
      weekly: Number(row["Weekly Hours"] || 0),
      transportMode: row["TransportModeDescription"] || "",
      gender: row["Gender"] || "",
    }))
    .filter((row) => row.name && row.weekly > 0)
    .map((row) => ({
      originalName: row.name,
      normalizedName: normalizeName(row.name),
      weeklyHours: row.weekly,
      transportMode: row.transportMode,
      gender: row.gender,
    }));

  // Add employees from Guaranteed Hours who are not in CG Data
  const existingNames = new Set(masterEmployees.map(e => e.normalizedName));
  const adhocFromGuaranteed = new Map<string, string>();

  guaranteed.forEach(row => {
    const actualName = row["Actual Employee Name"];
    const plannedName = row["Planned Employee Name"];
    const name = actualName || plannedName;
    if (!name) return;
    const nameStr = name.toString();
    const norm = normalizeName(nameStr);
    if (!existingNames.has(norm)) {
      adhocFromGuaranteed.set(norm, nameStr);
    }
  });

  if (adhocFromGuaranteed.size > 0) {
    logger.debug(`Adding ${adhocFromGuaranteed.size} employees found in Guaranteed Hours but missing from CG Data to master list`);
    adhocFromGuaranteed.forEach((originalName, norm) => {
      masterEmployees.push({
        originalName: originalName,
        normalizedName: norm,
        weeklyHours: 0,
        transportMode: "",
        gender: "",
      });
      existingNames.add(norm);
    });
  }

  logger.debug(
    `Master employee list created: ${masterEmployees.length} employees from CG Data (with non-zero weekly hours)`,
  );
  if (masterEmployees.length > 0) {
    logger.debug(`  - Sample employee:`, masterEmployees[0]);
  }

  const masterEmployeeMap = new Map();
  masterEmployees.forEach((emp) => {
    masterEmployeeMap.set(emp.normalizedName, emp);
  });

  const postCodeMap = new Map<string, string>();
  cgData.forEach((row) => {
    if (row["CAREGiver Name"] && row.PostCode) {
      const normalizedName = normalizeName(row["CAREGiver Name"]);
      postCodeMap.set(normalizedName, row.PostCode);
    }
  });

  // Determine core week boundary
  const coreWeekDates = new Set<string>();
  guaranteed.forEach((row) => {
    try {
      const { start } = resolveServiceTimestamps(row);
      if (!start) return;
      const startDate = parseGuaranteedDate(start);
      const dateStr = format(startDate, "yyyy-MM-dd");
      coreWeekDates.add(dateStr);
    } catch (error) {
      // Skip invalid dates
    }
  });

  availability.forEach((row) => {
    if (row.parsedDate) {
      const dateStr = format(row.parsedDate, "yyyy-MM-dd");
      coreWeekDates.add(dateStr);
    }
  });

  let coreWeekArray = Array.from(coreWeekDates).sort();
  const spilloverDatesRemoved: string[] = [];

  if (coreWeekArray.length > 7) {
    logger.debug(`\nDETECTING WEEK BOUNDARY in processCapacityData (${coreWeekArray.length} dates found):`);

    if (coreWeekArray.length > 7) {
      const firstDate = new Date(coreWeekArray[0]);
      const secondDate = new Date(coreWeekArray[1]);
      const lastDate = new Date(coreWeekArray[coreWeekArray.length - 1]);

      const daysBetweenSecondAndLast = Math.round(
        (lastDate.getTime() - secondDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const daysBetweenFirstAndSecond = Math.round(
        (secondDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysBetweenFirstAndSecond === 1 && daysBetweenSecondAndLast === 6) {
        logger.debug(`  Detected spillover date: ${coreWeekArray[0]} (will be excluded)`);
        logger.debug(`  Core week: ${coreWeekArray[1]} to ${coreWeekArray[coreWeekArray.length - 1]}`);
        spilloverDatesRemoved.push(coreWeekArray[0]);
        coreWeekDates.delete(coreWeekArray[0]);
        coreWeekArray = coreWeekArray.slice(1);
      } else if (coreWeekArray.length === 8) {
        const secondToLastDate = new Date(coreWeekArray[coreWeekArray.length - 2]);
        const daysBetweenFirstAndSecondToLast = Math.round(
          (secondToLastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysBetweenFirstAndSecondToLast === 6) {
          logger.debug(`  Detected spillover date: ${coreWeekArray[coreWeekArray.length - 1]} (will be excluded)`);
          logger.debug(`  Core week: ${coreWeekArray[0]} to ${coreWeekArray[coreWeekArray.length - 2]}`);
          spilloverDatesRemoved.push(coreWeekArray[coreWeekArray.length - 1]);
          coreWeekDates.delete(coreWeekArray[coreWeekArray.length - 1]);
          coreWeekArray = coreWeekArray.slice(0, -1);
        }
      }
    }
  }

  // Step 2: Filter availability data to ONLY include master employees
  const availabilityFiltered: any[] = [];
  let spilloverDatesSkipped = 0;
  availability.forEach((row, i) => {
    try {
      const name = row["CAREGiver Name"];
      const normalizedName = normalizeName(name);

      const masterEmployeeKeys = Array.from(masterEmployeeMap.keys());
      const matches = getCloseMatches(normalizedName, masterEmployeeKeys, 0.65);
      if (matches.length === 0) return;
      const canonicalKey = matches[0].choice;
      const matchedEmployee = masterEmployeeMap.get(canonicalKey);

      if (!row["Start Date"]) {
        warnings.push(`Availability row ${i + 1}: missing Start Date`);
        return;
      }

      const parsedDate = row.parsedDate;
      const dateStr = format(parsedDate, "yyyy-MM-dd");

      if (!coreWeekDates.has(dateStr)) {
        spilloverDatesSkipped++;
        return;
      }

      let hrs =
        row.Hours !== undefined && row.Hours !== null
          ? Number(row.Hours)
          : hoursBetween(row["Start Time"], row["End Time"]);

      if (isNaN(hrs)) {
        const rowStatus = canonicalStatus(row.Type);
        if (rowStatus === "Available") {
          warnings.push(`Availability row ${i + 1}: cannot compute hours`);
          return;
        }
        hrs = 0;
      }

      availabilityFiltered.push({
        ...row,
        _normalizedName: canonicalKey,
        _parsedDate: parsedDate,
        _hours: Math.round(hrs * 100) / 100,
        matchedEmployee,
      });
    } catch (e: any) {
      warnings.push(`Availability row ${i + 1}: ${e.message || "error"}`);
    }
  });

  if (spilloverDatesSkipped > 0) {
    logger.debug(`  🔸 Filtered ${spilloverDatesSkipped} availability records from spillover dates: ${spilloverDatesRemoved.join(', ')}`);
  }

  logger.debug(
    `Availability filtered: ${availabilityFiltered.length} rows (only master employees)`,
  );

  const allAvailabilityWithMatching = availabilityFiltered;

  // Step 3: Calculate days available for each employee
  const employeeDays = new Map<string, Set<string>>();
  allAvailabilityWithMatching.forEach((row) => {
    const key = row.matchedEmployee
      ? row.matchedEmployee.normalizedName
      : normalizeName(row["CAREGiver Name"]);
    if (!employeeDays.has(key)) {
      employeeDays.set(key, new Set());
    }
    const dateStr = format(row.parsedDate, "yyyy-MM-dd");
    employeeDays.get(key)!.add(dateStr);
  });

  const employeeAbsenceDates = new Map<string, Set<string>>();
  allAvailabilityWithMatching.forEach((row) => {
    if (canonicalStatus(row.Type) === "Available") return;
    const key = row.matchedEmployee
      ? row.matchedEmployee.normalizedName
      : normalizeName(row["CAREGiver Name"]);
    if (!employeeAbsenceDates.has(key)) {
      employeeAbsenceDates.set(key, new Set());
    }
    const dateStr = format(row.parsedDate, "yyyy-MM-dd");
    employeeAbsenceDates.get(key)!.add(dateStr);
  });

  // Step 4: Create merged data
  const mergedData = allAvailabilityWithMatching.map((row) => {
    const key = row.matchedEmployee
      ? row.matchedEmployee.normalizedName
      : normalizeName(row["CAREGiver Name"]);

    const contractedWeeklyHours = row.matchedEmployee
      ? row.matchedEmployee.weeklyHours
      : 0;

    let contractedDailyHours = 0;
    if (row.matchedEmployee) {
      const daysAvailable = employeeDays.get(key)!.size;
      const standardDaily = Math.round((row.matchedEmployee.weeklyHours / daysAvailable) * 100) / 100;

      const perDayHours = new Map<string, number>();
      allAvailabilityWithMatching
        .filter(r => {
          const rKey = r.matchedEmployee?.normalizedName || normalizeName(r["CAREGiver Name"]);
          return rKey === key && canonicalStatus(r.Type) === "Available";
        })
        .forEach(r => {
          const d = format(r.parsedDate, "yyyy-MM-dd");
          const hrs = (r.Hours !== undefined && r.Hours !== null)
            ? Number(r.Hours)
            : hoursBetween(r["Start Time"], r["End Time"]);
          if (isNaN(hrs) || hrs <= 0) return;
          perDayHours.set(d, (perDayHours.get(d) || 0) + hrs);
        });

      const currentDate = format(row.parsedDate, "yyyy-MM-dd");
      const todayHours = perDayHours.get(currentDate) || 0;
      const allDayHours = Array.from(perDayHours.values());
      const totalWeekHours = allDayHours.reduce((a, b) => a + b, 0);
      const avgDayHours = allDayHours.length > 0 ? totalWeekHours / allDayHours.length : 0;

      const hasVariableShifts = allDayHours.length > 1 && allDayHours.some(h => Math.abs(h - avgDayHours) > 0.25);

      const dateHasAbsence = employeeAbsenceDates.get(key)?.has(currentDate) ?? false;
      if (hasVariableShifts && totalWeekHours > 0 && todayHours > 0 && !dateHasAbsence) {
        const proportion = todayHours / totalWeekHours;
        contractedDailyHours = Math.round((row.matchedEmployee.weeklyHours * proportion) * 100) / 100;
      } else {
        contractedDailyHours = standardDaily;
      }
    }

    const hoursCalc = hoursBetween(row["Start Time"], row["End Time"]);
    const hoursEffective =
      row.Hours !== undefined && row.Hours !== null ? row.Hours : hoursCalc;

    return {
      employeeName: row.matchedEmployee
        ? row.matchedEmployee.originalName
        : row["CAREGiver Name"],
      contractedWeeklyHours,
      contractedDailyHours,
      date: format(row.parsedDate, "yyyy-MM-dd"),
      status: canonicalStatus(row.Type),
      startTime: timeToString(row["Start Time"]),
      endTime: timeToString(row["End Time"]),
      timeWindow: row["Time Window(s)"],
      hours: hoursEffective,
      notes: row.Notes || "",
      employeeKey: key,
      matchedEmployee: row.matchedEmployee,
    };
  });

  // Step 5: Group by employee and date
  const groupedData = new Map<string, typeof mergedData>();
  mergedData.forEach((row) => {
    const key = `${row.employeeKey}|${row.date}`;
    if (!groupedData.has(key)) {
      groupedData.set(key, []);
    }
    groupedData.get(key)!.push(row);
  });

  // Step 6: Collapse function
  const cleanedRecords: CleanedEmployeeRecord[] = [];

  groupedData.forEach((group) => {
    if (group.length === 0) return;

    const empName = group[0].employeeName;
    const weekly = group[0].contractedWeeklyHours;
    const daily = group[0].contractedDailyHours || 0.0;
    const date = group[0].date;

    const totalScheduledHours = getScheduledHoursForEmployeeAndDate(
      scheduledHoursMap,
      empName,
      date,
    );
    const clientScheduledHrs = getScheduledHoursForEmployeeAndDate(clientScheduledHoursMap, empName, date);

    const deduplicatedRows = new Map<string, (typeof group)[0]>();
    group.forEach((row) => {
      const key = `${row.status}|${row.startTime}|${row.endTime}`;
      if (!deduplicatedRows.has(key)) {
        deduplicatedRows.set(key, row);
      }
    });

    const statusAgg = new Map<
      string,
      {
        hoursRaw: number;
        windows: string[];
        notes: string[];
      }
    >();

    Array.from(deduplicatedRows.values()).forEach((row) => {
      if (!statusAgg.has(row.status)) {
        statusAgg.set(row.status, {
          hoursRaw: 0,
          windows: [],
          notes: [],
        });
      }

      const agg = statusAgg.get(row.status)!;
      agg.hoursRaw += row.hours;

      if (
        row.timeWindow &&
        row.timeWindow !== "" &&
        row.timeWindow !== "-" &&
        row.timeWindow !== "--" &&
        row.timeWindow !== ":" &&
        !row.timeWindow.includes("undefined")
      ) {
        agg.windows.push(row.timeWindow);
      }

      if (row.notes && row.notes !== "") {
        agg.notes.push(row.notes);
      }
    });

    let totalLeaveRaw = 0;
    statusAgg.forEach((agg, status) => {
      if (LEAVE_TYPES.includes(status)) {
        totalLeaveRaw += agg.hoursRaw;
      }
    });
    const totalLeaveCapped = Math.min(totalLeaveRaw, daily);

    let hasDayKiller = false;
    let dayKillerStatus = "";
    let dayKillerPriority = 999;
    let hasPartialDayKiller = false;
    let partialDayKillerStatus = "";

    statusAgg.forEach((agg, status) => {
      if (DAY_KILLERS.has(status)) {
        const p = STATUS_PRIORITY[status] || 999;
        const hasTimeWindows = agg.windows && agg.windows.length > 0 && agg.windows.some(w => w.trim() !== "");

        if (hasTimeWindows) {
          hasPartialDayKiller = true;
          partialDayKillerStatus = status;
        } else {
          if (p < dayKillerPriority) {
            dayKillerPriority = p;
            dayKillerStatus = status;
          }
        }
      }
    });
    hasDayKiller = dayKillerStatus !== "";

    let hasTimeKiller = false;
    let hasAvailableStatus = false;
    statusAgg.forEach((_agg, status) => {
      if (TIME_KILLERS.has(status)) {
        hasTimeKiller = true;
      }
      if (status === "Available") {
        hasAvailableStatus = true;
      }
    });

    const availAgg = statusAgg.get("Available");
    const availPairs = mergeIntervals(
      windowListToPairs(availAgg?.windows || []),
      0,
    );

    const timeKillerPairs: Array<[number, number]> = [];
    statusAgg.forEach((_agg, status) => {
      if (TIME_KILLERS.has(status))
        timeKillerPairs.push(...windowListToPairs(_agg.windows));
    });

    let partialDayKillerPairs: Array<[number, number]> = [];
    if (hasPartialDayKiller && partialDayKillerStatus) {
      const partialAgg = statusAgg.get(partialDayKillerStatus);
      if (partialAgg?.windows) {
        partialDayKillerPairs = windowListToPairs(partialAgg.windows);
      }
    }

    const blockerPairs: Array<[number, number]> = [...timeKillerPairs, ...partialDayKillerPairs];
    const mergedBlockers = mergeIntervals(blockerPairs, 0);

    const mergedTimeKillers = mergeIntervals(timeKillerPairs, 0);
    const mergedPartialDayKillers = mergeIntervals(partialDayKillerPairs, 0);
    const timeKillerHours = mergedTimeKillers.reduce((sum, [start, end]) => sum + (end - start) / 60, 0);
    const partialDayKillerHours = mergedPartialDayKillers.reduce((sum, [start, end]) => sum + (end - start) / 60, 0);

    const contractedDailyMin = Math.round(
      (group[0]?.contractedDailyHours || 0) * 60,
    );
    const timeKillerIsAllDay = mergedBlockers.length
      ? isAllDayTimeKiller(mergedBlockers, availPairs, contractedDailyMin)
      : false;

    let highestPriorityStatus = "";
    let highestPriority = 999;

    if (hasDayKiller) {
      highestPriorityStatus = dayKillerStatus;
      highestPriority = dayKillerPriority;
    } else if (hasTimeKiller || hasPartialDayKiller) {
      if (timeKillerIsAllDay || !hasAvailableStatus) {
        if (hasPartialDayKiller && timeKillerIsAllDay) {
          highestPriorityStatus = partialDayKillerStatus;
          highestPriority = STATUS_PRIORITY[partialDayKillerStatus] || 5;
        } else if (hasPartialDayKiller && !hasAvailableStatus) {
          highestPriorityStatus = partialDayKillerStatus;
          highestPriority = STATUS_PRIORITY[partialDayKillerStatus] || 5;
        } else {
          highestPriorityStatus = "Other Unavailable";
          highestPriority = STATUS_PRIORITY["Other Unavailable"] || 5;
        }
      } else {
        if (hasPartialDayKiller) {
          highestPriorityStatus = `Partial ${partialDayKillerStatus}`;
          highestPriority = STATUS_PRIORITY["Partial Availability"] || 6;
        } else {
          highestPriorityStatus = "Partial Availability";
          highestPriority = STATUS_PRIORITY["Partial Availability"] || 6;
        }
      }
    } else {
      statusAgg.forEach((_agg, status) => {
        const p = STATUS_PRIORITY[status] || 999;
        if (p < highestPriority) {
          highestPriority = p;
          highestPriorityStatus = status;
        }
      });
    }

    if (highestPriorityStatus) {
      const agg = statusAgg.get(highestPriorityStatus) ?? {
        hoursRaw: 0,
        windows: [],
        notes: [],
      };
      let finalHours: number;
      let netCapacity: number;

      const totalBlockedHours = mergedBlockers.reduce((sum, [start, end]) => sum + (end - start) / 60, 0);

      if (hasDayKiller || ((hasTimeKiller || hasPartialDayKiller) && timeKillerIsAllDay) || (hasPartialDayKiller && !hasAvailableStatus)) {
        finalHours = daily > 0 ? daily : Math.min(agg.hoursRaw || 0.0, daily);
        netCapacity = 0.0;
      } else if (highestPriorityStatus.startsWith("Partial ")) {
        let statusBlockedHours: number;
        if (highestPriorityStatus === "Partial Availability") {
          statusBlockedHours = Math.min(timeKillerHours, daily);
        } else if (highestPriorityStatus.startsWith("Partial ")) {
          statusBlockedHours = Math.min(partialDayKillerHours, daily);
        } else {
          statusBlockedHours = Math.min(totalBlockedHours, daily);
        }
        finalHours = statusBlockedHours;
        netCapacity = Math.max(daily - Math.min(totalBlockedHours, daily), 0.0);
      } else if (highestPriorityStatus === "Available") {
        finalHours = Math.max(daily - totalLeaveCapped, 0.0);
        netCapacity = finalHours;
      } else {
        finalHours = agg.hoursRaw || 0.0;
        netCapacity = 0.0;
      }

      const allNotes: string[] = [];
      statusAgg.forEach((agg) => allNotes.push(...agg.notes));
      const notesStr = Array.from(new Set(allNotes))
        .filter((n) => n && n !== "")
        .sort()
        .join("; ");

      let windowsStr = "";
      if (!(hasDayKiller || timeKillerIsAllDay)) {
        const bookablePairs = filterMinDuration(
          subtractIntervals(availPairs, mergedBlockers),
          60,
        );
        const bookableWindows = pairsToWindowList(bookablePairs);
        windowsStr = bookableWindows.join("; ");
      }

      const normalizedEmpName = normalizeName(empName);
      const postCode = postCodeMap.get(normalizedEmpName) || "";

      cleanedRecords.push({
        employeeName: empName,
        contractedWeeklyHours: Math.round(weekly * 100) / 100,
        contractedDailyHours: Math.round(daily * 100) / 100,
        date,
        status: highestPriorityStatus,
        timeWindows: windowsStr,
        scheduledHours: Math.round(totalScheduledHours * 100) / 100,
        clientScheduledHours: Math.round(clientScheduledHrs * 100) / 100,
        otherScheduledHours: Math.round((totalScheduledHours - clientScheduledHrs) * 100) / 100,
        hours: Math.round(finalHours * 100) / 100,
        netCapacity: Math.round(netCapacity * 100) / 100,
        notes:
          notesStr +
          (hasDayKiller
            ? " [availability ignored due to day-level leave]"
            : ""),
        postCode,
      });
    }
  });

  cleanedRecords.sort((a, b) => {
    const aPriority = STATUS_PRIORITY[a.status] || 999;
    const bPriority = STATUS_PRIORITY[b.status] || 999;
    return aPriority - bPriority;
  });

  // Step 7: Build Daily Summary
  const dailySummaryMap = new Map<
    string,
    {
      availableHours: number;
      netCapacity: number;
      unavailability: number;
      holidays: number;
      sickness: number;
      scheduledHours: number;
      clientScheduledHours: number;
      otherScheduledHours: number;
    }
  >();

  const recordsByDateAndEmployee = new Map<
    string,
    Map<string, CleanedEmployeeRecord[]>
  >();

  cleanedRecords.forEach((record) => {
    const dateKey = record.date;
    if (!recordsByDateAndEmployee.has(dateKey)) {
      recordsByDateAndEmployee.set(dateKey, new Map());
    }

    const dateMap = recordsByDateAndEmployee.get(dateKey)!;
    if (!dateMap.has(record.employeeName)) {
      dateMap.set(record.employeeName, []);
    }

    dateMap.get(record.employeeName)!.push(record);
  });

  recordsByDateAndEmployee.forEach((employeeMap, date) => {
    if (!dailySummaryMap.has(date)) {
      dailySummaryMap.set(date, {
        availableHours: 0,
        netCapacity: 0,
        unavailability: 0,
        holidays: 0,
        sickness: 0,
        scheduledHours: 0,
        clientScheduledHours: 0,
        otherScheduledHours: 0,
      });
    }

    const summary = dailySummaryMap.get(date)!;

    employeeMap.forEach((records, _employeeName) => {
      let bestRecord = records[0];

      records.forEach((record) => {
        if (record.contractedDailyHours > bestRecord.contractedDailyHours) {
          bestRecord = record;
        }
      });

      const empNorm = normalizeName(_employeeName);
      const schedKey = `${empNorm}|${date}`;
      const empScheduled = scheduledHoursMap.get(schedKey) || 0;
      const empClientScheduled = clientScheduledHoursMap.get(schedKey) || 0;

      let empHolidays = 0;
      let empSickness = 0;
      let empUnavailability = 0;

      records.forEach((record) => {
        if (record.status === "Holiday" || record.status === "Partial Holiday") {
          empHolidays += record.hours;
        } else if (record.status === "Sick" || record.status === "Partial Sick") {
          empSickness += record.hours;
        } else if (
          [
            "Maternity/Paternity",
            "Compassionate Leave",
            "Other Unavailable",
            "Pre-Agreed Appointment",
            "Partial Maternity/Paternity",
            "Partial Compassionate Leave",
            "Partial Availability",
          ].includes(record.status)
        ) {
          empUnavailability += record.hours;
        }
      });

      const daily = bestRecord.contractedDailyHours;
      const totalDeductions = empHolidays + empSickness + empUnavailability;

      if (totalDeductions > daily && daily > 0) {
        const ratio = daily / totalDeductions;
        empHolidays *= ratio;
        empSickness *= ratio;
        empUnavailability *= ratio;
      }

      const empNetCapacity = Math.max(0, daily - empHolidays - empSickness - empUnavailability);
      summary.netCapacity += empNetCapacity;

      summary.availableHours += daily;

      summary.holidays += empHolidays;
      summary.sickness += empSickness;
      summary.unavailability += empUnavailability;

      summary.scheduledHours += empScheduled;
      summary.clientScheduledHours += empClientScheduled;
      summary.otherScheduledHours += Math.max(0, empScheduled - empClientScheduled);
    });
  });

  // Add scheduled hours for ad-hoc employees
  {
    const employeesAlreadyCounted = new Set<string>();
    recordsByDateAndEmployee.forEach((employeeMap, date) => {
      employeeMap.forEach((_records, empName) => {
        employeesAlreadyCounted.add(`${normalizeName(empName)}|${date}`);
      });
    });

    let adhocTotal = 0;
    let adhocCount = 0;
    scheduledHoursMap.forEach((schedHours, key) => {
      if (schedHours <= 0) return;

      const upperKey = key.toUpperCase();
      if (upperKey.includes("PALMER") || upperKey.includes("CAMPBELL")) {
        logger.debug(`[PROACTIVE] Found target employee in scheduledHoursMap: ${key} = ${schedHours}h`);
      }

      if (employeesAlreadyCounted.has(key)) return;

      const pipeIdx = key.lastIndexOf("|");
      if (pipeIdx < 0) return;
      const date = key.substring(pipeIdx + 1);
      if (!date) return;

      if (!dailySummaryMap.has(date)) {
        dailySummaryMap.set(date, {
          availableHours: 0,
          netCapacity: 0,
          unavailability: 0,
          holidays: 0,
          sickness: 0,
          scheduledHours: 0,
          clientScheduledHours: 0,
          otherScheduledHours: 0,
        });
      }

      const summary = dailySummaryMap.get(date)!;
      const clientSched = clientScheduledHoursMap.get(key) || 0;
      summary.scheduledHours += schedHours;
      summary.clientScheduledHours += clientSched;
      summary.otherScheduledHours += Math.max(0, schedHours - clientSched);

      adhocTotal += schedHours;
      adhocCount++;
      logger.debug(`  Ad-hoc scheduled hours added to daily summary: ${key} => ${schedHours}h (client: ${clientSched}h)`);
    });
    logger.debug(`  TOTAL AD-HOC HOURS ADDED TO DAILY SUMMARY: ${adhocCount} entries, ${Math.round(adhocTotal * 100) / 100}h`);
  }

  // Step 8: Merge with client demand
  const demandMap = new Map<string, number>();
  demand.forEach((row) => {
    const dateStr = format(parseDate(row.Date), "yyyy-MM-dd");
    demandMap.set(dateStr, row["Required Client Hours"]);
  });

  const SKIP_DATE = "2026-01-25";

  const dailySummary: DailySummaryRecord[] = Array.from(
    dailySummaryMap.entries(),
  )
    .filter(([date]) => date !== SKIP_DATE)
    .map(([date, summary]) => {
      const clientRequired = demandMap.get(date) || 0;
      const gap =
        Math.round((summary.netCapacity - clientRequired) * 100) / 100;

      return {
        date,
        availableHours: Math.round(summary.availableHours * 100) / 100,
        netCapacity: Math.round(summary.netCapacity * 100) / 100,
        unavailability: Math.round(summary.unavailability * 100) / 100,
        holidays: Math.round(summary.holidays * 100) / 100,
        sickness: Math.round(summary.sickness * 100) / 100,
        scheduledHours: Math.round(summary.scheduledHours * 100) / 100,
        clientScheduledHours: Math.round(summary.clientScheduledHours * 100) / 100,
        otherScheduledHours: Math.round(summary.otherScheduledHours * 100) / 100,
        clientRequired: Math.round(clientRequired * 100) / 100,
        gap,
        status: (gap >= 0 ? "Sufficient" : "Shortage") as
          | "Sufficient"
          | "Shortage",
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // Step 9: Calculate KPIs
  logger.debug(`\n===== DAILY SUMMARY CLIENT REQUIRED BREAKDOWN =====`);
  let totalClientRequired = 0;
  dailySummary.forEach((d) => {
    logger.debug(`  - ${d.date}: ${d.clientRequired} hours`);
    totalClientRequired += d.clientRequired;
  });
  logger.debug(
    `TOTAL CLIENT REQUIRED FROM DAILY SUMMARY: ${Math.round(totalClientRequired * 100) / 100}`,
  );
  logger.debug(`==================================================\n`);

  const kpis = {
    netCapacitySum:
      Math.round(
        dailySummary.reduce((sum, d) => sum + d.netCapacity, 0) * 100,
      ) / 100,
    totalDesiredHoursSum:
      Math.round(
        dailySummary.reduce((sum, d) => sum + d.availableHours, 0) * 100,
      ) / 100,
    clientRequiredSum:
      Math.round(
        dailySummary.reduce((sum, d) => sum + d.clientRequired, 0) * 100,
      ) / 100,
    gapSum:
      Math.round(dailySummary.reduce((sum, d) => sum + d.gap, 0) * 100) / 100,
    unavailabilitySum:
      Math.round(
        dailySummary.reduce((sum, d) => sum + d.unavailability, 0) * 100,
      ) / 100,
    holidaysSum:
      Math.round(dailySummary.reduce((sum, d) => sum + d.holidays, 0) * 100) /
      100,
    sicknessSum:
      Math.round(dailySummary.reduce((sum, d) => sum + (d as any).sickness, 0) * 100) /
      100,
    totalScheduledHoursSum:
      Math.round(dailySummary.reduce((sum, d) => sum + (d as any).scheduledHours, 0) * 100) /
      100,
    clientScheduledHoursSum:
      Math.round(dailySummary.reduce((sum, d) => sum + (d as any).clientScheduledHours, 0) * 100) / 100,
    otherScheduledHoursSum:
      Math.round(dailySummary.reduce((sum, d) => sum + (d as any).otherScheduledHours, 0) * 100) / 100,
    capacityAfterSchedulingSum:
      Math.round(dailySummary.reduce((sum, d) => sum + (d.netCapacity - d.clientRequired), 0) * 100) / 100,
  };

  // Step 10: Build employees by date for drilldown
  const employeesByDate: Record<string, EmployeeDailyDetail[]> = {};

  cleanedRecords.forEach((record) => {
    if (!employeesByDate[record.date]) {
      employeesByDate[record.date] = [];
    }

    const empNormalizedName = normalizeName(record.employeeName);
    const masterEmployee = masterEmployees.find(
      (emp) => emp.normalizedName === empNormalizedName,
    );
    const gender = masterEmployee?.gender || "";

    employeesByDate[record.date].push({
      employeeName: record.employeeName,
      status: record.status,
      timeWindows: record.timeWindows,
      contractedDailyHours: record.contractedDailyHours,
      scheduledHours: record.scheduledHours,
      hours: record.hours,
      netCapacity: record.netCapacity,
      notes: record.notes,
      gender: gender,
    });
  });

  // Inject Ad-hoc rows
  const adhocWindowsMap = buildAdHocWindowsMap(guaranteed);
  {
    const displayNameMap = buildDisplayNameMap(guaranteed);

    const present: Record<string, Set<string>> = {};
    for (const [date, list] of Object.entries(employeesByDate)) {
      present[date] = new Set(list.map((e) => normalizeName(e.employeeName)));
    }

    Array.from(scheduledHoursMap.entries()).forEach(([key, schedHoursRaw]) => {
      if ((schedHoursRaw || 0) <= 0) return;
      const pipeIdx = key.lastIndexOf("|");
      if (pipeIdx < 0) return;
      const normName = key.substring(0, pipeIdx);
      const date = key.substring(pipeIdx + 1);
      if (!date || !normName) return;

      const already = present[date]?.has(normName);
      if (already) return;

      const display = displayNameMap.get(normName) || normName;
      const windows = (adhocWindowsMap.get(key) || [])
        .map(([s, e]: [number, number]) => `${fromMin(s)}-${fromMin(e)}`)
        .join("; ");

      const masterEmployee = masterEmployees.find(
        (emp) => emp.normalizedName === normName,
      );
      const gender = masterEmployee?.gender || "";

      logger.debug(`  INJECTING AD-HOC EMPLOYEE: ${display} (norm: ${normName}) on ${date} with ${schedHoursRaw}h scheduled`);

      if (!employeesByDate[date]) employeesByDate[date] = [];
      employeesByDate[date].push({
        employeeName: display,
        status: "Ad-hoc",
        timeWindows: windows,
        contractedDailyHours: 0,
        scheduledHours: Math.round(schedHoursRaw * 100) / 100,
        hours: 0,
        netCapacity: 0,
        notes: "Scheduled (no availability record for this day)",
        gender: gender,
      });

      if (!present[date]) present[date] = new Set();
      present[date].add(normName);
    });
  }

  logger.debug(`\n===== AD-HOC INJECTION SUMMARY =====`);
  let totalAdhocInjected = 0;
  Object.entries(employeesByDate).forEach(([date, emps]) => {
    const adhocEmps = emps.filter(e => e.status === "Ad-hoc");
    if (adhocEmps.length > 0) {
      logger.debug(`  ${date}: ${adhocEmps.length} ad-hoc employees`);
      adhocEmps.forEach(e => {
        logger.debug(`    - ${e.employeeName}: ${e.scheduledHours}h`);
        totalAdhocInjected++;
      });
    }
  });
  logger.debug(`  TOTAL AD-HOC INJECTED: ${totalAdhocInjected}`);
  logger.debug(`====================================\n`);

  Object.values(employeesByDate).forEach((employees) => {
    employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  });

  // Step 9: Generate employee summary by date
  const employeeSummaryByDate: Record<string, any[]> = {};

  for (const [dateStr, employees] of Object.entries(employeesByDate)) {
    logger.debug(`\nEXTRACTING CANCELLED VISITS FOR ${dateStr}...`);
    const cancelledVisitsForDate = options?.ghWorkbookBuffer
      ? await extractCancelledWindowsFromGHWorkbook(
          options.ghWorkbookBuffer,
          new Date(dateStr),
          0,
        )
      : new Map<string, string>();
    logger.debug(
      `Found ${cancelledVisitsForDate.size} employees with cancelled visits on ${dateStr}`,
    );

    const employeeMap = new Map<
      string,
      {
        contractedDailyHours: number;
        scheduledHours: number;
        unavailabilityHours: number;
        hasAvailableStatus: boolean;
        hasUnavailableStatus: boolean;
        hasPartialAvailability: boolean;
      }
    >();

    employees.forEach((emp) => {
      const key = emp.employeeName;

      if (!employeeMap.has(key)) {
        const empNormalized = normalizeName(emp.employeeName);
        const scheduleKey = `${empNormalized}|${dateStr}`;
        const scheduledHoursFromLookup = scheduledHoursMap.get(scheduleKey) || 0;

        logger.debug(`Employee summary for ${emp.employeeName} on ${dateStr}:`);
        logger.debug(`  - Normalized: ${empNormalized}`);
        logger.debug(`  - Lookup key: ${scheduleKey}`);
        logger.debug(`  - Scheduled hours from lookup: ${scheduledHoursFromLookup}`);
        logger.debug(`  - Scheduled hours from emp object: ${emp.scheduledHours || 0}`);

        employeeMap.set(key, {
          contractedDailyHours: emp.contractedDailyHours,
          scheduledHours: scheduledHoursFromLookup,
          unavailabilityHours: 0,
          hasAvailableStatus: false,
          hasUnavailableStatus: false,
          hasPartialAvailability: false,
        });
      }

      const empData = employeeMap.get(key)!;

      empData.contractedDailyHours = Math.max(
        empData.contractedDailyHours,
        emp.contractedDailyHours,
      );

      const isPartialStatus = emp.status.startsWith("Partial ");

      if (emp.status === "Available") {
        empData.hasAvailableStatus = true;
      } else if (isPartialStatus) {
        empData.hasPartialAvailability = true;
        empData.unavailabilityHours += emp.hours;
      } else {
        empData.hasUnavailableStatus = true;
        empData.unavailabilityHours += emp.hours;
      }
    });

    employeeSummaryByDate[dateStr] = Array.from(employeeMap.entries()).map(
      ([employeeName, empData]) => {
        let finalUnavailabilityHours = empData.unavailabilityHours;

        const employeeDetails =
          employeesByDate[dateStr]?.filter(
            (emp) => emp.employeeName === employeeName,
          ) || [];

        let availabilityWindows = "";
        let unavailabilityWindows = "";
        let scheduledWindows = "";

        employeeDetails.forEach((emp) => {
          if (
            emp.status === "Available" &&
            emp.timeWindows &&
            emp.timeWindows !== "-"
          ) {
            availabilityWindows = availabilityWindows
              ? `${availabilityWindows}, ${emp.timeWindows}`
              : emp.timeWindows;
          } else if (
            LEAVE_TYPES.includes(emp.status) &&
            emp.timeWindows &&
            emp.timeWindows !== "-"
          ) {
            unavailabilityWindows = unavailabilityWindows
              ? `${unavailabilityWindows}, ${emp.timeWindows}`
              : emp.timeWindows;
          } else if (
            emp.status === "Ad-hoc" &&
            emp.timeWindows &&
            emp.timeWindows !== "-"
          ) {
            scheduledWindows = scheduledWindows
              ? `${scheduledWindows}, ${emp.timeWindows}`
              : emp.timeWindows;
          }
        });

        const empNormalized = normalizeName(employeeName);
        const scheduleKey = `${empNormalized}|${dateStr}`;
        const guaranteedWindows = adhocWindowsMap.get(scheduleKey);
        if (guaranteedWindows && guaranteedWindows.length > 0) {
          const guaranteedWindowStrings = guaranteedWindows
            .map(
              ([start, end]: [number, number]) =>
                `${fromMin(start)}-${fromMin(end)}`,
            )
            .join(", ");
          scheduledWindows = scheduledWindows
            ? `${scheduledWindows}, ${guaranteedWindowStrings}`
            : guaranteedWindowStrings;
        }

        let freeWindows = "";
        try {
          if (availabilityWindows) {
            const allWindows = availabilityWindows
              .split(',')
              .map(w => w.trim())
              .filter(w => w && w.includes('-'));

            const dayWindows = allWindows.filter(w => {
              const [start] = w.split('-').map(t => t.trim());
              const startHour = parseInt(start.split(':')[0]);
              return startHour >= 6 && startHour < 22;
            });

            if (dayWindows.length === 0 && allWindows.length > 0) {
              logger.debug(`EXCLUDING night-only employee from capacity: ${employeeName} on ${dateStr}`);
              return null;
            }

            const filteredAvailability = dayWindows.join(', ');

            if (filteredAvailability) {
              const capacityResult = computeCapacityWindows(
                {
                  employeeName,
                  date: dateStr,
                  availabilityWindows: filteredAvailability,
                  unavailabilityWindows,
                  scheduledWindows,
                  desiredMinutes: empData.contractedDailyHours * 60,
                },
                {
                  roundToMinutes: 15,
                  minWindowMinutes: 60,
                  bufferMinutes: 0,
                },
              );
              freeWindows = capacityResult.freeWindows;
            }
          }
        } catch (error) {
          logger.warn(
            `Error calculating free windows for ${employeeName} on ${dateStr}:`,
            error,
          );
          freeWindows = "";
        }

        const empNormalizedName = normalizeName(employeeName);
        const cancelledVisits =
          cancelledVisitsForDate.get(empNormalizedName) ?? "—";

        const masterEmployee = masterEmployees.find(
          (emp) => emp.normalizedName === empNormalizedName,
        );
        const transportMode = masterEmployee?.transportMode || "";
        const gender = masterEmployee?.gender || "";

        if (!gender) {
          logger.debug(`SUMMARY: ${employeeName} on ${dateStr} - NO GENDER (normalized: ${empNormalized})`);
        }

        const summaryRecord = {
          employeeName,
          availability: empData.contractedDailyHours,
          unavailability: finalUnavailabilityHours,
          scheduledHours: empData.scheduledHours,
          difference:
            empData.contractedDailyHours -
            finalUnavailabilityHours -
            empData.scheduledHours,
          freeWindows,
          cancelledVisits,
          transportMode,
          gender,
        };

        if (empData.scheduledHours > 0) {
          logger.debug(`SUMMARY RECORD with scheduled hours: ${employeeName} on ${dateStr} = ${empData.scheduledHours}h`);
        }

        return summaryRecord;
      },
    ).filter((record): record is NonNullable<typeof record> => record !== null);
  }

  Object.values(employeesByDate).forEach((employees) => {
    employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  });

  const result = {
    kpis,
    dailySummary,
    employeesByDate,
    employeeSummaryByDate,
    cleanedRecords,
    warnings: warnings.length > 0 ? warnings : undefined,
  };

  // Save to database for historical tracking
  try {
    const weekStart = result.dailySummary[0]?.date || "";
    const weekEnd =
      result.dailySummary[result.dailySummary.length - 1]?.date || "";

    if (!branchId) {
      throw new Error("branchId is required to save capacity analysis");
    }

    const analysisData: InsertCapacityAnalysis = {
      branchId,
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      kpis: result.kpis as any,
      dailySummary: result.dailySummary as any,
      employeesByDate: result.employeesByDate as any,
      employeeSummaryByDate: result.employeeSummaryByDate as any,
      warnings: result.warnings as any,
    };

    storage
      .saveCapacityAnalysis(analysisData)
      .then(() => {
        logger.debug("Successfully saved capacity analysis to database");
      })
      .catch((error) => {
        logger.error("Error saving to database:", error);
      });
  } catch (error) {
    logger.error("Error preparing database save:", error);
  }

  // Extract and store geographical data for scheduling optimization
  if (branchId) {
    await extractAndStoreGeographicalData(cgData, guaranteed, branchId, options?.ghWorkbookBuffer);
  } else {
    logger.debug(`WARNING: No branchId provided - skipping geographical data extraction`);
  }

  // Retrieve geographical data to include in the result
  try {
    const employeeLocations = branchId ? await storage.getAllEmployeeLocations(branchId) : [];
    const clientLocations = branchId ? await storage.getAllClientLocations(branchId) : [];

    const resultWithLocations = result as ProcessingResult;

    resultWithLocations.employeeLocations = employeeLocations.map(emp => ({
      employeeName: emp.employeeName,
      homePostcode: emp.homePostcode,
      homeLat: emp.homeLat ? Number(emp.homeLat) : undefined,
      homeLng: emp.homeLng ? Number(emp.homeLng) : undefined,
      transportMode: emp.transportMode || undefined,
      gender: emp.gender || undefined,
    }));

    resultWithLocations.clientLocations = clientLocations.map(cli => ({
      clientName: cli.clientName,
      addressLine: cli.addressLine,
      postcode: cli.postcode,
      lat: cli.lat ? Number(cli.lat) : undefined,
      lng: cli.lng ? Number(cli.lng) : undefined,
    }));

    logger.debug(`Including ${resultWithLocations.employeeLocations.length} employee locations and ${resultWithLocations.clientLocations.length} client locations in result`);
  } catch (error) {
    logger.error('Error retrieving geographical data:', error);
  }

  return result;
}
