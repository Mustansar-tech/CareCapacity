import { useState, useMemo } from "react";
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
import { 
  Calendar, Users, Clock, Car, PersonStanding, 
  Eye, CheckCircle, AlertTriangle, XCircle, Filter,
  Search, UserCheck, MapPin, Loader2, Star, ArrowRight,
  History, Trash2
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

function ClientEnquiryMatcher() {
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState('');
  const [postcode, setPostcode] = useState('');
  const [genderPreference, setGenderPreference] = useState('any');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [timeStart, setTimeStart] = useState('09:00');
  const [timeEnd, setTimeEnd] = useState('17:00');
  const [results, setResults] = useState<MatchResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [viewingHistoryResult, setViewingHistoryResult] = useState<any | null>(null);
  const { toast } = useToast();

  const historyQuery = useQuery<any[]>({
    queryKey: ['/api/client-enquiries'],
    enabled: open,
  });

  const saveEnquiryMutation = useMutation({
    mutationFn: async (data: { criteria: any; matchResult: MatchResult }) => {
      const res = await apiRequest('POST', '/api/client-enquiries', {
        clientName: data.criteria.clientName,
        postcode: data.criteria.postcode || null,
        genderPreference: data.criteria.genderPreference || null,
        requiredDays: data.criteria.requiredDays,
        preferredTimeWindow: data.criteria.preferredTimeWindow,
        matchCount: data.matchResult.matches.length,
        topMatch: data.matchResult.matches[0]?.employeeName || null,
        results: data.matchResult,
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
      const res = await apiRequest('POST', '/api/bd-matcher', {
        clientName,
        postcode: postcode || undefined,
        genderPreference,
        requiredDays: selectedDays,
        preferredTimeWindow: { start: timeStart, end: timeEnd },
        visitDurationMinutes: 60, // Default to 60 minutes
      });
      return res.json();
    },
    onSuccess: (data: MatchResult) => {
      setResults(data);
      saveEnquiryMutation.mutate({
        criteria: {
          clientName,
          postcode: postcode || undefined,
          genderPreference,
          requiredDays: selectedDays,
          preferredTimeWindow: { start: timeStart, end: timeEnd },
          visitDurationMinutes: 60,
        },
        matchResult: data,
      });
    },
    onError: () => {
      toast({
        title: "Matching Failed",
        description: "Could not find matches. Please make sure data has been uploaded and processed first.",
        variant: "destructive",
      });
    },
  });

  const handleDayToggle = (day: string) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleReset = () => {
    setClientName('');
    setPostcode('');
    setGenderPreference('any');
    setSelectedDays([]);
    setTimeStart('09:00');
    setTimeEnd('17:00');
    setResults(null);
  };

  const canSubmit = clientName.trim() && selectedDays.length > 0 && timeStart && timeEnd;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setResults(null); setShowHistory(false); setViewingHistoryResult(null); } }}>
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
                  : 'Enter client requirements to find the best matching staff members based on availability, gender preference, and capacity.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowHistory(!showHistory); setViewingHistoryResult(null); setResults(null); }}
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
                        Results for {viewingHistoryResult.criteria?.clientName || viewingHistoryResult.clientName}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {viewingHistoryResult.matches?.length || 0} match{(viewingHistoryResult.matches?.length || 0) !== 1 ? 'es' : ''} found
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

                  {(viewingHistoryResult.matches?.length || 0) === 0 ? (
                    <Card className="p-8 text-center border-dashed">
                      <XCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                      <h4 className="font-medium text-gray-600 dark:text-gray-300 mb-1">No Matches Were Found</h4>
                    </Card>
                  ) : (
                    viewingHistoryResult.matches.map((match: any, index: number) => (
                      <Card key={index} className="p-4 border border-gray-200 dark:border-gray-700">
                        <div className="space-y-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900/30 dark:to-blue-900/30 text-purple-700 dark:text-purple-300 font-bold text-sm">
                                {index + 1}
                              </div>
                              <div>
                                <h4 className={`font-semibold ${getGenderColorClass(match.gender)}`}>
                                  {match.employeeName}
                                </h4>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {getMatchTypeBadge(match.matchType)}
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Score: {match.matchScore?.toFixed(0) || 'N/A'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right text-sm">
                              <div className="font-semibold text-green-600 dark:text-green-400">
                                {match.remainingCapacity?.toFixed(1) || '?'}h remaining
                              </div>
                            </div>
                          </div>
                          {match.matchedSlots?.length > 0 && (
                            <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
                              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Available Slots:</div>
                              <div className="flex flex-wrap gap-2">
                                {match.matchedSlots.map((slot: any, si: number) => (
                                  <div key={si} className={`text-xs px-2.5 py-1.5 rounded-md border ${
                                    slot.matchType === 'exact'
                                      ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300'
                                      : slot.matchType === 'adjusted-time'
                                      ? 'bg-yellow-50 border-yellow-200 text-yellow-700 dark:bg-yellow-900/20 dark:border-yellow-700 dark:text-yellow-300'
                                      : 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300'
                                  }`}>
                                    <span className="font-medium">{slot.dayLabel}</span>
                                    <span className="mx-1">|</span>
                                    <span>{slot.availableWindow}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </Card>
                    ))
                  )}
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
                                {enquiry.matchCount > 0 ? (
                                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-700 text-xs">
                                    {enquiry.matchCount} match{enquiry.matchCount !== 1 ? 'es' : ''}
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-xs">No matches</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                                <span>{days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')}</span>
                                <span>{tw.start || '?'} - {tw.end || '?'}</span>
                                {enquiry.genderPreference && enquiry.genderPreference !== 'any' && (
                                  <span className="capitalize">{enquiry.genderPreference}</span>
                                )}
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
                                  const resultData = enquiry.results as MatchResult;
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
            ) : !results ? (
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Gender Preference</Label>
                    <Select value={genderPreference} onValueChange={setGenderPreference}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">No Preference</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="male">Male</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="visitDuration">Visit Duration *</Label>
                    <Select value={visitDuration} onValueChange={setVisitDuration}>
                      <SelectTrigger id="visitDuration">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 min</SelectItem>
                        <SelectItem value="45">45 min</SelectItem>
                        <SelectItem value="60">1 hour</SelectItem>
                        <SelectItem value="75">1h 15m</SelectItem>
                        <SelectItem value="90">1.5 hours</SelectItem>
                        <SelectItem value="120">2 hours</SelectItem>
                        <SelectItem value="180">3 hours</SelectItem>
                        <SelectItem value="240">4 hours</SelectItem>
                        <SelectItem value="300">5 hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Required Days *</Label>
                  <div className="flex flex-wrap gap-2">
                    {DAY_OPTIONS.map(day => (
                      <Button
                        key={day.value}
                        type="button"
                        variant={selectedDays.includes(day.value) ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleDayToggle(day.value)}
                        className={selectedDays.includes(day.value)
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
                    <Label htmlFor="timeStart">Preferred Start Time *</Label>
                    <Input
                      id="timeStart"
                      type="time"
                      step="900"
                      value={timeStart}
                      onChange={(e) => setTimeStart(e.target.value)}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="timeEnd">Preferred End Time *</Label>
                    <Input
                      id="timeEnd"
                      type="time"
                      step="900"
                      value={timeEnd}
                      onChange={(e) => setTimeEnd(e.target.value)}
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="weeklyHours">Minimum Weekly Capacity Needed (hours)</Label>
                  <Input
                    id="weeklyHours"
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="Leave blank to skip this filter"
                    value={weeklyHours}
                    onChange={(e) => setWeeklyHours(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Only show staff with at least this many hours of remaining weekly capacity
                  </p>
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-700">
                  <Button variant="ghost" onClick={handleReset} className="text-gray-500">
                    Reset
                  </Button>
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
            ) : (
              <div className="space-y-4 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                      Results for {results.criteria.clientName}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {results.matches.length} match{results.matches.length !== 1 ? 'es' : ''} found from {results.totalEmployeesEvaluated} employees evaluated
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setResults(null)}>
                    <ArrowRight className="w-4 h-4 mr-1 rotate-180" />
                    Back to Search
                  </Button>
                </div>

                {results.matches.length === 0 ? (
                  <Card className="p-8 text-center border-dashed">
                    <XCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                    <h4 className="font-medium text-gray-600 dark:text-gray-300 mb-1">No Matches Found</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Try adjusting the time window, reducing required days, or changing gender preference to find available staff.
                    </p>
                  </Card>
                ) : (
                  results.matches.map((match, index) => (
                    <Card key={index} className="p-4 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900/30 dark:to-blue-900/30 text-purple-700 dark:text-purple-300 font-bold text-sm">
                              {index + 1}
                            </div>
                            <div>
                              <h4 className={`font-semibold ${getGenderColorClass(match.gender)}`}>
                                {match.employeeName}
                              </h4>
                              <div className="flex items-center gap-2 mt-0.5">
                                {getMatchTypeBadge(match.matchType)}
                                <TransportModeIcon transportMode={match.transportMode} />
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  Score: {match.matchScore.toFixed(0)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right text-sm">
                            <div className="text-gray-600 dark:text-gray-400">
                              {match.contractedWeeklyHours.toFixed(1)}h contracted/week
                            </div>
                            <div className="text-blue-600 dark:text-blue-400">
                              {match.totalScheduledHours.toFixed(1)}h scheduled
                            </div>
                            <div className="font-semibold text-green-600 dark:text-green-400">
                              {match.remainingCapacity.toFixed(1)}h remaining
                            </div>
                          </div>
                        </div>

                        <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
                          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Available Slots:</div>
                          <div className="flex flex-wrap gap-2">
                            {match.matchedSlots.map((slot, si) => (
                              <div
                                key={si}
                                className={`text-xs px-2.5 py-1.5 rounded-md border ${
                                  slot.matchType === 'exact'
                                    ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300'
                                    : slot.matchType === 'adjusted-time'
                                    ? 'bg-yellow-50 border-yellow-200 text-yellow-700 dark:bg-yellow-900/20 dark:border-yellow-700 dark:text-yellow-300'
                                    : 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300'
                                }`}
                              >
                                <span className="font-medium">{slot.dayLabel}</span>
                                <span className="mx-1">|</span>
                                <span>{slot.availableWindow}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))
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