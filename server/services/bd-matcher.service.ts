import { geocodeWithFallback } from '../pipeline';
import { TravelTimeService, travelTimeService } from '../features/travel/travel-time-service';
import type { MatchedEmployee, MatchedSlot } from '../features/bd-matrix/bdMatcher';
import type { CpVisitEntry } from '../features/imports/excel-visit-extractor';
import { logger } from '../infrastructure/logger';

export async function refineForwardTravelWithORS(
  matches: MatchedEmployee[],
  clientCoords: { lat: number; lng: number },
  branchId: string,
): Promise<void> {
  type PendingSlot = {
    match: MatchedEmployee;
    slot: MatchedSlot;
    nextPostcode: string | undefined;
    nextCoords: { lat: number; lng: number } | null;
    gapMins: number;
    isCar: boolean;
    transportMode: string;
    resolvedCoords?: { lat: number; lng: number };
  };

  const pending: PendingSlot[] = [];
  const { storage } = await import('../storage');

  for (const match of matches) {
    const isCar = TravelTimeService.normalizeMode(match.transportMode) === 'car';
    if (!isCar && TravelTimeService.normalizeMode(match.transportMode) !== 'walking') continue;

    for (const slot of match.matchedSlots) {
      const nv = slot.nextVisit;
      if (!nv) continue;
      const endStr = slot.availableWindow.split('-')[1] ?? '';
      const [endH, endM] = endStr.split(':').map(Number);
      const [nvH, nvM] = nv.startTime.split(':').map(Number);
      if (isNaN(endH) || isNaN(endM) || isNaN(nvH) || isNaN(nvM)) continue;
      const gapMins = nvH * 60 + nvM - (endH * 60 + endM);
      if (gapMins >= 90) continue;
      const hasCoords = nv.lat != null && nv.lng != null;
      pending.push({
        match, slot, nextPostcode: nv.postcode,
        nextCoords: hasCoords ? { lat: nv.lat!, lng: nv.lng! } : null,
        gapMins, isCar, transportMode: match.transportMode ?? 'car',
      });
    }
  }

  if (pending.length === 0) return;

  const missingGeoCount = pending.filter(p => !p.nextCoords && p.nextPostcode).length;
  logger.info(`[FWD-ORS] ${pending.length} slot(s) to refine (car+walker) — geocoding ${missingGeoCount} missing postcode(s)`);

  await Promise.all(
    pending.map(async (p) => {
      if (p.nextCoords) { p.resolvedCoords = p.nextCoords; return; }
      if (p.nextPostcode) {
        const geo = await geocodeWithFallback(p.nextPostcode, storage, branchId);
        if (geo?.lat && geo?.lng) {
          p.resolvedCoords = { lat: parseFloat(String(geo.lat)), lng: parseFloat(String(geo.lng)) };
        }
      }
    }),
  );

  const rejectedSlots = new Set<MatchedSlot>();
  const orsQueue: PendingSlot[] = [];

  for (const p of pending) {
    if (!p.resolvedCoords) continue;
    const mode = TravelTimeService.normalizeMode(p.transportMode);
    const heuristicMins = travelTimeService.heuristicEstimate(clientCoords, p.resolvedCoords, mode);
    if (p.isCar) {
      if (heuristicMins >= 30) {
        logger.info(`[FWD-ORS] ${p.slot.day} ${p.slot.availableWindow}: car heuristic=${heuristicMins}min ≥30 — rejected`);
        rejectedSlots.add(p.slot);
      } else {
        p.slot.forwardTravelMinutes = heuristicMins;
        orsQueue.push(p);
      }
    } else {
      if (heuristicMins > p.gapMins + 20) {
        logger.info(`[FWD-ORS] ${p.slot.day} ${p.slot.availableWindow}: walk heuristic=${heuristicMins}min >gap+20 — rejected`);
        rejectedSlots.add(p.slot);
      } else {
        p.slot.forwardTravelMinutes = heuristicMins;
        p.slot.forwardTravelWarning = heuristicMins > p.gapMins + 5 ? true : undefined;
      }
    }
  }

  if (orsQueue.length > 0 && travelTimeService.hasORSKey()) {
    const destinations = orsQueue.map(p => p.resolvedCoords!);
    try {
      await travelTimeService.orsMatrixBatch([clientCoords], destinations);
      for (const p of orsQueue) {
        const cached = travelTimeService.getCachedTravelTime(clientCoords, p.resolvedCoords!, 'car');
        if (cached) {
          const roadMins = cached.durationMinutes;
          if (roadMins >= 30) {
            rejectedSlots.add(p.slot);
          } else {
            p.slot.forwardTravelMinutes = roadMins;
            p.slot.forwardTravelWarning = roadMins > p.gapMins + 5;
          }
        }
      }
    } catch (e) {
      logger.warn('[FWD-ORS] ORS Matrix batch failed — haversine values retained', { error: String(e) });
    }
  }

  if (rejectedSlots.size > 0) {
    for (const match of matches) {
      match.matchedSlots = match.matchedSlots.filter(s => !rejectedSlots.has(s));
    }
  }
}

export async function buildScheduleMap(
  branchId: string,
  analysisDateKeys: string[],
): Promise<Map<string, Map<string, CpVisitEntry[]>> | undefined> {
  const { storage } = await import('../storage');
  const dbVisits = await storage.getCpScheduledVisitsByBranch(branchId, analysisDateKeys);
  if (dbVisits.length === 0) return undefined;

  const employeeScheduleMap = new Map<string, Map<string, CpVisitEntry[]>>();
  for (const v of dbVisits) {
    if (!employeeScheduleMap.has(v.cpName)) employeeScheduleMap.set(v.cpName, new Map());
    const dayMap = employeeScheduleMap.get(v.cpName)!;
    if (!dayMap.has(v.date)) dayMap.set(v.date, []);
    dayMap.get(v.date)!.push({
      clientName: v.clientName,
      startTime: v.startTime,
      endTime: v.endTime,
      lat: v.clientLat ? Number(v.clientLat) : undefined,
      lng: v.clientLng ? Number(v.clientLng) : undefined,
      postcode: v.clientPostcode ?? undefined,
    });
  }
  for (const dayMap of employeeScheduleMap.values()) {
    for (const visits of dayMap.values()) {
      visits.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
  }
  return employeeScheduleMap;
}
