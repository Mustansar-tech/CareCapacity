import { logger } from '../../infrastructure/logger';
import { format } from "date-fns";
import { parseGuaranteedDate, timeToString } from "../../shared/utils/time-window-utils";
import { computeCapacityWindows } from "./capacity-windows";
import { extractCancelledWindowsFromGHWorkbook } from "../cancelled-visits/cancelled-visits-from-gh";
import { getCloseMatches } from "./employee-matching";
import { extractAndStoreGeographicalData } from "./geographical-extraction";
import {
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
  LEAVE_TYPES,
  STATUS_PRIORITY,
  DAY_KILLERS,
  TIME_KILLERS,
  normalizeName,
  canonicalStatus,
  resolveServiceTimestamps,
  parseDate,
  hoursBetween,
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
  buildGhLossScheduledHoursLookup,
  buildGhLossWeeklyRawSummary,
  getScheduledHoursForEmployeeAndDate,
} from "../imports/pipeline-utils";

export async function processCapacityData(
  availability: ParsedAvailabilityRow[],
  guaranteed: GuaranteedHoursRow[],
  demand: ClientDemandRow[],
  cgData: CGDataRow[],
  options?: { ghWorkbookBuffer?: Buffer; branchId?: string; guaranteedRaw?: GuaranteedHoursRow[]; skipClearLocations?: boolean },
): Promise<ProcessingResult & { cleanedRecords: CleanedEmployeeRecord[] }> {
  const warnings: string[] = [];
  const branchId = options?.branchId;

  logger.debug(`\n🚀 ===== USING CG DATA AS MASTER EMPLOYEE LIST =====`);
  logger.debug(`Total employees in CG Data: ${cgData.length}`);

  if (cgData.length > 0) {
    logger.debug(`Sample CG Data entries:`);
    cgData.slice(0, 3).forEach((emp, idx) => {
      logger.debug(`  ${idx + 1}. ${emp["CAREGiver Name"]} - ${emp["Weekly Hours"]} hours/week`);
    });
  }

  logger.debug(`\n===== RECEIVED DEMAND DATA =====`);
  let totalDemandHours = 0;
  demand.forEach((row) => {
    logger.debug(`  - ${row.Date}: ${row["Required Client Hours"]} hours`);
    totalDemandHours += row["Required Client Hours"];
  });
  logger.debug(`TOTAL DEMAND HOURS FROM FILTERING: ${Math.round(totalDemandHours * 100) / 100}`);
  logger.debug(`================================\n`);

  logger.debug(`\nDEBUG: About to call buildScheduledHoursLookup with ${guaranteed.length} guaranteed rows`);

  const officeRows = guaranteed.filter(row => {
    const serviceType = (row["Actual Service Type Description"] || "").toString().toLowerCase();
    return serviceType.includes("office");
  });
  logger.debug(`DEBUG: Found ${officeRows.length} office hours rows in guaranteed data`);

  const scheduledHoursMap = buildScheduledHoursLookup(guaranteed);
  const clientScheduledHoursMap = buildClientScheduledHoursLookup(guaranteed);
  const ghLossScheduledHoursMap = buildGhLossScheduledHoursLookup(guaranteed);
  const ghLossRawSummary = buildGhLossWeeklyRawSummary(options?.guaranteedRaw ?? guaranteed);

  logger.debug(`\nSCHEDULED HOURS MAP VERIFICATION:`);
  logger.debug(`  Total entries in map: ${scheduledHoursMap.size}`);
  let mapCount = 0;
  for (const [key, hours] of Array.from(scheduledHoursMap.entries())) {
    if (mapCount < 10) { logger.debug(`  ${key}: ${hours}h`); mapCount++; }
  }
  logger.debug(`=========================================\n`);

  if (guaranteed.length > 0) {
    logger.debug("=== GUARANTEED HOURS DEBUGGING ===");
    logger.debug("First row raw data:", guaranteed[0]);
    logger.debug("Service Start Date raw:", guaranteed[0]["Service Requirement Start Date And Time"]);
    logger.debug("Service End Date raw:", guaranteed[0]["Service Requirement End Date And Time"]);
  }

  logger.debug(`CG Data debugging:`);
  logger.debug(`  - Total CG Data rows: ${cgData.length}`);
  if (cgData.length > 0) {
    logger.debug(`  - First row keys:`, Object.keys(cgData[0]));
    logger.debug(`  - First row:`, cgData[0]);
  }

  // ── Step 1: Build master employee list from CG Data ──
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

  const existingNames = new Set(masterEmployees.map(e => e.normalizedName));
  const adhocFromGuaranteed = new Map<string, string>();
  guaranteed.forEach(row => {
    const name = row["Actual Employee Name"] || row["Planned Employee Name"];
    if (!name) return;
    const nameStr = name.toString();
    const norm = normalizeName(nameStr);
    if (!existingNames.has(norm)) adhocFromGuaranteed.set(norm, nameStr);
  });

  if (adhocFromGuaranteed.size > 0) {
    logger.debug(`Adding ${adhocFromGuaranteed.size} employees found in Guaranteed Hours but missing from CG Data`);
    adhocFromGuaranteed.forEach((originalName, norm) => {
      masterEmployees.push({ originalName, normalizedName: norm, weeklyHours: 0, transportMode: "", gender: "" });
      existingNames.add(norm);
    });
  }

  logger.debug(`Master employee list created: ${masterEmployees.length} employees`);

  const masterEmployeeMap = new Map<string, typeof masterEmployees[0]>();
  masterEmployees.forEach((emp) => masterEmployeeMap.set(emp.normalizedName, emp));

  const postCodeMap = new Map<string, string>();
  cgData.forEach((row) => {
    if (row["CAREGiver Name"] && row.PostCode) {
      postCodeMap.set(normalizeName(row["CAREGiver Name"]), row.PostCode);
    }
  });

  // ── Step 2: Determine core week boundary ──
  const coreWeekDates = new Set<string>();
  guaranteed.forEach((row) => {
    try {
      const { start } = resolveServiceTimestamps(row);
      if (!start) return;
      coreWeekDates.add(format(parseGuaranteedDate(start), "yyyy-MM-dd"));
    } catch { /* skip */ }
  });
  availability.forEach((row) => {
    if (row.parsedDate) coreWeekDates.add(format(row.parsedDate, "yyyy-MM-dd"));
  });

  let coreWeekArray = Array.from(coreWeekDates).sort();
  const spilloverDatesRemoved: string[] = [];

  if (coreWeekArray.length > 7) {
    logger.debug(`\nDETECTING WEEK BOUNDARY in processCapacityData (${coreWeekArray.length} dates found):`);
    const firstDate = new Date(coreWeekArray[0]);
    const secondDate = new Date(coreWeekArray[1]);
    const lastDate = new Date(coreWeekArray[coreWeekArray.length - 1]);
    const daysBetweenSecondAndLast = Math.round((lastDate.getTime() - secondDate.getTime()) / 86400000);
    const daysBetweenFirstAndSecond = Math.round((secondDate.getTime() - firstDate.getTime()) / 86400000);

    if (daysBetweenFirstAndSecond === 1 && daysBetweenSecondAndLast === 6) {
      logger.debug(`  Detected spillover date: ${coreWeekArray[0]} (will be excluded)`);
      spilloverDatesRemoved.push(coreWeekArray[0]);
      coreWeekDates.delete(coreWeekArray[0]);
      coreWeekArray = coreWeekArray.slice(1);
    } else if (coreWeekArray.length === 8) {
      const secondToLastDate = new Date(coreWeekArray[coreWeekArray.length - 2]);
      const daysBetweenFirstAndSecondToLast = Math.round((secondToLastDate.getTime() - firstDate.getTime()) / 86400000);
      if (daysBetweenFirstAndSecondToLast === 6) {
        logger.debug(`  Detected spillover date: ${coreWeekArray[coreWeekArray.length - 1]} (will be excluded)`);
        spilloverDatesRemoved.push(coreWeekArray[coreWeekArray.length - 1]);
        coreWeekDates.delete(coreWeekArray[coreWeekArray.length - 1]);
        coreWeekArray = coreWeekArray.slice(0, -1);
      }
    }
  }

  // ── Step 3: Filter availability to master employees within core week ──
  const availabilityFiltered: any[] = [];
  let spilloverDatesSkipped = 0;
  availability.forEach((row, i) => {
    try {
      const normalizedName = normalizeName(row["CAREGiver Name"]);
      const masterEmployeeKeys = Array.from(masterEmployeeMap.keys());
      const matches = getCloseMatches(normalizedName, masterEmployeeKeys, 0.65);
      if (matches.length === 0) return;
      const canonicalKey = matches[0].choice;
      const matchedEmployee = masterEmployeeMap.get(canonicalKey);

      if (!row["Start Date"]) { warnings.push(`Availability row ${i + 1}: missing Start Date`); return; }

      const parsedDate = row.parsedDate;
      const dateStr = format(parsedDate, "yyyy-MM-dd");
      if (!coreWeekDates.has(dateStr)) { spilloverDatesSkipped++; return; }

      let hrs = row.Hours !== undefined && row.Hours !== null
        ? Number(row.Hours)
        : hoursBetween(row["Start Time"], row["End Time"]);

      if (isNaN(hrs)) {
        if (canonicalStatus(row.Type) === "Available") {
          warnings.push(`Availability row ${i + 1}: cannot compute hours`);
          return;
        }
        hrs = 0;
      }

      availabilityFiltered.push({ ...row, _normalizedName: canonicalKey, _parsedDate: parsedDate, _hours: Math.round(hrs * 100) / 100, matchedEmployee });
    } catch (e: any) {
      warnings.push(`Availability row ${i + 1}: ${e.message || "error"}`);
    }
  });

  if (spilloverDatesSkipped > 0) {
    logger.debug(`  🔸 Filtered ${spilloverDatesSkipped} availability records from spillover dates: ${spilloverDatesRemoved.join(', ')}`);
  }
  logger.debug(`Availability filtered: ${availabilityFiltered.length} rows (only master employees)`);

  // ── Step 4: Build per-employee metrics ──
  const employeeDays = new Map<string, Set<string>>();
  availabilityFiltered.forEach((row) => {
    const key = row.matchedEmployee ? row.matchedEmployee.normalizedName : normalizeName(row["CAREGiver Name"]);
    if (!employeeDays.has(key)) employeeDays.set(key, new Set());
    employeeDays.get(key)!.add(format(row.parsedDate, "yyyy-MM-dd"));
  });

  const employeeAbsenceDates = new Map<string, Set<string>>();
  availabilityFiltered.forEach((row) => {
    if (canonicalStatus(row.Type) === "Available") return;
    const key = row.matchedEmployee ? row.matchedEmployee.normalizedName : normalizeName(row["CAREGiver Name"]);
    if (!employeeAbsenceDates.has(key)) employeeAbsenceDates.set(key, new Set());
    employeeAbsenceDates.get(key)!.add(format(row.parsedDate, "yyyy-MM-dd"));
  });

  // ── Step 5: Merge availability data ──
  const mergedData = availabilityFiltered.map((row) => {
    const key = row.matchedEmployee ? row.matchedEmployee.normalizedName : normalizeName(row["CAREGiver Name"]);
    const contractedWeeklyHours = row.matchedEmployee ? row.matchedEmployee.weeklyHours : 0;

    let contractedDailyHours = 0;
    if (row.matchedEmployee) {
      const daysAvailable = employeeDays.get(key)!.size;
      const standardDaily = Math.round((row.matchedEmployee.weeklyHours / daysAvailable) * 100) / 100;

      const perDayHours = new Map<string, number>();
      availabilityFiltered
        .filter(r => {
          const rKey = r.matchedEmployee?.normalizedName || normalizeName(r["CAREGiver Name"]);
          return rKey === key && canonicalStatus(r.Type) === "Available";
        })
        .forEach(r => {
          const d = format(r.parsedDate, "yyyy-MM-dd");
          const hrs = (r.Hours !== undefined && r.Hours !== null) ? Number(r.Hours) : hoursBetween(r["Start Time"], r["End Time"]);
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
        contractedDailyHours = Math.round((row.matchedEmployee.weeklyHours * (todayHours / totalWeekHours)) * 100) / 100;
      } else {
        contractedDailyHours = standardDaily;
      }
    }

    const hoursEffective = row.Hours !== undefined && row.Hours !== null ? row.Hours : hoursBetween(row["Start Time"], row["End Time"]);
    return {
      employeeName: row.matchedEmployee ? row.matchedEmployee.originalName : row["CAREGiver Name"],
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

  // ── Step 6: Group and collapse records ──
  const groupedData = new Map<string, typeof mergedData>();
  mergedData.forEach((row) => {
    const key = `${row.employeeKey}|${row.date}`;
    if (!groupedData.has(key)) groupedData.set(key, []);
    groupedData.get(key)!.push(row);
  });

  const cleanedRecords: CleanedEmployeeRecord[] = [];

  groupedData.forEach((group) => {
    if (group.length === 0) return;

    const empName = group[0].employeeName;
    const weekly = group[0].contractedWeeklyHours;
    const daily = group[0].contractedDailyHours || 0.0;
    const date = group[0].date;

    const totalScheduledHours = getScheduledHoursForEmployeeAndDate(scheduledHoursMap, empName, date);
    const clientScheduledHrs = getScheduledHoursForEmployeeAndDate(clientScheduledHoursMap, empName, date);

    const deduplicatedRows = new Map<string, (typeof group)[0]>();
    group.forEach((row) => {
      const key = `${row.status}|${row.startTime}|${row.endTime}`;
      if (!deduplicatedRows.has(key)) deduplicatedRows.set(key, row);
    });

    const statusAgg = new Map<string, { hoursRaw: number; windows: string[]; notes: string[] }>();
    Array.from(deduplicatedRows.values()).forEach((row) => {
      if (!statusAgg.has(row.status)) statusAgg.set(row.status, { hoursRaw: 0, windows: [], notes: [] });
      const agg = statusAgg.get(row.status)!;
      agg.hoursRaw += row.hours;
      if (row.timeWindow && row.timeWindow !== "" && row.timeWindow !== "-" && row.timeWindow !== "--" && row.timeWindow !== ":" && !row.timeWindow.includes("undefined")) {
        agg.windows.push(row.timeWindow);
      }
      if (row.notes && row.notes !== "") agg.notes.push(row.notes);
    });

    let totalLeaveRaw = 0;
    statusAgg.forEach((agg, status) => { if (LEAVE_TYPES.includes(status)) totalLeaveRaw += agg.hoursRaw; });
    const totalLeaveCapped = Math.min(totalLeaveRaw, daily);

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
        } else if (p < dayKillerPriority) {
          dayKillerPriority = p;
          dayKillerStatus = status;
        }
      }
    });
    const hasDayKiller = dayKillerStatus !== "";

    let hasTimeKiller = false;
    let hasAvailableStatus = false;
    statusAgg.forEach((_agg, status) => {
      if (TIME_KILLERS.has(status)) hasTimeKiller = true;
      if (status === "Available") hasAvailableStatus = true;
    });

    const availAgg = statusAgg.get("Available");
    const availPairs = mergeIntervals(windowListToPairs(availAgg?.windows || []), 0);

    const timeKillerPairs: Array<[number, number]> = [];
    statusAgg.forEach((_agg, status) => { if (TIME_KILLERS.has(status)) timeKillerPairs.push(...windowListToPairs(_agg.windows)); });

    let partialDayKillerPairs: Array<[number, number]> = [];
    if (hasPartialDayKiller && partialDayKillerStatus) {
      const partialAgg = statusAgg.get(partialDayKillerStatus);
      if (partialAgg?.windows) partialDayKillerPairs = windowListToPairs(partialAgg.windows);
    }

    const blockerPairs: Array<[number, number]> = [...timeKillerPairs, ...partialDayKillerPairs];
    const mergedBlockers = mergeIntervals(blockerPairs, 0);
    const mergedTimeKillers = mergeIntervals(timeKillerPairs, 0);
    const mergedPartialDayKillers = mergeIntervals(partialDayKillerPairs, 0);
    const timeKillerHours = mergedTimeKillers.reduce((sum, [s, e]) => sum + (e - s) / 60, 0);
    const partialDayKillerHours = mergedPartialDayKillers.reduce((sum, [s, e]) => sum + (e - s) / 60, 0);

    const contractedDailyMin = Math.round((group[0]?.contractedDailyHours || 0) * 60);
    const timeKillerIsAllDay = mergedBlockers.length ? isAllDayTimeKiller(mergedBlockers, availPairs, contractedDailyMin) : false;

    let highestPriorityStatus = "";
    let highestPriority = 999;

    if (hasDayKiller) {
      highestPriorityStatus = dayKillerStatus;
      highestPriority = dayKillerPriority;
    } else if (hasTimeKiller || hasPartialDayKiller) {
      if (timeKillerIsAllDay || !hasAvailableStatus) {
        if (hasPartialDayKiller && (timeKillerIsAllDay || !hasAvailableStatus)) {
          highestPriorityStatus = partialDayKillerStatus;
          highestPriority = STATUS_PRIORITY[partialDayKillerStatus] || 5;
        } else {
          highestPriorityStatus = "Other Unavailable";
          highestPriority = STATUS_PRIORITY["Other Unavailable"] || 5;
        }
      } else {
        highestPriorityStatus = hasPartialDayKiller ? `Partial ${partialDayKillerStatus}` : "Partial Availability";
        highestPriority = STATUS_PRIORITY["Partial Availability"] || 6;
      }
    } else {
      statusAgg.forEach((_agg, status) => {
        const p = STATUS_PRIORITY[status] || 999;
        if (p < highestPriority) { highestPriority = p; highestPriorityStatus = status; }
      });
    }

    if (highestPriorityStatus) {
      const agg = statusAgg.get(highestPriorityStatus) ?? { hoursRaw: 0, windows: [], notes: [] };
      const totalBlockedHours = mergedBlockers.reduce((sum, [s, e]) => sum + (e - s) / 60, 0);

      let finalHours: number;
      let netCapacity: number;

      if (hasDayKiller || ((hasTimeKiller || hasPartialDayKiller) && timeKillerIsAllDay) || (hasPartialDayKiller && !hasAvailableStatus)) {
        finalHours = daily > 0 ? daily : Math.min(agg.hoursRaw || 0.0, daily);
        netCapacity = 0.0;
      } else if (highestPriorityStatus.startsWith("Partial ")) {
        const statusBlockedHours = highestPriorityStatus === "Partial Availability"
          ? Math.min(timeKillerHours, daily)
          : Math.min(partialDayKillerHours, daily);
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
      statusAgg.forEach((a) => allNotes.push(...a.notes));
      const notesStr = Array.from(new Set(allNotes)).filter((n) => n && n !== "").sort().join("; ");

      let windowsStr = "";
      if (!(hasDayKiller || timeKillerIsAllDay)) {
        const bookableWindows = pairsToWindowList(filterMinDuration(subtractIntervals(availPairs, mergedBlockers), 60));
        windowsStr = bookableWindows.join("; ");
      }

      const postCode = postCodeMap.get(normalizeName(empName)) || "";

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
        notes: notesStr + (hasDayKiller ? " [availability ignored due to day-level leave]" : ""),
        postCode,
      });
    }
  });

  cleanedRecords.sort((a, b) => (STATUS_PRIORITY[a.status] || 999) - (STATUS_PRIORITY[b.status] || 999));

  // ── Step 7: Build Daily Summary ──
  const dailySummaryMap = new Map<string, {
    availableHours: number; netCapacity: number; unavailability: number;
    holidays: number; sickness: number; scheduledHours: number;
    clientScheduledHours: number; otherScheduledHours: number;
  }>();

  const recordsByDateAndEmployee = new Map<string, Map<string, CleanedEmployeeRecord[]>>();
  cleanedRecords.forEach((record) => {
    if (!recordsByDateAndEmployee.has(record.date)) recordsByDateAndEmployee.set(record.date, new Map());
    const dateMap = recordsByDateAndEmployee.get(record.date)!;
    if (!dateMap.has(record.employeeName)) dateMap.set(record.employeeName, []);
    dateMap.get(record.employeeName)!.push(record);
  });

  recordsByDateAndEmployee.forEach((employeeMap, date) => {
    if (!dailySummaryMap.has(date)) dailySummaryMap.set(date, { availableHours: 0, netCapacity: 0, unavailability: 0, holidays: 0, sickness: 0, scheduledHours: 0, clientScheduledHours: 0, otherScheduledHours: 0 });
    const summary = dailySummaryMap.get(date)!;

    employeeMap.forEach((records, _employeeName) => {
      let bestRecord = records[0];
      records.forEach((r) => { if (r.contractedDailyHours > bestRecord.contractedDailyHours) bestRecord = r; });

      const empNorm = normalizeName(_employeeName);
      const schedKey = `${empNorm}|${date}`;
      const empScheduled = scheduledHoursMap.get(schedKey) || 0;
      const empClientScheduled = clientScheduledHoursMap.get(schedKey) || 0;

      let empHolidays = 0, empSickness = 0, empUnavailability = 0;
      records.forEach((r) => {
        if (r.status === "Holiday" || r.status === "Partial Holiday") empHolidays += r.hours;
        else if (r.status === "Sick" || r.status === "Partial Sick") empSickness += r.hours;
        else if (["Maternity/Paternity","Compassionate Leave","Other Unavailable","Pre-Agreed Appointment","Partial Maternity/Paternity","Partial Compassionate Leave","Partial Availability"].includes(r.status)) empUnavailability += r.hours;
      });

      const daily = bestRecord.contractedDailyHours;
      const totalDeductions = empHolidays + empSickness + empUnavailability;
      if (totalDeductions > daily && daily > 0) {
        const ratio = daily / totalDeductions;
        empHolidays *= ratio; empSickness *= ratio; empUnavailability *= ratio;
      }

      summary.netCapacity += Math.max(0, daily - empHolidays - empSickness - empUnavailability);
      summary.availableHours += daily;
      summary.holidays += empHolidays;
      summary.sickness += empSickness;
      summary.unavailability += empUnavailability;
      summary.scheduledHours += empScheduled;
      summary.clientScheduledHours += empClientScheduled;
      summary.otherScheduledHours += Math.max(0, empScheduled - empClientScheduled);
    });
  });

  // Add ad-hoc scheduled hours
  {
    const alreadyCounted = new Set<string>();
    recordsByDateAndEmployee.forEach((empMap, date) => {
      empMap.forEach((_r, empName) => alreadyCounted.add(`${normalizeName(empName)}|${date}`));
    });
    let adhocTotal = 0, adhocCount = 0;
    scheduledHoursMap.forEach((schedHours, key) => {
      if (schedHours <= 0 || alreadyCounted.has(key)) return;
      const pipeIdx = key.lastIndexOf("|");
      if (pipeIdx < 0) return;
      const date = key.substring(pipeIdx + 1);
      if (!date) return;
      if (!dailySummaryMap.has(date)) dailySummaryMap.set(date, { availableHours: 0, netCapacity: 0, unavailability: 0, holidays: 0, sickness: 0, scheduledHours: 0, clientScheduledHours: 0, otherScheduledHours: 0 });
      const summary = dailySummaryMap.get(date)!;
      const clientSched = clientScheduledHoursMap.get(key) || 0;
      summary.scheduledHours += schedHours;
      summary.clientScheduledHours += clientSched;
      summary.otherScheduledHours += Math.max(0, schedHours - clientSched);
      adhocTotal += schedHours; adhocCount++;
    });
    logger.debug(`  TOTAL AD-HOC HOURS ADDED TO DAILY SUMMARY: ${adhocCount} entries, ${Math.round(adhocTotal * 100) / 100}h`);
  }

  // ── Step 8: Merge demand & build daily summary array ──
  const demandMap = new Map<string, number>();
  demand.forEach((row) => demandMap.set(format(parseDate(row.Date), "yyyy-MM-dd"), row["Required Client Hours"]));

  const SKIP_DATE = "2026-01-25";
  const dailySummary: DailySummaryRecord[] = Array.from(dailySummaryMap.entries())
    .filter(([date]) => date !== SKIP_DATE)
    .map(([date, summary]) => {
      const clientRequired = demandMap.get(date) || 0;
      const gap = Math.round((summary.netCapacity - clientRequired) * 100) / 100;
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
        status: (gap >= 0 ? "Sufficient" : "Shortage") as "Sufficient" | "Shortage",
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Step 9: KPIs ──
  logger.debug(`\n===== DAILY SUMMARY CLIENT REQUIRED BREAKDOWN =====`);
  let totalClientRequired = 0;
  dailySummary.forEach((d) => { logger.debug(`  - ${d.date}: ${d.clientRequired} hours`); totalClientRequired += d.clientRequired; });
  logger.debug(`TOTAL CLIENT REQUIRED FROM DAILY SUMMARY: ${Math.round(totalClientRequired * 100) / 100}`);
  logger.debug(`==================================================\n`);

  const kpis = {
    netCapacitySum: Math.round(dailySummary.reduce((s, d) => s + d.netCapacity, 0) * 100) / 100,
    totalDesiredHoursSum: Math.round(dailySummary.reduce((s, d) => s + d.availableHours, 0) * 100) / 100,
    clientRequiredSum: Math.round(dailySummary.reduce((s, d) => s + d.clientRequired, 0) * 100) / 100,
    gapSum: Math.round(dailySummary.reduce((s, d) => s + d.gap, 0) * 100) / 100,
    unavailabilitySum: Math.round(dailySummary.reduce((s, d) => s + d.unavailability, 0) * 100) / 100,
    holidaysSum: Math.round(dailySummary.reduce((s, d) => s + d.holidays, 0) * 100) / 100,
    sicknessSum: Math.round(dailySummary.reduce((s, d) => s + (d as any).sickness, 0) * 100) / 100,
    totalScheduledHoursSum: Math.round(dailySummary.reduce((s, d) => s + (d as any).scheduledHours, 0) * 100) / 100,
    clientScheduledHoursSum: Math.round(dailySummary.reduce((s, d) => s + (d as any).clientScheduledHours, 0) * 100) / 100,
    otherScheduledHoursSum: Math.round(dailySummary.reduce((s, d) => s + (d as any).otherScheduledHours, 0) * 100) / 100,
    capacityAfterSchedulingSum: Math.round(dailySummary.reduce((s, d) => s + (d.netCapacity - d.clientRequired), 0) * 100) / 100,
  };

  // ── Step 10: Build employeesByDate ──
  const employeesByDate: Record<string, EmployeeDailyDetail[]> = {};
  cleanedRecords.forEach((record) => {
    if (!employeesByDate[record.date]) employeesByDate[record.date] = [];
    const masterEmployee = masterEmployees.find(e => e.normalizedName === normalizeName(record.employeeName));
    employeesByDate[record.date].push({
      employeeName: record.employeeName,
      status: record.status,
      timeWindows: record.timeWindows,
      contractedDailyHours: record.contractedDailyHours,
      scheduledHours: record.scheduledHours,
      hours: record.hours,
      netCapacity: record.netCapacity,
      notes: record.notes,
      gender: masterEmployee?.gender || "",
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
      if (!date || !normName || present[date]?.has(normName)) return;

      const display = displayNameMap.get(normName) || normName;
      const windows = (adhocWindowsMap.get(key) || []).map(([s, e]: [number, number]) => `${fromMin(s)}-${fromMin(e)}`).join("; ");
      const masterEmployee = masterEmployees.find(e => e.normalizedName === normName);

      logger.debug(`  INJECTING AD-HOC EMPLOYEE: ${display} on ${date} with ${schedHoursRaw}h scheduled`);

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
        gender: masterEmployee?.gender || "",
      });
      if (!present[date]) present[date] = new Set();
      present[date].add(normName);
    });
  }

  Object.values(employeesByDate).forEach((employees) => {
    employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  });

  // ── Step 11: Build employeeSummaryByDate ──
  const employeeSummaryByDate: Record<string, any[]> = {};

  for (const [dateStr, employees] of Object.entries(employeesByDate)) {
    logger.debug(`\nEXTRACTING CANCELLED VISITS FOR ${dateStr}...`);
    const cancelledVisitsForDate = options?.ghWorkbookBuffer
      ? await extractCancelledWindowsFromGHWorkbook(options.ghWorkbookBuffer, new Date(dateStr), 0)
      : new Map<string, string>();
    logger.debug(`Found ${cancelledVisitsForDate.size} employees with cancelled visits on ${dateStr}`);

    const employeeMap = new Map<string, { contractedDailyHours: number; scheduledHours: number; ghScheduledHours: number; unavailabilityHours: number; hasAvailableStatus: boolean; hasUnavailableStatus: boolean; hasPartialAvailability: boolean; }>();

    employees.forEach((emp) => {
      const key = emp.employeeName;
      if (!employeeMap.has(key)) {
        const empNormalized = normalizeName(emp.employeeName);
        const scheduledHoursFromLookup = scheduledHoursMap.get(`${empNormalized}|${dateStr}`) || 0;
        const ghScheduledHoursFromLookup = ghLossScheduledHoursMap.get(`${empNormalized}|${dateStr}`) || 0;
        employeeMap.set(key, { contractedDailyHours: emp.contractedDailyHours, scheduledHours: scheduledHoursFromLookup, ghScheduledHours: ghScheduledHoursFromLookup, unavailabilityHours: 0, hasAvailableStatus: false, hasUnavailableStatus: false, hasPartialAvailability: false });
      }

      const empData = employeeMap.get(key)!;
      empData.contractedDailyHours = Math.max(empData.contractedDailyHours, emp.contractedDailyHours);

      if (emp.status === "Available") empData.hasAvailableStatus = true;
      else if (emp.status.startsWith("Partial ")) { empData.hasPartialAvailability = true; empData.unavailabilityHours += emp.hours; }
      else { empData.hasUnavailableStatus = true; empData.unavailabilityHours += emp.hours; }
    });

    employeeSummaryByDate[dateStr] = Array.from(employeeMap.entries()).map(([employeeName, empData]) => {
      const employeeDetails = employeesByDate[dateStr]?.filter(e => e.employeeName === employeeName) || [];

      let availabilityWindows = "", unavailabilityWindows = "", scheduledWindows = "";
      employeeDetails.forEach((emp) => {
        if (emp.status === "Available" && emp.timeWindows && emp.timeWindows !== "-") {
          availabilityWindows = availabilityWindows ? `${availabilityWindows}, ${emp.timeWindows}` : emp.timeWindows;
        } else if (LEAVE_TYPES.includes(emp.status) && emp.timeWindows && emp.timeWindows !== "-") {
          unavailabilityWindows = unavailabilityWindows ? `${unavailabilityWindows}, ${emp.timeWindows}` : emp.timeWindows;
        } else if (emp.status === "Ad-hoc" && emp.timeWindows && emp.timeWindows !== "-") {
          scheduledWindows = scheduledWindows ? `${scheduledWindows}, ${emp.timeWindows}` : emp.timeWindows;
        }
      });

      const empNormalized = normalizeName(employeeName);
      const guaranteedWindows = adhocWindowsMap.get(`${empNormalized}|${dateStr}`) ?? [];
      if (guaranteedWindows.length > 0) {
        const gwStr = guaranteedWindows.map(([s, e]: [number, number]) => `${fromMin(s)}-${fromMin(e)}`).join(", ");
        scheduledWindows = scheduledWindows ? `${scheduledWindows}, ${gwStr}` : gwStr;
      }

      let freeWindows = "";
      try {
        if (availabilityWindows) {
          const allWindows = availabilityWindows.split(',').map(w => w.trim()).filter(w => w && w.includes('-'));
          const dayWindows = allWindows.filter(w => {
            const startHour = parseInt((w.split('-')[0] || "").split(':')[0]);
            return startHour >= 6 && startHour < 22;
          });
          if (dayWindows.length === 0 && allWindows.length > 0) {
            logger.debug(`EXCLUDING night-only employee from capacity: ${employeeName} on ${dateStr}`);
            return null;
          }
          const filteredAvailability = dayWindows.join(', ');
          if (filteredAvailability) {
            const capacityResult = computeCapacityWindows(
              { employeeName, date: dateStr, availabilityWindows: filteredAvailability, unavailabilityWindows, scheduledWindows, desiredMinutes: empData.contractedDailyHours * 60 },
              { roundToMinutes: 15, minWindowMinutes: 60, bufferMinutes: 0 },
            );
            freeWindows = capacityResult.freeWindows;
          }
        }
      } catch (error) {
        logger.warn(`Error calculating free windows for ${employeeName} on ${dateStr}:`, error);
      }

      const masterEmployee = masterEmployees.find(e => e.normalizedName === empNormalized);

      return {
        employeeName,
        availability: empData.contractedDailyHours,
        unavailability: empData.unavailabilityHours,
        scheduledHours: empData.scheduledHours,
        ghScheduledHours: empData.ghScheduledHours,
        difference: empData.contractedDailyHours - empData.unavailabilityHours - empData.scheduledHours,
        freeWindows,
        cancelledVisits: cancelledVisitsForDate.get(empNormalized) ?? "—",
        transportMode: masterEmployee?.transportMode || "",
        gender: masterEmployee?.gender || "",
      };
    }).filter((record): record is NonNullable<typeof record> => record !== null);
  }

  Object.values(employeesByDate).forEach(employees => employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName)));

  // ── Populate GH unavailability from employeeSummaryByDate ──────────────────
  // After both employeeSummaryByDate and ghLossRawSummary.targets are finalised,
  // pre-compute weekly unavailability totals per GH employee and store them
  // directly in ghLossRawSummary.  This makes Path A on the frontend fully
  // self-contained — no need to re-derive unavailability from employeeSummaryByDate.
  if (ghLossRawSummary) {
    const ghUnavailMap: Record<string, { weeklyUnavailability: number; weeklyAvailability: number }> = {};
    for (const records of Object.values(employeeSummaryByDate)) {
      for (const rec of records as Array<{ employeeName: string; unavailability: number; availability: number }>) {
        const normKey = normalizeName(rec.employeeName);
        if (!ghLossRawSummary.targets[normKey]) continue;
        if (!ghUnavailMap[normKey]) {
          ghUnavailMap[normKey] = { weeklyUnavailability: 0, weeklyAvailability: 0 };
        }
        ghUnavailMap[normKey].weeklyUnavailability += rec.unavailability ?? 0;
        ghUnavailMap[normKey].weeklyAvailability += rec.availability ?? 0;
      }
    }
    ghLossRawSummary.unavailability = ghUnavailMap;
  }

  const result: ProcessingResult & { cleanedRecords: CleanedEmployeeRecord[] } = {
    kpis,
    dailySummary,
    employeesByDate,
    employeeSummaryByDate,
    cleanedRecords,
    warnings: warnings.length > 0 ? warnings : undefined,
    ghLossRawSummary,
  };

  // ── Save to database ──
  try {
    if (!branchId) throw new Error("branchId is required to save capacity analysis");
    const weekStart = result.dailySummary[0]?.date || "";
    const weekEnd = result.dailySummary[result.dailySummary.length - 1]?.date || "";
    const analysisData: InsertCapacityAnalysis = {
      branchId, weekStartDate: weekStart, weekEndDate: weekEnd,
      kpis: result.kpis as any, dailySummary: result.dailySummary as any,
      employeesByDate: result.employeesByDate as any,
      employeeSummaryByDate: result.employeeSummaryByDate as any,
      warnings: result.warnings as any,
      ghLossRawSummary: result.ghLossRawSummary as any,
    };
    storage.saveCapacityAnalysis(analysisData)
      .then(() => logger.debug("Successfully saved capacity analysis to database"))
      .catch((error) => logger.error("Error saving to database:", error));
  } catch (error) {
    logger.error("Error preparing database save:", error);
  }

  // ── Extract geographical data ──
  if (branchId) {
    await extractAndStoreGeographicalData(cgData, guaranteed, branchId, options?.ghWorkbookBuffer, options?.skipClearLocations);
  } else {
    logger.debug(`WARNING: No branchId provided - skipping geographical data extraction`);
  }

  // ── Retrieve geo data to include in result ──
  try {
    const employeeLocations = branchId ? await storage.getAllEmployeeLocations(branchId) : [];
    const clientLocations = branchId ? await storage.getAllClientLocations(branchId) : [];
    (result as ProcessingResult).employeeLocations = employeeLocations.map(emp => ({
      employeeName: emp.employeeName,
      homePostcode: emp.homePostcode,
      homeLat: emp.homeLat ? Number(emp.homeLat) : undefined,
      homeLng: emp.homeLng ? Number(emp.homeLng) : undefined,
      transportMode: emp.transportMode || undefined,
      gender: emp.gender || undefined,
    }));
    (result as ProcessingResult).clientLocations = clientLocations.map(cli => ({
      clientName: cli.clientName,
      addressLine: cli.addressLine,
      postcode: cli.postcode,
      lat: cli.lat ? Number(cli.lat) : undefined,
      lng: cli.lng ? Number(cli.lng) : undefined,
    }));
    logger.debug(`Including ${employeeLocations.length} employee locations and ${clientLocations.length} client locations in result`);
  } catch (error) {
    logger.error('Error retrieving geographical data:', error);
  }

  return result;
}
