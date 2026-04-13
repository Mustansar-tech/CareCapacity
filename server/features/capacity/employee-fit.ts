import type { EmployeeDailyDetail, EmployeeSummaryRecord } from "@shared/schema";

export interface FitRow {
  Date: string;
  Employee: string;
  Status: string;
  Windows: string;
  ContractedDaily: number | string;
  ScheduledHours: number | string;
  Client1: string; Travel1: number | string; Duration1: number | string;
  Client2: string; Travel2: number | string; Duration2: number | string;
  Client3: string; Travel3: number | string; Duration3: number | string;
  Client4: string; Travel4: number | string; Duration4: number | string;
  Client5: string; Travel5: number | string; Duration5: number | string;
}

function emptyClientSlots(maxClients: number): Pick<
  FitRow,
  | "Client1" | "Travel1" | "Duration1"
  | "Client2" | "Travel2" | "Duration2"
  | "Client3" | "Travel3" | "Duration3"
  | "Client4" | "Travel4" | "Duration4"
  | "Client5" | "Travel5" | "Duration5"
> {
  const slots: Record<string, string | number> = {};
  for (let i = 1; i <= maxClients; i++) {
    slots[`Client${i}`] = "";
    slots[`Travel${i}`] = "";
    slots[`Duration${i}`] = "";
  }
  return slots as ReturnType<typeof emptyClientSlots>;
}

export async function buildEmployeeFitRows(
  employeesByDate: Record<string, EmployeeDailyDetail[]>,
  employeeSummaryByDate: Record<string, EmployeeSummaryRecord[]>,
  maxClients: number
): Promise<FitRow[]> {
  const rows: FitRow[] = [];

  for (const [date, employees] of Object.entries(employeesByDate)) {
    const summaryForDate: EmployeeSummaryRecord[] = employeeSummaryByDate[date] ?? [];

    for (const emp of employees) {
      const summary = summaryForDate.find(s => s.employeeName === emp.employeeName);

      rows.push({
        Date: date,
        Employee: emp.employeeName,
        Status: emp.status,
        Windows: summary?.freeWindows || emp.timeWindows,
        ContractedDaily: emp.contractedDailyHours,
        ScheduledHours: emp.scheduledHours,
        ...emptyClientSlots(maxClients),
      });
    }
  }

  return rows;
}
