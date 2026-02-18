import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  Users, 
  Clock, 
  MapPin, 
  Search, 
  Loader2, 
  X, 
  History, 
  ArrowRight, 
  UserCheck, 
  XCircle,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Car,
  Footprints,
  Activity,
  BarChart3,
  User,
  Info,
  BarChart
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

// --- Types ---

interface MatchedSlot {
  day: string;
  dayLabel: string;
  availableWindow: string;
  matchType: 'exact' | 'adjusted-time' | 'alternative-day';
}

interface MatchedEmployee {
  employeeName: string;
  matchType: 'exact' | 'adjusted-time' | 'alternative-day';
  matchScore: number;
  gender?: string;
  transportMode?: string;
  contractedWeeklyHours: number;
  totalScheduledHours: number;
  remainingCapacity: number;
  matchedSlots: MatchedSlot[];
}

interface VisitMatchResult {
  visitLabel: string;
  visitIndex: number;
  careProsRequired: number;
  genderPreferences: string[];
  matches: MatchedEmployee[];
  totalEmployeesEvaluated: number;
}

interface MultiVisitResult {
  clientName: string;
  postcode?: string;
  visitResults: VisitMatchResult[];
  totalVisits: number;
}

interface VisitFormData {
  careProsRequired: number;
  genderPreferences: ('male' | 'female' | 'any')[];
  selectedDays: string[];
  timeStart: string;
  timeEnd: string;
}

function TransportModeIcon({ transportMode }: { transportMode?: string }) {
  if (transportMode === 'car') return <Car className="w-3.5 h-3.5" />;
  if (transportMode === 'walker') return <Footprints className="w-3.5 h-3.5" />;
  return <Users className="w-3.5 h-3.5" />;
}

// --- Components ---

function MatchResultsGrid({ result, requiredDays = [] }: { result: MultiVisitResult; requiredDays?: string[] }) {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'];

  const visibleDays = days.filter(d => requiredDays.includes(d));
  const visibleDayLabels = dayLabels.filter((_, i) => requiredDays.includes(days[i]));

  const displayDays = visibleDays.length > 0 ? visibleDays : days;
  const displayLabels = visibleDayLabels.length > 0 ? visibleDayLabels : dayLabels;

  if (!result || !result.visitResults || result.visitResults.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-lg overflow-hidden flex flex-col">
      <div className="overflow-x-auto custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full border-collapse" style={{ minWidth: '800px' }}>
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900/80">
              <th className="p-4 text-left font-bold text-gray-900 dark:text-gray-100 border-b border-r w-[240px] sticky left-0 z-20 bg-gray-50 dark:bg-gray-900 shadow-[4px_0_10px_rgba(0,0,0,0.08)]">
                Requirement
              </th>
              {displayLabels.map(label => (
                <th key={label} className="p-4 text-center font-bold text-gray-900 dark:text-gray-100 border-b min-w-[200px] bg-gray-50 dark:bg-gray-900">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {result.visitResults.map((vr) => (
              <React.Fragment key={vr.visitIndex}>
                {Array.from({ length: vr.careProsRequired }).map((_, cpIdx) => {
                  const genderPref = vr.genderPreferences[cpIdx] || 'any';
                  const genderLabel = genderPref === 'any' ? 'Any' : genderPref.charAt(0).toUpperCase() + genderPref.slice(1);
                  
                  return (
                    <tr key={`${vr.visitIndex}-${cpIdx}`} className="group hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors">
                      <td className="p-4 align-top border-r sticky left-0 z-10 bg-white dark:bg-gray-950 shadow-[4px_0_10px_rgba(0,0,0,0.08)]">
                        <div className="space-y-4">
                          <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[11px] font-bold uppercase tracking-wider border border-purple-200 dark:border-purple-800/50">
                            CP{cpIdx + 1}: {genderLabel} Only
                          </div>
                          <div className="space-y-2.5 text-[10px] text-gray-400 dark:text-gray-500 font-semibold tracking-tight">
                            <div className="flex items-center gap-2"><Users className="w-3.5 h-3.5 opacity-70" /> NAME</div>
                            <div className="flex items-center gap-2"><Clock className="w-3.5 h-3.5 opacity-70" /> SUGGESTED TIME</div>
                            <div className="flex items-center gap-2"><Car className="w-3.5 h-3.5 opacity-70" /> DRIVER / WALKER</div>
                            <div className="flex items-center gap-2"><BarChart3 className="w-3.5 h-3.5 opacity-70" /> WEEKLY LOAD (REM)</div>
                          </div>
                        </div>
                      </td>
                      {displayDays.map(day => {
                        const employeeMatch = vr.matches[cpIdx]; 
                        const slotOnDay = employeeMatch?.matchedSlots.find(s => {
                          const dateStr = s.day;
                          const date = new Date(dateStr + 'T12:00:00');
                          const dayAbbrev = date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
                          return dayAbbrev === day;
                        });

                        if (!employeeMatch || !slotOnDay) {
                          return (
                            <td key={day} className="p-4 bg-gray-50/10 dark:bg-gray-900/5">
                              <div className="h-full min-h-[120px] flex items-center justify-center border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-xl">
                                <span className="text-gray-200 dark:text-gray-800 font-bold text-lg">-</span>
                              </div>
                            </td>
                          );
                        }

                        const isExact = slotOnDay.matchType === 'exact';
                        const remainingHours = (employeeMatch.contractedWeeklyHours - employeeMatch.totalScheduledHours).toFixed(1);
                        
                        return (
                          <td key={day} className="p-3 align-top">
                            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 shadow-sm group-hover:shadow-md transition-all space-y-3 ring-1 ring-black/5 dark:ring-white/5">
                              <div className="font-bold text-gray-900 dark:text-gray-100 text-[13px] tracking-tight truncate" title={employeeMatch.employeeName}>
                                {employeeMatch.employeeName}
                              </div>
                              <div className={`inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold border ${isExact ? 'bg-green-50 text-green-700 border-green-100 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800/50' : 'bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800/50'}`}>
                                {slotOnDay.availableWindow}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-gray-600 dark:text-gray-400 font-medium">
                                <TransportModeIcon transportMode={employeeMatch.transportMode} />
                                <span className="capitalize">{employeeMatch.transportMode || 'N/A'}</span>
                              </div>
                              <div className="text-[10px] font-bold text-gray-700 dark:text-gray-300 border-t border-gray-100 dark:border-gray-800 pt-3 mt-1 flex justify-between items-center">
                                <span>{employeeMatch.totalScheduledHours} / {employeeMatch.contractedWeeklyHours}h</span>
                                <span className="text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-1.5 py-0.5 rounded-sm">
                                  {remainingHours} rem
                                </span>
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr className="h-4 bg-gray-200/40 dark:bg-gray-800/50">
                  <td colSpan={displayDays.length + 1} className="border p-1 text-[9px] font-bold text-gray-400 uppercase tracking-wider text-center">
                    Next Visit Block
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-gray-100/50 dark:bg-gray-900/80 border-t p-4 text-center">
        <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-white dark:bg-gray-800 border shadow-sm ring-1 ring-black/5">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
          <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-[0.2em]">Next Visit Block</span>
        </div>
      </div>
    </div>
  );
}

function ClientEnquiryMatcher() {
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState('');
  const [postcode, setPostcode] = useState('');
  const [visits, setVisits] = useState<VisitFormData[]>([createEmptyVisit()]);
  const [activeVisitTab, setActiveVisitTab] = useState('0');
  const [multiResults, setMultiResults] = useState<MultiVisitResult | null>(null);
  const [activeResultTab, setActiveResultTab] = useState('0');
  const [showHistory, setShowHistory] = useState(false);
  const [viewingHistoryResult, setViewingHistoryResult] = useState<any | null>(null);
  const { toast } = useToast();

  const historyQuery = useQuery<any[]>({
    queryKey: ['/api/client-enquiries'],
    enabled: open,
  });

  const saveEnquiryMutation = useMutation({
    mutationFn: async (data: { criteria: any; matchResult: any; isSingleVisit: boolean }) => {
      const totalMatches = data.matchResult.visitResults
        ? data.matchResult.visitResults.reduce((sum: number, vr: any) => sum + (vr.matches?.length || 0), 0)
        : data.matchResult.matches?.length || 0;
      const topMatch = data.matchResult.visitResults
        ? data.matchResult.visitResults[0]?.matches?.[0]?.employeeName || null
        : data.matchResult.matches?.[0]?.employeeName || null;

      const firstVisit = data.criteria.visits?.[0];
      
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
      const activeVisits = visits.filter(v => v.selectedDays.length > 0);
      if (activeVisits.length === 1 && activeVisits[0].careProsRequired === 1) {
        const v = activeVisits[0];
        const res = await apiRequest('POST', '/api/bd-matcher', {
          clientName,
          postcode: postcode || undefined,
          genderPreference: v.genderPreferences[0] || 'any',
          requiredDays: v.selectedDays,
          preferredTimeWindow: { start: v.timeStart, end: v.timeEnd },
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
    onError: () => {
      toast({
        title: "Matching Failed",
        description: "Could not find matches. Please make sure data has been uploaded and processed first.",
        variant: "destructive",
      });
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

  return (
    <Card className="shadow-lg border-purple-100 dark:border-purple-900/30 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/10 dark:to-blue-900/10 border-b pb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-600 rounded-xl text-white shadow-lg shadow-purple-200 dark:shadow-none">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                Client Enquiry Matcher
              </CardTitle>
              <CardDescription className="text-gray-500 dark:text-gray-400 mt-1">
                Intelligent multi-visit matching for complex client requirements
              </CardDescription>
            </div>
          </div>
          <Button 
            variant="outline" 
            className="rounded-xl gap-2 hover:bg-purple-50 dark:hover:bg-purple-900/20"
            onClick={() => setShowHistory(true)}
          >
            <History className="w-4 h-4 text-purple-600" />
            Enquiry History
            {historyQuery.data?.length ? (
              <Badge variant="secondary" className="ml-1 bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 border-none px-1.5 h-5">
                {historyQuery.data.length}
              </Badge>
            ) : null}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                Client Name <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input 
                  placeholder="Enter client name" 
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="pl-10 h-11 rounded-xl border-gray-200 focus:ring-purple-500"
                />
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                Postcode <span className="text-gray-400 font-normal">(Optional)</span>
              </Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input 
                  placeholder="e.g. SW1A 1AA" 
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  className="pl-10 h-11 rounded-xl border-gray-200 focus:ring-purple-500 uppercase"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-600" />
              Visit Requirements
            </h3>
            <Button 
              type="button" 
              variant="outline" 
              size="sm" 
              onClick={addVisitTab}
              disabled={visits.length >= 5}
              className="rounded-full gap-1.5 h-8 border-purple-200 hover:bg-purple-50 dark:border-purple-800 dark:hover:bg-purple-900/20 text-purple-700 dark:text-purple-300"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Visit
            </Button>
          </div>

          <Tabs value={activeVisitTab} onValueChange={setActiveVisitTab} className="w-full">
            <TabsList className="bg-gray-100/50 dark:bg-gray-800/50 p-1.5 h-auto flex-wrap gap-1.5 rounded-xl border border-gray-200 dark:border-gray-700">
              {visits.map((_, idx) => (
                <TabsTrigger 
                  key={idx} 
                  value={String(idx)} 
                  className="rounded-lg px-4 py-2 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-300 transition-all"
                >
                  Visit {idx + 1}
                  {visits.length > 1 && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeVisitTab(idx); }}
                      className="ml-2 hover:text-red-500 transition-colors opacity-50 hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            {visits.map((visit, idx) => (
              <TabsContent key={idx} value={String(idx)} className="mt-6 animate-in fade-in duration-300">
                <VisitForm 
                  visit={visit} 
                  onChange={(data) => updateVisit(idx, data)} 
                />
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <div className="mt-10 flex flex-col items-center gap-4">
          <Button 
            onClick={() => matchMutation.mutate()} 
            disabled={!clientName || matchMutation.isPending || visits.every(v => v.selectedDays.length === 0)}
            className="w-full max-w-md h-14 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-xl shadow-purple-200 dark:shadow-none text-lg font-bold transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:scale-100 gap-3"
          >
            {matchMutation.isPending ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                Matching Intelligence Running...
              </>
            ) : (
              <>
                <Search className="w-6 h-6" />
                Find Optimal Matches
              </>
            )}
          </Button>
          {!clientName && (
            <p className="text-xs text-red-500 font-medium animate-bounce flex items-center gap-1">
              <Info className="w-3 h-3" /> Please enter client name to start matching
            </p>
          )}
        </div>

        {multiResults && (
          <div className="mt-12 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="flex items-end justify-between border-b border-purple-100 dark:border-purple-900/30 pb-6">
              <div>
                <h3 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-blue-600">
                  Matching Results
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-green-500" />
                  Successfully analyzed {multiResults.visitResults.reduce((acc, vr) => acc + vr.totalEmployeesEvaluated, 0)} potential matches across {multiResults.totalVisits} visits.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={handleReset} className="rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50">
                <Trash2 className="w-4 h-4 mr-2" />
                Clear All Results
              </Button>
            </div>

            <Tabs value={activeResultTab} onValueChange={setActiveResultTab} className="w-full">
              <TabsList className="bg-gray-100/50 dark:bg-gray-800/50 p-1.5 h-auto flex-wrap gap-2 rounded-xl mb-6">
                {multiResults.visitResults.map((vr, idx) => (
                  <TabsTrigger 
                    key={idx} 
                    value={String(idx)}
                    className="px-6 py-2.5 rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-md data-[state=active]:text-purple-700 transition-all font-bold"
                  >
                    Visit {idx + 1}
                    <Badge variant="secondary" className="ml-2.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-none px-2 h-5 font-bold">
                      {vr.matches.length}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
              
              {multiResults.visitResults.map((vr, idx) => (
                <TabsContent key={idx} value={String(idx)} className="animate-in fade-in zoom-in-95 duration-500">
                  <div className="flex items-center gap-6 mb-6 px-2 text-[13px] font-bold text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 px-3 py-1.5 rounded-lg border">
                      <Users className="w-4 h-4 text-purple-500" />
                      CPs: {vr.careProsRequired}
                    </span>
                    <span className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 px-3 py-1.5 rounded-lg border capitalize">
                      <Users className="w-4 h-4 text-blue-500" />
                      Gender: {vr.genderPreferences.join(', ')}
                    </span>
                  </div>
                  
                  <MatchResultsGrid 
                    result={{
                      ...multiResults!,
                      visitResults: [vr]
                    }} 
                    requiredDays={visits[idx]?.selectedDays || []}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
      </CardContent>

      {/* History Slide-out Drawer (Using Dialog logic but visually a sheet) */}
      {showHistory && (
        <HistorySheet 
          open={showHistory} 
          onOpenChange={setShowHistory} 
          onView={(enquiry) => {
            setViewingHistoryResult(enquiry);
          }}
        />
      )}
    </Card>
  );
}

function createEmptyVisit(): VisitFormData {
  return {
    careProsRequired: 1,
    genderPreferences: ['any'],
    selectedDays: [],
    timeStart: '09:00',
    timeEnd: '17:00'
  };
}

function VisitForm({ visit, onChange }: { visit: VisitFormData, onChange: (data: VisitFormData) => void }) {
  const dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayValues = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  const toggleDay = (day: string) => {
    const newDays = visit.selectedDays.includes(day)
      ? visit.selectedDays.filter(d => d !== day)
      : [...visit.selectedDays, day];
    onChange({ ...visit, selectedDays: newDays });
  };

  const updateGender = (index: number, gender: 'male' | 'female' | 'any') => {
    const newGenders = [...visit.genderPreferences];
    newGenders[index] = gender;
    onChange({ ...visit, genderPreferences: newGenders });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 bg-gray-50/30 dark:bg-gray-900/10 p-6 rounded-2xl border border-dashed border-purple-100 dark:border-purple-900/30">
      <div className="lg:col-span-4 space-y-6">
        <div className="space-y-3">
          <Label className="text-sm font-bold text-gray-700 dark:text-gray-300">Staffing Required</Label>
          <Select 
            value={String(visit.careProsRequired)} 
            onValueChange={(val) => {
              const num = parseInt(val);
              const newGenders = Array(num).fill('any');
              onChange({ ...visit, careProsRequired: num, genderPreferences: newGenders });
            }}
          >
            <SelectTrigger className="h-11 rounded-xl bg-white border-gray-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="1">1 Care Professional</SelectItem>
              <SelectItem value="2">2 Care Professionals</SelectItem>
              <SelectItem value="3">3 Care Professionals</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4">
          <Label className="text-sm font-bold text-gray-700 dark:text-gray-300">Gender Preferences</Label>
          <div className="space-y-3">
            {Array.from({ length: visit.careProsRequired }).map((_, i) => (
              <div key={i} className="flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-100 shadow-sm">
                <span className="text-xs font-bold text-purple-600">CP{i+1}</span>
                <div className="flex gap-1.5">
                  {(['male', 'female', 'any'] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => updateGender(i, g)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                        visit.genderPreferences[i] === g 
                          ? 'bg-purple-600 text-white border-purple-600 shadow-sm' 
                          : 'bg-white text-gray-400 border-gray-100 hover:border-purple-200'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lg:col-span-8 space-y-6">
        <div className="space-y-3">
          <Label className="text-sm font-bold text-gray-700 dark:text-gray-300">Preferred Days <span className="text-red-500">*</span></Label>
          <div className="flex flex-wrap gap-2">
            {dayLabels.map((day, i) => {
              const val = dayValues[i];
              const isSelected = visit.selectedDays.includes(val);
              return (
                <button
                  key={val}
                  onClick={() => toggleDay(val)}
                  className={`flex-1 min-w-[100px] h-12 rounded-xl text-xs font-bold transition-all border ${
                    isSelected 
                      ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white border-transparent shadow-md' 
                      : 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:border-purple-300'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 pt-2">
          <div className="space-y-3">
            <Label className="text-sm font-bold text-gray-700 dark:text-gray-300">Window Start</Label>
            <Input 
              type="time" 
              value={visit.timeStart}
              onChange={(e) => onChange({ ...visit, timeStart: e.target.value })}
              className="h-11 rounded-xl bg-white border-gray-200 focus:ring-purple-500"
            />
          </div>
          <div className="space-y-3">
            <Label className="text-sm font-bold text-gray-700 dark:text-gray-300">Window End</Label>
            <Input 
              type="time" 
              value={visit.timeEnd}
              onChange={(e) => onChange({ ...visit, timeEnd: e.target.value })}
              className="h-11 rounded-xl bg-white border-gray-200 focus:ring-purple-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function HistorySheet({ open, onOpenChange, onView }: { open: boolean, onOpenChange: (open: boolean) => void, onView: (enquiry: any) => void }) {
  const historyQuery = useQuery<any[]>({
    queryKey: ['/api/client-enquiries'],
    enabled: open,
  });

  const [viewingHistoryResult, setViewingHistoryResult] = useState<any | null>(null);
  const deleteEnquiryMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/client-enquiries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/client-enquiries'] });
    },
  });

  return (
    <div className={`fixed inset-0 z-50 transition-opacity ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className={`absolute right-0 top-0 bottom-0 w-full max-w-4xl bg-white dark:bg-gray-950 shadow-2xl transition-transform duration-500 ease-out transform ${open ? 'translate-x-0' : 'translate-x-full'} overflow-y-auto custom-scrollbar`}>
        <div className="p-8">
          <div className="flex items-center justify-between mb-8 border-b pb-6">
            <div className="flex items-center gap-3">
              <History className="w-6 h-6 text-purple-600" />
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Enquiry History</h2>
            </div>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="rounded-full">
              <X className="w-6 h-6" />
            </Button>
          </div>

          {viewingHistoryResult ? (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
              <div className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/10 p-6 rounded-2xl border border-purple-100 dark:border-purple-900/30">
                <div>
                  <h3 className="text-2xl font-extrabold text-purple-900 dark:text-purple-100">
                    {viewingHistoryResult.clientName}
                  </h3>
                  <p className="text-purple-600 dark:text-purple-400 text-sm font-bold flex items-center gap-2 mt-1 uppercase tracking-wider">
                    {viewingHistoryResult.postcode ? (
                      <><MapPin className="w-4 h-4" /> {viewingHistoryResult.postcode} &middot; </>
                    ) : null}
                    <Clock className="w-4 h-4" /> Saved on {new Date(viewingHistoryResult.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <Button variant="outline" className="rounded-xl gap-2 h-11 border-purple-200" onClick={() => setViewingHistoryResult(null)}>
                  <ArrowRight className="w-4 h-4 rotate-180" />
                  Back to List
                </Button>
              </div>

              {viewingHistoryResult.results?.visitResults ? (
                <Tabs defaultValue="0" className="w-full">
                  <TabsList className="bg-gray-100/50 dark:bg-gray-800/50 p-1.5 h-auto flex-wrap gap-2 rounded-xl mb-6">
                    {viewingHistoryResult.results.visitResults.map((vr: any, vi: number) => (
                      <TabsTrigger key={vi} value={String(vi)} className="px-6 py-2.5 rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-md font-bold">
                        Visit {vi + 1}
                        <Badge variant="secondary" className="ml-2.5 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-none px-2 h-5 font-bold">
                          {vr.matches?.length || 0}
                        </Badge>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {viewingHistoryResult.results.visitResults.map((vr: any, vi: number) => (
                    <TabsContent key={vi} value={String(vi)} className="animate-in fade-in zoom-in-95 duration-500">
                      <div className="flex items-center gap-6 mb-6 px-2 text-[13px] font-bold text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 px-3 py-1.5 rounded-lg border">
                          <Users className="w-4 h-4 text-purple-500" />
                          CPs: {vr.careProsRequired}
                        </span>
                        <span className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 px-3 py-1.5 rounded-lg border capitalize">
                          <Users className="w-4 h-4 text-blue-500" />
                          Gender: {vr.genderPreferences?.join(', ') || 'Any'}
                        </span>
                      </div>
                      <MatchResultsGrid 
                        result={{
                          ...viewingHistoryResult.results,
                          visitResults: [{
                            ...vr,
                            visitIndex: vi
                          }]
                        }} 
                        requiredDays={viewingHistoryResult.criteria?.visits?.[vi]?.requiredDays || []}
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              ) : (
                <div className="bg-orange-50 dark:bg-orange-900/10 p-8 rounded-2xl border border-dashed border-orange-200 dark:border-orange-800 text-center">
                  <Info className="w-12 h-12 text-orange-400 mx-auto mb-4" />
                  <h4 className="text-lg font-bold text-orange-900 dark:text-orange-100">No match data available</h4>
                  <p className="text-orange-600 dark:text-orange-400 max-w-md mx-auto mt-2">
                    This search may have been performed before the multi-visit result system was updated.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {historyQuery.isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 bg-gray-50 dark:bg-gray-900/50 rounded-3xl border-2 border-dashed border-gray-100">
                  <Loader2 className="w-10 h-10 animate-spin text-purple-600 mb-4" />
                  <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Retrieving Intelligence History...</p>
                </div>
              ) : !historyQuery.data?.length ? (
                <div className="flex flex-col items-center justify-center py-20 bg-gray-50 dark:bg-gray-900/50 rounded-3xl border-2 border-dashed border-gray-100">
                  <History className="w-12 h-12 text-gray-300 mb-4" />
                  <h4 className="text-xl font-bold text-gray-900 dark:text-gray-100">No Enquiries Found</h4>
                  <p className="text-gray-500 dark:text-gray-400 mt-2">Run a search and it will be archived here automatically.</p>
                </div>
              ) : (
                historyQuery.data.map((enquiry: any) => {
                  const results = enquiry.results;
                  const isMultiVisit = results?.visitResults && results.visitResults.length > 0;
                  const visitCount = isMultiVisit ? results.totalVisits : 1;
                  return (
                    <Card key={enquiry.id} className="group overflow-hidden border border-gray-100 dark:border-gray-800 hover:border-purple-200 dark:hover:border-purple-800 transition-all hover:shadow-xl hover:shadow-purple-500/5 cursor-pointer rounded-2xl" onClick={() => setViewingHistoryResult(enquiry)}>
                      <div className="p-5 flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-xl group-hover:bg-purple-600 transition-colors group-hover:text-white text-purple-600">
                            <Users className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate group-hover:text-purple-600 transition-colors">{enquiry.clientName}</h4>
                            <div className="flex items-center gap-3 mt-1">
                              <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 border-none font-bold text-[10px] uppercase">
                                {visitCount} visit{visitCount !== 1 ? 's' : ''}
                              </Badge>
                              {enquiry.matchCount > 0 && (
                                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-none font-bold text-[10px] uppercase">
                                  {enquiry.matchCount} match{enquiry.matchCount !== 1 ? 'es' : ''}
                                </Badge>
                              )}
                              <span className="text-[11px] font-bold text-gray-400 uppercase">{new Date(enquiry.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                            onClick={(e) => { e.stopPropagation(); deleteEnquiryMutation.mutate(enquiry.id); }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                          <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-purple-600 group-hover:translate-x-1 transition-all" />
                        </div>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return <ArrowRight className={className} />;
}

export default ClientEnquiryMatcher;
