import { supabase } from "./supabase";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const SESSION_TIMEOUT_MS = 4000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

async function getAccessTokenWithTimeout(): Promise<string | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), SESSION_TIMEOUT_MS);
  });

  try {
    const token = await Promise.race([
      supabase.auth
        .getSession()
        .then(({ data: { session } }) => session?.access_token ?? null)
        .catch(() => null),
      timeoutPromise,
    ]);

    return token;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function buildApiUrl(endpoint: string): string {
  if (endpoint.startsWith("/")) {
    return `${API_BASE_URL}${endpoint}`;
  }

  return `${API_BASE_URL}/${endpoint}`;
}

export async function fetchApi<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const accessToken = await getAccessTokenWithTimeout();

  const headers = new Headers(options.headers);

  if (options.body != null && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response: Response;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const hasExternalSignal = Boolean(options.signal);
  const requestController = hasExternalSignal ? undefined : new AbortController();

  if (requestController) {
    timeoutId = setTimeout(() => requestController.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  }

  try {
    response = await fetch(buildApiUrl(endpoint), {
      ...options,
      headers,
      signal: options.signal ?? requestController?.signal,
    });
  } catch {
    throw new Error("Network error: unable to reach API server");
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const errorData = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errorData.error || `API error (${response.status}): ${response.statusText}`);
    }

    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `API error (${response.status}): ${response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
