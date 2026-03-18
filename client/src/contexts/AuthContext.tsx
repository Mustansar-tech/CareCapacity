import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export type UserRole = 'admin' | 'scheduler' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  branches: Array<{ id: string; name: string; displayName: string }>;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (role: UserRole) => boolean;
  hasRoleAtLeast: (role: UserRole) => boolean;
  canEdit: boolean;
  canGenerate: boolean;
  isAdmin: boolean;
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 3,
  scheduler: 2,
  viewer: 1,
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const { data: user, isLoading, error } = useQuery<AuthUser | null>({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.status === 401) return null;
        if (!res.ok) throw new Error('Failed to fetch auth state');
        return res.json();
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      try {
        const res = await apiRequest('POST', '/api/auth/login', { email, password });
        return res.json();
      } catch (err: any) {
        // Extract the error message from the thrown error
        const errorMsg = err.message || 'Login failed';
        // Parse the error if it's in format "401: {json}"
        if (errorMsg.includes(':')) {
          try {
            const jsonStr = errorMsg.split(': ')[1];
            const parsed = JSON.parse(jsonStr);
            throw new Error(parsed.message || 'Login failed');
          } catch {
            throw new Error(errorMsg);
          }
        }
        throw new Error(errorMsg);
      }
    },
    onSuccess: (data) => {
      // Immediately set the user data so navigation works without waiting for a refetch
      qc.setQueryData(['/api/auth/me'], data);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      try {
        await apiRequest('POST', '/api/auth/logout', {});
      } catch (err: any) {
        // Ignore errors on logout (e.g., already logged out)
        console.debug('Logout error:', err.message);
      }
    },
    onSuccess: () => {
      qc.setQueryData(['/api/auth/me'], null);
      qc.clear();
    },
  });

  const login = useCallback(async (email: string, password: string) => {
    await loginMutation.mutateAsync({ email, password });
  }, [loginMutation]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const hasRole = useCallback((role: UserRole) => {
    return user?.role === role;
  }, [user]);

  const hasRoleAtLeast = useCallback((role: UserRole) => {
    if (!user) return false;
    return ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY[role];
  }, [user]);

  const resolvedUser = error ? null : (user ?? null);
  const isAuthenticated = !!resolvedUser;
  const canEdit = hasRoleAtLeast('scheduler');
  const canGenerate = hasRoleAtLeast('scheduler');
  const isAdmin = hasRole('admin');

  return (
    <AuthContext.Provider value={{
      user: resolvedUser,
      isLoading,
      isAuthenticated,
      login,
      logout,
      hasRole,
      hasRoleAtLeast,
      canEdit,
      canGenerate,
      isAdmin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
