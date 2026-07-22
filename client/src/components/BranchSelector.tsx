import { useBranch } from '@/contexts/BranchContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, MapPin, Check, Building2 } from 'lucide-react';

interface BranchSelectorProps {
  compact?: boolean;
}

export function BranchSelector({ compact = false }: BranchSelectorProps) {
  let branchContext;
  try {
    branchContext = useBranch();
  } catch {
    return null;
  }

  const { selectedBranchId, setSelectedBranchId, branches, isLoadingBranches } = branchContext;

  if (isLoadingBranches) {
    if (compact) {
      return (
        <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground text-xs animate-pulse">
          <Building2 className="w-3.5 h-3.5 shrink-0" />
          <span>Loading…</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 text-white/40 text-sm">
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        <span>Loading…</span>
      </div>
    );
  }

  if (branches.length === 0) return null;

  const selectedBranch = branches.find(b => b.id === selectedBranchId);

  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground hover:bg-muted transition-colors outline-none"
            data-testid="branch-selector"
            aria-label="Switch branch"
          >
            <div className="h-5 w-5 rounded-md bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
              {(selectedBranch?.displayName ?? 'B').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="text-xs font-medium text-foreground truncate leading-tight">
                {selectedBranch?.displayName ?? 'Select branch…'}
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">Franchise · Live</div>
            </div>
            <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="min-w-[200px] z-50"
        >
          {branches.map((branch) => {
            const isSelected = branch.id === selectedBranchId;
            return (
              <DropdownMenuItem
                key={branch.id}
                onClick={() => setSelectedBranchId(branch.id)}
                className="flex items-center justify-between px-3 py-2 text-sm rounded cursor-pointer"
                data-testid={`branch-option-${branch.id}`}
              >
                <span className={isSelected ? "font-medium" : ""}>
                  {branch.displayName}
                </span>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 ml-3 shrink-0 text-primary" />
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors cursor-pointer outline-none"
          data-testid="branch-selector"
          aria-label="Switch branch"
        >
          <MapPin className="w-3.5 h-3.5 text-white/40 shrink-0" />
          <span className="whitespace-nowrap max-w-[180px] truncate">
            {selectedBranch?.displayName ?? 'Select branch…'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-white/40 shrink-0" />
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
