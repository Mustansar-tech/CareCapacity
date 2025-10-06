import { storage } from "./storage";
import { TravelTimeService } from "./travel-time-service";

type EmployeeDetail = {
  employeeName: string;
  status: string;
  timeWindows?: string;
  contractedDailyHours: number;
  scheduledHours: number;
};

type Visit = {
  id: string;
  clientId: string;
  date: string;                 // yyyy-MM-dd
  durationMinutes: number;
  preferredStartTime: string | null;  // ISO or HH:mm
  preferredEndTime: string | null;
  priority: number | null;
  serviceType: string | null;
  createdAt: Date;
};

type ClientLoc = { id: string; clientName: string; lat: string | null; lng: string | null; };

function hhmmToMin(hhmm?: string): number | null {
  if (!hhmm) return null;
  const s = hhmm.slice(-5);
  const [h, m] = s.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function parseWindows(winStr: string): Array<[number, number]> {
  return (winStr || "")
    .split(/[;,]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(w => {
      const [a,b] = w.split("-").map(t => t.trim());
      const s = hhmmToMin(a); const e = hhmmToMin(b);
      return s!=null && e!=null && e>s ? [s,e] as [number,number] : null;
    })
    .filter(Boolean) as Array<[number,number]>;
}

function windowCanHost(
  freePairs: Array<[number, number]>, durationMin: number,
  prefStart?: string, prefEnd?: string, bufferEachWay = 5
) {
  const pS = hhmmToMin(prefStart ?? "");
  const pE = hhmmToMin(prefEnd ?? "");
  for (const [ws,we] of freePairs) {
    const s = Number.isFinite(pS) ? Math.max(ws, pS as number) : ws;
    const e = Number.isFinite(pE) ? Math.min(we, pE as number) : we;
    if (e - s >= durationMin + 2*bufferEachWay) return true;
  }
  return false;
}

const travelService = new TravelTimeService(30, 15); // 30min max, 15min soft limit

export async function buildEmployeeFitRows(
  employeesByDate: Record<string, EmployeeDetail[]>,
  employeeSummaryByDate: Record<string, any[]>,
  maxPerEmployee = 5
) {
  const [clients, employeesLoc]:
    [ClientLoc[], any[]] = await Promise.all([
      storage.getAllClientLocations?.() ?? [],
      storage.getAllEmployeeLocations?.() ?? [],
    ]);

  // Visits are no longer stored - this functionality has been removed
  const visits: Visit[] = [];

  const clientById = new Map(clients.map(c => [c.id, c]));
  const empLocByName = new Map(employeesLoc.map(e => [e.employeeName, e]));
  const visitsByDate = new Map<string, Visit[]>();
  for (const v of visits) {
    if (!visitsByDate.has(v.date)) visitsByDate.set(v.date, []);
    visitsByDate.get(v.date)!.push(v);
  }

  const rows: any[] = [];

  for (const [date, empRows] of Object.entries(employeesByDate)) {
    const todays = (visitsByDate.get(date) ?? []).filter(v => clientById.get(v.clientId));
    if (!todays.length) continue;

    const load = new Map<string, number>();
    (employeeSummaryByDate[date] ?? []).forEach(r => load.set(r.employeeName, r.scheduledHours ?? 0));

    for (const emp of empRows) {
      if (!["Available","Partial Availability","Ad-hoc"].includes(emp.status)) continue;
      const freePairs = parseWindows(emp.timeWindows || "");
      if (!freePairs.length) continue;

      const empLoc = empLocByName.get(emp.employeeName) || {};
      const suggestions: { clientName: string; travelMin: number; duration: number }[] = [];

      for (const v of todays) {
        const c = clientById.get(v.clientId)!;
        const dur = Math.max(15, v.durationMinutes || 60);
        const can = windowCanHost(freePairs, dur, v.preferredStartTime || undefined, v.preferredEndTime || undefined, 5);
        if (!can) continue;

        // Use TravelTimeService for realistic travel time estimates
        let travelMin = 10; // fallback
        const empLat = empLoc.homeLat ? Number(empLoc.homeLat) : null;
        const empLng = empLoc.homeLng ? Number(empLoc.homeLng) : null;
        const clientLat = c.lat ? Number(c.lat) : null;
        const clientLng = c.lng ? Number(c.lng) : null;

        if (Number.isFinite(empLat) && Number.isFinite(empLng) &&
            Number.isFinite(clientLat) && Number.isFinite(clientLng)) {
          try {
            const travelMatrix = travelService.calculateTravelTime(
              { lat: empLat!, lng: empLng! },
              { lat: clientLat!, lng: clientLng! },
              empLoc.transportMode || "car"
            );
            travelMin = travelMatrix.travelTimeMinutes;
          } catch (err) {
            console.log(`⚠️ Travel time calculation failed for ${emp.employeeName} -> ${c.clientName}, using fallback`);
          }
        }

        suggestions.push({ clientName: c.clientName, travelMin, duration: dur });
      }

      suggestions.sort((a,b) => a.travelMin - b.travelMin);
      const top = suggestions.slice(0, maxPerEmployee);

      rows.push({
        Date: date,
        Employee: emp.employeeName,
        Status: emp.status,
        Windows: emp.timeWindows || "—",
        ContractedDaily: emp.contractedDailyHours ?? 0,
        ScheduledHours: load.get(emp.employeeName) ?? emp.scheduledHours ?? 0,
        Client1: top[0]?.clientName ?? "", Travel1: top[0]?.travelMin ?? "", Duration1: top[0]?.duration ?? "",
        Client2: top[1]?.clientName ?? "", Travel2: top[1]?.travelMin ?? "", Duration2: top[1]?.duration ?? "",
        Client3: top[2]?.clientName ?? "", Travel3: top[2]?.travelMin ?? "", Duration3: top[2]?.duration ?? "",
        Client4: top[3]?.clientName ?? "", Travel4: top[3]?.travelMin ?? "", Duration4: top[3]?.duration ?? "",
        Client5: top[4]?.clientName ?? "", Travel5: top[4]?.travelMin ?? "", Duration5: top[4]?.duration ?? "",
      });
    }
  }

  return rows;
}