import { useBranch } from '@/contexts/BranchContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Building2, ChevronDown } from 'lucide-react';

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
      <div className="flex items-center gap-2 px-4 border-l border-r border-white/20 h-full text-white/70 text-sm">
        <Building2 className="w-4 h-4 flex-shrink-0 text-white/50" />
        <span>Loading branches...</span>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 border-l border-r border-white/20 h-full text-white/70 text-sm">
        <Building2 className="w-4 h-4 flex-shrink-0 text-white/50" />
        <span>No branches</span>
      </div>
    );
  }

  const selectedBranch = branches.find(b => b.id === selectedBranchId);

  return (
    <div
      className="flex items-center gap-2 border-l border-r border-white/20 px-4 h-full"
      data-testid="branch-selector"
    >
      <Building2 className="w-4 h-4 text-white/70 flex-shrink-0" />

      <Select value={selectedBranchId || undefined} onValueChange={setSelectedBranchId}>
        <SelectTrigger
          className="border-0 bg-transparent text-sm font-semibold text-white focus:ring-0 px-0 h-auto shadow-none [&>svg]:hidden gap-1.5 min-w-0"
          data-testid="select-branch-trigger"
          aria-label="Select branch"
        >
          <span className="truncate max-w-[200px]">
            {selectedBranch?.displayName ?? 'Select branch…'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-white/60 flex-shrink-0" />
        </SelectTrigger>

        <SelectContent
          className="min-w-[220px] p-1.5 shadow-2xl rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900"
          sideOffset={8}
        >
          {branches.map((branch) => (
            <SelectItem
              key={branch.id}
              value={branch.id}
              className="rounded-lg py-2 pl-8 pr-3 text-sm cursor-pointer text-gray-700 dark:text-gray-200 focus:bg-blue-50 dark:focus:bg-blue-900/30 focus:text-blue-700 dark:focus:text-blue-300 data-[state=checked]:font-semibold data-[state=checked]:text-blue-700 dark:data-[state=checked]:text-blue-300"
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
