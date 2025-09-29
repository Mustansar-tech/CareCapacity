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
  date: string; 
  durationMinutes: number; 
  preferredStartTime: string | null; 
  preferredEndTime: string | null; 
  priority: number | null; 
  serviceType: string | null;
  createdAt: Date;
};

type ClientLoc = { id: string; clientName: string; lat: string | null; lng: string | null; };

function hhmmToMin(h?: string){ 
  if(!h) return null; 
  const s=h.slice(-5); 
  const [H,M]=s.split(":").map(Number); 
  return Number.isFinite(H)&&Number.isFinite(M)?H*60+M:null; 
}

function parseWindows(win?: string){ 
  return (win||"").split(/[;,]/).map(s=>s.trim()).filter(Boolean).map(w=>{
    const[a,b]=w.split("-").map(t=>t.trim());
    const s=hhmmToMin(a),e=hhmmToMin(b);
    return s!=null&&e!=null&&e>s?[s,e] as [number,number]:null
  }).filter(Boolean) as Array<[number,number]>; 
}

function canFit(free:Array<[number,number]>, dur:number, ps?:string, pe?:string){ 
  const P=hhmmToMin(ps??""),Q=hhmmToMin(pe??""); 
  for(const[ws,we] of free){
    const s=Number.isFinite(P)?Math.max(ws,P as number):ws; 
    const e=Number.isFinite(Q)?Math.min(we,Q as number):we; 
    if(e-s>=dur+10) return true;
  } 
  return false;
}

function score(travelMin:number, remainingMin:number, prio=1){ 
  const t=Math.max(0,Math.min(45,travelMin)); 
  const travelScore=1 - t/45; 
  const fair=Math.max(0,Math.min(240,remainingMin))/240*0.25; 
  const p= prio<=1?0.1: prio===2?0.05:0; 
  return Number((travelScore+fair+p).toFixed(2)); 
}

export async function buildHeatmapMatrixLite(
  employeesByDate: Record<string, EmployeeDetail[]>,
  employeeSummaryByDate: Record<string, any[]>
){
  const [clients, employeesLoc]:
    [ClientLoc[], any[]] = await Promise.all([
      storage.getAllClientLocations?.() ?? [],
      storage.getAllEmployeeLocations?.() ?? [],
    ]);

  // Get all visits for analysis
  const visits = await storage.listVisitsBetween(null, null);
  
  const clientById = new Map(clients.map(c=>[c.id,c]));
  const empLocByName = new Map(employeesLoc.map(e => [e.employeeName, e]));
  const visitsByDate = new Map<string, Visit[]>();
  for (const v of visits){ 
    if(!visitsByDate.has(v.date)) visitsByDate.set(v.date,[]); 
    visitsByDate.get(v.date)!.push(v); 
  }

  const travelService = new TravelTimeService();
  const out: Array<{date:string; employees:string[]; columns:string[]; matrix:(number|"")[][];}> = [];

  for (const [date, empRows] of Object.entries(employeesByDate)){
    const todays=(visitsByDate.get(date) ?? []).filter(v=>clientById.get(v.clientId));
    if(!todays.length) continue;

    const employees = empRows.filter(r=>["Available","Partial Availability","Ad-hoc"].includes(r.status))
                             .map(r=>r.employeeName);
    if(!employees.length) continue;

    const load=new Map<string,number>();
    (employeeSummaryByDate[date] ?? []).forEach(r=>load.set(r.employeeName, r.scheduledHours ?? 0));

    const columns = todays.map(v=>{
      const c = clientById.get(v.clientId)!;
      const s=v.preferredStartTime?.slice(-5) || ""; 
      const e=v.preferredEndTime?.slice(-5) || "";
      return `${c.clientName}${s&&e?` ${s}-${e}`:""} (${v.durationMinutes||60}m)`;
    });

    const matrix:(number|"")[][]=[];
    for (const empName of employees){
      const emp = (empRows as any[]).find(r=>r.employeeName===empName);
      const free = parseWindows(emp?.timeWindows || "");
      const remainingMin = Math.max(0, Math.round(((emp?.contractedDailyHours ?? 0) - (load.get(empName) ?? emp?.scheduledHours ?? 0)) * 60));
      const row:(number|"")[] = [];

      for (const v of todays){
        const dur=Math.max(15, v.durationMinutes || 60);
        if (!canFit(free, dur, v.preferredStartTime || undefined, v.preferredEndTime || undefined)) { 
          row.push(""); 
          continue; 
        }
        
        // Use TravelTimeService for travel time calculation
        const c = clientById.get(v.clientId)!;
        const eLoc = empLocByName.get(empName) || {};
        let t = 10; // fallback
        
        const empLat = eLoc.homeLat ? Number(eLoc.homeLat) : null;
        const empLng = eLoc.homeLng ? Number(eLoc.homeLng) : null;
        const clientLat = c.lat ? Number(c.lat) : null;
        const clientLng = c.lng ? Number(c.lng) : null;
        
        if (Number.isFinite(empLat) && Number.isFinite(empLng) && Number.isFinite(clientLat) && Number.isFinite(clientLng)) {
          try {
            const travelMatrix = travelService.calculateTravelTime(
              { lat: empLat!, lng: empLng! },
              { lat: clientLat!, lng: clientLng! },
              eLoc.transportMode || "car"
            );
            t = travelMatrix.travelTimeMinutes;
          } catch (err) {
            console.log(`⚠️ Travel time calculation failed for ${empName} -> ${c.clientName}, using fallback`);
          }
        }
        
        row.push(score(t, remainingMin, v.priority ?? 1));
      }
      matrix.push(row);
    }

    out.push({ date, employees, columns, matrix });
  }

  return out;
}