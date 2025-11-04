import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Helper to get branchId from localStorage
function getBranchId(): string | null {
  return localStorage.getItem('selectedBranchId');
}

// Helper to append branchId to URL for GET requests
function appendBranchIdToUrl(url: string, queryKey?: unknown[]): string {
  const branchId = getBranchId();
  
  // Don't add branchId to the branches endpoint itself
  if (!branchId || url.includes('/api/branches')) {
    return url;
  }

  // Check if branchId is already in the query key parameters
  if (queryKey && queryKey.length > 1) {
    const params = queryKey[1];
    if (params && typeof params === 'object' && 'branchId' in params) {
      // branchId is already in query params, don't append again
      return url;
    }
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
  // Add branchId to request based on method
  const finalUrl = method === 'GET' ? appendBranchIdToUrl(url, undefined) : url;
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
    // Extract URL from queryKey - only use the first string part as the URL
    // Any subsequent parts (like branchId) are query parameters, not part of the URL path
    const url = typeof queryKey[0] === 'string' ? queryKey[0] : '';
    const finalUrl = appendBranchIdToUrl(url, queryKey);

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