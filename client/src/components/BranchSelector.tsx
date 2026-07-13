import { useBranch } from '@/contexts/BranchContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, MapPin, Check } from 'lucide-react';

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
      <div className="flex items-center gap-1.5 text-sm" style={{ color: '#64748B' }}>
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        <span>Loading…</span>
      </div>
    );
  }

  if (branches.length === 0) return null;

  const selectedBranch = branches.find(b => b.id === selectedBranchId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 text-sm transition-colors cursor-pointer outline-none"
          style={{ color: '#334155', background: 'transparent', border: 'none', fontWeight: 600, fontSize: 12 }}
          data-testid="branch-selector"
          aria-label="Switch branch"
        >
          <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: '#64748B' }} />
          <span className="whitespace-nowrap max-w-[160px] truncate">
            {selectedBranch?.displayName ?? 'Select branch…'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: '#94A3B8' }} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={10}
        className="min-w-[200px] bg-white border border-slate-200 shadow-sm rounded-md p-1 z-50"
      >
        {branches.map((branch) => {
          const isSelected = branch.id === selectedBranchId;
          return (
            <DropdownMenuItem
              key={branch.id}
              onClick={() => setSelectedBranchId(branch.id)}
              className="flex items-center justify-between px-3 py-2 text-sm rounded cursor-pointer text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:text-slate-900"
              data-testid={`branch-option-${branch.id}`}
            >
              <span className={isSelected ? "font-medium text-slate-900" : ""}>
                {branch.displayName}
              </span>
              {isSelected && (
                <Check className="w-3.5 h-3.5 text-slate-500 ml-3 shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
