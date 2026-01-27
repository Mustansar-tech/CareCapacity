// Walker Proximity Matching System
// 
// DESIGN RATIONALE:
// Walking employees are treated as CONSTRAINT-BASED resources, not travel-time-based.
// This is because:
// 1. Walk speeds are highly variable (terrain, weather, fitness, carrying equipment)
// 2. Public transport calculations are unreliable without live API data
// 3. Walkers realistically serve only their local area
// 
// Instead of calculating travel times (which would be inaccurate), we use PROXIMITY RULES:
// - Same postcode = definitely walkable
// - Within 1.5km = likely walkable (10-15 min walk at average pace)
// - Outside these bounds = not suitable for walkers
//
// This approach prioritizes RELIABILITY over optimization accuracy.

import type { ClientVisit } from "@shared/schema";

// Maximum walking distance in kilometers
const MAX_WALKING_DISTANCE_KM = 1.5;

// Fixed walking travel time for display (actual time not calculated)
export const WALKING_TRAVEL_DISPLAY_MINUTES = 15;

export interface WalkerCandidate {
  employeeName: string;
  homeLat: number;
  homeLng: number;
  homePostcode?: string;
  date: string;
  capacityMinutes: number;
  usedMinutes: number;
  weeklyContractedMinutes: number;
  weeklyUsedMinutes: number;
}

export interface VisitWithLocation {
  id: string;
  clientName: string;
  lat: number;
  lng: number;
  postcode?: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  date: string;
}

// Calculate Haversine distance between two points (in kilometers)
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Extract postcode sector (e.g., "EH8 7" from "EH8 7AB")
// Postcode sector = outward code + first digit of inward code
function getPostcodeSector(postcode: string | undefined): string | null {
  if (!postcode) return null;
  const clean = postcode.trim().toUpperCase();
  // UK postcode format: outward (2-4 chars) + space + inward (3 chars)
  // Extract sector = outward + first digit of inward
  const match = clean.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)\s*(\d)/);
  if (match) {
    return `${match[1]} ${match[2]}`;
  }
  // Fallback: just return the outward code
  const outward = clean.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)/);
  return outward ? outward[1] : null;
}

// Check if visit is within walking proximity of employee
// Returns true if visit is suitable for a walking employee
export function isWithinWalkingProximity(
  walker: WalkerCandidate,
  visit: VisitWithLocation
): boolean {
  // First check: Same postcode sector (most reliable for UK addresses)
  const walkerSector = getPostcodeSector((walker as any).homePostcode);
  const visitSector = getPostcodeSector(visit.postcode);
  
  if (walkerSector && visitSector && walkerSector === visitSector) {
    return true;
  }
  
  // Second check: Physical distance within walking limit
  const distanceKm = haversineDistance(
    walker.homeLat,
    walker.homeLng,
    visit.lat,
    visit.lng
  );
  
  if (distanceKm <= MAX_WALKING_DISTANCE_KM) {
    return true;
  }
  
  return false;
}

// Score walker-visit match based on proximity
// Higher score = better match (closer to home)
export function scoreWalkerMatch(
  walker: WalkerCandidate,
  visit: VisitWithLocation
): number {
  if (!isWithinWalkingProximity(walker, visit)) {
    return -1; // Not walkable
  }
  
  const distanceKm = haversineDistance(
    walker.homeLat,
    walker.homeLng,
    visit.lat,
    visit.lng
  );
  
  // Score based on proximity (closer = higher score)
  // Max score 1.0 at 0km, min score 0.0 at MAX_WALKING_DISTANCE_KM
  const proximityScore = 1 - (distanceKm / MAX_WALKING_DISTANCE_KM);
  
  // Bonus for same postcode sector
  const walkerSector = getPostcodeSector((walker as any).homePostcode);
  const visitSector = getPostcodeSector(visit.postcode);
  const samePostcodeBonus = (walkerSector && visitSector && walkerSector === visitSector) ? 0.2 : 0;
  
  return Math.min(1.0, proximityScore + samePostcodeBonus);
}

// Get all walkable visits for a walker, sorted by distance
export function getWalkableVisits(
  walker: WalkerCandidate,
  visits: VisitWithLocation[]
): Array<{ visit: VisitWithLocation; score: number; distanceKm: number }> {
  const walkable: Array<{ visit: VisitWithLocation; score: number; distanceKm: number }> = [];
  
  for (const visit of visits) {
    // Skip if different date
    if (visit.date !== walker.date) continue;
    
    const score = scoreWalkerMatch(walker, visit);
    if (score > 0) {
      const distanceKm = haversineDistance(
        walker.homeLat,
        walker.homeLng,
        visit.lat,
        visit.lng
      );
      walkable.push({ visit, score, distanceKm });
    }
  }
  
  // Sort by score descending (nearest first)
  walkable.sort((a, b) => b.score - a.score);
  
  return walkable;
}

// Check if a sequence of visits is walkable (consecutive visits in same area)
// This allows walkers to do multiple visits if they're all nearby
export function areVisitsWalkable(
  visits: VisitWithLocation[]
): boolean {
  if (visits.length < 2) return true;
  
  for (let i = 0; i < visits.length - 1; i++) {
    const dist = haversineDistance(
      visits[i].lat,
      visits[i].lng,
      visits[i + 1].lat,
      visits[i + 1].lng
    );
    if (dist > MAX_WALKING_DISTANCE_KM) {
      return false;
    }
  }
  
  return true;
}

// Get distance between two visits
export function getDistanceBetweenVisits(
  visit1: VisitWithLocation,
  visit2: VisitWithLocation
): number {
  return haversineDistance(
    visit1.lat,
    visit1.lng,
    visit2.lat,
    visit2.lng
  );
}
