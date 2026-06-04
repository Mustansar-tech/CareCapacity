export interface StatusConfig {
  bgClass: string;
  textClass: string;
  borderClass: string;
  darkBgClass: string;
  label: string;
  description: string;
  priority: number;
}

export const HR_STATUS_CONFIG: Record<string, StatusConfig> = {
  'Available': {
    bgClass: 'bg-green-700', textClass: 'text-white', borderClass: 'border-green-800',
    darkBgClass: 'dark:bg-green-800',
    label: 'Available', description: 'Fully available for work', priority: 10,
  },
  'Ad-hoc': {
    bgClass: 'bg-green-500', textClass: 'text-white', borderClass: 'border-green-600',
    darkBgClass: 'dark:bg-green-600',
    label: 'Ad-hoc', description: 'Available based on existing scheduled visits', priority: 9,
  },
  'Partial Availability': {
    bgClass: 'bg-yellow-600', textClass: 'text-white', borderClass: 'border-yellow-700',
    darkBgClass: 'dark:bg-yellow-700',
    label: 'Partial', description: 'Has some blockers but some free windows remain', priority: 8,
  },
  'Sick': {
    bgClass: 'bg-gray-900', textClass: 'text-white', borderClass: 'border-black',
    darkBgClass: 'dark:bg-black',
    label: 'Sick', description: 'Sickness absence', priority: 4,
  },
  'Partial Sick': {
    bgClass: 'bg-gray-600', textClass: 'text-white', borderClass: 'border-gray-700',
    darkBgClass: 'dark:bg-gray-700',
    label: 'Partial Sick', description: 'Sickness affecting part of the day', priority: 4,
  },
  'Long-term Sick': {
    bgClass: 'bg-orange-800', textClass: 'text-white', borderClass: 'border-orange-900',
    darkBgClass: 'dark:bg-orange-900',
    label: 'Long-term Sick', description: 'Extended sickness absence (manually recorded)', priority: 3,
  },
  'Holiday': {
    bgClass: 'bg-sky-700', textClass: 'text-white', borderClass: 'border-sky-800',
    darkBgClass: 'dark:bg-sky-800',
    label: 'Holiday', description: 'Annual leave', priority: 5,
  },
  'Partial Holiday': {
    bgClass: 'bg-sky-500', textClass: 'text-white', borderClass: 'border-sky-600',
    darkBgClass: 'dark:bg-sky-600',
    label: 'Partial Holiday', description: 'Partial annual leave', priority: 5,
  },
  'Maternity/Paternity': {
    bgClass: 'bg-purple-700', textClass: 'text-white', borderClass: 'border-purple-800',
    darkBgClass: 'dark:bg-purple-800',
    label: 'Mat/Pat', description: 'Maternity or paternity leave', priority: 2,
  },
  'Partial Maternity/Paternity': {
    bgClass: 'bg-purple-500', textClass: 'text-white', borderClass: 'border-purple-600',
    darkBgClass: 'dark:bg-purple-600',
    label: 'Part Mat/Pat', description: 'Partial maternity or paternity leave', priority: 2,
  },
  'AWOL': {
    bgClass: 'bg-red-800', textClass: 'text-white', borderClass: 'border-red-900',
    darkBgClass: 'dark:bg-red-900',
    label: 'AWOL', description: 'Absent without leave', priority: 1,
  },
  'Other Unavailable': {
    bgClass: 'bg-slate-600', textClass: 'text-white', borderClass: 'border-slate-700',
    darkBgClass: 'dark:bg-slate-700',
    label: 'Unavailable', description: 'Unavailable — reason unspecified', priority: 7,
  },
  'Compassionate Leave': {
    bgClass: 'bg-pink-700', textClass: 'text-white', borderClass: 'border-pink-800',
    darkBgClass: 'dark:bg-pink-800',
    label: 'Compassionate', description: 'Compassionate leave', priority: 3,
  },
  'Partial Compassionate Leave': {
    bgClass: 'bg-pink-500', textClass: 'text-white', borderClass: 'border-pink-600',
    darkBgClass: 'dark:bg-pink-600',
    label: 'Part Compassionate', description: 'Partial compassionate leave', priority: 3,
  },
  'Jury Service': {
    bgClass: 'bg-teal-700', textClass: 'text-white', borderClass: 'border-teal-800',
    darkBgClass: 'dark:bg-teal-800',
    label: 'Jury Service', description: 'Jury service', priority: 3,
  },
  'Educational Commitment': {
    bgClass: 'bg-indigo-600', textClass: 'text-white', borderClass: 'border-indigo-700',
    darkBgClass: 'dark:bg-indigo-700',
    label: 'Education', description: 'Educational commitment or training', priority: 6,
  },
  'Pre-Agreed Appointment': {
    bgClass: 'bg-orange-600', textClass: 'text-white', borderClass: 'border-orange-700',
    darkBgClass: 'dark:bg-orange-700',
    label: 'Appointment', description: 'Pre-agreed appointment during work hours', priority: 7,
  },
};

const FALLBACK_CONFIG: StatusConfig = {
  bgClass: 'bg-slate-300', textClass: 'text-slate-700', borderClass: 'border-slate-400',
  darkBgClass: 'dark:bg-slate-600',
  label: 'Unknown', description: 'Status not recognised', priority: 0,
};

export function getStatusConfig(status: string): StatusConfig {
  return HR_STATUS_CONFIG[status] ?? FALLBACK_CONFIG;
}

export const MANUAL_STATUSES = [
  'Available',
  'Sick',
  'Long-term Sick',
  'Holiday',
  'Maternity/Paternity',
  'AWOL',
  'Other Unavailable',
  'Compassionate Leave',
  'Jury Service',
  'Educational Commitment',
  'Pre-Agreed Appointment',
  'Ad-hoc',
  'Partial Availability',
];

export const LONG_TERM_STATUSES = new Set(['Maternity/Paternity', 'Long-term Sick', 'Partial Maternity/Paternity']);

export function normalizeEmployeeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|dr|prof)\b\.?\s*/gi, '')
    .trim()
    .split(/\s+/)
    .sort()
    .join(' ');
}

export function isAbsence(status: string): boolean {
  const absenceStatuses = new Set([
    'Sick', 'Partial Sick', 'Long-term Sick', 'AWOL', 'Other Unavailable',
    'Maternity/Paternity', 'Partial Maternity/Paternity',
    'Compassionate Leave', 'Partial Compassionate Leave', 'Jury Service',
  ]);
  return absenceStatuses.has(status);
}

export function isLeave(status: string): boolean {
  const leaveStatuses = new Set([
    'Holiday', 'Partial Holiday', 'Maternity/Paternity', 'Partial Maternity/Paternity',
    'Compassionate Leave', 'Partial Compassionate Leave', 'Jury Service', 'Educational Commitment',
    'Long-term Sick',
  ]);
  return leaveStatuses.has(status);
}

export function formatMonthYear(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export function getDaysInMonth(year: number, month: number): string[] {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, i) => {
    const d = i + 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });
}

export function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export function isToday(dateStr: string): boolean {
  const today = new Date();
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return dateStr === t;
}

export function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${d.getUTCDate()}`;
}

export function dayWeekday(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}
