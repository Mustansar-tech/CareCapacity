import { useBranch } from '@/contexts/BranchContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { ChevronDown, MapPin } from 'lucide-react';

export function BranchSelector() {
  let branchContext;
  try {
    branchContext = useBranch();
  } catch {
    return null;
  }

  const { selectedBranchId, setSelectedBranchId, branches, isLoadingBranches } = branchContext;

  if (isLoadingBranches) {
    return (
      <div className="flex items-center gap-1.5 text-white/40 text-[12.5px]">
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        <span>Loading…</span>
      </div>
    );
  }

  if (branches.length === 0) return null;

  const selectedBranch = branches.find(b => b.id === selectedBranchId);

  return (
    <div className="flex items-center" data-testid="branch-selector">
      <MapPin className="w-3.5 h-3.5 text-white/35 shrink-0 mr-1.5" />

      <Select value={selectedBranchId || undefined} onValueChange={setSelectedBranchId}>
        <SelectTrigger
          className="border-0 bg-transparent text-[12.5px] font-normal text-white/70 hover:text-white/90 focus:ring-0 px-0 h-auto shadow-none [&>svg]:hidden gap-1 min-w-0 outline-none transition-colors"
          data-testid="select-branch-trigger"
          aria-label="Select branch"
        >
          <span className="truncate max-w-[160px]">
            {selectedBranch?.displayName ?? 'Select branch…'}
          </span>
          <ChevronDown className="w-3 h-3 text-white/35 flex-shrink-0 ml-0.5" />
        </SelectTrigger>

        <SelectContent
          className="min-w-[200px] p-1.5 shadow-xl rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900"
          sideOffset={10}
        >
          {branches.map((branch) => (
            <SelectItem
              key={branch.id}
              value={branch.id}
              className="rounded-lg py-2 pl-8 pr-3 text-sm cursor-pointer text-gray-700 dark:text-gray-200 focus:bg-emerald-50 dark:focus:bg-emerald-900/30 focus:text-emerald-800 dark:focus:text-emerald-300 data-[state=checked]:font-semibold data-[state=checked]:text-emerald-800 dark:data-[state=checked]:text-emerald-300"
              data-testid={`branch-option-${branch.id}`}
            >
              {branch.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
