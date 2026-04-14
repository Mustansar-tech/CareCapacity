import * as XLSX from "../../shared/xlsx-compat.js";
import { logger } from '../../infrastructure/logger';
import { parse, format, addDays, differenceInDays } from "date-fns";
import { buildTimeWindow, parseGuaranteedDate } from "../../shared/utils/time-window-utils";
import {
  AvailabilityRow,
  GuaranteedHoursRow,
  ClientDemandRow,
} from "@shared/schema";
import {
  ParsedAvailabilityRow,
  CGDataRow,
  AVAIL_SHEET,
  GUAR_SHEET,
  CLIENT_COLS,
  CANCEL_COLS,
  EMPLOYEE_NAME_COLS,
  START_TIME_COLS,
  END_TIME_COLS,
  SERVICE_TYPE_COLS,
  PAY_HOURS_COLS,
  DAY_KILLERS,
  pickCol,
  normalizeName,
  canonicalStatus,
  resolveServiceTimestamps,
  parseDate,
  hoursBetween,
  isCancellationBlank,
  isSecondaryMultipleCare,
} from "./pipeline-utils";
import { extractBranchFromRow, normalizeBranchName } from "./geocoding";

// ─── Private helper: find the right CG Data sheet ────────────────────────────

function getCGSheetName(wb: any): string {
  const preferred = ["Data", "Employees", "CG Data", "Master", "Sheet1"];
  for (const n of preferred) if (wb.SheetNames.includes(n)) return n;

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      range: 0,
      blankrows: false,
    }) as any;
    const header = (rows?.[0] ?? []).map((c: any) =>
      String(c ?? "").trim().toLowerCase(),
    );
    const hasName =
      header.includes("caregiver name") ||
      (header.includes("first name") && header.includes("last name"));
    const hasHours = [
      "weekly hours",
      "hours per week",
      "contracted weekly hours",
      "contracted hours",
      "hours contracted",
    ].some((h) => header.includes(h));
    if (hasName && hasHours) return name;
  }

  return wb.SheetNames[0];
}

// ─── Public export ────────────────────────────────────────────────────────────

export async function parseExcelFiles(
  availabilityBuffer: Buffer,
  guaranteedBuffer: Buffer,
  cgDataBuffer: Buffer,
  ghWorkbookBuffer?: Buffer,
  branchId?: string,
): Promise<{
  availability: ParsedAvailabilityRow[];
  guaranteed: GuaranteedHoursRow[];
  guaranteedRaw: GuaranteedHoursRow[];
  demand: ClientDemandRow[];
  cgData: CGDataRow[];
  warnings: string[];
  detectedBranch: string | null;
}> {
  logger.debug(`\n===== PARSING EXCEL FILES FUNCTION STARTED =====`);
  logger.debug(
    `Buffer lengths: availability=${availabilityBuffer?.length}, guaranteed=${guaranteedBuffer?.length}, cgData=${cgDataBuffer?.length}`,
  );
  const warnings: string[] = [];

  // Parse Availability Export.xlsx
  const availabilityWorkbook = await XLSX.read(availabilityBuffer);
  const availabilitySheetName = AVAIL_SHEET;
  if (!availabilityWorkbook.SheetNames.includes(availabilitySheetName)) {
    throw new Error(
      `Sheet "${availabilitySheetName}" not found in Availability Export file`,
    );
  }

  const availabilitySheet = availabilityWorkbook.Sheets[availabilitySheetName];
  const availabilityData =
    XLSX.utils.sheet_to_json<AvailabilityRow>(availabilitySheet);

  // Parse Care Pro Guaranteed Hours.xlsx
  const guaranteedWorkbook = await XLSX.read(guaranteedBuffer);
  logger.debug(`Guaranteed workbook sheets available:`, guaranteedWorkbook.SheetNames);

  const guaranteedSheetName = GUAR_SHEET;
  if (!guaranteedWorkbook.SheetNames.includes(guaranteedSheetName)) {
    throw new Error(
      `Sheet "${guaranteedSheetName}" not found in Care Pro Guaranteed Hours file. Available sheets: ${guaranteedWorkbook.SheetNames.join(', ')}`,
    );
  }

  const guaranteedSheet = guaranteedWorkbook.Sheets[guaranteedSheetName];
  const guaranteedData = XLSX.utils.sheet_to_json<GuaranteedHoursRow>(guaranteedSheet, {
    defval: "",
  });

  logger.debug(`Guaranteed Hours sheet parsed: ${guaranteedData.length} rows found`);
  logger.debug(`Branch context: ${branchId || 'NO BRANCH ID'}`);
  if (guaranteedData.length > 0) {
    logger.debug(`First row columns:`, Object.keys(guaranteedData[0]).slice(0, 15));
    logger.debug(`First row sample:`, JSON.stringify(guaranteedData[0]).substring(0, 400));
  }

  // === Calculate demand from Guaranteed Hours data ===
  logger.debug(`Calculating demand from Guaranteed Hours data...`);

  const demandRows = guaranteedData.filter(row => {
    const cancellation = row["Cancellation Description"];
    const isCancelled = cancellation && String(cancellation).trim().length > 0;
    if (isCancelled) return false;

    if (isSecondaryMultipleCare(row["Actual Service Type Description"] || "")) return false;

    const serviceType = row["Actual Service Type Description"] || "";
    const normalizedServiceType = String(serviceType)
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const DEMAND_EXCLUDED_TYPES = [
      'multiple care (secondary)',
      'secondary',
      '(secondary)',
      'oncall',
      'on call',
      'office hours',
      'office',
      'training',
      'shadowing',
      'nights - sleep in',
      'sleep in',
      'nights - waking nights',
      'waking nights',
      'night',
      'overnight',
      'sleepover'
    ];

    const isExcludedType = DEMAND_EXCLUDED_TYPES.some(excluded =>
      normalizedServiceType.includes(excluded.replace(/[^\w\s]/g, '').replace(/\s+/g, ' '))
    );

    if (isExcludedType) return false;

    return true;
  });

  const totalFiltered = guaranteedData.length - demandRows.length;
  logger.debug(
    `DEMAND FILTERING (INCLUSIVE): Excluded ${totalFiltered} rows from ${guaranteedData.length} total Guaranteed Hours entries`,
  );

  const cancelledRows = guaranteedData.filter(row => {
    const cancellation = row["Cancellation Description"];
    return cancellation && String(cancellation).trim().length > 0;
  });
  const cancelledHours = cancelledRows.reduce((sum, r) => sum + (Number(r["Planned Duration"]) || 0), 0);

  const secondaryRows = guaranteedData.filter(row =>
    isSecondaryMultipleCare(row["Actual Service Type Description"] || "")
  );
  const secondaryHours = secondaryRows.reduce((sum, r) => sum + (Number(r["Planned Duration"]) || 0), 0);

  logger.debug(`  Cancelled: ${cancelledRows.length} rows (${Math.round(cancelledHours * 100) / 100}h)`);
  logger.debug(`  Secondary care: ${secondaryRows.length} rows (${Math.round(secondaryHours * 100) / 100}h)`);
  logger.debug(`  Night shifts: EXCLUDED from demand calculation`);
  logger.debug(`  Office hours, Training, Shadowing: EXCLUDED as requested`);

  const hoursByWeekday = new Map<string, number>();
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  demandRows.forEach(row => {
    const plannedStart = row["Planned Start Date And Time"];
    if (!plannedStart) return;

    const startDate = parseDate(plannedStart);
    const plannedEnd = row["Planned End Date And Time"];

    if (plannedEnd) {
      const endDate = parseDate(plannedEnd);
      if (format(startDate, "yyyy-MM-dd") !== format(endDate, "yyyy-MM-dd")) {
        if (demandRows.indexOf(row) < 10) {
          logger.debug(`  EXCLUDING overnight visit from demand: ${row["Actual Employee Name"]} starts ${format(startDate, "yyyy-MM-dd HH:mm")} ends ${format(endDate, "yyyy-MM-dd HH:mm")}`);
        }
        return;
      }
    }

    const weekdayName = weekdayNames[startDate.getDay()];

    const durationCols = [
      "Planned Duration",
      "Duration (Planned)",
      "Duration",
      "Planned Hrs",
      "Planned Hours",
      "Planned Time",
    ];

    let duration = 0;
    let foundColumn = "";
    for (const col of durationCols) {
      const rawVal = row[col];
      const val = Number(rawVal);
      if (val && isFinite(val) && val > 0) {
        duration = val;
        foundColumn = col;
        break;
      }
    }

    const currentTotal = hoursByWeekday.get(weekdayName) || 0;
    if (demandRows.indexOf(row) < 10) {
      logger.debug(`  Row ${demandRows.indexOf(row) + 1}: ${weekdayName} - ${duration}h from "${foundColumn}" (running total: ${currentTotal + duration}h)`);
    }

    if (duration > 0) {
      hoursByWeekday.set(weekdayName, currentTotal + duration);
    } else if (demandRows.indexOf(row) < 10) {
      logger.debug(`  Row ${demandRows.indexOf(row) + 1}: NO DURATION FOUND - checked columns: ${durationCols.join(", ")}`);
    }
  });

  const hoursByWeekdayArray = Array.from(hoursByWeekday.entries())
    .map(({0: weekday, 1: hours}) => ({ weekday, hours: Math.round(hours * 100) / 100 }))
    .sort((a, b) => a.weekday.localeCompare(b.weekday));

  logger.debug(`Calculated demand from Guaranteed Hours:`, hoursByWeekdayArray);
  logger.debug(`Total demand rows after filtering: ${demandRows.length}`);

  // Parse CG Data Export.xlsx (Master Employee List) — robust sheet detection
  const cgDataWorkbook = await XLSX.read(cgDataBuffer);
  const cgDataSheetName = getCGSheetName(cgDataWorkbook);
  const cgDataSheet = cgDataWorkbook.Sheets[cgDataSheetName];
  const cgRowsRaw = XLSX.utils.sheet_to_json<Record<string, any>>(cgDataSheet, {
    defval: "",
  });

  logger.debug(`CG Data sheet names available:`, cgDataWorkbook.SheetNames);
  logger.debug(`Using sheet: "${cgDataSheetName}"`);
  logger.debug(`Raw CG Data rows: ${cgRowsRaw.length}`);
  if (cgRowsRaw.length > 0) {
    logger.debug(`First raw CG Data row:`, cgRowsRaw[0]);
    logger.debug(`Available columns:`, Object.keys(cgRowsRaw[0]));
  }

  const cgData = cgRowsRaw
    .map((row) => {
      const name =
        pickCol(row, ["CAREGiver Name"]) ||
        `${pickCol(row, ["First Name"]) || ""} ${pickCol(row, ["Last Name"]) || ""}`.trim();

      const weeklyRaw = pickCol(row, [
        "Weekly Hours",
        "Hours Per Week",
        "Hours per week",
        "Contracted Weekly Hours",
        "Contracted Hours",
        "Hours Contracted",
      ]);

      const transportMode =
        pickCol(row, [
          "TransportModeDescription",
          "Transport Mode Description",
          "Transport Mode",
          "Transport",
        ]) || "";

      const title =
        pickCol(row, ["Title", "Employee Title", "Title Description"]) || "";

      const postCode =
        pickCol(row, ["Post Code", "PostCode", "Postal Code", "ZIP Code", "Zip Code"]) || "";

      const gender = (() => {
        const titleLower = title.toLowerCase().trim();
        if (titleLower === "mr") return "male";
        if (["miss", "ms", "mrs"].includes(titleLower)) return "female";
        return "";
      })();

      const weekly = Number(weeklyRaw ?? 0);
      return {
        "CAREGiver Name": name,
        "Weekly Hours": isFinite(weekly) ? weekly : 0,
        TransportModeDescription: transportMode,
        Title: title,
        Gender: gender,
        PostCode: postCode,
      };
    })
    .filter((r) => r["CAREGiver Name"] && r["Weekly Hours"] > 0);

  logger.debug(
    `CG Data: ${cgRowsRaw.length} rows → ${cgData.length} employees with weekly hours (sheet: ${cgDataSheetName})`,
  );
  if (cgData.length > 0) {
    logger.debug(`First processed CG Data row:`, cgData[0]);

    const genderStats = cgData.reduce((acc, emp) => {
      const g = emp.Gender || "unknown";
      acc[g] = (acc[g] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    logger.debug(`Gender distribution:`, genderStats);

    const samplesWithGender = cgData.slice(0, 5).map(emp => ({
      name: emp["CAREGiver Name"],
      title: emp.Title,
      gender: emp.Gender || "unknown"
    }));
    logger.debug(`Sample employees loaded: ${samplesWithGender.length} records`);
  } else {
    logger.debug(`No valid CG Data rows found - check column names and data`);
  }

  // Pass 1: scan all Available rows to build sameDayAvailKeys + midnightAvailDates
  const sameDayAvailKeys   = new Set<string>();
  const midnightAvailDates = new Set<string>();

  for (const row of availabilityData) {
    try {
      if (!row["CAREGiver Name"] || !row["Start Date"]) continue;
      const canonStatus = canonicalStatus(row.Type ?? row.Status ?? "");
      if (canonStatus !== "Available" && canonStatus !== "Ad-hoc") continue;
      const parsedStartDate = parseDate(row["Start Date"]);
      const startCalDate = format(parsedStartDate, "yyyy-MM-dd");
      const key = `${row["CAREGiver Name"]}|${startCalDate}`;

      if (row["End Date"]) {
        const parsedEndDate = parseDate(row["End Date"]);
        if (format(parsedStartDate, "yyyy-MM-dd") !== format(parsedEndDate, "yyyy-MM-dd")) {
          midnightAvailDates.add(key);
          continue;
        }
      }
      sameDayAvailKeys.add(key);
    } catch { /* ignore parse errors in pass 1 */ }
  }

  const rejectedDateKeys = new Set<string>();
  for (const key of midnightAvailDates) {
    if (!sameDayAvailKeys.has(key)) rejectedDateKeys.add(key);
  }

  // Pass 2: full validation loop
  const validatedAvailability: ParsedAvailabilityRow[] = [];
  availabilityData.forEach((row, index) => {
    try {
      if (!row["CAREGiver Name"] || !row["Start Date"]) {
        warnings.push(`Availability row ${index + 1}: Missing required fields`);
        return;
      }

      const empName = row["CAREGiver Name"];
      const parsedStartDate = parseDate(row["Start Date"]);
      const startCalDate = format(parsedStartDate, "yyyy-MM-dd");

      const entryDateKey = `${empName}|${startCalDate}`;
      if (rejectedDateKeys.has(entryDateKey)) {
        logger.debug(`Rejecting all entries for ${empName} on ${startCalDate} — overnight-only availability format (unsupported)`);
        return;
      }

      const canonStatus = canonicalStatus(row.Type ?? row.Status ?? "");
      const isDayKiller = DAY_KILLERS.has(canonStatus);

      if (row["End Date"]) {
        try {
          const parsedEndDate = parseDate(row["End Date"]);
          const startCalDate2 = format(parsedStartDate, "yyyy-MM-dd");
          const endCalDate   = format(parsedEndDate,   "yyyy-MM-dd");
          const crossesMidnight = startCalDate2 !== endCalDate;

          if (crossesMidnight) {
            if (isDayKiller) {
              const diffInDays = Math.max(1, Math.abs(differenceInDays(parsedEndDate, parsedStartDate)));
              const daysToExpand = Math.min(diffInDays, 14);
              let expanded = 0;
              for (let d = 0; d < daysToExpand; d++) {
                const dayDate = addDays(parsedStartDate, d);
                const key = `${empName}|${format(dayDate, "yyyy-MM-dd")}`;
                if (!sameDayAvailKeys.has(key)) {
                  logger.debug(`Skipping ${canonStatus} expansion for ${empName} on ${format(dayDate, "yyyy-MM-dd")} — no same-calendar-day Available entry`);
                  continue;
                }
                validatedAvailability.push({
                  ...row,
                  parsedDate: dayDate,
                  calculatedHours: 24,
                  "Time Window(s)": "",
                });
                expanded++;
              }
              if (expanded > 0) {
                logger.debug(`Expanded midnight-crossing ${canonStatus} for ${empName} into ${expanded} daily entries`);
              }
            } else {
              logger.debug(`REJECTING midnight-crossing availability for ${empName}: ${startCalDate2}→${endCalDate}`);
              warnings.push(
                `Availability row ${index + 1} (${empName}): Rejected - entry crosses midnight (${startCalDate2}→${endCalDate}). Only same-day availability is supported.`,
              );
            }
            return;
          }
        } catch (endDateError) {
          logger.debug(`Could not parse end date for ${empName}, continuing with start date validation`);
        }
      }

      const effectiveHours =
        row.Hours ?? hoursBetween(row["Start Time"], row["End Time"]);

      if (isNaN(effectiveHours)) {
        warnings.push(
          `Availability row ${index + 1}: Cannot calculate hours from time range`,
        );
        return;
      }

      const rawWindows = row["Time Window(s)"] || row["Time Window"] || "";
      let timeWindows = "";

      if (typeof rawWindows === "string" && rawWindows.trim()) {
        const windows = rawWindows
          .split(/[;,]/)
          .map((w) => w.trim())
          .filter((w) => w);

        const processedWindows = windows
          .map((w) => {
            const match = w.match(
              /(\d{1,2}:\d{2})\s*[\-–—]\s*(\d{1,2}:\d{2})/,
            );
            if (match) {
              const startTime = match[1].padStart(5, "0");
              const endTime = match[2].padStart(5, "0");
              return `${startTime}-${endTime}`;
            }
            return null;
          })
          .filter((w): w is string => w !== null);

        timeWindows = processedWindows.join(", ");
      } else {
        const builtWindow = buildTimeWindow(row);
        if (builtWindow) {
          timeWindows = builtWindow;
        }
      }

      validatedAvailability.push({
        ...row,
        parsedDate: parsedStartDate,
        calculatedHours: effectiveHours,
        "Time Window(s)": timeWindows,
      });
    } catch (error) {
      warnings.push(
        `Availability row ${index + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  });

  // Process guaranteed hours data
  const validatedGuaranteed: GuaranteedHoursRow[] = [];
  let filteredSecondaryCount = 0;
  guaranteedData.forEach((row, index) => {
    try {
      const { start, end } = resolveServiceTimestamps(row);

      const serviceType = row["Actual Service Type Description"] || row["Service Type Description"] || "";
      const lowerType = String(serviceType).toLowerCase();

      const isOfficeHours = lowerType && (
        lowerType.includes('office') ||
        lowerType.includes('training') ||
        lowerType.includes('shadowing') ||
        lowerType.includes('shadow') ||
        lowerType.includes('internal') ||
        lowerType.includes('meeting') ||
        lowerType.includes('admin')
      );

      const empName = row["Actual Employee Name"] || row["Planned Employee Name"];

      const isNightShift = lowerType && (
        lowerType.includes('night') ||
        lowerType.includes('sleep in') ||
        lowerType.includes('waking') ||
        lowerType.includes('overnight') ||
        lowerType.includes('sleepover')
      );

      if (isNightShift) {
        logger.debug(`EXCLUDING night shift from capacity: ${empName} - ${serviceType}`);
        return;
      }

      if (empName && (
        String(empName).toLowerCase().includes("chloe") || String(empName).toLowerCase().includes("mcclymont") ||
        String(empName).toLowerCase().includes("palmer") || String(empName).toLowerCase().includes("campbell")
      )) {
        logger.debug(`TRACKED EMPLOYEE VALIDATION CHECK (row ${index + 1}):`);
        logger.debug(`  Service Type: "${serviceType}"`);
        logger.debug(`  isOfficeHours: ${isOfficeHours}`);
        logger.debug(`  isNightShift: ${isNightShift}`);
        logger.debug(`  Actual Employee Name: "${row["Actual Employee Name"]}"`);
        logger.debug(`  Planned Employee Name: "${row["Planned Employee Name"]}"`);
        logger.debug(`  empName (resolved): "${empName}"`);
        logger.debug(`  Pay Hours Raw: "${row["Actual Pay Rate Hours"]}" -> ${Number(row["Actual Pay Rate Hours"]) || 0}`);
        logger.debug(`  Hours Per Week: "${row["Actual Employee Hours Per Week"]}"`);
        logger.debug(`  Start: "${start}", End: "${end}"`);
        logger.debug(`  Cancellation: "${row["Cancellation Description"]}"`);
      }

      if (isOfficeHours) {
        if (!empName || !start || !end) {
          warnings.push(
            `Guaranteed hours row ${index + 1}: Office/shadowing row missing employee name or timestamps`,
          );
          return;
        }
      } else {
        if (!empName || !start || !end) {
          if (!empName) {
            logger.debug(`Guaranteed hours row ${index + 1}: SKIPPED - Missing employee name (Actual: "${row["Actual Employee Name"]}", Planned: "${row["Planned Employee Name"]}")`);
          } else {
            logger.debug(`Guaranteed hours row ${index + 1} (${empName}): SKIPPED - Missing timestamps (Start: ${start}, End: ${end})`);
          }

          warnings.push(
            `Guaranteed hours row ${index + 1}: Missing or invalid required fields`,
          );
          return;
        }
      }

      const isCancelOk = isCancellationBlank(row["Cancellation Description"]);
      const isSecondary = isSecondaryMultipleCare(
        row["Actual Service Type Description"] || "",
      );

      if (isSecondary) {
        filteredSecondaryCount++;
        return;
      }

      if (!isCancelOk) {
        return;
      }

      if (empName && (
        String(empName).toLowerCase().includes("chloe") || String(empName).toLowerCase().includes("mcclymont") ||
        String(empName).toLowerCase().includes("palmer") || String(empName).toLowerCase().includes("campbell")
      )) {
        logger.debug(`  TRACKED EMPLOYEE ROW ${index + 1} (${empName}) PASSED VALIDATION - adding to validatedGuaranteed`);
      }

      validatedGuaranteed.push(row);
    } catch (error) {
      warnings.push(
        `Guaranteed hours row ${index + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  });

  logger.debug(
    `SECONDARY CLIENT FILTERING: Excluded ${filteredSecondaryCount} rows with service descriptions from ${guaranteedData.length} total Care Pro entries`,
  );

  // === Map calculated demand to actual dates ===
  const validatedDemand: ClientDemandRow[] = [];

  const actualDates = new Set<string>();

  validatedAvailability.forEach((row) => {
    const dateStr = format(row.parsedDate, "yyyy-MM-dd");
    actualDates.add(dateStr);
  });

  validatedGuaranteed.forEach((row) => {
    try {
      const { start } = resolveServiceTimestamps(row);
      if (!start) return;

      const startDate = parseGuaranteedDate(start);
      const dateStr = format(startDate, "yyyy-MM-dd");
      actualDates.add(dateStr);
    } catch (error) {
      // Skip invalid dates
    }
  });

  let actualDatesArray = Array.from(actualDates).sort();

  if (actualDatesArray.length > 7) {
    logger.debug(`\nDETECTING WEEK BOUNDARY (${actualDatesArray.length} dates found):`);

    const sortedDates = [...actualDatesArray].sort();

    if (sortedDates.length > 7) {
      const firstDate = new Date(sortedDates[0]);
      const secondDate = new Date(sortedDates[1]);
      const lastDate = new Date(sortedDates[sortedDates.length - 1]);

      const daysBetweenSecondAndLast = Math.round(
        (lastDate.getTime() - secondDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const daysBetweenFirstAndSecond = Math.round(
        (secondDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysBetweenFirstAndSecond === 1 && daysBetweenSecondAndLast === 6) {
        logger.debug(`  Detected spillover date: ${sortedDates[0]} (removed)`);
        logger.debug(`  Core week: ${sortedDates[1]} to ${sortedDates[sortedDates.length - 1]}`);
        actualDatesArray = sortedDates.slice(1);
        actualDates.delete(sortedDates[0]);
      } else if (sortedDates.length === 8) {
        const secondToLastDate = new Date(sortedDates[sortedDates.length - 2]);
        const daysBetweenFirstAndSecondToLast = Math.round(
          (secondToLastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysBetweenFirstAndSecondToLast === 6) {
          logger.debug(`  Detected spillover date: ${sortedDates[sortedDates.length - 1]} (removed)`);
          logger.debug(`  Core week: ${sortedDates[0]} to ${sortedDates[sortedDates.length - 2]}`);
          actualDatesArray = sortedDates.slice(0, -1);
          actualDates.delete(sortedDates[sortedDates.length - 1]);
        }
      }
    }
  }

  const weekdayToActualDates: Record<string, string[]> = {
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    Sunday: [],
  };

  actualDatesArray.forEach((dateStr) => {
    const date = new Date(dateStr);
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const weekdayName = dayNames[date.getDay()];
    if (weekdayToActualDates[weekdayName]) {
      weekdayToActualDates[weekdayName].push(dateStr);
    }
  });

  logger.debug(`\nACTUAL DATES FOUND IN FILES:`);
  logger.debug(`  Total unique dates: ${actualDatesArray.length}`);
  logger.debug(
    `  Date range: ${actualDatesArray[0]} to ${actualDatesArray[actualDatesArray.length - 1]}`,
  );

  logger.debug(`\nWEEKDAY TO ACTUAL DATES MAPPING:`);
  Object.entries(weekdayToActualDates).forEach(([weekday, dates]) => {
    logger.debug(
      `  ${weekday}: ${dates.length > 0 ? dates.join(", ") : "No dates found"}`,
    );
  });
  logger.debug(`================================\n`);

  hoursByWeekdayArray.forEach(({ weekday, hours }) => {
    const actualDatesForWeekday = weekdayToActualDates[weekday] || [];

    if (actualDatesForWeekday.length === 0) {
      logger.debug(
        ` No actual dates found for ${weekday} (${hours}h) - skipping`,
      );
      return;
    }

    const hoursPerDate =
      actualDatesForWeekday.length > 1
        ? Math.round((hours / actualDatesForWeekday.length) * 100) / 100
        : hours;

    actualDatesForWeekday.forEach((dateStr) => {
      logger.debug(`Mapping: ${weekday} (${hoursPerDate}h) -> ${dateStr}`);
      validatedDemand.push({
        Date: dateStr,
        "Required Client Hours": hoursPerDate,
      });
    });
  });

  const totalHours = hoursByWeekdayArray.reduce((sum, { hours }) => sum + hours, 0);
  const mondayHours =
    hoursByWeekdayArray.find(({ weekday }) => weekday === "Monday")?.hours || 0;

  logger.debug(`\n===== DEMAND CALCULATION SUMMARY =====`);
  logger.debug(
    `Calculated from ${demandRows.length} Guaranteed Hours entries`,
  );
  logger.debug(`Monday hours: ${mondayHours}`);
  logger.debug(`Total hours: ${totalHours}`);
  logger.debug(`=======================================\n`);

  // === BRANCH EXTRACTION AND VALIDATION ===
  logger.debug(`\n===== BRANCH DETECTION =====`);

  const branchesDetected = new Set<string>();

  if (cgRowsRaw.length > 0) {
    const sampleBranches = cgRowsRaw.slice(0, 5).map(row => extractBranchFromRow(row)).filter(Boolean);
    sampleBranches.forEach(b => b && branchesDetected.add(normalizeBranchName(b)));
    logger.debug(`CG Data sample branches: ${sampleBranches.join(", ")}`);
  }

  if (guaranteedData.length > 0) {
    const sampleBranches = guaranteedData.slice(0, 5).map(row => extractBranchFromRow(row)).filter(Boolean);
    sampleBranches.forEach(b => b && branchesDetected.add(normalizeBranchName(b)));
    logger.debug(`Guaranteed Hours sample branches: ${sampleBranches.join(", ")}`);
  }

  if (availabilityData.length > 0) {
    const sampleBranches = availabilityData.slice(0, 5).map(row => extractBranchFromRow(row)).filter(Boolean);
    sampleBranches.forEach(b => b && branchesDetected.add(normalizeBranchName(b)));
    logger.debug(`Availability sample branches: ${sampleBranches.join(", ")}`);
  }

  const detectedBranches = Array.from(branchesDetected);
  logger.debug(`Detected branches: ${detectedBranches.join(", ")}`);

  let detectedBranch: string | null = null;
  if (detectedBranches.length === 0) {
    warnings.push("No branch information found in Excel files. Branch column may be missing.");
    logger.debug(`WARNING: No branch detected - files may be missing branch column`);
  } else if (detectedBranches.length > 1) {
    warnings.push(`Multiple branches detected: ${detectedBranches.join(", ")}. Files may be mixed.`);
    logger.debug(`WARNING: Multiple branches detected - potential data mixing!`);
    detectedBranch = detectedBranches[0];
  } else {
    detectedBranch = detectedBranches[0];
  }
  logger.debug(`Final detected branch: ${detectedBranch || "NONE"}`);
  logger.debug(`=======================================\n`);

  return {
    availability: validatedAvailability,
    guaranteed: validatedGuaranteed,
    guaranteedRaw: guaranteedData,
    demand: validatedDemand,
    cgData,
    warnings,
    detectedBranch,
  };
}
