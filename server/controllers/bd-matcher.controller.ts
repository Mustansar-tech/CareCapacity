import { Request, Response } from 'express';
import { resolveBranch } from '../utils/helpers';
import { geocodeWithFallback } from '../pipeline';
import { matchClientEnquiry, matchMultiVisitEnquiry, type ClientEnquiryCriteria, type MultiVisitCriteria } from '../features/bd-matrix/bdMatcher';
import { computeConsistentStars, type WeeklyMatchResult } from '../features/bd-matrix/multiWeekConsistency';
import * as capacityRepo from '../repositories/capacity.repository';
import { refineForwardTravelWithORS, refineReturnHomeTravelWithORS, buildScheduleMap } from '../services/bd-matcher.service';
import { logger } from '../infrastructure/logger';

export async function bdMatch(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { clientName, postcode, genderPreference, requiredDays, preferredTimeWindow, weekStartDate } = req.body;
  const { storage } = await import('../storage');

  let selectedAnalysis = weekStartDate ? await capacityRepo.getCapacityAnalysisByWeekStart(branchId, weekStartDate) : undefined;
  if (!selectedAnalysis) selectedAnalysis = await capacityRepo.getLatestCapacityAnalysis(branchId);
  if (!selectedAnalysis) {
    res.status(404).json({ message: 'No processed data available. Please upload and process Excel files first.' });
    return;
  }

  if (!clientName || !requiredDays || !preferredTimeWindow) {
    res.status(400).json({ message: 'Missing required fields: clientName, requiredDays, preferredTimeWindow' });
    return;
  }

  // Validate postcode can be geocoded before proceeding
  if (postcode) {
    const geocoded = await geocodeWithFallback(postcode, storage, branchId);
    if (!geocoded?.lat || !geocoded?.lng) {
      res.status(422).json({ message: 'POSTCODE_NOT_FOUND', postcode });
      return;
    }
  }

  const criteria: ClientEnquiryCriteria = {
    clientName, postcode, genderPreference: genderPreference || 'any', requiredDays, preferredTimeWindow,
  };
  const analysisDateKeys = Object.keys((selectedAnalysis.employeeSummaryByDate as Record<string, unknown>) || {});

  let employeeScheduleMap: Awaited<ReturnType<typeof buildScheduleMap>>;
  try {
    logger.info('BD Matcher: querying CP visits from DB', { weekStartDate: selectedAnalysis.weekStartDate, dates: analysisDateKeys.length, branchId });
    employeeScheduleMap = await buildScheduleMap(branchId, analysisDateKeys);
    logger.info('BD Matcher: built schedule map from DB', { employees: employeeScheduleMap?.size ?? 0 });
  } catch (err) {
    logger.error('BD Matcher: could not build employee schedule map from DB', { error: String(err) });
  }

  const result = await matchClientEnquiry(criteria, selectedAnalysis, branchId, storage, employeeScheduleMap);

  if (criteria.postcode && result.matches.length > 0) {
    try {
      const geocoded = await geocodeWithFallback(criteria.postcode, storage, branchId);
      if (geocoded?.lat && geocoded?.lng) {
        const clientCoords = { lat: parseFloat(geocoded.lat), lng: parseFloat(geocoded.lng) };
        await refineForwardTravelWithORS(result.matches, clientCoords, branchId);
        result.matches = result.matches.filter(m => m.matchedSlots.length > 0);
        await refineReturnHomeTravelWithORS(result.matches, clientCoords);
      }
    } catch (refineErr) {
      logger.warn('BD Matcher: ORS forward-travel refinement failed (non-fatal)', { error: String(refineErr) });
    }
  }

  res.json(result);
}

/**
 * Multi-week matcher: runs the same enquiry against the selected week AND
 * every future week with processed data, then computes consistency-ranked
 * recommended stars per week. The travel service's session cache is shared
 * across weeks, so ORS is only hit once per unique coordinate pair.
 */
export async function bdMatchMultiWeek(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { clientName, postcode, visits, weekStartDate } = req.body;
  const { storage } = await import('../storage');

  if (!clientName || !visits || !Array.isArray(visits) || visits.length === 0) {
    res.status(400).json({ message: 'Missing required fields: clientName, visits (array)' });
    return;
  }

  // All analyses in the rolling window, oldest first
  const windowed = (await capacityRepo.getWindowedAnalyses(branchId))
    .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));

  // Start from the requested week (or the latest analysis if none requested/found)
  let startWeek = weekStartDate as string | undefined;
  if (!startWeek || !windowed.some(a => a.weekStartDate === startWeek)) {
    const latest = await capacityRepo.getLatestCapacityAnalysis(branchId);
    startWeek = latest?.weekStartDate;
  }
  const analyses = windowed.filter(a => startWeek && a.weekStartDate >= startWeek);
  if (analyses.length === 0) {
    res.status(404).json({ message: 'No processed data available. Please upload and process Excel files first.' });
    return;
  }

  // Validate postcode can be geocoded before doing any heavy work
  let clientCoords: { lat: number; lng: number } | undefined;
  if (postcode) {
    const geocoded = await geocodeWithFallback(postcode, storage, branchId);
    if (!geocoded?.lat || !geocoded?.lng) {
      res.status(422).json({ message: 'POSTCODE_NOT_FOUND', postcode });
      return;
    }
    clientCoords = { lat: parseFloat(geocoded.lat), lng: parseFloat(geocoded.lng) };
  }

  const multiCriteria: MultiVisitCriteria = {
    clientName, postcode,
    visits: visits.map((v: any, i: number) => ({
      visitLabel: v.visitLabel || `Visit ${i + 1}`,
      careProsRequired: v.careProsRequired || 1,
      genderPreferences: v.genderPreferences || ['any'],
      requiredDays: v.requiredDays || [],
      preferredTimeWindow: v.preferredTimeWindow || { start: '09:00', end: '17:00' },
    })),
  };

  logger.info('BD Multi-Week Matcher: starting', { branchId, startWeek, weeks: analyses.length });

  const weekly: WeeklyMatchResult[] = [];
  for (const analysis of analyses) {
    const analysisDateKeys = Object.keys((analysis.employeeSummaryByDate as Record<string, unknown>) || {});
    let employeeScheduleMap: Awaited<ReturnType<typeof buildScheduleMap>>;
    try {
      employeeScheduleMap = await buildScheduleMap(branchId, analysisDateKeys);
    } catch (err) {
      logger.warn(`BD Multi-Week Matcher: schedule map failed for ${analysis.weekStartDate}: ${err}`);
    }

    const result = await matchMultiVisitEnquiry(multiCriteria, analysis, branchId, storage, employeeScheduleMap);

    // ORS refinement — session cache is shared, repeat coordinate pairs are free
    if (clientCoords && result.visitResults?.length > 0) {
      try {
        const allMatches = result.visitResults.flatMap(vr => vr.matches);
        await refineForwardTravelWithORS(allMatches, clientCoords, branchId);
        for (const vr of result.visitResults) vr.matches = vr.matches.filter(m => m.matchedSlots.length > 0);
        await refineReturnHomeTravelWithORS(allMatches, clientCoords);
      } catch (refineErr) {
        logger.warn('BD Multi-Week Matcher: ORS refinement failed (non-fatal)', { week: analysis.weekStartDate, error: String(refineErr) });
      }
    }

    weekly.push({ weekStartDate: analysis.weekStartDate, result });
  }

  const recommendedStars = computeConsistentStars(
    weekly,
    multiCriteria.visits.map(v => ({
      requiredDays: v.requiredDays,
      careProsRequired: v.careProsRequired,
      genderPreferences: v.genderPreferences,
      preferredTimeWindow: v.preferredTimeWindow,
    })),
  );

  res.json({
    clientName,
    postcode: postcode || undefined,
    totalVisits: multiCriteria.visits.length,
    weeks: weekly.map(w => ({
      weekStartDate: w.weekStartDate,
      visitResults: w.result.visitResults,
      totalVisits: w.result.totalVisits,
    })),
    recommendedStars,
  });
}

export async function bdMatchMultiVisit(req: Request, res: Response): Promise<void> {
  const branchId = await resolveBranch(req);
  const { clientName, postcode, visits, weekStartDate } = req.body;
  const { storage } = await import('../storage');

  let selectedAnalysis = weekStartDate ? await capacityRepo.getCapacityAnalysisByWeekStart(branchId, weekStartDate) : undefined;
  if (!selectedAnalysis) selectedAnalysis = await capacityRepo.getLatestCapacityAnalysis(branchId);
  if (!selectedAnalysis) {
    res.status(404).json({ message: 'No processed data available. Please upload and process Excel files first.' });
    return;
  }

  if (!clientName || !visits || !Array.isArray(visits) || visits.length === 0) {
    res.status(400).json({ message: 'Missing required fields: clientName, visits (array)' });
    return;
  }

  // Validate postcode can be geocoded before proceeding
  if (postcode) {
    const geocoded = await geocodeWithFallback(postcode, storage, branchId);
    if (!geocoded?.lat || !geocoded?.lng) {
      res.status(422).json({ message: 'POSTCODE_NOT_FOUND', postcode });
      return;
    }
  }

  const multiCriteria: MultiVisitCriteria = {
    clientName, postcode,
    visits: visits.map((v: any, i: number) => ({
      visitLabel: v.visitLabel || `Visit ${i + 1}`,
      careProsRequired: v.careProsRequired || 1,
      genderPreferences: v.genderPreferences || ['any'],
      requiredDays: v.requiredDays || [],
      preferredTimeWindow: v.preferredTimeWindow || { start: '09:00', end: '17:00' },
    })),
  };

  const analysisDateKeys = Object.keys((selectedAnalysis.employeeSummaryByDate as Record<string, unknown>) || {});
  let employeeScheduleMap: Awaited<ReturnType<typeof buildScheduleMap>>;
  try {
    logger.info('BD Multi-Visit Matcher: querying CP visits from DB', { weekStartDate: selectedAnalysis.weekStartDate, dates: analysisDateKeys.length, branchId });
    employeeScheduleMap = await buildScheduleMap(branchId, analysisDateKeys);
    logger.info('BD Multi-Visit Matcher: built schedule map from DB', { employees: employeeScheduleMap?.size ?? 0 });
  } catch (err) {
    logger.warn(`BD Multi-Visit Matcher: could not build employee schedule map from DB: ${err}`);
  }

  const result = await matchMultiVisitEnquiry(multiCriteria, selectedAnalysis, branchId, storage, employeeScheduleMap);

  if (multiCriteria.postcode && result.visitResults?.length > 0) {
    try {
      const geocoded = await geocodeWithFallback(multiCriteria.postcode, storage, branchId);
      if (geocoded?.lat && geocoded?.lng) {
        const clientCoords = { lat: parseFloat(geocoded.lat), lng: parseFloat(geocoded.lng) };
        const allMatches = result.visitResults.flatMap(vr => vr.matches);
        await refineForwardTravelWithORS(allMatches, clientCoords, branchId);
        for (const vr of result.visitResults) vr.matches = vr.matches.filter(m => m.matchedSlots.length > 0);
        await refineReturnHomeTravelWithORS(allMatches, clientCoords);
      }
    } catch (refineErr) {
      logger.warn('BD Multi-Visit Matcher: ORS forward-travel refinement failed (non-fatal)', { error: String(refineErr) });
    }
  }

  res.json(result);
}
