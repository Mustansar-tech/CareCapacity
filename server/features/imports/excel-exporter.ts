import * as XLSX from "../../shared/xlsx-compat.js";
import { logger } from '../../infrastructure/logger';
import {
  ProcessingResult,
  CleanedEmployeeRecord,
} from "@shared/schema";
import { CGDataRow } from "./pipeline-utils";

export async function generateExcelExport(
  result: ProcessingResult,
  cleanedRecords: CleanedEmployeeRecord[],
  cgData: CGDataRow[],
): Promise<Buffer> {
  const workbook = XLSX.utils.book_new();

  // Cleaned sheet
  const cleanedData = [
    [
      "Employee Name",
      "Contracted Weekly Hours",
      "Contracted Daily Hours",
      "Date",
      "Status",
      "Time Windows",
      "Hours",
      "Net Capacity",
      "Notes",
      "Post Code",
    ],
    ...cleanedRecords.map((record) => [
      record.employeeName,
      record.contractedWeeklyHours.toString(),
      record.contractedDailyHours.toString(),
      record.date,
      record.status,
      record.timeWindows,
      record.hours.toString(),
      record.netCapacity.toString(),
      record.notes,
      record.postCode,
    ]),
  ];

  const cleanedSheet = XLSX.utils.aoa_to_sheet(cleanedData);
  XLSX.utils.book_append_sheet(workbook, cleanedSheet, "Cleaned");

  // Daily Summary sheet
  const summaryData = [
    [
      "Date",
      "Available Hours",
      "Net Capacity",
      "Unavailability",
      "Holidays",
      "Client Required",
      "Gap",
      "Status",
    ],
    ...result.dailySummary.map((day) => [
      day.date,
      day.availableHours.toString(),
      day.netCapacity.toString(),
      day.unavailability.toString(),
      day.holidays.toString(),
      day.clientRequired.toString(),
      day.gap.toString(),
      day.status,
    ]),
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "DailySummary");

  // Employee Daily Detail sheet
  const detailData = [
    [
      "Date",
      "Employee Name",
      "Status",
      "Time Windows",
      "Contracted Daily Hours",
      "Hours",
      "Net Capacity",
      "Notes",
    ],
  ];

  Object.entries(result.employeesByDate).forEach(([date, employees]) => {
    employees.forEach((emp) => {
      detailData.push([
        date,
        emp.employeeName,
        emp.status,
        emp.timeWindows,
        emp.contractedDailyHours.toString(),
        emp.hours.toString(),
        emp.netCapacity.toString(),
        emp.notes,
      ]);
    });
  });

  const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
  XLSX.utils.book_append_sheet(workbook, detailSheet, "EmployeeDailyDetail");

  // Employee Master List sheet (CG Data with PostCode)
  const masterListData = [
    [
      "Employee Name",
      "Weekly Hours",
      "Transport Mode",
      "Title",
      "Gender",
      "Post Code",
    ],
    ...cgData.map((emp) => [
      emp["CAREGiver Name"],
      emp["Weekly Hours"].toString(),
      emp.TransportModeDescription || "",
      emp.Title || "",
      emp.Gender || "",
      emp.PostCode || "",
    ]),
  ];

  const masterListSheet = XLSX.utils.aoa_to_sheet(masterListData);
  XLSX.utils.book_append_sheet(workbook, masterListSheet, "EmployeeMasterList");

  // === EmployeeFit tab ===
  try {
    const { buildEmployeeFitRows } = await import("../capacity/employee-fit");
    const fitRows = await buildEmployeeFitRows(
      result.employeesByDate,
      result.employeeSummaryByDate,
      5
    );

    const header = [
      "Date","Employee","Status","Windows","Contracted Daily (h)","Scheduled (h)",
      "Client 1","Travel 1 (min)","Duration 1 (min)",
      "Client 2","Travel 2 (min)","Duration 2 (min)",
      "Client 3","Travel 3 (min)","Duration 3 (min)",
      "Client 4","Travel 4 (min)","Duration 4 (min)",
      "Client 5","Travel 5 (min)","Duration 5 (min)",
    ];
    const aoa = [ header, ...fitRows.map(r => [
      r.Date, r.Employee, r.Status, r.Windows, r.ContractedDaily, r.ScheduledHours,
      r.Client1, r.Travel1, r.Duration1,
      r.Client2, r.Travel2, r.Duration2,
      r.Client3, r.Travel3, r.Duration3,
      r.Client4, r.Travel4, r.Duration4,
      r.Client5, r.Travel5, r.Duration5,
    ])];

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(workbook, sheet, "EmployeeFit");
  } catch (e) {
    logger.debug("EmployeeFit generation skipped:", e);
  }

  logger.debug("Heatmap sheets excluded from Excel export");

  return await XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
