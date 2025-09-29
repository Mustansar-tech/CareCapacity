/**
 * Time Window Extractor for BD Matrix Scheduling
 * 
 * Extracts employee availability and client visit windows from processed data
 * and organizes them into visit blocks for simple time-based scheduling.
 */

import { 
  EmployeeAvailabilityWindow, 
  ClientVisitWindow, 
  VisitBlockType,
  getTimeWindowBlock,
  normalizePostcodeDistrict,
  timeStringToMinutes,
  DEFAULT_VISIT_BLOCKS
} from '@shared/schema';
import { CleanedEmployeeRecord, ServiceDeliveryRow } from '@shared/schema';

interface TimeInterval {
  start: number;
  end: number;
}

/**
 * Parse time windows string into intervals
 * Input: "08:00-12:00, 14:00-18:00" or "08:00-12:00"
 */
function parseTimeWindows(windowsStr: string): TimeInterval[] {
  if (!windowsStr || windowsStr.trim() === '' || windowsStr === '-') {
    return [];
  }

  const windows = windowsStr.split(/[,;]/).map(w => w.trim()).filter(w => w);
  const intervals: TimeInterval[] = [];

  for (const window of windows) {
    const parts = window.split('-');
    if (parts.length === 2) {
      const start = timeStringToMinutes(parts[0].trim());
      const end = timeStringToMinutes(parts[1].trim());
      
      // Clip to same day (00:00–24:00) and ignore invalid intervals
      if (start >= 0 && end > start && end <= 24 * 60) {
        intervals.push({ start, end });
      }
    }
  }

  return intervals;
}

/**
 * Extract employee availability windows from Daily Capacity data
 */
export function extractEmployeeAvailabilityWindows(
  employeeData: CleanedEmployeeRecord[],
  date: string
): EmployeeAvailabilityWindow[] {
  const windows: EmployeeAvailabilityWindow[] = [];
  
  // Filter employees for the specific date
  const dateEmployees = employeeData.filter(emp => emp.date === date);
  
  for (const emp of dateEmployees) {
    // Skip unavailable employees (Holiday, Sick, etc.)
    if (emp.status !== 'Available') {
      continue;
    }
    
    // Parse time windows from the timeWindows string
    const timeIntervals = parseTimeWindows(emp.timeWindows);
    
    // Convert each time interval to an availability window
    for (const interval of timeIntervals) {
      // Skip windows shorter than 30 minutes (not meaningful for scheduling)
      if (interval.end - interval.start < 30) {
        continue;
      }
      
      const postcodeDistrict = normalizePostcodeDistrict(emp.postCode || '');
      
      windows.push({
        employeeName: emp.employeeName,
        date: date,
        startMinutes: interval.start,
        endMinutes: interval.end,
        postcodeDistrict: postcodeDistrict,
        status: emp.status,
        contractedDailyHours: emp.contractedDailyHours
      });
    }
  }
  
  return windows;
}

/**
 * Extract client visit windows from Hours by Service Type data
 */
export function extractClientVisitWindows(
  serviceData: ServiceDeliveryRow[],
  date: string
): ClientVisitWindow[] {
  const windows: ClientVisitWindow[] = [];
  
  // Filter service data for the specific date
  const dateServices = serviceData.filter(service => {
    // Parse the date from the service data
    let serviceDate: string;
    
    if (typeof service["Actual Start Date And Time"] === 'string') {
      serviceDate = service["Actual Start Date And Time"].split(' ')[0];
    } else {
      // Handle Excel date number format
      const excelDate = new Date((service["Actual Start Date And Time"] as number - 25569) * 86400 * 1000);
      serviceDate = excelDate.toISOString().split('T')[0];
    }
    
    return serviceDate === date;
  });
  
  for (const service of dateServices) {
    // Skip cancelled visits
    if (service["Cancellation Description"]) {
      continue;
    }
    
    let startTime: Date;
    let endTime: Date;
    
    // Parse start and end times
    if (typeof service["Actual Start Date And Time"] === 'string') {
      startTime = new Date(service["Actual Start Date And Time"]);
    } else {
      startTime = new Date((service["Actual Start Date And Time"] - 25569) * 86400 * 1000);
    }
    
    if (typeof service["Actual End Date And Time"] === 'string') {
      endTime = new Date(service["Actual End Date And Time"]);
    } else {
      endTime = new Date((service["Actual End Date And Time"] - 25569) * 86400 * 1000);
    }
    
    // Convert to minutes from midnight
    const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
    const endMinutes = endTime.getHours() * 60 + endTime.getMinutes();
    const durationMinutes = service["Actual Duration"] || (endMinutes - startMinutes);
    
    // Skip very short visits (less than 15 minutes)
    if (durationMinutes < 15) {
      continue;
    }
    
    // TODO: Extract postcode from client location data
    // For now, use a placeholder that will be populated from client locations
    const postcodeDistrict = 'UNKNOWN';
    
    windows.push({
      clientName: service["Customer Name"],
      date: date,
      startMinutes: startMinutes,
      endMinutes: endMinutes,
      durationMinutes: durationMinutes,
      postcodeDistrict: postcodeDistrict,
      serviceType: service["Actual Service Type Description"],
      priority: 1 // Default priority
    });
  }
  
  return windows;
}

/**
 * Create default client visit windows for clients without specific time data
 */
export function createDefaultClientVisitWindows(
  clientNames: string[],
  date: string,
  defaultDurationMinutes = 60
): ClientVisitWindow[] {
  const windows: ClientVisitWindow[] = [];
  
  // Create default morning slots for clients without specific visit times
  for (const clientName of clientNames) {
    // Use morning block as default
    const morningBlock = DEFAULT_VISIT_BLOCKS.morning;
    
    windows.push({
      clientName: clientName,
      date: date,
      startMinutes: morningBlock.startMinutes, // 08:00
      endMinutes: morningBlock.startMinutes + defaultDurationMinutes, // 09:00
      durationMinutes: defaultDurationMinutes,
      postcodeDistrict: 'UNKNOWN', // Will be populated from client locations
      serviceType: 'General Care',
      priority: 1
    });
  }
  
  return windows;
}

/**
 * Group availability windows by visit block and postcode district
 */
export function groupEmployeeWindowsByBlockAndDistrict(
  windows: EmployeeAvailabilityWindow[]
): Record<string, Record<string, EmployeeAvailabilityWindow[]>> {
  const grouped: Record<string, Record<string, EmployeeAvailabilityWindow[]>> = {};
  
  // Initialize with empty blocks
  for (const blockType of Object.keys(DEFAULT_VISIT_BLOCKS)) {
    grouped[blockType] = {};
  }
  
  for (const window of windows) {
    // Determine which block this window belongs to
    const block = getTimeWindowBlock(window.startMinutes, window.endMinutes);
    if (!block) continue; // Skip windows that don't fit in any block
    
    if (!grouped[block][window.postcodeDistrict]) {
      grouped[block][window.postcodeDistrict] = [];
    }
    
    grouped[block][window.postcodeDistrict].push(window);
  }
  
  return grouped;
}

/**
 * Group client windows by visit block and postcode district
 */
export function groupClientWindowsByBlockAndDistrict(
  windows: ClientVisitWindow[]
): Record<string, Record<string, ClientVisitWindow[]>> {
  const grouped: Record<string, Record<string, ClientVisitWindow[]>> = {};
  
  // Initialize with empty blocks
  for (const blockType of Object.keys(DEFAULT_VISIT_BLOCKS)) {
    grouped[blockType] = {};
  }
  
  for (const window of windows) {
    // Determine which block this window belongs to
    const block = getTimeWindowBlock(window.startMinutes, window.endMinutes);
    if (!block) continue; // Skip windows that don't fit in any block
    
    if (!grouped[block][window.postcodeDistrict]) {
      grouped[block][window.postcodeDistrict] = [];
    }
    
    grouped[block][window.postcodeDistrict].push(window);
  }
  
  return grouped;
}

/**
 * Update client visit windows with postcode districts from location data
 */
export function updateClientWindowsWithPostcodes(
  windows: ClientVisitWindow[],
  clientLocations: Array<{ clientName: string; postcode: string }>
): ClientVisitWindow[] {
  const locationMap = new Map(
    clientLocations.map(loc => [loc.clientName, normalizePostcodeDistrict(loc.postcode)])
  );
  
  return windows.map(window => ({
    ...window,
    postcodeDistrict: locationMap.get(window.clientName) || 'UNKNOWN'
  }));
}

/**
 * Find unmatched employees and clients for a given date
 */
export function findUnmatchedWindowsForDate(
  employeeWindows: EmployeeAvailabilityWindow[],
  clientWindows: ClientVisitWindow[],
  assignments: Array<{ employeeName: string; clientName: string; date: string }>
): {
  employees: EmployeeAvailabilityWindow[];
  clients: ClientVisitWindow[];
} {
  const assignedEmployees = new Set(
    assignments.map(a => a.employeeName)
  );
  const assignedClients = new Set(
    assignments.map(a => a.clientName)
  );
  
  const unmatchedEmployees = employeeWindows.filter(
    emp => !assignedEmployees.has(emp.employeeName)
  );
  
  const unmatchedClients = clientWindows.filter(
    client => !assignedClients.has(client.clientName)
  );
  
  return {
    employees: unmatchedEmployees,
    clients: unmatchedClients
  };
}

/**
 * Generate scheduling summary statistics
 */
export function generateSchedulingSummary(
  employeeWindows: EmployeeAvailabilityWindow[],
  clientWindows: ClientVisitWindow[],
  assignments: Array<{ employeeName: string; clientName: string }>
) {
  const totalEmployees = new Set(employeeWindows.map(w => w.employeeName)).size;
  const totalClients = new Set(clientWindows.map(w => w.clientName)).size;
  const assignedEmployees = new Set(assignments.map(a => a.employeeName)).size;
  const assignedClients = new Set(assignments.map(a => a.clientName)).size;
  
  const employeesByBlock: Record<string, Set<string>> = {};
  const clientsByBlock: Record<string, Set<string>> = {};
  
  // Count employees by block
  for (const window of employeeWindows) {
    const block = getTimeWindowBlock(window.startMinutes, window.endMinutes);
    if (block) {
      if (!employeesByBlock[block]) employeesByBlock[block] = new Set();
      employeesByBlock[block].add(window.employeeName);
    }
  }
  
  // Count clients by block
  for (const window of clientWindows) {
    const block = getTimeWindowBlock(window.startMinutes, window.endMinutes);
    if (block) {
      if (!clientsByBlock[block]) clientsByBlock[block] = new Set();
      clientsByBlock[block].add(window.clientName);
    }
  }
  
  return {
    totalEmployees,
    totalClients,
    assignedEmployees,
    assignedClients,
    unassignedEmployees: totalEmployees - assignedEmployees,
    unassignedClients: totalClients - assignedClients,
    coverageRate: totalClients > 0 ? (assignedClients / totalClients) * 100 : 0,
    utilizationRate: totalEmployees > 0 ? (assignedEmployees / totalEmployees) * 100 : 0,
    blockBreakdown: {
      employees: Object.fromEntries(
        Object.entries(employeesByBlock).map(([block, employees]) => [block, employees.size])
      ),
      clients: Object.fromEntries(
        Object.entries(clientsByBlock).map(([block, clients]) => [block, clients.size])
      )
    }
  };
}