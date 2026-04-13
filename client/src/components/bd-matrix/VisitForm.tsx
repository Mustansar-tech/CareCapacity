import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Minus, Plus } from "lucide-react";
import { DAY_OPTIONS, type VisitFormData } from "@/utils/bd-matrix-utils";

export function VisitForm({ visit, onChange }: { visit: VisitFormData; onChange: (v: VisitFormData) => void }) {
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
