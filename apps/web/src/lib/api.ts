import type { ApiErrorBody } from '@prochia/shared';
import { demoApiBase } from '@prochia/demo/client';
import { branchHeader } from './branch';

/**
 * Prefix for API and upload URLs. Empty on a gym's own domain; in the static demo the API runs in a
 * service worker under the demo's root.
 */
export const API_BASE: string = import.meta.env.VITE_DEMO ? demoApiBase() : '';

/** Upload paths from the API (`/uploads/…`) as loadable URLs. */
export function assetUrl(url: string) {
  return url.startsWith('/') ? API_BASE + url : url;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T>(
  path: string,
  init: { method?: Method; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...branchHeader(),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'اتصال برقرار نشد؛ اینترنت را بررسی کنید');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? 'unknown',
      body?.error.message ?? 'خطایی رخ داد',
      body?.error.details,
    );
  }
  return (await res.json()) as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'خطایی رخ داد');
