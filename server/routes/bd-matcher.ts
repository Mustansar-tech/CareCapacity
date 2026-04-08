import type { Express } from 'express';
import { storage } from '../storage';
import { logger } from '../logger';
import { safeErrorMessage, resolveBranch } from '../utils/helpers';
import { geocodeWithFallback } from '../pipeline';
import { TravelTimeService, travelTimeService } from '../travel-time-service';
import {
  matchClientEnquiry,
  matchMultiVisitEnquiry,
  type ClientEnquiryCriteria,
  type MultiVisitCriteria,
  type MatchedEmployee,
} from '../bdMatcher';

async function refineForwardTravelWithORS(
  matches: MatchedEmployee[],
  clientCoords: { lat: number; lng: number },
  branchId: string
): Promise<void> {
  type PendingSlot = {
    match: MatchedEmployee;
    slot: import('../bdMatcher').MatchedSlot;
    nextPostcode: string | undefined;
    nextCoords: { lat: number; lng: number } | null;
    gapMins: number;
    isCar: boolean;
    transportMode: string;
    resolvedCoords?: { lat: number; lng: number };
  };

  const pending: PendingSlot[] = [];

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
      const coords = hasCoords ? { lat: nv.lat!, lng: nv.lng! } : null;
      pending.push({
        match,
        slot,
        nextPostcode: nv.postcode,
        nextCoords: coords,
        gapMins,
        isCar,
        transportMode: match.transportMode ?? 'car',
      });
    }
  }

  if (pending.length === 0) return;

  const missingGeoCount = pending.filter(p => !p.nextCoords && p.nextPostcode).length;
  logger.info(
    `[FWD-ORS] ${pending.length} slot(s) to refine (car+walker) — geocoding ${missingGeoCount} missing postcode(s)`
  );

  await Promise.all(
    pending.map(async (p) => {
      if (p.nextCoords) {
        p.resolvedCoords = p.nextCoords;
        return;
      }
      if (p.nextPostcode) {
        const geo = await geocodeWithFallback(p.nextPostcode, storage, branchId);
        if (geo?.lat && geo?.lng) {
          p.resolvedCoords = { lat: parseFloat(String(geo.lat)), lng: parseFloat(String(geo.lng)) };
        }
      }
    })
  );

  const rejectedSlots = new Set<import('../bdMatcher').MatchedSlot>();
  const orsQueue: PendingSlot[] = [];

  for (const p of pending) {
    if (!p.resolvedCoords) continue;

    const mode = TravelTimeService.normalizeMode(p.transportMode);
    const heuristicMins = travelTimeService.heuristicEstimate(clientCoords, p.resolvedCoords, mode);

    if (p.isCar) {
      if (heuristicMins >= 30) {
        logger.info(
          `[FWD-ORS] ${p.slot.day} ${p.slot.availableWindow}: car heuristic=${heuristicMins}min ≥30 — rejected`
        );
        rejectedSlots.add(p.slot);
      } else {
        p.slot.forwardTravelMinutes = heuristicMins;
        orsQueue.push(p);
      }
    } else {
      if (heuristicMins > p.gapMins + 20) {
        logger.info(
          `[FWD-ORS] ${p.slot.day} ${p.slot.availableWindow}: walk heuristic=${heuristicMins}min >gap+20 (${p.gapMins + 20}) — rejected`
        );
        rejectedSlots.add(p.slot);
      } else {
        p.slot.forwardTravelMinutes = heuristicMins;
        p.slot.forwardTravelWarning = heuristicMins > p.gapMins + 5 ? true : undefined;
        logger.info(
          `[FWD-ORS] ${p.slot.day} ${p.slot.availableWindow}: walk heuristic=${heuristicMins}min gap=${p.gapMins}min warn=${!!p.slot.forwardTravelWarning}`
        );
      }
    }
  }

  if (orsQueue.length > 0 && travelTimeService.hasORSKey()) {
    const destinations = orsQueue.map(p => p.resolvedCoords!);
    logger.info(`[FWD-ORS] ORS Matrix batch: 1×${destinations.length} (client → next visits)`);
    try {
      await travelTimeService.orsMatrixBatch([clientCoords], destinations);

      for (const p of orsQueue) {
        const cached = travelTimeService.getCachedTravelTime(clientCoords, p.resolvedCoords!, 'car');
        if (cached) {
          const roadMins = cached.durationMinutes;
          if (roadMins >= 30) {
            logger.info(
              `[FWD-ORS] ${p.slot.day} ${p.slot.availableWindow}: matrix=${roadMins}min ≥30 — rejected`
            );
            rejectedSlots.add(p.slot);
          } else {
            p.slot.forwardTravelMinutes = roadMins;
            p.slot.forwardTravelWarning = roadMins > p.gapMins + 5;
            logger.info(
              `[FWD-ORS] ${p.slot.day} ${p.slot.availableWindow}: matrix=${roadMins}min gap=${p.gapMins}min warn=${p.slot.forwardTravelWarning}`
            );
          }
        }
      }
    } catch (e) {
      logger.warn('[FWD-ORS] ORS Matrix batch failed — haversine values retained', { error: String(e) });
    }
  }

  if (rejectedSlots.size > 0) {
    logger.info(`[FWD-ORS] removing ${rejectedSlots.size} slot(s) with forward travel ≥30 min`);
    for (const match of matches) {
      match.matchedSlots = match.matchedSlots.filter(s => !rejectedSlots.has(s));
    }
  }
}

export function registerBdMatcherRoutes(app: Express): void {
  app.post('/api/bd-matcher', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { clientName, postcode, genderPreference, requiredDays, preferredTimeWindow, weekStartDate } =
        req.body;

      let selectedAnalysis = weekStartDate
        ? await storage.getCapacityAnalysisByWeekStart(branchId, weekStartDate)
        : undefined;
      if (!selectedAnalysis) selectedAnalysis = await storage.getLatestCapacityAnalysis(branchId);
      if (!selectedAnalysis) {
        return res.status(404).json({
          message: 'No processed data available. Please upload and process Excel files first.',
        });
      }

      if (!clientName || !requiredDays || !preferredTimeWindow) {
        return res.status(400).json({
          message: 'Missing required fields: clientName, requiredDays, preferredTimeWindow',
        });
      }

      const criteria: ClientEnquiryCriteria = {
        clientName,
        postcode,
        genderPreference: genderPreference || 'any',
        requiredDays,
        preferredTimeWindow,
      };

      let employeeScheduleMap:
        | Map<string, Map<string, import('../excel-visit-extractor').CpVisitEntry[]>>
        | undefined;

      try {
        const analysisDateKeys = Object.keys(
          (selectedAnalysis.employeeSummaryByDate as Record<string, unknown>) || {}
        );
        logger.info('BD Matcher: querying CP visits from DB', {
          weekStartDate: selectedAnalysis.weekStartDate,
          dates: analysisDateKeys.length,
          datesSample: analysisDateKeys.slice(0, 5),
          branchId,
          requiredDays: req.body.requiredDays,
        });
        const dbVisits = await storage.getCpScheduledVisitsByBranch(branchId, analysisDateKeys);
        logger.info('BD Matcher: DB CP visits retrieved', {
          count: dbVisits.length,
          cpNamesSample:
            dbVisits.length > 0
              ? [...new Set(dbVisits.slice(0, 10).map((v: any) => v.cpName))]
              : [],
        });
        if (dbVisits.length > 0) {
          employeeScheduleMap = new Map();
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
          logger.info('BD Matcher: built schedule map from DB', {
            employees: employeeScheduleMap.size,
            sample: Array.from(employeeScheduleMap.keys()).slice(0, 5),
          });
        } else {
          logger.warn(
            'BD Matcher: no CP visits in DB for these dates — CPs will default to home departure.',
            { queryDates: analysisDateKeys.length, branchId }
          );
        }
      } catch (err) {
        logger.error('BD Matcher: could not build employee schedule map from DB', {
          error: String(err),
          stack: err instanceof Error ? err.stack : null,
        });
      }

      const result = await matchClientEnquiry(
        criteria,
        selectedAnalysis,
        branchId,
        storage,
        employeeScheduleMap
      );

      if (criteria.postcode && result.matches.length > 0) {
        try {
          const geocoded = await geocodeWithFallback(criteria.postcode, storage, branchId);
          if (geocoded?.lat && geocoded?.lng) {
            const clientCoords = {
              lat: parseFloat(geocoded.lat),
              lng: parseFloat(geocoded.lng),
            };
            await refineForwardTravelWithORS(result.matches, clientCoords, branchId);
            result.matches = result.matches.filter(m => m.matchedSlots.length > 0);
          }
        } catch (refineErr) {
          logger.warn('BD Matcher: ORS forward-travel refinement failed (non-fatal)', {
            error: String(refineErr),
          });
        }
      }

      res.json(result);
    } catch (error) {
      logger.error('BD Matcher error', error);
      const message = safeErrorMessage(error, 'Failed to match client enquiry');
      const statusCode =
        message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });

  app.post('/api/bd-matcher/multi-visit', async (req, res) => {
    try {
      const branchId = await resolveBranch(req);
      const { clientName, postcode, visits, weekStartDate } = req.body;

      let selectedAnalysis = weekStartDate
        ? await storage.getCapacityAnalysisByWeekStart(branchId, weekStartDate)
        : undefined;
      if (!selectedAnalysis) selectedAnalysis = await storage.getLatestCapacityAnalysis(branchId);
      if (!selectedAnalysis) {
        return res.status(404).json({
          message: 'No processed data available. Please upload and process Excel files first.',
        });
      }

      if (!clientName || !visits || !Array.isArray(visits) || visits.length === 0) {
        return res.status(400).json({ message: 'Missing required fields: clientName, visits (array)' });
      }

      const multiCriteria: MultiVisitCriteria = {
        clientName,
        postcode,
        visits: visits.map((v: any, i: number) => ({
          visitLabel: v.visitLabel || `Visit ${i + 1}`,
          careProsRequired: v.careProsRequired || 1,
          genderPreferences: v.genderPreferences || ['any'],
          requiredDays: v.requiredDays || [],
          preferredTimeWindow: v.preferredTimeWindow || { start: '09:00', end: '17:00' },
        })),
      };

      let employeeScheduleMap:
        | Map<string, Map<string, import('../excel-visit-extractor').CpVisitEntry[]>>
        | undefined;

      try {
        const analysisDateKeys = Object.keys(
          (selectedAnalysis.employeeSummaryByDate as Record<string, unknown>) || {}
        );
        logger.info('BD Multi-Visit Matcher: querying CP visits from DB', {
          weekStartDate: selectedAnalysis.weekStartDate,
          dates: analysisDateKeys.length,
          branchId,
        });
        const dbVisits = await storage.getCpScheduledVisitsByBranch(branchId, analysisDateKeys);
        logger.info('BD Multi-Visit Matcher: DB CP visits retrieved', { count: dbVisits.length });
        if (dbVisits.length > 0) {
          employeeScheduleMap = new Map();
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
          logger.info('BD Multi-Visit Matcher: built schedule map from DB', {
            employees: employeeScheduleMap.size,
          });
        } else {
          logger.warn(
            'BD Multi-Visit Matcher: no CP visits in DB for these dates — CPs will default to home departure.'
          );
        }
      } catch (err) {
        logger.warn(`BD Multi-Visit Matcher: could not build employee schedule map from DB: ${err}`);
      }

      const result = await matchMultiVisitEnquiry(
        multiCriteria,
        selectedAnalysis,
        branchId,
        storage,
        employeeScheduleMap
      );

      if (multiCriteria.postcode && result.visitResults?.length > 0) {
        try {
          const geocoded = await geocodeWithFallback(multiCriteria.postcode, storage, branchId);
          if (geocoded?.lat && geocoded?.lng) {
            const clientCoords = { lat: parseFloat(geocoded.lat), lng: parseFloat(geocoded.lng) };
            const allMatches = result.visitResults.flatMap(vr => vr.matches);
            await refineForwardTravelWithORS(allMatches, clientCoords, branchId);
            for (const vr of result.visitResults) {
              vr.matches = vr.matches.filter(m => m.matchedSlots.length > 0);
            }
          }
        } catch (refineErr) {
          logger.warn('BD Multi-Visit Matcher: ORS forward-travel refinement failed (non-fatal)', {
            error: String(refineErr),
          });
        }
      }

      res.json(result);
    } catch (error) {
      logger.error('BD Multi-Visit Matcher error', error);
      const message = safeErrorMessage(error, 'Failed to match multi-visit client enquiry');
      const statusCode =
        message.includes('branchId is required') || message.includes('not found') ? 400 : 500;
      res.status(statusCode).json({ message });
    }
  });
}
