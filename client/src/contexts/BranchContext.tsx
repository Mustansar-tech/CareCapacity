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
  isReady: boolean; // True when branch is selected and ready to make API calls
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [selectedBranchId, setSelectedBranchIdState] = useState<string | null>(() => {
    // Load from localStorage on init
    return localStorage.getItem('selectedBranchId');
  });

  // Fetch all branches
  const { data: branches = [], isLoading: isLoadingBranches } = useQuery<Branch[]>({
    queryKey: ['/api/branches'],
  });

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
