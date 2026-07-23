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
  iconOnly?: boolean; // collapsed sidebar: just the avatar icon + dropdown
}

export function BranchSelector({ compact = false, iconOnly = false }: BranchSelectorProps) {
  let branchContext;
  try {
    branchContext = useBranch();
  } catch {
    return null;
  }

  const { selectedBranchId, setSelectedBranchId, branches, isLoadingBranches } = branchContext;

  if (isLoadingBranches) {
    if (iconOnly) {
      return (
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-white/20 animate-pulse mx-auto" />
      );
    }
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

  function branchInitials(name: string): string {
    const STOP = new Set(['and', 'the', 'of', 'a', '&']);
    const words = name.trim().split(/\s+/).filter(w => !STOP.has(w.toLowerCase()));
    if (words.length === 0) return name.slice(0, 2).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return words.map(w => w[0]).join('').toUpperCase();
  }

  const abbrev = branchInitials(selectedBranch?.displayName ?? 'B');

  // ── Collapsed icon-only variant ────────────────────────────────────────────
  if (iconOnly) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex flex-col items-center justify-center w-full py-1 gap-0.5 outline-none group"
            title={selectedBranch?.displayName ?? 'Switch branch'}
            aria-label="Switch branch"
            data-testid="branch-selector"
          >
            <div className="h-7 w-7 rounded-md bg-white/20 hover:bg-white/30 text-white text-[11px] font-bold flex items-center justify-center transition-colors group-hover:ring-2 ring-white/30">
              {abbrev}
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" sideOffset={8} align="start" className="min-w-[200px] z-50">
          <div className="px-3 py-1.5 mb-1 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Switch Branch</p>
          </div>
          {branches.map((branch) => {
            const isSelected = branch.id === selectedBranchId;
            return (
              <DropdownMenuItem
                key={branch.id}
                onClick={() => setSelectedBranchId(branch.id)}
                className="flex items-center justify-between px-3 py-2 text-sm rounded cursor-pointer"
                data-testid={`branch-option-${branch.id}`}
              >
                <span className={isSelected ? "font-medium" : ""}>{branch.displayName}</span>
                {isSelected && <Check className="w-3.5 h-3.5 ml-3 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // ── Compact sidebar variant ────────────────────────────────────────────────
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
              {abbrev}
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
        <DropdownMenuContent align="start" sideOffset={6} className="min-w-[200px] z-50">
          {branches.map((branch) => {
            const isSelected = branch.id === selectedBranchId;
            return (
              <DropdownMenuItem
                key={branch.id}
                onClick={() => setSelectedBranchId(branch.id)}
                className="flex items-center justify-between px-3 py-2 text-sm rounded cursor-pointer"
                data-testid={`branch-option-${branch.id}`}
              >
                <span className={isSelected ? "font-medium" : ""}>{branch.displayName}</span>
                {isSelected && <Check className="w-3.5 h-3.5 ml-3 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // ── Default inline variant ─────────────────────────────────────────────────
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
              <span className={isSelected ? "font-medium text-slate-900" : ""}>{branch.displayName}</span>
              {isSelected && <Check className="w-3.5 h-3.5 text-slate-500 ml-3 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
