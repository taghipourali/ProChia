import type { ApiErrorBody } from '@prochia/shared';
import { apiUrl, session } from './session';

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
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  if (session.branch) headers['x-branch'] = session.branch;
  return headers;
}

export async function api<T>(
  path: string,
  init: {
    method?: Method;
    body?: unknown;
    raw?: Blob;
    contentType?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: init.method ?? 'GET',
      headers: {
        ...authHeaders(),
        ...(init.raw
          ? { 'content-type': init.contentType ?? init.raw.type }
          : init.body !== undefined
            ? { 'content-type': 'application/json' }
            : {}),
      },
      body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'ارتباط با سرور برقرار نشد');
  }
  if (res.status === 401 && session.token) onUnauthorized();
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
