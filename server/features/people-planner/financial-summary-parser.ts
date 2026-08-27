/**
 * Parser for the People Planner "Financial Summary Export" workbook.
 *
 * Layout (observed from a real export):
 *   Row 1: merged title — "Finance Summary - For <Franchise> & All Areas - <start> - <end> - ..."
 *   Row 2: real header row — Name, Customer External ID, Type, "", Total Delivered Hours,
 *          Total Cancelled Hours, %, "", Total Delivered Invoice, Total Cancelled Invoice,
 *          Total Invoice Hours Banded, %, "", Total Delivered Payroll, Total Cancelled Payroll
 *   Rows follow: one per customer/individual/organisation, then a blank separator, an
 *   "Organisation Sub Total" row, another blank, then the final "Total" row.
 *
 * We locate the header row by column NAME (not fixed index) so a shifted column layout
 * doesn't silently produce a wrong number, then locate the LAST row whose first
 * non-empty cell is exactly "Total" (case-insensitive, distinct from "Sub Total"), and
 * sum "Total Delivered Invoice" + "Total Cancelled Invoice" from that row.
 */
import ExcelJS from "exceljs";

export interface FinancialSummaryTotals {
  totalDeliveredInvoice: number;
  totalCancelledInvoice: number;
  /** totalDeliveredInvoice + totalCancelledInvoice — the day-rate tracker's revenue figure */
  revenue: number;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if ("richText" in (value as any)) return (value as any).richText.map((rt: any) => rt.text).join("");
    if ("result" in (value as any)) return String((value as any).result ?? "");
    if ("text" in (value as any)) return String((value as any).text ?? "");
  }
  return String(value).trim();
}

function cellNumber(value: ExcelJS.CellValue): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "object") {
    if ("result" in (value as any)) return Number((value as any).result) || 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function parseFinancialSummaryWorkbook(buffer: Buffer): Promise<FinancialSummaryTotals> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("Financial Summary workbook has no worksheets");
  }

  // Find the header row: the first row containing both "Total Delivered Invoice"
  // and "Total Cancelled Invoice" as cell text (case-insensitive, trimmed).
  let headerRowNumber = -1;
  let deliveredInvoiceCol = -1;
  let cancelledInvoiceCol = -1;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (headerRowNumber !== -1) return; // already found
    let foundDelivered = -1;
    let foundCancelled = -1;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = cellText(cell.value).toLowerCase();
      if (text === "total delivered invoice") foundDelivered = colNumber;
      if (text === "total cancelled invoice") foundCancelled = colNumber;
    });
    if (foundDelivered !== -1 && foundCancelled !== -1) {
      headerRowNumber = rowNumber;
      deliveredInvoiceCol = foundDelivered;
      cancelledInvoiceCol = foundCancelled;
    }
  });

  if (headerRowNumber === -1) {
    throw new Error(
      'Could not locate header row with "Total Delivered Invoice" / "Total Cancelled Invoice" columns'
    );
  }

  // Find the LAST row (below the header) whose first non-empty cell is exactly
  // "Total" (case-insensitive) — this is the grand-total row, distinct from any
  // "Organisation Sub Total" rows above it.
  let totalRowNumber = -1;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    let firstNonEmptyText: string | null = null;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (firstNonEmptyText === null) {
        const t = cellText(cell.value);
        if (t !== "") firstNonEmptyText = t;
      }
    });
    const rowLabel: string = firstNonEmptyText ?? "";
    if (rowLabel.toLowerCase() === "total") {
      totalRowNumber = rowNumber; // keep the LAST match
    }
  });

  if (totalRowNumber === -1) {
    throw new Error('Could not locate the grand-total "Total" row in the Financial Summary export');
  }

  const totalRow = worksheet.getRow(totalRowNumber);
  const totalDeliveredInvoice = cellNumber(totalRow.getCell(deliveredInvoiceCol).value);
  const totalCancelledInvoice = cellNumber(totalRow.getCell(cancelledInvoiceCol).value);

  return {
    totalDeliveredInvoice,
    totalCancelledInvoice,
    revenue: totalDeliveredInvoice + totalCancelledInvoice,
  };
}
