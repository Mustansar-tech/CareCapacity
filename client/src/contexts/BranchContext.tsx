import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { clientLogger } from '@/lib/logger';
import { useQuery } from '@tanstack/react-query';
import { queryClient, toAbsoluteUrl } from '@/lib/queryClient';

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

  // Track previous user ID to detect user switches
  const prevUserIdRef = useRef<string | null>(null);

  // Fetch auth user to filter branches (may be null before login)
  const { data: authUser } = useQuery<{ id: string; branches: Branch[] } | null>({
    queryKey: ['/api/auth/me'],
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        const res = await fetch(toAbsoluteUrl('/api/auth/me'), { credentials: 'include' });
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

  // Reset branch selection when a different user logs in, or when the saved
  // branch is not in the new user's allowed branch list
  useEffect(() => {
    if (!authUser || branches.length === 0) return;

    const currentUserId = authUser.id;
    const userSwitched = prevUserIdRef.current !== null && prevUserIdRef.current !== currentUserId;
    const branchNotAllowed = selectedBranchId && !branches.some(b => b.id === selectedBranchId);

    if (userSwitched || branchNotAllowed || !selectedBranchId) {
      const firstBranchId = branches[0].id;
      setSelectedBranchIdState(firstBranchId);
      localStorage.setItem('selectedBranchId', firstBranchId);
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0] as string;
          return key !== '/api/branches' && key !== '/api/auth/me';
        },
      });
    }

    prevUserIdRef.current = currentUserId;
  }, [authUser?.id, branches]);

  const setSelectedBranchId = (branchId: string) => {
    clientLogger.log(`🔄 Branch changed from ${selectedBranchId} to ${branchId} - invalidating all cached data`);
    
    setSelectedBranchIdState(branchId);
    localStorage.setItem('selectedBranchId', branchId);
    
    // Invalidate all data queries except the branch list and current auth session.
    // Invalidating /api/auth/me would trigger a cross-origin cookie re-check that
    // can return 401 in split-origin deployments, logging the user out inadvertently.
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey[0] as string;
        return queryKey !== '/api/branches' && queryKey !== '/api/auth/me';
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
