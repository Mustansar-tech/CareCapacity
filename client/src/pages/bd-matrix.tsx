import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { 
  Calendar, Users, Clock, Car, PersonStanding, 
  Eye, CheckCircle, AlertTriangle, XCircle, Filter,
  Search, UserCheck, MapPin, Loader2, Star, ArrowRight,
  History, Trash2, Plus, Minus
} from "lucide-react";
import type { ProcessingResult } from "@shared/schema";
import { getGenderColorClass, getGenderBgColorClass } from "@/utils/gender-colors";

// Company's 11 standardized time blocks
const COMPANY_TIME_BLOCKS = [
  { start: '08:00', end: '09:00', label: '08:00-09:00' },
  { start: '09:15', end: '10:15', label: '09:15-10:15' },
  { start: '10:30', end: '11:30', label: '10:30-11:30' },
  { start: '11:45', end: '12:45', label: '11:45-12:45' },
  { start: '13:00', end: '14:00', label: '13:00-14:00' },
  { start: '14:15', end: '15:15', label: '14:15-15:15' },
  { start: '15:30', end: '16:30', label: '15:30-16:30' },
  { start: '16:45', end: '17:45', label: '16:45-17:45' },
  { start: '18:00', end: '19:00', label: '18:00-19:00' },
  { start: '19:15', end: '20:15', label: '19:15-20:15' },
  { start: '20:30', end: '21:30', label: '20:30-21:30' },
];

interface TimeBlock {
  start: string;
  end: string;
  label: string;
}

interface EmployeeAvailabilityInfo {
  name: string;
  gender?: string;
  transportMode?: string;
  freeWindows: string;
  scheduledHours?: number;
  cancelledVisits?: string;
}

interface BDMatrixCell {
  count: number;
  employees: EmployeeAvailabilityInfo[];
  colorClass: string;
}

interface BDMatrixProps {
  data: ProcessingResult | null;
}

// Processing functions (inline for now)
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function isFullyAvailableInTimeBlock(freeWindows: string, timeBlock: TimeBlock): boolean {
  if (!freeWindows || freeWindows === '-' || freeWindows === '') {
    return false;
  }

  const blockStart = timeToMinutes(timeBlock.start);
  const blockEnd = timeToMinutes(timeBlock.end);

  const windows = freeWindows.split(',').map(w => w.trim()).filter(w => w);
  
  for (const window of windows) {
    if (window.includes('-')) {
      const [startStr, endStr] = window.split('-').map(s => s.trim());
      const windowStart = timeToMinutes(startStr);
      const windowEnd = timeToMinutes(endStr);
      
      if (windowStart <= blockStart && windowEnd >= blockEnd) {
        return true;
      }
    }
  }
  
  return false;
}

function getColorClass(count: number): string {
  if (count <= 1) return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800/50';
  if (count <= 3) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800/50';
  return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800/50';
}

function getStatusIcon(count: number) {
  if (count === 0) return <XCircle className="w-4 h-4" />;
  if (count === 1) return <AlertTriangle className="w-4 h-4" />;
  if (count <= 3) return <CheckCircle className="w-4 h-4" />;
  return <Users className="w-4 h-4" />;
}

function TransportModeIcon({ transportMode }: { transportMode?: string }) {
  if (!transportMode || transportMode.trim() === '') return null;
  
  const mode = transportMode.toLowerCase();
  
  if (mode.includes('car') || mode.includes('driver')) {
    return (
      <div title="Car" aria-label="Transport mode: car" className="inline-block">
        <Car className="w-4 h-4 text-blue-600 dark:text-blue-400" />
      </div>
    );
  } else if (mode.includes('walk')) {
    return (
      <div title="Walking" aria-label="Transport mode: walking" className="inline-block">
        <PersonStanding className="w-4 h-4 text-green-600 dark:text-green-400" />
      </div>
    );
  }
  
  return null;
}

function formatDateForDisplay(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00.000Z');
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit' });
  } catch (error) {
    return dateStr;
  }
}

function getDayOfWeek(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00.000Z');
    return date.toLocaleDateString('en-GB', { weekday: 'long' });
  } catch (error) {
    return 'Unknown';
  }
}

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

interface MatchResult {
  criteria: any;
  matches: MatchedEmployee[];
  totalEmployeesEvaluated: number;
}

const DAY_OPTIONS = [
  { value: 'mon', label: 'Monday' },
  { value: 'tue', label: 'Tuesday' },
  { value: 'wed', label: 'Wednesday' },
  { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' },
  { value: 'sat', label: 'Saturday' },
  { value: 'sun', label: 'Sunday' },
];

function getMatchTypeBadge(matchType: string) {
  switch (matchType) {
    case 'exact':
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-700">Exact Match</Badge>;
    case 'adjusted-time':
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-700">Adjusted Time</Badge>;
    case 'alternative-day':
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-700">Alternative Day</Badge>;
    default:
      return null;
  }
}

interface VisitFormData {
  careProsRequired: number;
  genderPreferences: string[];
  selectedDays: string[];
  timeStart: string;
  timeEnd: string;
}

interface MultiVisitResult {
  clientName: string;
  postcode?: string;
  visitResults: Array<{
    visitLabel: string;
    visitIndex: number;
    careProsRequired: number;
    genderPreferences: string[];
    matches: MatchedEmployee[];
    totalEmployeesEvaluated: number;
  }>;
  totalVisits: number;
}

function createEmptyVisit(): VisitFormData {
  return {
    careProsRequired: 1,
    genderPreferences: ['any'],
    selectedDays: [],
    timeStart: '09:00',
    timeEnd: '17:00',
  };
}

function VisitForm({ visit, onChange }: { visit: VisitFormData; onChange: (v: VisitFormData) => void }) {
  const handleDayToggle = (day: string) => {
    const newDays = visit.selectedDays.includes(day)
      ? visit.selectedDays.filter(d => d !== day)
      : [...visit.selectedDays, day];
    onChange({ ...visit, selectedDays: newDays });
  };

  const handleCareProsChange = (count: number) => {
    const clamped = Math.max(1, Math.min(3, count));
    const genderPrefs = [...visit.genderPreferences];
    while (genderPrefs.length < clamped) genderPrefs.push('any');
    while (genderPrefs.length > clamped) genderPrefs.pop();
    onChange({ ...visit, careProsRequired: clamped, genderPreferences: genderPrefs });
  };

  const handleGenderChange = (cpIndex: number, value: string) => {
    const genderPrefs = [...visit.genderPreferences];
    genderPrefs[cpIndex] = value;
    onChange({ ...visit, genderPreferences: genderPrefs });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Care Pros Required</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCareProsChange(visit.careProsRequired - 1)}
              disabled={visit.careProsRequired <= 1}
              className="h-8 w-8 p-0"
            >
              <Minus className="w-3 h-3" />
            </Button>
            <span className="text-lg font-semibold w-8 text-center">{visit.careProsRequired}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCareProsChange(visit.careProsRequired + 1)}
              disabled={visit.careProsRequired >= 3}
              className="h-8 w-8 p-0"
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Gender Preference per CP</Label>
          <div className="space-y-1.5">
            {Array.from({ length: visit.careProsRequired }).map((_, cpIdx) => (
              <div key={cpIdx} className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-10">CP{cpIdx + 1}:</span>
                <Select
                  value={visit.genderPreferences[cpIdx] || 'any'}
                  onValueChange={(v) => handleGenderChange(cpIdx, v)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">No Preference</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Required Days *</Label>
        <div className="flex flex-wrap gap-2">
          {DAY_OPTIONS.map(day => (
            <Button
              key={day.value}
              type="button"
              variant={visit.selectedDays.includes(day.value) ? "default" : "outline"}
              size="sm"
              onClick={() => handleDayToggle(day.value)}
              className={visit.selectedDays.includes(day.value)
                ? "bg-purple-600 hover:bg-purple-700 text-white"
                : ""}
            >
              {day.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Preferred Start Time *</Label>
          <Input
            type="time"
            step="900"
            value={visit.timeStart}
            onChange={(e) => onChange({ ...visit, timeStart: e.target.value })}
            className="w-full"
          />
        </div>
        <div className="space-y-2">
          <Label>Preferred End Time *</Label>
          <Input
            type="time"
            step="900"
            value={visit.timeEnd}
            onChange={(e) => onChange({ ...visit, timeEnd: e.target.value })}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}

function MatchResultsGrid({ result, requiredDays = [] }: { result: MultiVisitResult; requiredDays?: string[] }) {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'];

  // Filter days to only show those that are required
  const visibleDays = days.filter(d => requiredDays.includes(d));
  const visibleDayLabels = dayLabels.filter((_, i) => requiredDays.includes(days[i]));

  // If no specific days are required (unlikely given the UI), show all
  const displayDays = visibleDays.length > 0 ? visibleDays : days;
  const displayLabels = visibleDayLabels.length > 0 ? visibleDayLabels : dayLabels;

  return (
    <div className="overflow-x-auto border rounded-lg border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm relative">
      <table className="w-full border-collapse text-[10px] leading-tight table-fixed min-w-[800px]">
        <thead>
          <tr className="bg-gray-100 dark:bg-gray-900">
            <th className="border p-2 w-[180px] text-left font-bold text-gray-700 dark:text-gray-300 sticky left-0 z-20 bg-gray-100 dark:bg-gray-900 shadow-[2px_0_5px_rgba(0,0,0,0,0.05)]">Requirement</th>
            {displayLabels.map(label => (
              <th key={label} className="border p-2 w-[140px] text-center font-bold text-gray-700 dark:text-gray-300">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.visitResults.map((vr) => (
            <React.Fragment key={vr.visitIndex}>
              {Array.from({ length: vr.careProsRequired }).map((_, cpIdx) => {
                const genderPref = vr.genderPreferences[cpIdx] || 'any';
                const genderLabel = genderPref === 'any' ? 'Any' : genderPref.charAt(0).toUpperCase() + genderPref.slice(1);
                
                return (
                  <tr key={`${vr.visitIndex}-${cpIdx}`} className="group hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="border p-2 align-top bg-gray-50/30 dark:bg-gray-900/10 font-medium sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0,0.05)]">
                      <div className="font-bold text-purple-700 dark:text-purple-400 mb-2 border-b border-purple-100 dark:border-purple-900/50 pb-1">
                        CP{cpIdx + 1}: {genderLabel} Only
                      </div>
                      <div className="space-y-2 text-gray-400 dark:text-gray-500 font-normal">
                        <div className="flex justify-between"><span>Name</span></div>
                        <div className="flex justify-between"><span>Time Suggested</span></div>
                        <div className="flex justify-between"><span>Driver / Walker</span></div>
                        <div className="flex justify-between"><span>Hours complete / Desired Hours (week)</span></div>
                        <div className="text-[9px] pt-1 opacity-60 italic">Exact time green, adjusted time is orange</div>
                      </div>
                    </td>
                    {displayDays.map(day => {
                      // Logic to find matches: for a grid, we typically show the top match for this CP slot
                      const employeeMatch = vr.matches[cpIdx]; 
                      const slotOnDay = employeeMatch?.matchedSlots.find(s => {
                        const dateStr = s.day;
                        const date = new Date(dateStr + 'T12:00:00');
                        const dayAbbrev = date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
                        return dayAbbrev === day;
                      });

                      if (!employeeMatch || !slotOnDay) {
                        return <td key={day} className="border p-2 bg-gray-50/5 dark:bg-gray-900/2"></td>;
                      }

                      const isExact = slotOnDay.matchType === 'exact';
                      const remainingHours = (employeeMatch.contractedWeeklyHours - employeeMatch.totalScheduledHours).toFixed(1);
                      
                      return (
                        <td key={day} className="border p-2 align-top transition-colors">
                          <div className="space-y-2 mt-[1.4rem]">
                            <div className="font-bold text-gray-900 dark:text-gray-100 truncate text-[11px] leading-none" title={employeeMatch.employeeName}>
                              {employeeMatch.employeeName}
                            </div>
                            <div className={`font-bold text-[11px] leading-none ${isExact ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                              {slotOnDay.availableWindow}
                            </div>
                            <div className="flex items-center gap-1 text-gray-600 dark:text-gray-400 leading-none h-3">
                              <TransportModeIcon transportMode={employeeMatch.transportMode} />
                              <span className="capitalize">{employeeMatch.transportMode || 'N/A'}</span>
                            </div>
                            <div className="text-gray-600 dark:text-gray-400 font-medium leading-none">
                              {employeeMatch.totalScheduledHours} / {employeeMatch.contractedWeeklyHours} ({remainingHours} rem)
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {/* Spacer row between visits */}
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
      
      // Calculate duration for the first visit to store in the main record
      let durationMinutes = 60;
      if (firstVisit?.preferredTimeWindow?.start && firstVisit?.preferredTimeWindow?.end) {
        const start = firstVisit.preferredTimeWindow.start.split(':').map(Number);
        const end = firstVisit.preferredTimeWindow.end.split(':').map(Number);
        durationMinutes = (end[0] * 60 + (end[1] || 0)) - (start[0] * 60 + (start[1] || 0));
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

  const activeVisits = visits.filter(v => v.selectedDays.length > 0);
  const canSubmit = clientName.trim() && activeVisits.length > 0 && activeVisits.every(v => v.timeStart && v.timeEnd);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setMultiResults(null); setShowHistory(false); setViewingHistoryResult(null); } }}>
        <DialogTrigger asChild>
          <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-lg">
            <Search className="w-4 h-4 mr-2" />
            Client Enquiry Matcher
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-lg">
              <UserCheck className="w-5 h-5 text-purple-600" />
              {showHistory ? 'Enquiry History' : 'Client Enquiry Matcher'}
            </DialogTitle>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {showHistory
                  ? `${historyQuery.data?.length || 0} saved enquiries`
                  : 'Enter client requirements — use tabs for multiple daily visits. Fill each visit tab then click Find Matches.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowHistory(!showHistory); setViewingHistoryResult(null); setMultiResults(null); }}
                className={showHistory ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700' : ''}
              >
                {showHistory ? (
                  <><Search className="w-4 h-4 mr-1" /> New Search</>
                ) : (
                  <><History className="w-4 h-4 mr-1" /> History {historyQuery.data?.length ? `(${historyQuery.data.length})` : ''}</>
                )}
              </Button>
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1 overflow-y-auto pr-2">
            {showHistory ? (
              viewingHistoryResult ? (
                <div className="space-y-4 py-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                        Results for {viewingHistoryResult.clientName}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {viewingHistoryResult.totalVisits
                          ? `${viewingHistoryResult.totalVisits} visit(s)`
                          : `${viewingHistoryResult.matches?.length || 0} match(es)`}
                        {viewingHistoryResult.createdAt && (
                          <> &middot; {new Date(viewingHistoryResult.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                        )}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setViewingHistoryResult(null)}>
                      <ArrowRight className="w-4 h-4 mr-1 rotate-180" />
                      Back to History
                    </Button>
                  </div>

                  {viewingHistoryResult.visitResults ? (
                    <Tabs defaultValue="0">
                      <TabsList className="mb-3">
                        {viewingHistoryResult.visitResults.map((vr: any, vi: number) => (
                          <TabsTrigger key={vi} value={String(vi)} className="text-xs">
                            {vr.visitLabel || `Visit ${vi + 1}`}
                            <Badge variant="secondary" className="ml-1.5 text-xs px-1.5">
                              {vr.matches?.length || 0}
                            </Badge>
                          </TabsTrigger>
                        ))}
                      </TabsList>
                      {viewingHistoryResult.visitResults.map((vr: any, vi: number) => (
                        <TabsContent key={vi} value={String(vi)} className="space-y-3">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            CPs needed: {vr.careProsRequired || 1} &middot;
                            Gender: {(vr.genderPreferences || ['any']).map((g: string, gi: number) => `CP${gi + 1}: ${g}`).join(', ')}
                          </div>
                          {(vr.matches?.length || 0) === 0 ? (
                            <Card className="p-6 text-center border-dashed">
                              <XCircle className="w-10 h-10 mx-auto mb-2 text-gray-400" />
                              <h4 className="font-medium text-gray-600 dark:text-gray-300 text-sm">No Matches Found</h4>
                            </Card>
                          ) : (
                            <MatchResultsGrid 
                              result={{
                                ...viewingHistoryResult.results,
                                visitResults: [vr]
                              }} 
                              requiredDays={vr.requiredDays || enquiryRequiredDays}
                            />
                          )}
                        </TabsContent>
                      ))}
                    </Tabs>
                  ) : viewingHistoryResult.matches ? (
                    (viewingHistoryResult.matches.length === 0) ? (
                      <Card className="p-8 text-center border-dashed">
                        <XCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                        <h4 className="font-medium text-gray-600 dark:text-gray-300 mb-1">No Matches Were Found</h4>
                      </Card>
                    ) : (
                      <MatchResultsGrid 
                        result={{
                          totalVisits: 1,
                          visitResults: [{
                            visitLabel: 'Visit 1',
                            visitIndex: 0,
                            careProsRequired: 1,
                            genderPreferences: [viewingHistoryResult.genderPreference || 'any'],
                            matches: viewingHistoryResult.matches,
                            totalEmployeesEvaluated: viewingHistoryResult.results?.totalEmployeesEvaluated || 0
                          }]
                        }}
                        requiredDays={viewingHistoryResult.requiredDays || []}
                      />
                    )
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2 py-2">
                  {historyQuery.isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-purple-600 mr-2" />
                      <span className="text-gray-500">Loading history...</span>
                    </div>
                  ) : !historyQuery.data?.length ? (
                    <Card className="p-8 text-center border-dashed">
                      <History className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                      <h4 className="font-medium text-gray-600 dark:text-gray-300 mb-1">No Enquiries Yet</h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Run a client match search and it will be saved here automatically.
                      </p>
                    </Card>
                  ) : (
                    historyQuery.data.map((enquiry: any) => {
                      const results = enquiry.results;
                      const isMultiVisit = results?.visitResults && results.visitResults.length > 0;
                      const visitCount = isMultiVisit ? results.totalVisits : 1;
                      const days = Array.isArray(enquiry.requiredDays) ? enquiry.requiredDays : [];
                      const tw = enquiry.preferredTimeWindow || {};
                      return (
                        <Card key={enquiry.id} className="p-3 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow">
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                                  {enquiry.clientName}
                                </h4>
                                {isMultiVisit && (
                                  <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-700 text-xs">
                                    {visitCount} visit{visitCount !== 1 ? 's' : ''}
                                  </Badge>
                                )}
                                {enquiry.matchCount > 0 ? (
                                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-700 text-xs">
                                    {enquiry.matchCount} match{enquiry.matchCount !== 1 ? 'es' : ''}
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-xs">No matches</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {days.length > 0 && (
                                  <span>{days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')}</span>
                                )}
                                {tw.start && <span>{tw.start} - {tw.end || '?'}</span>}
                                {enquiry.topMatch && (
                                  <span className="text-purple-600 dark:text-purple-400">Top: {enquiry.topMatch}</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                {new Date(enquiry.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 ml-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const resultData = enquiry.results;
                                  if (resultData) {
                                    setViewingHistoryResult({ ...resultData, createdAt: enquiry.createdAt, clientName: enquiry.clientName });
                                  }
                                }}
                                className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteEnquiryMutation.mutate(enquiry.id)}
                                disabled={deleteEnquiryMutation.isPending}
                                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </Card>
                      );
                    })
                  )}
                </div>
              )
            ) : !multiResults ? (
              <div className="space-y-5 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="clientName">Client Name *</Label>
                    <Input
                      id="clientName"
                      placeholder="e.g. Mrs Smith"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="postcode">Postcode</Label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        id="postcode"
                        placeholder="e.g. SW1A 1AA"
                        value={postcode}
                        onChange={(e) => setPostcode(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                  </div>
                </div>

                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Visit Details
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {visits.length} visit{visits.length !== 1 ? 's' : ''}
                      </span>
                      {visits.length < 5 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addVisitTab}
                          className="h-7 text-xs px-2"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add Visit
                        </Button>
                      )}
                    </div>
                  </div>

                  <Tabs value={activeVisitTab} onValueChange={setActiveVisitTab}>
                    <TabsList className="mb-3 flex-wrap h-auto gap-1">
                      {visits.map((v, i) => (
                        <div key={i} className="flex items-center">
                          <TabsTrigger value={String(i)} className="text-xs relative pr-6">
                            Visit {i + 1}
                            {v.selectedDays.length > 0 && (
                              <CheckCircle className="w-3 h-3 text-green-500 ml-1" />
                            )}
                          </TabsTrigger>
                          {visits.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removeVisitTab(i); }}
                              className="ml-[-18px] mr-1 z-10 text-gray-400 hover:text-red-500 transition-colors"
                              title="Remove this visit"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </TabsList>
                    {visits.map((v, i) => (
                      <TabsContent key={i} value={String(i)}>
                        <VisitForm
                          visit={v}
                          onChange={(updated) => updateVisit(i, updated)}
                        />
                      </TabsContent>
                    ))}
                  </Tabs>
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-700">
                  <Button variant="ghost" onClick={handleReset} className="text-gray-500">
                    Reset
                  </Button>
                  <div className="flex items-center gap-3">
                    {activeVisits.length > 0 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {activeVisits.length} visit{activeVisits.length !== 1 ? 's' : ''} configured
                      </span>
                    )}
                    <Button
                      onClick={() => matchMutation.mutate()}
                      disabled={!canSubmit || matchMutation.isPending}
                      className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-6"
                    >
                      {matchMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Finding Matches...
                        </>
                      ) : (
                        <>
                          <Search className="w-4 h-4 mr-2" />
                          Find Matches
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                      Results for {multiResults.clientName}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {multiResults.totalVisits} visit{multiResults.totalVisits !== 1 ? 's' : ''} &middot;
                      {multiResults.visitResults.reduce((sum, vr) => sum + vr.matches.length, 0)} total matches
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setMultiResults(null)}>
                    <ArrowRight className="w-4 h-4 mr-1 rotate-180" />
                    Back to Search
                  </Button>
                </div>

                {multiResults && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-blue-600">
                          Matches for {clientName}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {multiResults.totalVisits} visits • {multiResults.visitResults.reduce((acc, vr) => acc + vr.matches.length, 0)} total matches
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={handleReset}>
                          Clear Results
                        </Button>
                      </div>
                    </div>

                    <Tabs value={activeResultTab} onValueChange={setActiveResultTab} className="w-full">
                      <TabsList className="bg-gray-100/50 dark:bg-gray-800/50 p-1 h-auto flex-wrap gap-1">
                        {multiResults.visitResults.map((vr, idx) => (
                          <TabsTrigger 
                            key={idx} 
                            value={String(idx)}
                            className="px-4 py-2 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded-md transition-all"
                          >
                            <div className="flex items-center gap-2">
                              <span>Visit {idx + 1}</span>
                              <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-none px-1.5 h-5 min-w-[20px] flex items-center justify-center font-bold">
                                {vr.matches.length}
                              </Badge>
                            </div>
                          </TabsTrigger>
                        ))}
                      </TabsList>
                      
                      {multiResults.visitResults.map((vr, idx) => (
                        <TabsContent key={idx} value={String(idx)} className="mt-4">
                          <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-4 px-1">
                            <span className="flex items-center gap-1.5">
                              <Users className="w-4 h-4" />
                              CPs needed: {vr.careProsRequired}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-4 h-4" />
                              Gender: {vr.genderPreferences.map((g, i) => `CP${i+1}: ${g}`).join(', ')}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <UserCheck className="w-4 h-4" />
                              {vr.totalEmployeesEvaluated} employees evaluated
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
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function BDMatrix({ data }: BDMatrixProps) {
  const [selectedTimeBlocks, setSelectedTimeBlocks] = useState<Set<string>>(new Set());

  const matrixData = useMemo(() => {
    if (!data?.employeeSummaryByDate) return null;

    const dates = Object.keys(data.employeeSummaryByDate).sort();
    const matrix: Record<string, Record<string, BDMatrixCell>> = {};

    // Initialize matrix structure
    for (const date of dates) {
      matrix[date] = {};
      for (const timeBlock of COMPANY_TIME_BLOCKS) {
        matrix[date][timeBlock.label] = {
          count: 0,
          employees: [],
          colorClass: getColorClass(0)
        };
      }
    }

    // Process each date's employee data
    for (const date of dates) {
      const employees = data.employeeSummaryByDate[date] || [];
      
      for (const employee of employees) {
        for (const timeBlock of COMPANY_TIME_BLOCKS) {
          if (isFullyAvailableInTimeBlock(employee.freeWindows, timeBlock)) {
            const cell = matrix[date][timeBlock.label];
            cell.count++;
            cell.employees.push({
              name: employee.employeeName,
              gender: employee.gender,
              transportMode: employee.transportMode,
              freeWindows: employee.freeWindows,
              scheduledHours: employee.scheduledHours,
              cancelledVisits: employee.cancelledVisits
            });
            cell.colorClass = getColorClass(cell.count);
          }
        }
      }
    }

    return { dates, matrix };
  }, [data]);
  
  // Calculate filtered matrix data (intersection logic)
  const filteredMatrixData = useMemo(() => {
    if (!matrixData || selectedTimeBlocks.size === 0) return null;
    
    const { dates, matrix } = matrixData;
    const filteredMatrix: Record<string, BDMatrixCell> = {};
    const selectedTimeBlocksArray = Array.from(selectedTimeBlocks);
    
    // Initialize filtered matrix for each date
    for (const date of dates) {
      const employeeAvailabilityMap = new Map<string, EmployeeAvailabilityInfo>();
      
      // Find employees available in ALL selected time blocks (intersection)
      if (selectedTimeBlocksArray.length > 0) {
        // Start with employees from first selected time block
        const firstBlockEmployees = matrix[date][selectedTimeBlocksArray[0]]?.employees || [];
        
        for (const employee of firstBlockEmployees) {
          let availableInAllBlocks = true;
          
          // Check if employee is available in ALL other selected time blocks
          for (let i = 1; i < selectedTimeBlocksArray.length; i++) {
            const blockEmployees = matrix[date][selectedTimeBlocksArray[i]]?.employees || [];
            const isAvailable = blockEmployees.some(emp => emp.name === employee.name);
            if (!isAvailable) {
              availableInAllBlocks = false;
              break;
            }
          }
          
          if (availableInAllBlocks) {
            employeeAvailabilityMap.set(employee.name, employee);
          }
        }
      }
      
      const employeeDetails = Array.from(employeeAvailabilityMap.values());
      
      filteredMatrix[date] = {
        count: employeeDetails.length,
        employees: employeeDetails,
        colorClass: getColorClass(employeeDetails.length)
      };
    }
    
    return { dates, filteredMatrix };
  }, [matrixData, selectedTimeBlocks]);
  
  const handleTimeBlockToggle = (timeBlockLabel: string, checked: boolean) => {
    const newSelected = new Set(selectedTimeBlocks);
    if (checked) {
      newSelected.add(timeBlockLabel);
    } else {
      newSelected.delete(timeBlockLabel);
    }
    setSelectedTimeBlocks(newSelected);
  };
  
  const handleSelectAll = () => {
    setSelectedTimeBlocks(new Set(COMPANY_TIME_BLOCKS.map(tb => tb.label)));
  };
  
  const handleSelectNone = () => {
    setSelectedTimeBlocks(new Set());
  };

  if (!data) {
    return (
      <div className="p-8 text-center">
        <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-500 mb-2">No Data Available</h3>
        <p className="text-gray-400">Upload and process your Excel files to see the BD availability matrix.</p>
      </div>
    );
  }

  if (!matrixData) {
    return (
      <div className="p-8 text-center">
        <Users className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-500 mb-2">Processing Data</h3>
        <p className="text-gray-400">Please wait while we process your availability data...</p>
      </div>
    );
  }

  const { dates, matrix } = matrixData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="backdrop-blur-sm bg-white/70 dark:bg-gray-900/70 border-0 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/50 dark:to-purple-950/50 rounded-t-lg">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-3">
              <Users className="w-6 h-6 text-blue-600" />
              BD Availability Matrix
            </CardTitle>
            <ClientEnquiryMatcher />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Quick view of staff availability across standard time blocks for business development decisions
          </p>
        </CardHeader>
        <CardContent className="p-4">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Legend:</span>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50"></div>
              <span className="text-sm text-gray-600 dark:text-gray-400">0-1 employees</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800/50"></div>
              <span className="text-sm text-gray-600 dark:text-gray-400">2-3 employees</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800/50"></div>
              <span className="text-sm text-gray-600 dark:text-gray-400">4+ employees</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BD Matrix Grid with Filter as First Column */}
      <Card className="backdrop-blur-sm bg-white/70 dark:bg-gray-900/70 border-0 shadow-xl">
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto overflow-y-auto max-h-[70vh]">
            <div className="min-w-[1000px]">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700">
                    <th className="p-3 text-left font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 sticky left-0 bg-gray-50 dark:bg-gray-800 z-10 min-w-[180px]">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Filter className="w-4 h-4" />
                          Filter & Time Blocks
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={handleSelectAll}
                            variant="outline"
                            size="sm"
                            className="text-xs h-6 px-2"
                          >
                            All
                          </Button>
                          <Button
                            onClick={handleSelectNone}
                            variant="outline"
                            size="sm"
                            className="text-xs h-6 px-2"
                          >
                            None
                          </Button>
                          <span className="text-xs text-gray-500">
                            {selectedTimeBlocks.size} selected
                          </span>
                        </div>
                      </div>
                    </th>
                    {dates.map(date => (
                      <th key={date} className="p-3 text-center font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 min-w-[100px]">
                        <div className="flex flex-col items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span className="text-xs">{formatDateForDisplay(date)}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{getDayOfWeek(date)}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Filtered View Row - Only show when filters are selected */}
                  {selectedTimeBlocks.size > 0 && filteredMatrixData && (
                    <tr className="bg-blue-50/50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-700">
                      <td className="p-3 font-medium text-blue-700 dark:text-blue-300 border-r border-gray-200 dark:border-gray-600 sticky left-0 bg-blue-50/90 dark:bg-blue-900/40 z-10">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Filter className="w-4 h-4 text-blue-500" />
                            <span className="font-semibold text-sm">Available in ALL Selected</span>
                          </div>
                          <div className="text-xs space-y-1 max-h-32 overflow-y-auto">
                            {Array.from(selectedTimeBlocks).slice(0,3).map(block => (
                              <div key={block} className="bg-blue-100 dark:bg-blue-800/30 px-1 py-0.5 rounded text-xs">
                                {block}
                              </div>
                            ))}
                            {selectedTimeBlocks.size > 3 && (
                              <div className="text-xs text-blue-600">
                                +{selectedTimeBlocks.size - 3} more
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {filteredMatrixData.dates.map(date => {
                        const cell = filteredMatrixData.filteredMatrix[date];
                        return (
                          <td key={`filtered-${date}`} className="p-1 border border-blue-200 dark:border-blue-600 text-center">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={`h-16 w-full justify-center transition-all hover:scale-105 ${cell.colorClass} ${cell.count > 0 ? 'hover:shadow-md cursor-pointer' : 'cursor-default'} border-2 border-blue-300 dark:border-blue-600`}
                                  disabled={cell.count === 0}
                                >
                                  <div className="flex flex-col items-center gap-1">
                                    {getStatusIcon(cell.count)}
                                    <span className="text-lg font-bold">{cell.count}</span>
                                    {cell.count > 0 && (
                                      <Eye className="w-3 h-3 opacity-60" />
                                    )}
                                  </div>
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-4xl max-h-[80vh]">
                                <DialogHeader>
                                  <DialogTitle className="flex items-center gap-3">
                                    <Filter className="w-5 h-5" />
                                    Employees Available in ALL Selected Blocks
                                  </DialogTitle>
                                  <div className="text-sm text-gray-600 dark:text-gray-400">
                                    {formatDateForDisplay(date)} ({getDayOfWeek(date)}) • {cell.count} employees available in all {selectedTimeBlocks.size} selected time blocks
                                  </div>
                                </DialogHeader>
                                <ScrollArea className="max-h-[60vh]">
                                  <div className="space-y-3">
                                    {cell.employees.length === 0 ? (
                                      <div className="text-center py-8 text-gray-500">
                                        <XCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                        <p>No employees available in ALL selected time blocks</p>
                                      </div>
                                    ) : (
                                      cell.employees.map((employee, index) => (
                                        <Card key={index} className="p-4 border border-gray-200 dark:border-gray-700">
                                          <div className="flex items-start justify-between">
                                            <div className="flex items-start gap-3 flex-1">
                                              <div className={`w-3 h-3 rounded-full mt-1 ${getGenderBgColorClass(employee.gender)}`}></div>
                                              <div className="flex-1">
                                                <h4 className={`font-medium ${getGenderColorClass(employee.gender)}`}>
                                                  {employee.name}
                                                </h4>
                                                <div className="text-sm mt-1 flex flex-wrap items-center gap-1">
                                                  {employee.scheduledHours !== undefined && (
                                                    <span className="text-blue-600 dark:text-blue-400">
                                                      {employee.scheduledHours.toFixed(1)}h scheduled
                                                    </span>
                                                  )}
                                                  {employee.scheduledHours !== undefined && (employee.freeWindows && employee.freeWindows !== '-') && (
                                                    <span className="text-gray-500">•</span>
                                                  )}
                                                  {employee.freeWindows && employee.freeWindows !== '-' && (
                                                    <span className="text-green-600 dark:text-green-400">
                                                      Free: {employee.freeWindows}
                                                    </span>
                                                  )}
                                                  {((employee.scheduledHours !== undefined) || (employee.freeWindows && employee.freeWindows !== '-')) && (employee.cancelledVisits && employee.cancelledVisits.trim() !== '' && employee.cancelledVisits !== '-' && employee.cancelledVisits !== 'None' && employee.cancelledVisits !== '—') && (
                                                    <span className="text-gray-500">•</span>
                                                  )}
                                                  {employee.cancelledVisits && employee.cancelledVisits.trim() !== '' && employee.cancelledVisits !== '-' && employee.cancelledVisits !== 'None' && employee.cancelledVisits !== '—' && (
                                                    <span className="text-red-600 dark:text-red-400">
                                                      Cancelled: {employee.cancelledVisits}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-2 ml-3">
                                              <TransportModeIcon transportMode={employee.transportMode} />
                                              <Badge variant="outline" className="text-xs">
                                                Available
                                              </Badge>
                                            </div>
                                          </div>
                                        </Card>
                                      ))
                                    )}
                                  </div>
                                </ScrollArea>
                              </DialogContent>
                            </Dialog>
                          </td>
                        );
                      })}
                    </tr>
                  )}
                  
                  {/* Individual Time Block Rows */}
                  {COMPANY_TIME_BLOCKS.map((timeBlock, blockIndex) => (
                    <tr key={timeBlock.label} className={blockIndex % 2 === 0 ? 'bg-white/50 dark:bg-gray-900/50' : 'bg-gray-50/50 dark:bg-gray-800/50'}>
                      <td className="p-3 border-r border-gray-200 dark:border-gray-600 sticky left-0 bg-white/90 dark:bg-gray-900/90 z-10">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`timeblock-${timeBlock.label}`}
                            checked={selectedTimeBlocks.has(timeBlock.label)}
                            onCheckedChange={(checked) => handleTimeBlockToggle(timeBlock.label, checked as boolean)}
                          />
                          <label htmlFor={`timeblock-${timeBlock.label}`} className="font-medium text-gray-700 dark:text-gray-300 cursor-pointer flex items-center gap-2 text-sm">
                            <Clock className="w-4 h-4 text-gray-500" />
                            {timeBlock.label}
                          </label>
                        </div>
                      </td>
                      {dates.map(date => {
                        const cell = matrix[date][timeBlock.label];
                        return (
                          <td key={`${date}-${timeBlock.label}`} className="p-1 border border-gray-200 dark:border-gray-600 text-center">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={`h-14 w-full justify-center transition-all hover:scale-105 ${cell.colorClass} ${cell.count > 0 ? 'hover:shadow-md cursor-pointer' : 'cursor-default'}`}
                                  disabled={cell.count === 0}
                                >
                                  <div className="flex flex-col items-center gap-1">
                                    {getStatusIcon(cell.count)}
                                    <span className="text-lg font-bold">{cell.count}</span>
                                    {cell.count > 0 && (
                                      <Eye className="w-3 h-3 opacity-60" />
                                    )}
                                  </div>
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-4xl max-h-[80vh]">
                                <DialogHeader>
                                  <DialogTitle className="flex items-center gap-3">
                                    <Users className="w-5 h-5" />
                                    Available Employees - {timeBlock.label}
                                  </DialogTitle>
                                  <div className="text-sm text-gray-600 dark:text-gray-400">
                                    {formatDateForDisplay(date)} ({getDayOfWeek(date)}) • {cell.count} employees fully available
                                  </div>
                                </DialogHeader>
                                <ScrollArea className="max-h-[60vh]">
                                  <div className="space-y-3">
                                    {cell.employees.length === 0 ? (
                                      <div className="text-center py-8 text-gray-500">
                                        <XCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                        <p>No employees fully available during this time block</p>
                                      </div>
                                    ) : (
                                      cell.employees.map((employee, index) => (
                                        <Card key={index} className="p-4 border border-gray-200 dark:border-gray-700">
                                          <div className="flex items-start justify-between">
                                            <div className="flex items-start gap-3 flex-1">
                                              <div className={`w-3 h-3 rounded-full mt-1 ${getGenderBgColorClass(employee.gender)}`}></div>
                                              <div className="flex-1">
                                                <h4 className={`font-medium ${getGenderColorClass(employee.gender)}`}>
                                                  {employee.name}
                                                </h4>
                                                <div className="text-sm mt-1 flex flex-wrap items-center gap-1">
                                                  {employee.scheduledHours !== undefined && (
                                                    <span className="text-blue-600 dark:text-blue-400">
                                                      {employee.scheduledHours.toFixed(1)}h scheduled
                                                    </span>
                                                  )}
                                                  {employee.scheduledHours !== undefined && (employee.freeWindows && employee.freeWindows !== '-') && (
                                                    <span className="text-gray-500">•</span>
                                                  )}
                                                  {employee.freeWindows && employee.freeWindows !== '-' && (
                                                    <span className="text-green-600 dark:text-green-400">
                                                      Free: {employee.freeWindows}
                                                    </span>
                                                  )}
                                                  {((employee.scheduledHours !== undefined) || (employee.freeWindows && employee.freeWindows !== '-')) && (employee.cancelledVisits && employee.cancelledVisits.trim() !== '' && employee.cancelledVisits !== '-' && employee.cancelledVisits !== 'None' && employee.cancelledVisits !== '—') && (
                                                    <span className="text-gray-500">•</span>
                                                  )}
                                                  {employee.cancelledVisits && employee.cancelledVisits.trim() !== '' && employee.cancelledVisits !== '-' && employee.cancelledVisits !== 'None' && employee.cancelledVisits !== '—' && (
                                                    <span className="text-red-600 dark:text-red-400">
                                                      Cancelled: {employee.cancelledVisits}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-2 ml-3">
                                              <TransportModeIcon transportMode={employee.transportMode} />
                                              <Badge variant="outline" className="text-xs">
                                                Available
                                              </Badge>
                                            </div>
                                          </div>
                                        </Card>
                                      ))
                                    )}
                                  </div>
                                </ScrollArea>
                              </DialogContent>
                            </Dialog>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}