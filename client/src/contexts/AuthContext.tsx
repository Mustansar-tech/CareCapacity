import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export type UserRole = 'admin' | 'manager' | 'supervisor' | 'viewer';

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
  admin: 4,
  manager: 3,
  supervisor: 2,
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
      const res = await apiRequest('POST', '/api/auth/login', { email, password });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Login failed');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/auth/me'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', '/api/auth/logout', {});
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
  const canEdit = hasRoleAtLeast('supervisor');
  const canGenerate = hasRoleAtLeast('supervisor');
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
