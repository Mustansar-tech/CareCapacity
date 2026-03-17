import React, { useState, useMemo } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Tooltip } from "react-leaflet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
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
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  Map as MapIcon,
  Calendar, Users, Clock, Car, PersonStanding, 
  Eye, EyeOff, CheckCircle, AlertTriangle, XCircle, Filter,
  Search, UserCheck, MapPin, Loader2, Star, ArrowRight, ArrowLeft, RefreshCw,
  History, Trash2, Plus, Minus, BarChart3, Info, X, Activity
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

// Normalize a raw transport mode string to 'car' | 'walking' | 'public'
function normalizeTransportMode(raw?: string): 'car' | 'walking' | 'public' {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('walk') || s.includes('foot') || s.includes('pedestrian')) return 'walking';
  if (s.includes('public') || s.includes('bus') || s.includes('train') || s.includes('transit')) return 'public';
  // Explicitly known car patterns (including New Hire who hasn't been profiled yet)
  return 'car';
}

function TransportModeIcon({ transportMode }: { transportMode?: string }) {
  if (!transportMode || transportMode.trim() === '') return null;
  
  const normalized = normalizeTransportMode(transportMode);
  
  if (normalized === 'car') {
    return (
      <div title="Car" aria-label="Transport mode: car" className="inline-block">
        <Car className="w-4 h-4 text-blue-600 dark:text-blue-400" />
      </div>
    );
  } else if (normalized === 'walking') {
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
  cancelledVisits?: string;
}

interface MatchedEmployee {
  employeeName: string;
  matchType: 'exact' | 'adjusted-time' | 'alternative-day';
  matchScore: number;
  gender?: string;
  transportMode?: string;
  homePostcode?: string;
  travelMinutes?: number;
  departureSource?: 'home' | 'last-client';
  departureSummary?: string;
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
      return (
        <TooltipProvider>
            <ShadcnTooltip>
              <TooltipTrigger asChild>
                <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-700 flex items-center gap-1 cursor-help">
                  <Info className="w-3 h-3" /> Needs Adjustment
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="bg-gray-900 text-white border-gray-800 font-bold text-[10px] py-1.5">
                <p>Availability does not perfectly match standard blocks</p>
              </TooltipContent>
            </ShadcnTooltip>
        </TooltipProvider>
      );
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
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-2.5">
          <Label className="text-xs font-bold uppercase tracking-wider text-gray-500">Care Pros Required</Label>
          <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCareProsChange(visit.careProsRequired - 1)}
              disabled={visit.careProsRequired <= 1}
              className="h-9 w-9 p-0 rounded-lg border-gray-200"
            >
              <Minus className="w-3.5 h-3.5" />
            </Button>
            <span className="text-2xl font-black w-10 text-center text-purple-700 dark:text-purple-400">{visit.careProsRequired}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCareProsChange(visit.careProsRequired + 1)}
              disabled={visit.careProsRequired >= 3}
              className="h-9 w-9 p-0 rounded-lg border-gray-200"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="space-y-2.5">
          <Label className="text-xs font-bold uppercase tracking-wider text-gray-500">Gender Preference</Label>
          <div className="space-y-2">
            {Array.from({ length: visit.careProsRequired }).map((_, cpIdx) => (
              <div key={cpIdx} className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 w-8 uppercase tracking-wider">CP{cpIdx + 1}</span>
                <Select
                  value={visit.genderPreferences[cpIdx] || 'any'}
                  onValueChange={(v) => handleGenderChange(cpIdx, v)}
                >
                  <SelectTrigger className="h-9 text-xs font-medium bg-white dark:bg-gray-900 border-gray-200">
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

      <div className="space-y-2.5">
        <Label className="text-xs font-bold uppercase tracking-wider text-gray-500">Required Days *</Label>
        <div className="flex flex-wrap gap-2">
          {DAY_OPTIONS.map(day => (
            <Button
              key={day.value}
              type="button"
              variant={visit.selectedDays.includes(day.value) ? "default" : "outline"}
              size="sm"
              onClick={() => handleDayToggle(day.value)}
              className={visit.selectedDays.includes(day.value)
                ? "bg-purple-600 hover:bg-purple-700 text-white font-bold shadow-md shadow-purple-500/20 px-4"
                : "font-bold border-gray-200 hover:border-purple-300 hover:text-purple-700 hover:bg-purple-50 px-4"}
            >
              {day.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-2.5">
          <Label className="text-xs font-bold uppercase tracking-wider text-gray-500">Start Time *</Label>
          <div className="relative group">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-purple-500 transition-colors" />
            <Input
              type="time"
              step="900"
              value={visit.timeStart}
              onChange={(e) => onChange({ ...visit, timeStart: e.target.value })}
              className="pl-10 h-11 bg-white dark:bg-gray-900 border-gray-200 focus:ring-2 focus:ring-purple-500/20"
            />
          </div>
        </div>
        <div className="space-y-2.5">
          <Label className="text-xs font-bold uppercase tracking-wider text-gray-500">End Time *</Label>
          <div className="relative group">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-purple-500 transition-colors" />
            <Input
              type="time"
              step="900"
              value={visit.timeEnd}
              onChange={(e) => onChange({ ...visit, timeEnd: e.target.value })}
              className="pl-10 h-11 bg-white dark:bg-gray-900 border-gray-200 focus:ring-2 focus:ring-purple-500/20"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function normalizeGender(raw: string | undefined | null): 'female' | 'male' | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'female' || v === 'f' || v === 'miss' || v === 'ms' || v === 'mrs') return 'female';
  if (v === 'male' || v === 'm' || v === 'mr') return 'male';
  return null;
}

function makeIcon(gender: string) {
  const g = normalizeGender(gender);
  const color = g === 'female' ? '#ec4899' : g === 'male' ? '#3b82f6' : '#9ca3af';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
    <circle cx="16" cy="16" r="4" fill="${color}"/>
    <circle cx="24" cy="8" r="5" fill="#22c55e" stroke="white" stroke-width="2"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -40],
  });
}

function CareProMap({ 
  locations, 
  onRefresh, 
  isRefreshing 
}: { 
  locations: any[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  const [showPostcodes, setShowPostcodes] = useState(true);

  const validLocations = useMemo(
    () => locations.filter(l => l.homeLat && l.homeLng),
    [locations]
  );

  const femaleCount = useMemo(() => validLocations.filter(l => normalizeGender(l.gender) === 'female').length, [validLocations]);
  const maleCount = useMemo(() => validLocations.filter(l => normalizeGender(l.gender) === 'male').length, [validLocations]);

  const center = useMemo<[number, number]>(() => {
    if (validLocations.length === 0) return [53.5, -1.5];
    const avgLat = validLocations.reduce((s, l) => s + parseFloat(l.homeLat), 0) / validLocations.length;
    const avgLng = validLocations.reduce((s, l) => s + parseFloat(l.homeLng), 0) / validLocations.length;
    return [avgLat, avgLng];
  }, [validLocations]);

  if (validLocations.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100">
        <MapIcon className="w-16 h-16 text-gray-300 mb-4" />
        <h4 className="text-xl font-bold text-gray-400">No Location Data</h4>
        <p className="text-sm text-gray-400 mt-2">Ensure employee postcodes are uploaded and geocoded</p>
        {onRefresh && (
          <Button 
            onClick={onRefresh} 
            disabled={isRefreshing}
            variant="outline"
            className="mt-4 gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh Data
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <MapContainer
        center={center}
        zoom={10}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {validLocations.map((loc) => (
          <Marker
            key={loc.id}
            position={[parseFloat(loc.homeLat), parseFloat(loc.homeLng)]}
            icon={makeIcon(loc.gender || '')}
          >
            {showPostcodes && (
              <Tooltip permanent direction="right" offset={[15, -20]} className="bg-white/90 border-none shadow-md font-bold text-[10px] px-2 py-1 rounded-md">
                <span>{loc.homePostcode}</span>
              </Tooltip>
            )}
            <Popup>
              <div className="text-center min-w-[140px]">
                <p className="text-sm text-[#5d51d5] font-bold">{loc.employeeName}</p>
                <p className="text-xs font-bold text-gray-500 mt-0.5 uppercase">{loc.homePostcode}</p>
                <div className="flex items-center justify-center gap-1.5 mt-1.5 flex-wrap">
                  {normalizeGender(loc.gender) && (
                    <>
                      <div className={`w-2 h-2 rounded-full ${normalizeGender(loc.gender) === 'female' ? 'bg-pink-500' : 'bg-blue-500'}`} />
                      <span className="text-xs text-gray-600 capitalize">{normalizeGender(loc.gender)}</span>
                    </>
                  )}
                  {loc.transportMode && normalizeGender(loc.gender) && (
                    <span className="text-xs text-gray-400">•</span>
                  )}
                  {loc.transportMode && (
                    <span className="text-xs text-gray-500 capitalize">{loc.transportMode}</span>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="absolute top-6 right-20 z-[1000] flex gap-3">
        <Button 
          onClick={() => setShowPostcodes(!showPostcodes)}
          className="bg-white/95 hover:bg-white text-gray-900 font-bold shadow-2xl border-none rounded-xl gap-2 h-10 px-4"
          title={showPostcodes ? 'Hide postcodes' : 'Show postcodes'}
        >
          {showPostcodes ? (
            <>
              <Eye className="w-4 h-4 text-blue-600" />
              <span className="hidden sm:inline">Postcodes</span>
            </>
          ) : (
            <>
              <EyeOff className="w-4 h-4 text-gray-400" />
              <span className="hidden sm:inline">Show</span>
            </>
          )}
        </Button>
        {onRefresh && (
          <Button 
            onClick={onRefresh} 
            disabled={isRefreshing}
            className="bg-white/95 hover:bg-white text-gray-900 font-bold shadow-2xl border-none rounded-xl gap-2 h-10 px-4"
          >
            <RefreshCw className={`w-4 h-4 text-purple-600 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh Map Data'}
          </Button>
        )}
      </div>
      <div className="absolute bottom-6 left-6 bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-gray-100 flex flex-col gap-2 z-[1000]">
        <h5 className="text-[10px] font-black uppercase tracking-widest text-gray-400 border-b pb-2 mb-1">Legend</h5>
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 bg-pink-500 rounded-full border-2 border-white shadow-sm" />
          <span className="text-xs font-bold text-gray-700">Female Care Pro <span className="text-pink-600">({femaleCount})</span></span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 bg-blue-500 rounded-full border-2 border-white shadow-sm" />
          <span className="text-xs font-bold text-gray-700">Male Care Pro <span className="text-blue-600">({maleCount})</span></span>
        </div>
      </div>
    </div>
  );
}

function MatchResultsGrid({ result, requiredDays = [], className = '', sortByTravel = false, onToggleSortByTravel }: { result: MultiVisitResult; requiredDays?: string[]; className?: string; sortByTravel?: boolean; onToggleSortByTravel?: () => void }) {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'];

  const visibleDays = days.filter(d => requiredDays.includes(d));
  const visibleDayLabels = dayLabels.filter((_, i) => requiredDays.includes(days[i]));

  const displayDays = visibleDays.length > 0 ? visibleDays : days;
  const displayLabels = visibleDayLabels.length > 0 ? visibleDayLabels : dayLabels;

  // starred: key = "visitIndex-cpIdx-day", value = { employeeName, timeWindow }
  const [starredMap, setStarredMap] = useState<Record<string, { employeeName: string; timeWindow: string }>>({});

  const starKey = (visitIndex: number, cpIdx: number, day: string) => `${visitIndex}-${cpIdx}-${day}`;

  const getStarred = (visitIndex: number, cpIdx: number, day: string) =>
    starredMap[starKey(visitIndex, cpIdx, day)];

  const toggleStar = (visitIndex: number, cpIdx: number, day: string, employeeName: string, timeWindow: string) => {
    const key = starKey(visitIndex, cpIdx, day);
    setStarredMap(prev => {
      const existing = prev[key];
      if (existing?.employeeName === employeeName) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { employeeName, timeWindow } };
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

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-lg overflow-hidden flex flex-col ${className}`}>
      <div className="bg-purple-50/50 dark:bg-purple-900/10 border-b p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
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
            <p className="text-xs text-purple-600 dark:text-purple-400 font-bold uppercase tracking-widest">{result.clientName || 'New Client'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {onToggleSortByTravel && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleSortByTravel}
              className={`text-[10px] font-bold gap-1.5 h-7 px-3 transition-all ${sortByTravel ? 'bg-blue-100 border-blue-400 text-blue-700 dark:bg-blue-900/40 dark:border-blue-500 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400 hover:border-blue-300 hover:text-blue-600'}`}
              title={sortByTravel ? 'Sorting by nearest first — click to sort by best match' : 'Click to sort by nearest first'}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" /></svg>
              {sortByTravel ? 'Nearest First' : 'Best Match'}
            </Button>
          )}
          {hasAnyStars && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStarredMap({})}
              className="text-[10px] font-bold gap-1.5 h-7 px-3 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400"
            >
              <X className="w-3 h-3" /> Clear Selections
            </Button>
          )}
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => {
              window.dispatchEvent(new CustomEvent('bd-matcher-back'));
            }} 
            className="gap-2 font-bold rounded-xl border-gray-200 hover:border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all px-3 h-8 text-[10px]"
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
                <tr className="bg-purple-50/30 dark:bg-purple-900/10">
                  <td colSpan={displayDays.length + 1} className="p-3 border-b border-purple-100 dark:border-purple-800/30">
                    <div className="flex flex-wrap items-center gap-6 px-4 py-2">
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
                        Gender: {vr.genderPreferences.map((g, i) => `CP${i+1}: ${g}`).join(', ')}
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
                  const genderLabel = genderPref === 'any' ? 'Any' : genderPref.charAt(0).toUpperCase() + genderPref.slice(1);

                  return (
                    <tr key={`${vr.visitIndex}-${cpIdx}`} className="group hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors">
                      <td className="p-4 align-top border-r sticky left-0 z-10 bg-white dark:bg-gray-950 shadow-[4px_0_10px_rgba(0,0,0,0.08)]">
                        <div className="space-y-4">
                          <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300 text-[11px] font-bold uppercase tracking-wider border border-purple-200 dark:border-purple-800/50 text-[#41589c]">
                            CP{cpIdx + 1}: {genderLabel === "Female" ? "F" : genderLabel === "Male" ? "M" : genderLabel} Only
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
                        if (!vr.matches || vr.matches.length === 0) {
                          return (
                            <td key={day} className="p-4 bg-gray-50/10 dark:bg-gray-900/5">
                              <div className="h-full min-h-[120px] flex items-center justify-center border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-xl">
                                <span className="text-gray-200 dark:text-gray-800 font-bold text-lg">-</span>
                              </div>
                            </td>
                          );
                        }

                        // Who is starred in ANY OTHER CP on this day (they are "taken" — can't assign same person twice)
                        const takenByStarred: string[] = [];
                        for (let i = 0; i < vr.careProsRequired; i++) {
                          if (i === cpIdx) continue;
                          const otherStar = getStarred(vr.visitIndex, i, day);
                          if (otherStar) takenByStarred.push(otherStar.employeeName);
                        }

                        // Find any star from another CP slot — used to lock time window across all CPs
                        let anyOtherStar: { employeeName: string; timeWindow: string } | undefined;
                        for (let i = 0; i < vr.careProsRequired; i++) {
                          if (i === cpIdx) continue;
                          const otherStar = getStarred(vr.visitIndex, i, day);
                          if (otherStar) { anyOtherStar = otherStar; break; }
                        }

                        // Current CP's starred selection for this day
                        const currentStar = getStarred(vr.visitIndex, cpIdx, day);

                        // Base filter: gender, has slot on day, not taken by any other starred CP
                        let allVisibleMatches = vr.matches.filter(m => {
                          const isCorrectGender = genderPref === 'any' || m.gender?.toLowerCase() === genderPref.toLowerCase();
                          if (!isCorrectGender) return false;
                          if (!m.matchedSlots.some(s => matchesDay(s, day))) return false;
                          if (takenByStarred.includes(m.employeeName)) return false;
                          return true;
                        });

                        // If any other CP has a star, only show matches with the EXACT same time window
                        if (anyOtherStar) {
                          allVisibleMatches = allVisibleMatches.filter(m => {
                            const slot = m.matchedSlots.find(s => matchesDay(s, day));
                            return slot && slot.availableWindow === anyOtherStar!.timeWindow;
                          });
                        }

                        // Sort: exact first, then by score (or travel time if toggle active)
                        const sorted = [...allVisibleMatches].sort((a, b) => {
                          const aExact = a.matchedSlots.some(s => s.matchType === 'exact' && matchesDay(s, day));
                          const bExact = b.matchedSlots.some(s => s.matchType === 'exact' && matchesDay(s, day));
                          if (aExact && !bExact) return -1;
                          if (!aExact && bExact) return 1;
                          if (sortByTravel) {
                            const aTrav = a.travelMinutes ?? 9999;
                            const bTrav = b.travelMinutes ?? 9999;
                            if (aTrav !== bTrav) return aTrav - bTrav; // nearest first
                          }
                          return b.matchScore - a.matchScore;
                        });

                        // If this CP has a star, only show that person; otherwise show all
                        const matchesToShow = currentStar
                          ? sorted.filter(m => m.employeeName === currentStar.employeeName)
                          : sorted;

                        return (
                          <td key={day} className="p-3 align-top min-w-[250px]">
                            <div className={`overflow-y-auto ${vr.careProsRequired > 1 ? 'max-h-[315px]' : 'max-h-[420px]'} pr-1 space-y-3`}>
                                {matchesToShow.length > 0 ? (
                                  matchesToShow.map((employeeMatch, matchIdx) => {
                                    const slotOnDay = employeeMatch.matchedSlots.find(s => matchesDay(s, day));
                                    if (!slotOnDay) return null;

                                    const isExact = slotOnDay.matchType === 'exact';
                                    const remainingHours = (employeeMatch.contractedWeeklyHours - employeeMatch.totalScheduledHours).toFixed(1);

                                    const isStarred = currentStar?.employeeName === employeeMatch.employeeName;

                                    const genderColorClass = employeeMatch.gender?.toLowerCase() === 'female'
                                      ? 'border-pink-200 bg-pink-50/50 dark:bg-pink-900/20 dark:border-pink-800/50'
                                      : employeeMatch.gender?.toLowerCase() === 'male'
                                        ? 'border-blue-200 bg-blue-50/50 dark:bg-blue-900/20 dark:border-blue-800/50'
                                        : 'border-gray-200 dark:border-gray-800';

                                    const nameColorClass = employeeMatch.gender?.toLowerCase() === 'female'
                                      ? 'text-pink-700 dark:text-pink-400'
                                      : employeeMatch.gender?.toLowerCase() === 'male'
                                        ? 'text-blue-700 dark:text-blue-400'
                                        : 'text-gray-900 dark:text-gray-100';

                                    return (
                                      <div
                                        key={`${employeeMatch.employeeName}-${matchIdx}`}
                                        className={`bg-white dark:bg-gray-900 border ${isStarred ? 'ring-2 ring-amber-400 dark:ring-amber-500' : matchIdx === 0 ? 'ring-1 ring-purple-100 dark:ring-purple-900/30' : ''} ${genderColorClass} rounded-xl p-3 shadow-sm hover:shadow-md transition-all space-y-2 relative`}
                                      >
                                        <div className="flex justify-between items-start gap-2">
                                          <div className="flex flex-col min-w-0 flex-1">
                                            <div className={`font-bold ${nameColorClass} text-[12px] tracking-tight truncate flex items-center gap-1`} title={employeeMatch.employeeName}>
                                              {employeeMatch.employeeName}
                                              {slotOnDay.matchType === 'adjusted-time' && (
                                                <TooltipProvider>
                                                  <ShadcnTooltip>
                                                    <TooltipTrigger asChild>
                                                      <Info className="w-3 h-3 text-orange-500 cursor-help" />
                                                    </TooltipTrigger>
                                                    <TooltipContent className="bg-gray-900 text-white border-gray-800 font-bold text-[10px] py-1.5">
                                                      <p>Needs Adjustment</p>
                                                    </TooltipContent>
                                                  </ShadcnTooltip>
                                                </TooltipProvider>
                                              )}
                                            </div>
                                            {employeeMatch.homePostcode && (
                                              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                                                {employeeMatch.homePostcode}
                                              </div>
                                            )}
                                          </div>
                                          <TooltipProvider>
                                            <ShadcnTooltip>
                                              <TooltipTrigger asChild>
                                                <button
                                                  onClick={() => toggleStar(vr.visitIndex, cpIdx, day, employeeMatch.employeeName, slotOnDay.availableWindow)}
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
                                        <div className="flex flex-wrap gap-1.5">
                                          <div className={`inline-flex px-3 py-1 rounded-md text-[11px] font-black border shadow-sm ${isExact ? 'bg-green-100 text-green-900 border-green-300 dark:bg-green-900/60 dark:text-green-100 dark:border-green-700' : 'bg-orange-200 text-orange-950 border-orange-400 dark:bg-orange-800 dark:text-orange-50 dark:border-orange-600'}`}>
                                            {slotOnDay.availableWindow}
                                          </div>
                                        </div>
                                        {slotOnDay.cancelledVisits && (
                                          <div className="flex items-center gap-1 text-[9px] font-bold text-rose-600 dark:text-rose-400">
                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />
                                            <span className="uppercase tracking-wide">Cancelled:</span>
                                            <span className="font-black">{slotOnDay.cancelledVisits}</span>
                                          </div>
                                        )}
                                        <div className="flex items-center justify-between text-[9px] text-gray-600 dark:text-gray-400 font-medium">
                                          <div className="flex items-center gap-1.5">
                                            <TransportModeIcon transportMode={employeeMatch.transportMode} />
                                            <span className="capitalize">{employeeMatch.transportMode || 'N/A'}</span>
                                          </div>
                                          <div className="font-bold text-gray-700 dark:text-gray-300 cursor-help" title={`Scheduled: ${employeeMatch.totalScheduledHours}h\nContracted: ${employeeMatch.contractedWeeklyHours}h\nRemaining: ${remainingHours}h`}>
                                            {employeeMatch.totalScheduledHours} / {employeeMatch.contractedWeeklyHours} ({remainingHours} rem)
                                          </div>
                                        </div>
                                        {employeeMatch.travelMinutes !== undefined && (
                                          <div className="flex flex-col gap-0.5">
                                            <div className={`flex items-center gap-1 text-[9px] font-bold rounded px-1.5 py-0.5 w-fit ${employeeMatch.travelMinutes <= 20 ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : employeeMatch.travelMinutes <= 35 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'}`}>
                                              <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" /></svg>
                                              ~{employeeMatch.travelMinutes} min {normalizeTransportMode(employeeMatch.transportMode) === 'walking' ? 'walk' : normalizeTransportMode(employeeMatch.transportMode) === 'public' ? 'transit' : 'drive'}
                                            </div>
                                            {employeeMatch.departureSummary && (
                                              <div className={`text-[8px] font-semibold px-1.5 py-0.5 rounded w-fit ${employeeMatch.departureSource === 'last-client' ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                                                from {employeeMatch.departureSummary}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="h-full min-h-[120px] flex flex-col items-center justify-center border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/30 dark:bg-gray-900/20 p-4 text-center">
                                    <Users className="w-8 h-8 text-gray-200 dark:text-gray-800 mb-2 opacity-20" />
                                    <span className="text-gray-300 dark:text-gray-700 font-bold text-[10px] uppercase tracking-widest">
                                      {anyOtherStar ? 'No match at same time' : 'No Matches'}
                                    </span>
                                    <span className="text-[9px] text-gray-400 dark:text-gray-600 mt-1">
                                      {anyOtherStar ? `Needs to be free at ${anyOtherStar.timeWindow}` : 'Check constraints or day selection'}
                                    </span>
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
  const [sortByTravel, setSortByTravel] = useState(true);
  const { toast } = useToast();

  // Handle back button from grid
  React.useEffect(() => {
    const handleBack = () => setMultiResults(null);
    window.addEventListener('bd-matcher-back', handleBack);
    return () => window.removeEventListener('bd-matcher-back', handleBack);
  }, []);

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
        visits: data.criteria.visits, // Pass the full visits array for history
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
          <Button className="bg-gradient-to-br from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-xl shadow-purple-500/20 font-black gap-3 h-auto rounded-2xl transition-all duration-300 hover:scale-[1.02] hover:-translate-y-0.5 pl-[24px] pr-[24px] pt-[8.5px] pb-[8.5px]">
            <div className="p-1.5 bg-white/20 rounded-xl backdrop-blur-sm">
              <UserCheck className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div className="text-sm font-black tracking-wide">Client Enquiry Matcher</div>
              <div className="text-[10px] font-medium text-purple-200/80 tracking-widest uppercase">Care Intelligence</div>
            </div>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-6xl w-full max-h-[95vh] overflow-hidden flex flex-col p-0 gap-0 border-none shadow-2xl rounded-3xl bg-white dark:bg-gray-950">
          {/* Header */}
          <div className="px-8 py-7 bg-gradient-to-r from-[#f5f7ff] to-[#fafbff] dark:from-gray-900/80 dark:to-gray-900 border-b border-gray-200/50 dark:border-gray-800/50 rounded-t-3xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-indigo-500/5 pointer-events-none" />
            <div className="flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="p-3.5 bg-white dark:bg-gray-800/60 rounded-2xl shadow-sm border border-gray-100/50 dark:border-gray-700/50 backdrop-blur-sm">
                      <UserCheck className="w-6 h-6 text-[#5d51d5]" />
                    </div>
                    <div>
                      <DialogTitle className="text-[28px] font-black tracking-tight text-gray-950 dark:text-gray-50 leading-tight">
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
                  onClick={() => { setShowHistory(!showHistory); setViewingHistoryResult(null); setMultiResults(null); }}
                  className="gap-2 font-semibold text-[11px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/70 hover:border-gray-300 dark:hover:border-gray-600 rounded-xl px-4 py-2.5 h-auto transition-all duration-300 shadow-sm hover:shadow-md"
                >
                  {showHistory ? (
                    <><Search className="w-4 h-4" /> New Search</>
                  ) : (
                    <><History className="w-4 h-4" /> History {historyQuery.data?.length ? `(${historyQuery.data.length})` : ''}</>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div className={`flex-1 min-h-0 bg-[#fbfbfe] dark:bg-gray-950 ${multiResults ? 'flex flex-col overflow-hidden' : 'overflow-y-auto p-8'}`}>
            {multiResults ? (
              <div className="flex flex-col flex-1 min-h-0 gap-4 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-wrap items-center gap-2">
                  {multiResults.visitResults.map((vr, i) => (
                    <Button
                      key={i}
                      variant={activeResultTab === String(i) ? "default" : "outline"}
                      size="sm"
                      onClick={() => setActiveResultTab(String(i))}
                      className={`gap-2 font-bold rounded-xl transition-all px-4 h-9 text-xs ${
                        activeResultTab === String(i)
                          ? "bg-purple-600 text-white shadow-md shadow-purple-500/20"
                          : "bg-white dark:bg-gray-800 border-gray-200 text-gray-600 hover:border-purple-300 hover:bg-purple-50"
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-lg text-[10px] font-black flex items-center justify-center ${
                        activeResultTab === String(i) ? "bg-white/20 text-white" : "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                      }`}>
                        {i + 1}
                      </span>
                      Visit {i + 1}
                    </Button>
                  ))}
                </div>
                <MatchResultsGrid
                  result={{
                    ...multiResults,
                    visitResults: [multiResults.visitResults[parseInt(activeResultTab)]]
                  }}
                  requiredDays={visits[parseInt(activeResultTab)]?.selectedDays || []}
                  className="flex-1 min-h-0"
                  sortByTravel={sortByTravel}
                  onToggleSortByTravel={() => setSortByTravel(v => !v)}
                />
              </div>
            ) : showHistory ? (
              viewingHistoryResult ? (
                <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between pb-5 border-b border-gray-200/60 dark:border-gray-800/60">
                    <div className="flex items-center gap-4">
                      <div className="p-3.5 bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/40 dark:to-indigo-900/40 rounded-2xl shadow-md shadow-purple-500/10">
                        <History className="w-6 h-6 text-purple-700 dark:text-purple-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-xl font-black text-gray-900 dark:text-gray-100 tracking-tight">
                            {viewingHistoryResult.clientName}
                          </h3>
                          <Badge className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black text-[10px] px-3 py-1 uppercase tracking-widest rounded-xl shadow-md shadow-purple-500/20">Archived</Badge>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-8 gap-2 font-bold rounded-xl border-blue-200 hover:border-blue-400 hover:bg-blue-50 transition-all text-xs ml-2"
                            onClick={() => {
                              // Close history view and set up the search fields
                              setClientName(viewingHistoryResult.clientName);
                              setPostcode(viewingHistoryResult.postcode || "");
                              
                              // Check both possible locations for the visits data
                              const visitsToLoad = viewingHistoryResult.criteria?.visits || viewingHistoryResult.visits;
                              
                              if (visitsToLoad && Array.isArray(visitsToLoad)) {
                                setVisits(visitsToLoad);
                                setActiveVisitTab("0");
                              }
                              
                              setShowHistory(false);
                              setViewingHistoryResult(null);
                              
                              toast({
                                title: "Search Populated",
                                description: `Criteria for ${viewingHistoryResult.clientName} has been loaded.`,
                              });
                            }}
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
                            Re-run Search
                          </Button>
                        </div>
                        <p className="text-xs font-bold text-gray-500 mt-1 flex items-center gap-3">
                          <span className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5" />
                            {viewingHistoryResult.postcode || 'No postcode'}
                          </span>
                          {viewingHistoryResult.createdAt && (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-300 animate-pulse" />
                              <span className="flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" />
                                {new Date(viewingHistoryResult.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setViewingHistoryResult(null)} className="gap-2 font-bold rounded-xl border-gray-200 hover:border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all duration-300 px-4 py-2 h-auto">
                      <ArrowLeft className="w-4 h-4" />
                      Back
                    </Button>
                  </div>

                  <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-3xl border border-gray-200/60 dark:border-gray-800/60 shadow-xl shadow-purple-500/5 overflow-hidden p-5">
                    {viewingHistoryResult.visitResults ? (
                      <Tabs defaultValue="0" className="w-full">
                        <TabsList className="bg-gray-100/50 dark:bg-gray-800/50 p-1 h-auto flex-wrap gap-1 mb-4">
                          {viewingHistoryResult.visitResults.map((vr: any, vi: number) => (
                            <TabsTrigger key={vi} value={String(vi)} className="px-4 py-2 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800 data-[state=active]:shadow-sm rounded-lg transition-all">
                              <div className="flex items-center gap-2">
                                <span>{vr.visitLabel || `Visit ${vi + 1}`}</span>
                                <div className="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded font-bold text-[10px] min-w-[20px] text-center">
                                  {vr.matches?.length || 0}
                                </div>
                              </div>
                            </TabsTrigger>
                          ))}
                        </TabsList>
                        {viewingHistoryResult.visitResults.map((vr: any, vi: number) => (
                          <TabsContent key={vi} value={String(vi)} className="mt-0 space-y-4">
                            <div className="flex flex-wrap items-center gap-4 px-3 py-2.5 bg-purple-50/50 dark:bg-purple-900/10 rounded-xl border border-purple-100/50 dark:border-purple-800/30 text-xs font-bold text-gray-500">
                              <span className="flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5 text-purple-600" />
                                CPs: {vr.careProsRequired || 1}
                              </span>
                              <span className="w-px h-4 bg-purple-200/50" />
                              <span className="flex items-center gap-1.5">
                                <Star className="w-3.5 h-3.5 text-blue-600" />
                                Gender: {(vr.genderPreferences || ['any']).map((g: string, gi: number) => `CP${gi + 1}: ${g}`).join(', ')}
                              </span>
                            </div>
                            {(vr.matches?.length || 0) === 0 ? (
                              <div className="p-16 text-center border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-2xl">
                                <XCircle className="w-12 h-12 mx-auto mb-4 text-gray-200" />
                                <h4 className="font-bold text-gray-400">No Matches Found</h4>
                              </div>
                            ) : (
                            <MatchResultsGrid 
                                result={{
                                  ...viewingHistoryResult.results,
                                  visitResults: [vr]
                                }} 
                                requiredDays={viewingHistoryResult.visits?.[vi]?.requiredDays || 
                                             viewingHistoryResult.visits?.[vi]?.selectedDays || 
                                             viewingHistoryResult.criteria?.visits?.[vi]?.selectedDays || 
                                             viewingHistoryResult.criteria?.visits?.[vi]?.requiredDays || 
                                             viewingHistoryResult.requiredDays || []}
                              />
                            )}
                          </TabsContent>
                        ))}
                      </Tabs>
                    ) : viewingHistoryResult.matches ? (
                      (viewingHistoryResult.matches.length === 0) ? (
                        <div className="p-16 text-center border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-2xl">
                          <XCircle className="w-12 h-12 mx-auto mb-4 text-gray-200" />
                          <h4 className="font-bold text-gray-400">No Matches Were Found</h4>
                        </div>
                      ) : (
                        <MatchResultsGrid 
                          result={{
                            clientName: viewingHistoryResult.clientName,
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
                          requiredDays={viewingHistoryResult.criteria?.visits?.[0]?.selectedDays || 
                                       viewingHistoryResult.criteria?.visits?.[0]?.requiredDays || 
                                       viewingHistoryResult.requiredDays || []}
                        />
                      )
                    ) : null}
                  </div>
                </div>
              ) : (
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
                      {historyQuery.data.map((enquiry: any) => {
                        const results = enquiry.results;
                        const isMultiVisit = results?.visitResults && results.visitResults.length > 0;
                        const visitCount = isMultiVisit ? results.totalVisits : 1;
                        return (
                          <div 
                            key={enquiry.id} 
                            className="group relative bg-gradient-to-br from-white to-gray-50 dark:from-gray-900/90 dark:to-gray-950 border border-gray-200 dark:border-gray-800/80 hover:border-purple-400/50 dark:hover:border-purple-600/40 rounded-3xl p-6 transition-all duration-300 cursor-pointer shadow-lg hover:shadow-2xl hover:shadow-purple-500/20 hover:-translate-y-2 overflow-hidden"
                            onClick={() => {
                              const resultData = enquiry.results;
                              if (resultData) {
                                setViewingHistoryResult({ ...resultData, createdAt: enquiry.createdAt, clientName: enquiry.clientName, postcode: enquiry.postcode, criteria: enquiry.criteria, requiredDays: enquiry.requiredDays, genderPreference: enquiry.genderPreference });
                              }
                            }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-br from-purple-600/0 via-purple-500/0 to-indigo-600/0 group-hover:from-purple-500/5 group-hover:via-purple-400/3 group-hover:to-indigo-500/5 transition-all duration-500" />
                            <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-purple-400/15 to-indigo-400/10 rounded-full -mr-20 -mt-20 group-hover:scale-[1.5] transition-transform duration-700" />
                            <div className="relative z-10">
                              <div className="flex items-start justify-between mb-5">
                                <div className="space-y-2 flex-1 pr-4">
                                  <div className="flex items-center gap-3">
                                    <h4 className="font-black text-[17px] text-gray-950 dark:text-gray-50 truncate tracking-tight leading-tight">{enquiry.clientName}</h4>
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
                      <Label htmlFor="postcode" className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-700 dark:text-gray-300">Postcode</Label>
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
                        <Info className="w-4 h-4 flex-shrink-0" />
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

export default function BDMatrix({ data }: BDMatrixProps) {
  const [selectedTimeBlocks, setSelectedTimeBlocks] = useState<Set<string>>(new Set());

  const { data: locationsData, refetch: refetchLocations, isFetching: isFetchingLocations } = useQuery<{ employees: any[]; clients: any[] }>({
    queryKey: ['/api/locations'],
  });
  const locations = locationsData?.employees ?? [];

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
        <CardHeader className="bg-[#f8f9ff] dark:bg-gray-900/50 rounded-t-lg">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-semibold text-[#5d51d5] flex items-center gap-3">
              <Users className="w-6 h-6 text-[#5d51d5]" />
              BD Availability Matrix
            </CardTitle>
            <div className="flex items-center gap-3">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 font-bold rounded-xl border-blue-200 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all">
                    <MapIcon className="w-4 h-4 text-blue-600" />
                    View Care Pro Map
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 overflow-hidden border-0">
                  <DialogHeader className="p-6 bg-[#f8f9ff] dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
                    <DialogTitle className="flex items-center gap-3 text-2xl font-black tracking-tight text-[#5d51d5] dark:text-gray-100">
                      <MapPin className="w-7 h-7 text-[#5d51d5]" />
                      Care Pro Strategic Map
                    </DialogTitle>
                    <DialogDescription className="text-gray-500 font-bold uppercase tracking-widest text-[10px]">
                      Real-time geographic distribution of care professionals
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex-1 relative bg-gray-100 overflow-hidden">
                    <CareProMap 
                      locations={locations} 
                      onRefresh={() => refetchLocations()} 
                      isRefreshing={isFetchingLocations} 
                    />
                  </div>
                </DialogContent>
              </Dialog>
              <ClientEnquiryMatcher />
            </div>
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
                                  <DialogDescription className="text-sm text-gray-600 dark:text-gray-400">
                                    {formatDateForDisplay(date)} ({getDayOfWeek(date)}) &bull; {cell.count} employees available in all {selectedTimeBlocks.size} selected time blocks
                                  </DialogDescription>
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
                                  <DialogDescription className="text-sm text-gray-600 dark:text-gray-400">
                                    {formatDateForDisplay(date)} ({getDayOfWeek(date)}) &bull; {cell.count} employees fully available
                                  </DialogDescription>
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