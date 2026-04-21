import { Car, PersonStanding } from "lucide-react";
import { normalizeTransportMode } from "@/utils/bd-matrix-utils";

export function TransportModeIcon({ transportMode, size = 'md' }: { transportMode?: string; size?: 'sm' | 'md' }) {
  if (!transportMode || transportMode.trim() === '') return null;

  const iconCls = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  if (transportMode.toLowerCase().includes('recruiter')) {
    return (
      <div title="Recruiter" aria-label="Transport mode: recruiter" className="inline-block">
        <Car className={`${iconCls} text-blue-600 dark:text-blue-400`} />
      </div>
    );
  }

  const normalized = normalizeTransportMode(transportMode);

  if (normalized === 'car') {
    return (
      <div title="Car" aria-label="Transport mode: car" className="inline-block">
        <Car className={`${iconCls} text-blue-600 dark:text-blue-400`} />
      </div>
    );
  } else if (normalized === 'walking') {
    return (
      <div title="Walking" aria-label="Transport mode: walking" className="inline-block">
        <PersonStanding className={`${iconCls} text-green-600 dark:text-green-400`} />
      </div>
    );
  }

  return null;
}
