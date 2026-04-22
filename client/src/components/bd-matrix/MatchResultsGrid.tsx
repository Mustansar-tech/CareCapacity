import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Users, MapPin, Star, ArrowRight, ArrowLeft, X, Activity,
  Home, Clock, UserCheck, XCircle, Info, History, FileDown,
} from "lucide-react";
import { TransportModeIcon } from "./TransportModeIcon";
import { roundContractedHours, type MultiVisitResult, type MatchedSlot } from "@/utils/bd-matrix-utils";
import { exportSchedulePdf } from "@/utils/export-schedule-pdf";

interface VisitTabDef {
  index: number;
  label: string;
  careProsRequired?: number;
  selectedDays?: string[];
}

interface MatchResultsGridProps {
  result: MultiVisitResult;
  requiredDays?: string[];
  className?: string;
  sortByTravel?: boolean;
  onToggleSortByTravel?: () => void;
  enquiryPostcode?: string;
  enquiryTimeStart?: string;
  enquiryTimeEnd?: string;
  visitTabs?: VisitTabDef[];
  activeVisitTab?: string;
  onVisitTabChange?: (tab: string) => void;
  historyCount?: number;
  onHistory?: () => void;
}

export function MatchResultsGrid({
  result,
  requiredDays = [],
  className = '',
  sortByTravel = false,
  onToggleSortByTravel,
  enquiryPostcode,
  enquiryTimeStart,
  enquiryTimeEnd,
  visitTabs,
  activeVisitTab,
  onVisitTabChange,
  historyCount,
  onHistory,
}: MatchResultsGridProps) {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'];

  const visibleDays = days.filter(d => requiredDays.includes(d));
  const visibleDayLabels = dayLabels.filter((_, i) => requiredDays.includes(days[i]));

  const displayDays = visibleDays.length > 0 ? visibleDays : days;
  const displayLabels = visibleDayLabels.length > 0 ? visibleDayLabels : dayLabels;

  const [starredMap, setStarredMap] = useState<Record<string, { employeeName: string; timeWindow: string; gender?: string; transportMode?: string }>>({});

  const starKey = (visitIndex: number, cpIdx: number, day: string) => `${visitIndex}-${cpIdx}-${day}`;

  const getStarred = (visitIndex: number, cpIdx: number, day: string) =>
    starredMap[starKey(visitIndex, cpIdx, day)];

  const toggleStar = (visitIndex: number, cpIdx: number, day: string, employeeName: string, timeWindow: string, gender?: string, transportMode?: string) => {
    const key = starKey(visitIndex, cpIdx, day);
    setStarredMap(prev => {
      const existing = prev[key];
      if (existing?.employeeName === employeeName) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { employeeName, timeWindow, gender, transportMode } };
    });
  };

  const normalizeDay = (d: string) => {
    const mapped: Record<string, string> = {
      'thu': 'thu', 'thur': 'thu', 'thurs': 'thu',
      'sat': 'sat', 'sun': 'sun', 'mon': 'mon',
      'tue': 'tue', 'tues': 'tue', 'wed': 'wed', 'fri': 'fri'
    };
    return mapped[d] || d;
  };

  const matchesDay = (slot: MatchedSlot, day: string) => {
    const date = new Date(slot.day + 'T12:00:00');
    const dayAbbrev = date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    const normSlotDay = normalizeDay(dayAbbrev);
    const normColumnDay = normalizeDay(day.toLowerCase());
    const normLabelDay = normalizeDay(slot.dayLabel.toLowerCase().split(' ')[0]);
    return normSlotDay === normColumnDay || normLabelDay === normColumnDay;
  };

  if (!result || !result.visitResults || result.visitResults.length === 0) return null;

  const hasAnyStars = Object.keys(starredMap).length > 0;
  const totalCpRows = result.visitResults.reduce((s, v) => s + v.careProsRequired, 0);

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-lg overflow-hidden flex flex-col ${className}`}>
      <div className="bg-purple-50/50 dark:bg-purple-900/10 border-b px-4 pr-14 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg" aria-hidden="true">
            <Users className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-tight">Enquiry Results</h3>
              {result.postcode && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white dark:bg-gray-800 rounded-full border shadow-sm" role="note" aria-label={`Location: ${result.postcode}`}>
                  <MapPin className="w-3 h-3 text-purple-500" aria-hidden="true" />
                  <span className="text-[9px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider">{result.postcode}</span>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-purple-600 dark:text-purple-400 font-bold uppercase tracking-widest">{result.clientName || 'New Client'}</p>
              {enquiryTimeStart && enquiryTimeEnd && (
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{enquiryTimeStart}-{enquiryTimeEnd}</p>
              )}
            </div>
          </div>
        </div>

        {visitTabs && visitTabs.length > 0 && onVisitTabChange && (
          <div className="flex items-center gap-1.5 ml-1">
            {visitTabs.map((vt) => (
              <Button
                key={vt.index}
                variant={activeVisitTab === String(vt.index) ? "default" : "outline"}
                size="sm"
                onClick={() => onVisitTabChange(String(vt.index))}
                className={`gap-1.5 font-bold rounded-xl transition-all px-3 h-7 text-[11px] ${
                  activeVisitTab === String(vt.index)
                    ? "bg-purple-600 text-white shadow-md shadow-purple-500/20"
                    : "bg-white dark:bg-gray-800 border-gray-200 text-gray-600 hover:border-purple-300 hover:bg-purple-50"
                }`}
              >
                <span className={`w-4 h-4 rounded-md text-[9px] font-black flex items-center justify-center ${
                  activeVisitTab === String(vt.index) ? "bg-white/20 text-white" : "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                }`}>
                  {vt.index + 1}
                </span>
                {vt.label}
              </Button>
            ))}
          </div>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-2 flex-shrink-0">
          {onHistory && (
            <Button
              variant="outline"
              size="sm"
              onClick={onHistory}
              className="gap-1.5 font-semibold text-[11px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 hover:bg-gray-50 rounded-xl px-3 h-7 transition-all"
            >
              <History className="w-3.5 h-3.5" />
              History{historyCount ? ` (${historyCount})` : ''}
            </Button>
          )}
          {hasAnyStars && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const allVisits = (visitTabs ?? []).map(vt => ({
                    visitIndex: vt.index,
                    visitLabel: vt.label,
                    careProsRequired: vt.careProsRequired ?? result.visitResults[0]?.careProsRequired ?? 1,
                    selectedDays: vt.selectedDays,
                  }));
                  if (allVisits.length === 0) {
                    allVisits.push(...result.visitResults.map(vr => ({
                      visitIndex: vr.visitIndex,
                      visitLabel: vr.visitLabel || `Visit ${vr.visitIndex + 1}`,
                      careProsRequired: vr.careProsRequired,
                      selectedDays: undefined,
                    })));
                  }
                  exportSchedulePdf(
                    starredMap,
                    result.clientName,
                    result.postcode,
                    enquiryTimeStart,
                    enquiryTimeEnd,
                    allVisits,
                    requiredDays
                  );
                }}
                className="text-[10px] font-bold gap-1.5 h-7 px-3 border-emerald-400 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-600 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
              >
                <FileDown className="w-3 h-3" /> Export PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStarredMap({})}
                className="text-[10px] font-bold gap-1.5 h-7 px-3 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400"
              >
                <X className="w-3 h-3" /> Clear Selections
              </Button>
            </>
          )}
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('bd-matcher-back'));
            }}
            className="gap-2 font-bold rounded-xl border-gray-200 hover:border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all px-3 h-7 text-[10px]"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-x-auto overflow-y-auto min-h-0">
        <table className="w-full border-collapse" style={{ minWidth: '800px' }}>
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/80">
              {displayLabels.map(label => (
                <th key={label} className="py-3 px-2 text-center font-bold text-gray-900 dark:text-gray-100 border-b min-w-[200px] bg-gray-50 dark:bg-gray-900">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {result.visitResults.map((vr) => (
              <React.Fragment key={vr.visitIndex}>
                <tr className="bg-purple-50/30 dark:bg-purple-900/10">
                  <td colSpan={displayDays.length} className="py-2 px-3 border-b border-purple-100 dark:border-purple-800/30">
                    <div className="flex flex-wrap items-center gap-4 px-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-purple-600" />
                        <span className="text-xs font-black uppercase tracking-wider text-purple-900 dark:text-purple-100">Visit {vr.visitIndex + 1}</span>
                      </div>
                      <div className="h-4 w-px bg-purple-200/50" />
                      <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase">
                        <UserCheck className="w-3.5 h-3.5" />
                        CPs needed: {vr.careProsRequired}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase">
                        <Star className="w-3.5 h-3.5" />
                        Gender: {vr.genderPreferences.map((g, i) => `CP${i + 1}: ${g}`).join(', ')}
                      </div>
                      <div className="ml-auto flex items-center gap-2 text-[10px] font-bold text-purple-600 uppercase">
                        <Activity className="w-3.5 h-3.5" />
                        {vr.totalEmployeesEvaluated} analyzed
                      </div>
                    </div>
                  </td>
                </tr>
                {Array.from({ length: vr.careProsRequired }).map((_, cpIdx) => {
                  const genderPref = vr.genderPreferences[cpIdx] || 'any';

                  const cellHeight = `calc((100vh - 140px) / ${totalCpRows})`;
                  const isCp2Plus = cpIdx > 0;
                  return (
                    <tr key={`${vr.visitIndex}-${cpIdx}`} className="group hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors">
                      {displayDays.map(day => {
                        if (!vr.matches || vr.matches.length === 0) {
                          return (
                            <td key={day} className={`p-2 bg-gray-50/10 dark:bg-gray-900/5 ${isCp2Plus ? 'border-t-4 border-gray-800 dark:border-gray-200' : ''}`} style={{ height: cellHeight }}>
                              <div className="h-full min-h-[120px] flex items-center justify-center border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-xl">
                                <span className="text-gray-200 dark:text-gray-800 font-bold text-lg">-</span>
                              </div>
                            </td>
                          );
                        }

                        const takenByStarred: string[] = [];
                        for (let i = 0; i < vr.careProsRequired; i++) {
                          if (i === cpIdx) continue;
                          const otherStar = getStarred(vr.visitIndex, i, day);
                          if (otherStar) takenByStarred.push(otherStar.employeeName);
                        }

                        let anyOtherStar: { employeeName: string; timeWindow: string } | undefined;
                        for (let i = 0; i < vr.careProsRequired; i++) {
                          if (i === cpIdx) continue;
                          const otherStar = getStarred(vr.visitIndex, i, day);
                          if (otherStar) { anyOtherStar = otherStar; break; }
                        }

                        const currentStar = getStarred(vr.visitIndex, cpIdx, day);

                        let allVisibleMatches = vr.matches.filter(m => {
                          const isCorrectGender = genderPref === 'any' || m.gender?.toLowerCase() === genderPref.toLowerCase();
                          if (!isCorrectGender) return false;
                          if (!m.matchedSlots.some(s => matchesDay(s, day))) return false;
                          if (takenByStarred.includes(m.employeeName)) return false;
                          return true;
                        });

                        if (anyOtherStar) {
                          allVisibleMatches = allVisibleMatches.filter(m => {
                            const slot = m.matchedSlots.find(s => matchesDay(s, day));
                            return slot && slot.availableWindow === anyOtherStar!.timeWindow;
                          });
                        }

                        const sorted = [...allVisibleMatches].sort((a, b) => {
                          const aExact = a.matchedSlots.some(s => s.matchType === 'exact' && matchesDay(s, day));
                          const bExact = b.matchedSlots.some(s => s.matchType === 'exact' && matchesDay(s, day));
                          if (aExact && !bExact) return -1;
                          if (!aExact && bExact) return 1;
                          if (sortByTravel) {
                            const aTrav = a.travelMinutes ?? 9999;
                            const bTrav = b.travelMinutes ?? 9999;
                            if (aTrav !== bTrav) return aTrav - bTrav;
                          }
                          return b.matchScore - a.matchScore;
                        });

                        const matchesToShow = currentStar
                          ? sorted.filter(m => m.employeeName === currentStar.employeeName)
                          : sorted;

                        return (
                          <td key={day} className={`p-1.5 align-top min-w-[230px] ${isCp2Plus ? 'border-t-4 border-gray-800 dark:border-gray-200' : ''}`} style={{ height: cellHeight }}>
                            <div className="h-full overflow-y-auto pr-1 space-y-2"  style={{ maxHeight: cellHeight }}>
                              {matchesToShow.length > 0 ? (
                                matchesToShow.map((employeeMatch, matchIdx) => {
                                  const slotOnDay = employeeMatch.matchedSlots.find(s => matchesDay(s, day));
                                  if (!slotOnDay) return null;

                                  const isExact = slotOnDay.matchType === 'exact';
                                  const roundedDesired = roundContractedHours(employeeMatch.contractedWeeklyHours);
                                  const remainingHours = (roundedDesired - employeeMatch.totalScheduledHours).toFixed(1);

                                  const isStarred = currentStar?.employeeName === employeeMatch.employeeName;

                                  const genderColorClass = employeeMatch.gender?.toLowerCase() === 'female'
                                    ? 'border-pink-200 bg-pink-100/70 dark:bg-pink-900/40 dark:border-pink-800/50'
                                    : employeeMatch.gender?.toLowerCase() === 'male'
                                      ? 'border-blue-200 bg-blue-100/70 dark:bg-blue-900/40 dark:border-blue-800/50'
                                      : 'border-gray-200 bg-gray-50/50 dark:bg-gray-800/40 dark:border-gray-800';

                                  const nameColorClass = employeeMatch.gender?.toLowerCase() === 'female'
                                    ? 'text-pink-700 dark:text-pink-400'
                                    : employeeMatch.gender?.toLowerCase() === 'male'
                                      ? 'text-blue-700 dark:text-blue-400'
                                      : 'text-gray-900 dark:text-gray-100';

                                  return (
                                    <div
                                      key={`${employeeMatch.employeeName}-${matchIdx}`}
                                      className={`bg-gray-50 dark:bg-gray-800 border ${isStarred ? 'ring-2 ring-amber-400 dark:ring-amber-500' : matchIdx === 0 ? 'ring-1 ring-purple-100 dark:ring-purple-900/30' : ''} ${genderColorClass} rounded-xl p-2 shadow-sm hover:shadow-md transition-all space-y-1.5 relative`}
                                    >
                                      <div className="flex justify-between items-start gap-2">
                                        <div className="flex flex-col min-w-0 flex-1">
                                          <div className={`font-bold ${nameColorClass} text-[12px] tracking-tight truncate flex items-center gap-1.5`} title={employeeMatch.employeeName}>
                                            {employeeMatch.employeeName}
                                            <TransportModeIcon transportMode={employeeMatch.transportMode} />
                                            {slotOnDay.matchType === 'adjusted-time' && (
                                              <TooltipProvider>
                                                <ShadcnTooltip>
                                                  <TooltipTrigger asChild>
                                                    <Info className="w-3 h-3 text-orange-500 cursor-help flex-shrink-0" />
                                                  </TooltipTrigger>
                                                  <TooltipContent className="bg-gray-900 text-white border-gray-800 font-bold text-[10px] py-1.5">
                                                    <p>Needs Adjustment</p>
                                                  </TooltipContent>
                                                </ShadcnTooltip>
                                              </TooltipProvider>
                                            )}
                                            <TooltipProvider>
                                              <ShadcnTooltip>
                                                <TooltipTrigger asChild>
                                                  <span className="text-[10px] font-bold text-gray-600 dark:text-gray-400 ml-auto flex-shrink-0 cursor-help">
                                                    {employeeMatch.totalScheduledHours} / {roundedDesired}
                                                  </span>
                                                </TooltipTrigger>
                                                <TooltipContent className="bg-gray-900 text-white border-gray-800 font-bold text-[10px] py-1.5">
                                                  <p>Scheduled: {employeeMatch.totalScheduledHours}h</p>
                                                  <p>Desired: {roundedDesired}h</p>
                                                  <p>Remaining: {remainingHours}h</p>
                                                </TooltipContent>
                                              </ShadcnTooltip>
                                            </TooltipProvider>
                                          </div>
                                        </div>
                                        <TooltipProvider>
                                          <ShadcnTooltip>
                                            <TooltipTrigger asChild>
                                              <button
                                                onClick={() => toggleStar(vr.visitIndex, cpIdx, day, employeeMatch.employeeName, slotOnDay.availableWindow, employeeMatch.gender, employeeMatch.transportMode)}
                                                className={`flex-shrink-0 p-1 rounded-md transition-all hover:scale-110 ${isStarred ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-amber-400 dark:text-gray-600 dark:hover:text-amber-500'}`}
                                                aria-label={isStarred ? 'Unselect this care pro' : 'Select this care pro for double-up'}
                                              >
                                                <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400' : ''}`} />
                                              </button>
                                            </TooltipTrigger>
                                            <TooltipContent className="bg-gray-900 text-white border-gray-800 font-bold text-[10px] py-1.5">
                                              <p>{isStarred ? 'Click to deselect' : 'Select for double-up — filters other CPs to match this time'}</p>
                                            </TooltipContent>
                                          </ShadcnTooltip>
                                        </TooltipProvider>
                                      </div>
                                      <div className="flex items-center gap-2 flex-nowrap pt-1.5">
                                        {(slotOnDay.nextVisit || slotOnDay.travelMinutes !== undefined || employeeMatch.travelMinutes !== undefined) && (() => {
                                          const displayMins = slotOnDay.travelMinutes ?? employeeMatch.travelMinutes;
                                          const forwardMins = slotOnDay.forwardTravelMinutes;
                                          const nextVisit = slotOnDay.nextVisit;
                                          const departureSource = slotOnDay.departureSource;
                                          const departureSummary = slotOnDay.departureSummary;
                                          const isFromHome = !departureSource || departureSource === 'home';

                                          return (
                                            <div className="flex items-center gap-2.5 flex-nowrap">
                                              {isFromHome ? (
                                                <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                                                  <Home className="w-6 h-6 text-blue-500" />
                                                  <span className="text-[9px] font-bold text-blue-600 dark:text-blue-400">Home</span>
                                                </div>
                                              ) : (
                                                <div
                                                  className="flex flex-col items-center gap-1.5 flex-shrink-0"
                                                  title={departureSummary ? `Departing from: ${departureSummary}` : 'Departing from previous client'}
                                                >
                                                  <MapPin className="w-6 h-6 text-purple-500" />
                                                  <span className="text-[9px] font-bold text-purple-600 dark:text-purple-400">Prev</span>
                                                </div>
                                              )}

                                              <div className="flex flex-col items-center flex-shrink-0">
                                                <span className="text-[10px] font-black text-gray-800 dark:text-gray-100 mb-1.5">
                                                  {displayMins !== undefined ? `~${displayMins}m` : ''}
                                                </span>
                                                <ArrowRight className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                                              </div>

                                              <div
                                                className="flex flex-col items-center gap-1 flex-shrink-0 cursor-default"
                                                title={enquiryPostcode || ''}
                                              >
                                                <UserCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                                                <span className="text-[9px] font-black text-emerald-800 dark:text-emerald-300">Enquiry</span>
                                                <span className={`text-[9px] font-black leading-none px-2 py-0.5 rounded-md ${isExact ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'}`}>{slotOnDay.availableWindow}</span>
                                              </div>

                                              {nextVisit ? (
                                                <>
                                                  <div className="flex flex-col items-center flex-shrink-0">
                                                    <span className="text-[10px] font-black text-gray-800 dark:text-gray-100 mb-1.5">
                                                      {forwardMins !== undefined ? `~${forwardMins}m` : ''}
                                                    </span>
                                                    <ArrowRight className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                                                  </div>
                                                  {(() => {
                                                    const nextColor =
                                                      forwardMins !== undefined && forwardMins <= 20
                                                        ? 'text-emerald-600 dark:text-emerald-400'
                                                        : forwardMins !== undefined && forwardMins <= 35
                                                          ? 'text-amber-600 dark:text-amber-400'
                                                          : 'text-rose-600 dark:text-rose-400';
                                                    return (
                                                      <div
                                                        className="flex flex-col items-center gap-1.5 flex-shrink-0 cursor-default"
                                                        title={[`${nextVisit.startTime}–${nextVisit.endTime}`, nextVisit.postcode].filter(Boolean).join(' • ')}
                                                      >
                                                        <Clock className={`w-6 h-6 ${nextColor}`} />
                                                        <span className={`text-[9px] font-bold ${nextColor}`}>Next</span>
                                                      </div>
                                                    );
                                                  })()}
                                                </>
                                              ) : (
                                                <>
                                                  <div className="flex flex-col items-center flex-shrink-0">
                                                    <span className="text-[10px] font-black text-gray-800 dark:text-gray-100 mb-1.5">
                                                      {displayMins !== undefined ? `~${displayMins}m` : ''}
                                                    </span>
                                                    <ArrowRight className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                                                  </div>
                                                  <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                                                    <Home className="w-6 h-6 text-blue-500" />
                                                    <span className="text-[9px] font-bold text-blue-600 dark:text-blue-400">Home</span>
                                                  </div>
                                                </>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                      {slotOnDay.cancelledVisits && (
                                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-rose-600 dark:text-rose-400">
                                          <XCircle className="w-4 h-4 flex-shrink-0" />
                                          <span className="font-black">{slotOnDay.cancelledVisits}</span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="h-full min-h-[120px] flex flex-col items-center justify-center rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border-2 border-rose-200/60 dark:border-rose-800/40 p-4 text-center gap-1.5">
                                  <XCircle className="w-6 h-6 text-rose-400 dark:text-rose-500 opacity-80" />
                                  <span className="text-rose-700 dark:text-rose-400 font-black text-[11px] uppercase tracking-widest">
                                    No Availability
                                  </span>
                                  {anyOtherStar && (
                                    <span className="text-[9px] font-bold text-rose-500/80 dark:text-rose-500/60">
                                      Needs to be free at {anyOtherStar.timeWindow}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
