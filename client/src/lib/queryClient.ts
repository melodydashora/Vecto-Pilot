import { QueryClient } from "@tanstack/react-query";
import { STORAGE_KEYS } from "@/constants/storageKeys";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Get base URL for API calls - supports both development and Replit environments
const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    // In browser environment
    return window.location.origin;
  }
  // Fallback for server-side
  return '';
};

// Keep app credentials on this origin even when a caller supplies an absolute URL.
function requestAuthHeaders(fullUrl: string): Record<string, string> {
  if (typeof window === 'undefined' || new URL(fullUrl, window.location.origin).origin !== window.location.origin) return {};
  const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getBaseUrl();
  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  
  const res = await fetch(fullUrl, {
    method,
    headers: { ...(data !== undefined ? { "Content-Type": "application/json" } : {}), ...requestAuthHeaders(fullUrl) },
    body: data !== undefined ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

// Single app client. Provider consumers use useQueryClient so injected/test clients work too.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});
