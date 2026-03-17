import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { clientLogger } from '@/lib/logger';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

interface Branch {
  id: string;
  name: string;
  displayName: string;
  region: string;
}

interface BranchContextType {
  selectedBranchId: string | null;
  setSelectedBranchId: (branchId: string) => void;
  branches: Branch[];
  isLoadingBranches: boolean;
  selectedBranch: Branch | null;
  isReady: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [selectedBranchId, setSelectedBranchIdState] = useState<string | null>(() => {
    return localStorage.getItem('selectedBranchId');
  });

  // Fetch auth user to filter branches (may be null before login)
  const { data: authUser } = useQuery<{ branches: Branch[] } | null>({
    queryKey: ['/api/auth/me'],
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.status === 401) return null;
        if (!res.ok) return null;
        return res.json();
      } catch { return null; }
    },
  });

  // Fetch all branches as a fallback / source of truth
  const { data: allBranches = [], isLoading: isLoadingBranches } = useQuery<Branch[]>({
    queryKey: ['/api/branches'],
  });

  // Use user's assigned branches if available, otherwise all branches
  const branches: Branch[] = authUser?.branches?.length
    ? allBranches.filter(b => authUser.branches.some(ub => ub.id === b.id))
    : allBranches;

  // Auto-select first branch if none selected and branches are loaded
  useEffect(() => {
    if (!selectedBranchId && branches.length > 0) {
      const firstBranchId = branches[0].id;
      setSelectedBranchIdState(firstBranchId);
      localStorage.setItem('selectedBranchId', firstBranchId);
    }
  }, [selectedBranchId, branches]);

  const setSelectedBranchId = (branchId: string) => {
    clientLogger.log(`🔄 Branch changed from ${selectedBranchId} to ${branchId} - invalidating all cached data`);
    
    setSelectedBranchIdState(branchId);
    localStorage.setItem('selectedBranchId', branchId);
    
    // Invalidate ALL queries except the branches list to force fresh data from new branch
    // This is more elegant than window.location.reload() and preserves UI state
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey[0] as string;
        return queryKey !== '/api/branches'; // Keep branches cached, invalidate everything else
      }
    });
    
    clientLogger.log(`✅ All queries invalidated - components will now refetch data for branch: ${branchId}`);
  };

  const selectedBranch = branches.find(b => b.id === selectedBranchId) || null;
  const isReady = !isLoadingBranches && selectedBranchId !== null;

  return (
    <BranchContext.Provider
      value={{
        selectedBranchId,
        setSelectedBranchId,
        branches,
        isLoadingBranches,
        selectedBranch,
        isReady,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const context = useContext(BranchContext);
  if (context === undefined) {
    throw new Error('useBranch must be used within a BranchProvider');
  }
  return context;
}
