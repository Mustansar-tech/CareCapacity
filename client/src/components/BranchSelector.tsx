import { useBranch } from '@/contexts/BranchContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
      <div className="flex items-center gap-2 px-3 py-1.5 rounded text-white/70 text-sm min-w-0">
        <Building2 className="w-4 h-4 flex-shrink-0 text-white/60" />
        <span className="truncate">Loading branches...</span>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-white/70 text-sm min-w-0">
        <Building2 className="w-4 h-4 flex-shrink-0 text-white/60" />
        <span className="truncate">No branches available</span>
      </div>
    );
  }

  const selectedBranch = branches.find(b => b.id === selectedBranchId);

  return (
    <div className="flex items-center gap-2 border-l border-r border-white/20 px-4 h-full" data-testid="branch-selector">
      <Building2 className="w-4 h-4 text-white/80 flex-shrink-0" />
      <Select
        value={selectedBranchId || undefined}
        onValueChange={setSelectedBranchId}
      >
        <SelectTrigger
          className="border-0 bg-transparent text-sm font-medium text-white focus:ring-0 px-0 h-auto gap-1 shadow-none [&>svg]:hidden"
          data-testid="select-branch-trigger"
          aria-label="Select branch"
        >
          <span className="text-white font-semibold truncate max-w-[220px]">
            {selectedBranch ? `Home Instead - UK - ${selectedBranch.displayName}` : 'Select branch...'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-white/70 flex-shrink-0" />
        </SelectTrigger>
        <SelectContent className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 shadow-xl">
          {branches.map((branch) => (
            <SelectItem
              key={branch.id}
              value={branch.id}
              className="cursor-pointer"
              data-testid={`branch-option-${branch.id}`}
            >
              <div className="flex flex-col">
                <span className="font-medium">{branch.displayName}</span>
                {branch.region && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">{branch.region}</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
