import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import {
  UserCheck, MapPin, Search, Loader2, RefreshCw,
  History, Trash2, Plus, X, XCircle, ArrowLeft, ArrowRight, Star, Clock,
} from "lucide-react";
import { VisitForm } from "./VisitForm";
import { MatchResultsGrid } from "./MatchResultsGrid";
import {
  createEmptyVisit,
  type VisitFormData,
  type MultiVisitResult,
  type HistoryViewResult,
  type SavedVisitResult,
} from "@/utils/bd-matrix-utils";
import type { ClientEnquiry } from "@shared/schema";

export function ClientEnquiryMatcher({ weekStartDate }: { weekStartDate?: string }) {
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState('');
  const [postcode, setPostcode] = useState('');
  const [visits, setVisits] = useState<VisitFormData[]>([createEmptyVisit()]);
  const [activeVisitTab, setActiveVisitTab] = useState('0');
  const [multiResults, setMultiResults] = useState<MultiVisitResult | null>(null);
  const [activeResultTab, setActiveResultTab] = useState('0');
  const [showHistory, setShowHistory] = useState(false);
  const [viewingHistoryResult, setViewingHistoryResult] = useState<HistoryViewResult | null>(null);
  const [sortByTravel, setSortByTravel] = useState(true);
  const [historyActiveTab, setHistoryActiveTab] = useState('0');
  const [historySortByTravel, setHistorySortByTravel] = useState(true);
  const { toast } = useToast();

  React.useEffect(() => {
    setHistoryActiveTab('0');
  }, [viewingHistoryResult]);

  React.useEffect(() => {
    const handleBack = () => setMultiResults(null);
    window.addEventListener('bd-matcher-back', handleBack);
    return () => window.removeEventListener('bd-matcher-back', handleBack);
  }, []);

  const historyQuery = useQuery<ClientEnquiry[]>({
    queryKey: ['/api/client-enquiries'],
    enabled: open,
  });

  const saveEnquiryMutation = useMutation({
    mutationFn: async (data: { criteria: { clientName: string; postcode?: string; visits?: unknown[] }; matchResult: MultiVisitResult; isSingleVisit: boolean }) => {
      const totalMatches = data.matchResult.visitResults
        ? data.matchResult.visitResults.reduce((sum: number, vr) => sum + (vr.matches?.length || 0), 0)
        : 0;
      const topMatch = data.matchResult.visitResults?.[0]?.matches?.[0]?.employeeName || null;

      type CriteriaVisit = { preferredTimeWindow?: { start: string; end: string }; genderPreferences?: string[]; requiredDays?: string[] };
      const firstVisit = data.criteria.visits?.[0] as CriteriaVisit | undefined;

      let durationMinutes = 60;
      if (firstVisit?.preferredTimeWindow?.start && firstVisit?.preferredTimeWindow?.end) {
        const start = firstVisit.preferredTimeWindow.start.split(':').map(Number);
        const end = firstVisit.preferredTimeWindow.end.split(':').map(Number);
        durationMinutes = (end[0] * 60 + end[1]) - (start[0] * 60 + start[1]);
      }

      const res = await apiRequest('POST', '/api/client-enquiries', {
        clientName: data.criteria.clientName,
        postcode: data.criteria.postcode || null,
        genderPreference: data.isSingleVisit ? (firstVisit?.genderPreferences?.[0] || 'any') : null,
        requiredDays: firstVisit?.requiredDays || [],
        preferredTimeWindow: firstVisit?.preferredTimeWindow || { start: '09:00', end: '17:00' },
        visitDurationMinutes: durationMinutes,
        matchCount: totalMatches,
        topMatch,
        results: data.matchResult,
        isMultiVisit: !data.isSingleVisit,
        visits: data.criteria.visits,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-enquiries'] });
    },
  });

  const deleteEnquiryMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/client-enquiries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-enquiries'] });
      toast({ title: "Enquiry Deleted", description: "The enquiry has been removed from history." });
    },
  });

  const matchMutation = useMutation({
    mutationFn: async () => {
      // Pre-flight: validate the postcode exists (fail-safe — network errors don't block the match)
      if (postcode.trim()) {
        try {
          const geoRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim().toUpperCase())}`, { signal: AbortSignal.timeout(5000) });
          if (geoRes.status === 404) {
            const geoData = await geoRes.json().catch(() => ({}));
            if (!geoData?.result) throw new Error('INVALID_POSTCODE');
          } else if (geoRes.ok) {
            const geoData = await geoRes.json().catch(() => null);
            if (geoData && geoData.status !== 200) throw new Error('INVALID_POSTCODE');
          }
          // If network error or other non-404 failure, proceed anyway
        } catch (e) {
          if ((e as Error).message === 'INVALID_POSTCODE') throw e;
          // Network/timeout errors: let the match proceed
        }
      }

      const activeVisits = visits.filter(v => v.selectedDays.length > 0);
      if (activeVisits.length === 1 && activeVisits[0].careProsRequired === 1) {
        const v = activeVisits[0];
        const res = await apiRequest('POST', '/api/bd-matcher', {
          clientName,
          postcode: postcode || undefined,
          genderPreference: v.genderPreferences[0] || 'any',
          requiredDays: v.selectedDays,
          preferredTimeWindow: { start: v.timeStart, end: v.timeEnd },
          weekStartDate: weekStartDate || undefined,
        });
        const singleResult = await res.json();
        return {
          clientName,
          postcode: postcode || undefined,
          visitResults: [{
            visitLabel: 'Visit 1',
            visitIndex: 0,
            careProsRequired: 1,
            genderPreferences: v.genderPreferences,
            matches: singleResult.matches,
            totalEmployeesEvaluated: singleResult.totalEmployeesEvaluated,
          }],
          totalVisits: 1,
        } as MultiVisitResult;
      }

      const visitPayloads = activeVisits.map((v, i) => ({
        visitLabel: `Visit ${i + 1}`,
        careProsRequired: v.careProsRequired,
        genderPreferences: v.genderPreferences,
        requiredDays: v.selectedDays,
        preferredTimeWindow: { start: v.timeStart, end: v.timeEnd },
      }));

      const res = await apiRequest('POST', '/api/bd-matcher/multi-visit', {
        clientName,
        postcode: postcode || undefined,
        visits: visitPayloads,
        weekStartDate: weekStartDate || undefined,
      });
      return await res.json() as MultiVisitResult;
    },
    onSuccess: (data: MultiVisitResult) => {
      setMultiResults(data);
      setActiveResultTab('0');
      const filledVisits = visits.filter(v => v.selectedDays.length > 0);
      const isSingle = filledVisits.length === 1 && filledVisits[0].careProsRequired === 1;
      saveEnquiryMutation.mutate({
        criteria: {
          clientName,
          postcode: postcode || undefined,
          visits: filledVisits.map((v, i) => ({
            visitLabel: `Visit ${i + 1}`,
            careProsRequired: v.careProsRequired,
            genderPreferences: v.genderPreferences,
            requiredDays: v.selectedDays,
            preferredTimeWindow: { start: v.timeStart, end: v.timeEnd },
          })),
        },
        matchResult: data,
        isSingleVisit: isSingle,
      });
      toast({ title: "Matches Found", description: `Found matches for ${clientName} across ${data.totalVisits} visits.` });
    },
    onError: (err: Error) => {
      const isPostcodeError = err.message === 'INVALID_POSTCODE' || err.message.includes('POSTCODE_NOT_FOUND');
      if (isPostcodeError) {
        const displayPostcode = postcode.trim().toUpperCase();
        toast({
          title: "Postcode Not Found",
          description: `"${displayPostcode}" could not be located. Please check the postcode and try again.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Matching Failed",
          description: "Could not find matches. Please make sure data has been uploaded and processed first.",
          variant: "destructive",
        });
      }
    },
  });

  const updateVisit = (index: number, visitData: VisitFormData) => {
    const newVisits = [...visits];
    newVisits[index] = visitData;
    setVisits(newVisits);
  };

  const addVisitTab = () => {
    if (visits.length >= 5) return;
    const newVisits = [...visits, createEmptyVisit()];
    setVisits(newVisits);
    setActiveVisitTab(String(newVisits.length - 1));
  };

  const removeVisitTab = (index: number) => {
    if (visits.length <= 1) return;
    const newVisits = visits.filter((_, i) => i !== index);
    setVisits(newVisits);
    const newActive = Math.min(parseInt(activeVisitTab), newVisits.length - 1);
    setActiveVisitTab(String(newActive));
  };

  const handleReset = () => {
    setClientName('');
    setPostcode('');
    setVisits([createEmptyVisit()]);
    setActiveVisitTab('0');
    setMultiResults(null);
    setActiveResultTab('0');
  };

  const activeVisits = visits.filter(v => v.selectedDays.length > 0);
  const canSubmit = clientName.trim() && postcode.trim() && activeVisits.length > 0 && activeVisits.every(v => v.timeStart && v.timeEnd);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setMultiResults(null); setShowHistory(false); setViewingHistoryResult(null); } }}>
        <DialogTrigger asChild>
          <Button className="bg-gradient-to-br from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-xl shadow-purple-500/20 font-black gap-3 h-auto rounded-2xl transition-all duration-300 hover:scale-[1.02] hover:-translate-y-0.5 pl-[24px] pr-[24px] pt-[8.5px] pb-[8.5px]">
            <div className="p-1.5 bg-white/20 rounded-xl backdrop-blur-sm">
              <UserCheck className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div className="text-sm font-black tracking-wide">Client Enquiry Matcher</div>
            </div>
          </Button>
        </DialogTrigger>
        <DialogContent className="w-screen h-screen max-w-none max-h-none overflow-hidden flex flex-col p-0 gap-0 border-none shadow-2xl rounded-none bg-white dark:bg-gray-950">
          {/* Header — full on form view, compact on results/history */}
          {!multiResults && !showHistory && !viewingHistoryResult ? (
            <div className="px-8 py-7 bg-gradient-to-r from-[#f5f7ff] to-[#fafbff] dark:from-gray-900/80 dark:to-gray-900 border-b border-gray-200/50 dark:border-gray-800/50 rounded-t-3xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-indigo-500/5 pointer-events-none" />
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-4">
                  <div className="p-3.5 bg-white dark:bg-gray-800/60 rounded-2xl shadow-sm border border-gray-100/50 dark:border-gray-700/50 backdrop-blur-sm">
                    <UserCheck className="w-6 h-6 text-[#5d51d5]" />
                  </div>
                  <div>
                    <DialogTitle className="tracking-tight text-gray-950 dark:text-gray-50 text-[28px] font-bold">
                      Client Enquiry Matcher
                    </DialogTitle>
                    <DialogDescription className="text-gray-500 dark:text-gray-400 text-[11px] font-semibold mt-1.5 uppercase tracking-[0.12em]">
                      Care Capacity Intelligence
                    </DialogDescription>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowHistory(true); setViewingHistoryResult(null); }}
                    className="gap-2 font-semibold text-[11px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/70 hover:border-gray-300 dark:hover:border-gray-600 rounded-xl px-4 py-2.5 h-auto transition-all duration-300 shadow-sm hover:shadow-md"
                  >
                    <History className="w-4 h-4" /> History {historyQuery.data?.length ? `(${historyQuery.data.length})` : ''}
                  </Button>
                </div>
              </div>
            </div>
          ) : multiResults || viewingHistoryResult ? (
            <>
              <DialogTitle className="sr-only">Enquiry Results</DialogTitle>
              <DialogDescription className="sr-only">Match results for client enquiry</DialogDescription>
            </>
          ) : (
            /* Compact history header */
            <div className="px-5 pr-14 py-3 border-b border-gray-200/50 dark:border-gray-800/50 bg-white dark:bg-gray-900 flex items-center gap-3">
              <DialogTitle className="sr-only">Search History</DialogTitle>
              <DialogDescription className="sr-only">Previously saved client enquiry searches</DialogDescription>
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <History className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              </div>
              <span className="font-bold text-sm text-gray-900 dark:text-gray-100">Search History</span>
              {historyQuery.data?.length ? (
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{historyQuery.data.length} records</span>
              ) : null}
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowHistory(false); setViewingHistoryResult(null); }}
                className="gap-2 font-semibold text-[11px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/70 rounded-xl px-4 h-8 transition-all"
              >
                <Search className="w-3.5 h-3.5" /> New Search
              </Button>
            </div>
          )}

          {/* Content Area */}
          <div className={`flex-1 min-h-0 bg-[#fbfbfe] dark:bg-gray-950 ${multiResults || viewingHistoryResult ? 'flex flex-col overflow-hidden' : 'overflow-y-auto p-8'}`}>
            {multiResults ? (
              <MatchResultsGrid
                result={{
                  ...multiResults,
                  visitResults: [multiResults.visitResults[parseInt(activeResultTab)]]
                }}
                requiredDays={visits[parseInt(activeResultTab)]?.selectedDays || []}
                className="flex-1 min-h-0 animate-in fade-in slide-in-from-bottom-4 duration-500"
                sortByTravel={sortByTravel}
                onToggleSortByTravel={() => setSortByTravel(v => !v)}
                enquiryPostcode={postcode}
                enquiryTimeStart={visits[parseInt(activeResultTab)]?.timeStart}
                enquiryTimeEnd={visits[parseInt(activeResultTab)]?.timeEnd}
                visitTabs={multiResults.visitResults.map((vr, i) => ({ index: i, label: `Visit ${i + 1}`, careProsRequired: vr.careProsRequired, selectedDays: visits[i]?.selectedDays }))}
                activeVisitTab={activeResultTab}
                onVisitTabChange={setActiveResultTab}
                historyCount={historyQuery.data?.length}
                onHistory={() => { setShowHistory(true); setMultiResults(null); setViewingHistoryResult(null); }}
                onBack={() => setMultiResults(null)}
              />
            ) : viewingHistoryResult ? (
              (() => {
                const histVRs: MultiVisitResult['visitResults'] = viewingHistoryResult.visitResults
                  ? (viewingHistoryResult.visitResults as MultiVisitResult['visitResults'])
                  : viewingHistoryResult.matches
                    ? [{
                        visitLabel: 'Visit 1',
                        visitIndex: 0,
                        careProsRequired: 1,
                        genderPreferences: [viewingHistoryResult.genderPreference || 'any'],
                        matches: viewingHistoryResult.matches,
                        totalEmployeesEvaluated: viewingHistoryResult.results?.totalEmployeesEvaluated || 0,
                      }]
                    : [];
                const histIdx = Math.min(parseInt(historyActiveTab), Math.max(histVRs.length - 1, 0));
                const histActiveVR = histVRs[histIdx];
                const histFullResult: MultiVisitResult = {
                  ...(viewingHistoryResult.results || {}),
                  clientName: viewingHistoryResult.clientName,
                  postcode: viewingHistoryResult.postcode || undefined,
                  totalVisits: histVRs.length,
                  visitResults: histActiveVR ? [histActiveVR] : [],
                };
                const reqDays =
                  viewingHistoryResult.criteria?.visits?.[histIdx]?.selectedDays ||
                  viewingHistoryResult.criteria?.visits?.[histIdx]?.requiredDays ||
                  viewingHistoryResult.visits?.[histIdx]?.requiredDays ||
                  viewingHistoryResult.visits?.[histIdx]?.selectedDays ||
                  viewingHistoryResult.requiredDays || [];
                const tStart = viewingHistoryResult.criteria?.visits?.[histIdx]?.preferredTimeWindow?.start;
                const tEnd = viewingHistoryResult.criteria?.visits?.[histIdx]?.preferredTimeWindow?.end;
                return (
                  <>
                    <div className="flex items-center gap-3 px-4 pr-14 py-2 border-b border-gray-200/50 dark:border-gray-800/50 bg-white dark:bg-gray-900 flex-shrink-0">
                      <Badge className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black text-[10px] px-3 py-1 uppercase tracking-widest rounded-xl shadow-md shadow-purple-500/20">Archived</Badge>
                      {viewingHistoryResult.createdAt && (
                        <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(viewingHistoryResult.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      <div className="flex-1" />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-2 font-bold rounded-xl border-blue-200 hover:border-blue-400 hover:bg-blue-50 transition-all text-xs"
                        onClick={() => {
                          setClientName(viewingHistoryResult.clientName);
                          setPostcode(viewingHistoryResult.postcode || "");
                          const visitsToLoad = viewingHistoryResult.criteria?.visits || viewingHistoryResult.visits;
                          if (visitsToLoad && Array.isArray(visitsToLoad)) {
                            setVisits(visitsToLoad as VisitFormData[]);
                            setActiveVisitTab("0");
                          }
                          setShowHistory(false);
                          setViewingHistoryResult(null);
                          toast({ title: "Search Populated", description: `Criteria for ${viewingHistoryResult.clientName} has been loaded.` });
                        }}
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-blue-600" /> Re-run Search
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setViewingHistoryResult(null)}
                        className="h-8 gap-2 font-bold rounded-xl border-gray-200 hover:border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all text-xs"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" /> Back
                      </Button>
                    </div>
                    {histActiveVR ? (
                      <MatchResultsGrid
                        result={histFullResult}
                        requiredDays={reqDays}
                        className="flex-1 min-h-0 animate-in fade-in slide-in-from-bottom-4 duration-500"
                        sortByTravel={historySortByTravel}
                        onToggleSortByTravel={() => setHistorySortByTravel(v => !v)}
                        enquiryPostcode={viewingHistoryResult.postcode ?? undefined}
                        enquiryTimeStart={tStart}
                        enquiryTimeEnd={tEnd}
                        visitTabs={histVRs.map((vr, i) => ({
                          index: i,
                          label: vr.visitLabel || `Visit ${i + 1}`,
                          careProsRequired: vr.careProsRequired,
                          selectedDays:
                            viewingHistoryResult.criteria?.visits?.[i]?.selectedDays ||
                            viewingHistoryResult.criteria?.visits?.[i]?.requiredDays ||
                            viewingHistoryResult.visits?.[i]?.selectedDays ||
                            viewingHistoryResult.visits?.[i]?.requiredDays,
                        }))}
                        activeVisitTab={String(histIdx)}
                        onVisitTabChange={setHistoryActiveTab}
                        historyCount={historyQuery.data?.length}
                        onHistory={() => setViewingHistoryResult(null)}
                      />
                    ) : (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="p-16 text-center">
                          <XCircle className="w-12 h-12 mx-auto mb-4 text-gray-200" />
                          <h4 className="font-bold text-gray-400">No Matches Were Found</h4>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()
            ) : showHistory ? (
              (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-[22px] font-black text-gray-950 dark:text-gray-50 tracking-tight leading-tight">Search Archives</h3>
                      <p className="text-[12px] text-gray-500 dark:text-gray-500 font-medium mt-0.5">Previously saved client enquiry searches</p>
                    </div>
                    <div className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl px-4 py-2 shadow-sm">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                      <span className="text-[12px] font-bold text-gray-700 dark:text-gray-300 tracking-wide">{historyQuery.data?.length || 0} <span className="text-gray-500 font-medium">records</span></span>
                    </div>
                  </div>

                  {historyQuery.isLoading ? (
                    <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm">
                      <Loader2 className="w-10 h-10 animate-spin text-purple-500 mb-4" />
                      <span className="text-[13px] font-semibold text-gray-500">Loading archives...</span>
                    </div>
                  ) : !historyQuery.data?.length ? (
                    <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-gray-900 rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
                      <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-2xl mb-4">
                        <History className="w-8 h-8 text-gray-400" />
                      </div>
                      <h4 className="text-[15px] font-bold text-gray-700 dark:text-gray-300 mb-1">No Enquiries Yet</h4>
                      <p className="text-[13px] text-gray-400 dark:text-gray-600">Searches will be saved here automatically.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      {historyQuery.data.map((enquiry) => {
                        const results = enquiry.results as { visitResults?: SavedVisitResult[]; totalVisits?: number } | null;
                        const isMultiVisit = results?.visitResults && results.visitResults.length > 0;
                        const visitCount = isMultiVisit ? results.totalVisits : 1;
                        return (
                          <div
                            key={enquiry.id}
                            className="group relative bg-gradient-to-br from-white to-gray-50 dark:from-gray-900/90 dark:to-gray-950 border border-gray-200 dark:border-gray-800/80 hover:border-purple-400/50 dark:hover:border-purple-600/40 rounded-3xl p-6 transition-all duration-300 cursor-pointer shadow-lg hover:shadow-2xl hover:shadow-purple-500/20 hover:-translate-y-2 overflow-hidden"
                            onClick={() => {
                              const resultData = enquiry.results;
                              if (resultData) {
                                setViewingHistoryResult({ ...resultData, createdAt: enquiry.createdAt, clientName: enquiry.clientName, postcode: enquiry.postcode, requiredDays: enquiry.requiredDays as string[], genderPreference: enquiry.genderPreference } as HistoryViewResult);
                              }
                            }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-br from-purple-600/0 via-purple-500/0 to-indigo-600/0 group-hover:from-purple-500/5 group-hover:via-purple-400/3 group-hover:to-indigo-500/5 transition-all duration-500" />
                            <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-purple-400/15 to-indigo-400/10 rounded-full -mr-20 -mt-20 group-hover:scale-[1.5] transition-transform duration-700" />
                            <div className="relative z-10">
                              <div className="flex items-start justify-between mb-5">
                                <div className="space-y-2 flex-1 pr-4">
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <h4 className="font-black text-[17px] text-gray-950 dark:text-gray-50 tracking-tight leading-tight">{enquiry.clientName}</h4>
                                    {!!enquiry.preferredTimeWindow && (() => {
                                      const tw = enquiry.preferredTimeWindow as { start: string; end: string };
                                      return (
                                        <span className="text-[12px] font-bold text-gray-600 dark:text-gray-400 px-2.5 py-1 bg-gray-100 dark:bg-gray-800/60 rounded-lg">
                                          {tw.start}–{tw.end}
                                        </span>
                                      );
                                    })()}
                                    {isMultiVisit && (
                                      <Badge className="bg-gradient-to-r from-purple-500/20 to-indigo-500/15 text-purple-700 dark:from-purple-600/30 dark:to-indigo-600/25 dark:text-purple-300 border border-purple-300/30 dark:border-purple-500/30 font-bold text-[10px] px-3 h-6 leading-none rounded-full">
                                        {visitCount} Visits
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2.5 text-[13px] font-medium text-gray-600 dark:text-gray-400 mt-1.5">
                                    <span className="flex items-center gap-1.5 flex-shrink-0">
                                      <MapPin className="w-4 h-4 flex-shrink-0 text-purple-500/70" />
                                      <span className="font-semibold">{enquiry.postcode || 'No postcode'}</span>
                                    </span>
                                    <span className="w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-600" />
                                    <span className="text-gray-500 dark:text-gray-500">{new Date(enquiry.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-lg flex-shrink-0 text-gray-400 hover:text-red-600 hover:bg-red-100/50 dark:hover:text-red-400 dark:hover:bg-red-950/30 opacity-0 group-hover:opacity-100 transition-all"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteEnquiryMutation.mutate(enquiry.id);
                                  }}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                              <div className="flex items-center justify-between pt-5 border-t border-gray-200/60 dark:border-gray-800/40">
                                <div className="flex items-center gap-2.5 text-purple-600 dark:text-purple-400 font-black text-[14px]">
                                  <div className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-100/60 dark:bg-purple-900/40">
                                    <UserCheck className="w-3 h-3" />
                                  </div>
                                  {enquiry.matchCount || 0} <span className="text-gray-500 dark:text-gray-500 font-medium">matches</span>
                                </div>
                                <div className="h-8 w-8 rounded-full bg-purple-100/40 dark:bg-purple-900/20 flex items-center justify-center group-hover:bg-purple-200/50 dark:group-hover:bg-purple-800/30 transition-all duration-300 border border-purple-200/30 dark:border-purple-700/20">
                                  <ArrowRight className="w-4 h-4 text-purple-500/70 dark:text-purple-400/70 group-hover:text-purple-700 dark:group-hover:text-purple-300 group-hover:translate-x-0.5 transition-all duration-300" />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="space-y-8">
                {/* Client Details */}
                <div className="space-y-4">
                  <h3 className="text-[12px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-[0.12em]">Client Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 grid grid-cols-2 gap-5">
                      <div className="space-y-2.5">
                        <Label htmlFor="clientName" className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-700 dark:text-gray-300">Client Name *</Label>
                        <div className="relative group">
                          <UserCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-purple-600 transition-colors duration-300" />
                          <Input
                            id="clientName"
                            placeholder="e.g. Mrs Smith"
                            value={clientName}
                            onChange={(e) => setClientName(e.target.value)}
                            className="pl-12 h-13 text-base font-medium bg-white dark:bg-gray-900/60 border border-gray-300 dark:border-gray-700/80 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 dark:focus:border-purple-500 rounded-2xl transition-all duration-300 shadow-sm hover:shadow-md hover:border-gray-400 dark:hover:border-gray-600 dark:placeholder:text-gray-600 placeholder:text-gray-400"
                          />
                        </div>
                      </div>
                      <div className="space-y-2.5">
                        <Label htmlFor="postcode" className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-700 dark:text-gray-300">Postcode <span className="text-red-500">*</span></Label>
                        <div className="relative group">
                          <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-purple-600 transition-colors duration-300" />
                          <Input
                            id="postcode"
                            placeholder="e.g. SW1A 1AA"
                            value={postcode}
                            onChange={(e) => setPostcode(e.target.value)}
                            className="pl-12 h-13 text-base font-medium bg-white dark:bg-gray-900/60 border border-gray-300 dark:border-gray-700/80 focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500 dark:focus:border-purple-500 rounded-2xl transition-all duration-300 shadow-sm hover:shadow-md hover:border-gray-400 dark:hover:border-gray-600 dark:placeholder:text-gray-600 placeholder:text-gray-400"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="bg-white dark:bg-gray-900/60 p-5 rounded-2xl border border-indigo-100 dark:border-indigo-800/30 shadow-sm flex flex-col justify-center relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-indigo-500 to-purple-600 rounded-l-2xl" />
                      <div className="pl-4">
                        <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 mb-2">
                          <Search className="w-4 h-4 flex-shrink-0" />
                          <h4 className="text-[12px] font-bold uppercase tracking-[0.1em]">Multi-Visit Support</h4>
                        </div>
                        <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
                          Configure up to 5 visits with different time windows and gender preferences per visit.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Visit Schedule */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-[13px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-[0.1em] mb-0.5">Visit Schedule</h3>
                    </div>
                    {visits.length < 5 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addVisitTab}
                        className="h-9 gap-2 text-[11px] font-semibold border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 hover:border-purple-400 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-xl transition-all duration-300 tracking-[0.08em] uppercase shadow-sm hover:shadow-md"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Visit
                      </Button>
                    )}
                  </div>

                  <div className="bg-white/90 dark:bg-gray-900/70 backdrop-blur-sm rounded-2xl border border-gray-200/70 dark:border-gray-800/50 shadow-lg shadow-purple-500/5 overflow-hidden">
                    <Tabs value={activeVisitTab} onValueChange={setActiveVisitTab}>
                      <div className="px-5 pt-4 border-b border-gray-100/60 dark:border-gray-800/60 bg-gray-50/30 dark:bg-gray-900/30">
                        <TabsList className="bg-transparent p-0 h-auto flex-wrap gap-2 pb-px">
                          {visits.map((v, i) => (
                            <div key={i} className="flex items-center group relative">
                              <TabsTrigger
                                value={String(i)}
                                className="px-5 py-2.5 text-xs font-black uppercase tracking-widest data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:text-purple-700 data-[state=active]:shadow-md data-[state=active]:shadow-purple-500/10 rounded-t-xl border-x border-t border-transparent data-[state=active]:border-gray-200/60 dark:data-[state=active]:border-gray-700 transition-all duration-300"
                              >
                                <span className="inline-flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-black flex items-center justify-center">{i + 1}</span>
                                  Visit {i + 1}
                                </span>
                                {v.selectedDays.length > 0 && (
                                  <div className="ml-2 w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                                )}
                              </TabsTrigger>
                              {visits.length > 1 && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); removeVisitTab(i); }}
                                  className="absolute -top-1 -right-1 p-0.5 bg-white dark:bg-gray-800 rounded-full border shadow-sm text-gray-400 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 z-10"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          ))}
                        </TabsList>
                      </div>
                      <div className="p-6">
                        {visits.map((v, i) => (
                          <TabsContent key={i} value={String(i)} className="mt-0">
                            <VisitForm
                              visit={v}
                              onChange={(updated) => updateVisit(i, updated)}
                            />
                          </TabsContent>
                        ))}
                      </div>
                    </Tabs>
                  </div>
                </div>

                {/* Action Bar */}
                <div className="flex justify-between items-center pt-7 border-t border-gray-200 dark:border-gray-800/70">
                  <Button
                    variant="ghost"
                    onClick={handleReset}
                    className="text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 font-semibold text-[12px] uppercase tracking-[0.08em] gap-2 transition-all duration-300 rounded-xl px-4 h-9"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reset
                  </Button>
                  <div className="flex items-center gap-5">
                    {activeVisits.length > 0 && (
                      <div className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-gray-400 font-medium">
                        <span className="inline-block w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
                        <span>{activeVisits.length} visit{activeVisits.length !== 1 ? 's' : ''} ready</span>
                      </div>
                    )}
                    <Button
                      onClick={() => matchMutation.mutate()}
                      disabled={!canSubmit || matchMutation.isPending}
                      className="h-12 px-10 bg-gradient-to-r from-[#5d51d5] to-[#4338ca] hover:from-[#4f46e5] hover:to-[#3730a3] text-white font-bold text-[13px] tracking-[0.06em] shadow-xl shadow-indigo-500/30 gap-3 rounded-2xl transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                    >
                      {matchMutation.isPending ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Searching...</>
                      ) : (
                        <><Search className="w-4 h-4" /> Find Best Matches</>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
