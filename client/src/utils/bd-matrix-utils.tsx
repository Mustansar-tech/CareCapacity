import { Badge } from "@/components/ui/badge";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, XCircle, AlertTriangle, CheckCircle, Users } from "lucide-react";
import type { ProcessingResult } from "@shared/schema";

export const COMPANY_TIME_BLOCKS = [
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

export const DAY_OPTIONS = [
  { value: 'mon', label: 'Monday' },
  { value: 'tue', label: 'Tuesday' },
  { value: 'wed', label: 'Wednesday' },
  { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' },
  { value: 'sat', label: 'Saturday' },
  { value: 'sun', label: 'Sunday' },
];

export interface TimeBlock {
  start: string;
  end: string;
  label: string;
}

export interface EmployeeAvailabilityInfo {
  name: string;
  gender?: string;
  transportMode?: string;
  freeWindows: string;
  scheduledHours?: number;
  cancelledVisits?: string;
}

export interface BDMatrixCell {
  count: number;
  employees: EmployeeAvailabilityInfo[];
  colorClass: string;
}

export interface BDMatrixProps {
  data: ProcessingResult | null;
  weekStartDate?: string;
}

export interface MatchedSlot {
  day: string;
  dayLabel: string;
  availableWindow: string;
  matchType: 'exact' | 'adjusted-time' | 'alternative-day';
  cancelledVisits?: string;
  departureSummary?: string;
  departureSource?: 'home' | 'last-client';
  travelMinutes?: number;
  nextVisit?: { startTime: string; endTime: string } | null;
  forwardTravelWarning?: boolean;
  forwardTravelMinutes?: number;
}

export interface MatchedEmployee {
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

export interface MatchResult {
  matches: MatchedEmployee[];
  totalEmployeesEvaluated: number;
}

export interface SavedVisitResult {
  visitLabel?: string;
  visitIndex?: number;
  careProsRequired?: number;
  genderPreferences?: string[];
  matches?: MatchedEmployee[];
  totalEmployeesEvaluated?: number;
}

export interface HistoryViewResult {
  clientName: string;
  postcode?: string | null;
  genderPreference?: string | null;
  requiredDays?: string[];
  createdAt?: Date | null;
  criteria?: { visits?: Array<{ selectedDays?: string[]; requiredDays?: string[]; preferredTimeWindow?: { start: string; end: string } }> } | null;
  visits?: Array<{ requiredDays?: string[]; selectedDays?: string[] }> | null;
  visitResults?: SavedVisitResult[];
  totalVisits?: number;
  matches?: MatchedEmployee[];
  results?: (MultiVisitResult & { totalEmployeesEvaluated?: number }) | null;
}

export interface VisitFormData {
  careProsRequired: number;
  genderPreferences: string[];
  selectedDays: string[];
  timeStart: string;
  timeEnd: string;
}

export interface MultiVisitResult {
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

export function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isFullyAvailableInTimeBlock(freeWindows: string, timeBlock: TimeBlock): boolean {
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

export function getColorClass(count: number): string {
  if (count <= 1) return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800/50';
  if (count <= 3) return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800/50';
  return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800/50';
}

export function getStatusIcon(count: number) {
  if (count === 0) return <XCircle className="w-4 h-4" />;
  if (count === 1) return <AlertTriangle className="w-4 h-4" />;
  if (count <= 3) return <CheckCircle className="w-4 h-4" />;
  return <Users className="w-4 h-4" />;
}

export function roundContractedHours(hours: number): number {
  const decimal = hours % 1;
  if (decimal === 0.5) return hours;
  return Math.round(hours);
}

export function normalizeTransportMode(raw?: string): 'car' | 'walking' | 'public' {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('walk') || s.includes('foot') || s.includes('pedestrian')) return 'walking';
  if (s.includes('public') || s.includes('bus') || s.includes('train') || s.includes('transit')) return 'public';
  return 'car';
}

export function normalizeGender(raw: string | undefined | null): 'female' | 'male' | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'female' || v === 'f' || v === 'miss' || v === 'ms' || v === 'mrs') return 'female';
  if (v === 'male' || v === 'm' || v === 'mr') return 'male';
  return null;
}

export function formatDateForDisplay(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00.000Z');
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit' });
  } catch (error) {
    return dateStr;
  }
}

export function getDayOfWeek(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00.000Z');
    return date.toLocaleDateString('en-GB', { weekday: 'long' });
  } catch (error) {
    return 'Unknown';
  }
}

export function getMatchTypeBadge(matchType: string) {
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

export function createEmptyVisit(): VisitFormData {
  return {
    careProsRequired: 1,
    genderPreferences: ['any'],
    selectedDays: [],
    timeStart: '09:00',
    timeEnd: '17:00',
  };
}
