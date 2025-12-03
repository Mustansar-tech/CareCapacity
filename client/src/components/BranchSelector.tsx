import { useBranch } from '@/contexts/BranchContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2 } from 'lucide-react';

export function BranchSelector() {
  let branchContext;
  try {
    branchContext = useBranch();
  } catch (error) {
    // Context not available yet
    return null;
  }
  
  const { selectedBranchId, setSelectedBranchId, branches, isLoadingBranches, selectedBranch } = branchContext;

  // Sort branches alphabetically by display name
  const sortedBranches = [...branches].sort((a, b) => 
    a.displayName.localeCompare(b.displayName)
  );

  if (isLoadingBranches) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-white/10 dark:bg-black/10 backdrop-blur-xl rounded-xl border border-white/20 dark:border-white/10 min-w-64">
        <Building2 className="w-5 h-5 text-gray-400" />
        <span className="text-sm text-gray-400">Loading branches...</span>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-white/10 dark:bg-black/10 backdrop-blur-xl rounded-xl border border-white/20 dark:border-white/10 min-w-64">
        <Building2 className="w-5 h-5 text-gray-400" />
        <span className="text-sm text-gray-400">No branches available</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white/10 dark:bg-black/10 backdrop-blur-xl rounded-xl border border-white/20 dark:border-white/10 min-w-64" data-testid="branch-selector">
      <Building2 className="w-5 h-5 text-blue-500 flex-shrink-0" />
      <Select
        value={selectedBranchId || undefined}
        onValueChange={setSelectedBranchId}
      >
        <SelectTrigger className="border-0 bg-transparent text-sm font-medium focus:ring-0 px-0 h-auto" data-testid="select-branch-trigger">
          <SelectValue placeholder="Select branch..." />
        </SelectTrigger>
        <SelectContent className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border-white/20 dark:border-white/10 max-h-[500px] overflow-y-auto">
          {sortedBranches.map((branch) => (
            <SelectItem
              key={branch.id}
              value={branch.id}
              className="cursor-pointer py-3"
              data-testid={`branch-option-${branch.id}`}
            >
              <div className="flex flex-col">
                <span className="font-medium">{branch.displayName}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{branch.region}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
