import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Backend base URL — set VITE_API_BASE_URL when the API lives on a different
// origin (e.g. Hetzner/DigitalOcean) from the frontend (e.g. Vercel).
// Leave unset for local dev where both run on the same port.
const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string) ?? "";

// Global handler called when any authenticated API request returns 401
// (i.e., the server session has expired). The AuthProvider sets this.
let globalUnauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  globalUnauthorizedHandler = fn;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // Fire the global handler on 401 so the app can react immediately
    if (res.status === 401) {
      globalUnauthorizedHandler?.();
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Prepend the configured API base to any path that starts with /api.
// Absolute URLs (e.g. http://...) are returned unchanged.
// Exported so contexts with custom queryFns can use it too.
export function toAbsoluteUrl(path: string): string {
  if (!API_BASE || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${API_BASE}${path}`;
}

// Helper to get branchId from localStorage
function getBranchId(): string | null {
  return localStorage.getItem('selectedBranchId');
}

// Helper to append branchId to URL for GET requests
function appendBranchIdToUrl(url: string): string {
  const branchId = getBranchId();
  if (!branchId || url.includes('/api/branches')) {
    // Don't add branchId to the branches endpoint itself
    return url;
  }
  
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}branchId=${encodeURIComponent(branchId)}`;
}

// Helper to add branchId to request body for POST/PUT requests
function addBranchIdToBody(data?: unknown): unknown {
  const branchId = getBranchId();
  if (!branchId || !data) {
    return data;
  }
  
  // Add branchId to the request body
  if (typeof data === 'object' && data !== null) {
    return { ...data, branchId };
  }
  
  return data;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Add branchId to request based on method, then resolve against API base
  const withBranch = method === 'GET' ? appendBranchIdToUrl(url) : url;
  const finalUrl = toAbsoluteUrl(withBranch);
  const finalData = method !== 'GET' && method !== 'DELETE' ? addBranchIdToBody(data) : data;
  
  const res = await fetch(finalUrl, {
    method,
    headers: finalData ? { "Content-Type": "application/json" } : {},
    body: finalData ? JSON.stringify(finalData) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const finalUrl = toAbsoluteUrl(appendBranchIdToUrl(url));
    
    const res = await fetch(finalUrl, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
