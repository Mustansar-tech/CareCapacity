import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

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
    setSelectedBranchIdState(branchId);
    localStorage.setItem('selectedBranchId', branchId);
    // Invalidate all queries to force refetch with new branch
    window.location.reload();
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
