// Service types to exclude (including secondary care, office hours, and night shifts)
const EXCLUDED_SERVICE_TYPES = [
  'office hours',
  'office',
  'multiple care (secondary)',
  'secondary',
  '(secondary)'
];

// Filter out excluded service types (secondary care, office hours, night shifts)
function isExcludedServiceType(serviceType: string): boolean {
  if (!serviceType) return false;
  const lowerType = serviceType.toLowerCase();
  return EXCLUDED_SERVICE_TYPES.some(excluded => lowerType.includes(excluded));
}

// Filter out office visits based on client name keywords
function isOfficeVisit(clientName: string): boolean {
  if (!clientName) return false;
  const lowerName = clientName.toLowerCase();
  // Add more office visit keywords if needed
  const officeKeywords = ['office', 'clinic', 'surgery', 'hospital'];
  return officeKeywords.some(keyword => lowerName.includes(keyword));
}

// Function to process and filter visits
function processVisits(visits: Visit[]): Visit[] {
  const filteredVisits = visits.filter(visit => {
    // Skip office visits
    if (isOfficeVisit(visit.clientName)) {
      console.log(`🚫 Excluding office visit: ${visit.clientName}`);
      return false;
    }

    // Skip excluded service types (office hours, night shifts, secondary care)
    if (isExcludedServiceType(visit.serviceType || '')) {
      console.log(`🚫 Excluding service type: ${visit.clientName} (${visit.serviceType})`);
      return false;
    }

    return true;
  });

  // Further processing of filteredVisits can be done here

  return filteredVisits;
}

// Placeholder for Visit type if not defined elsewhere
interface Visit {
  clientName: string | null;
  serviceType: string | null;
  // Add other properties of a visit as needed
}