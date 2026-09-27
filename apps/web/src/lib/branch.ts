/**
 * In production every gym has its own subdomain and the API reads it from the Host header.
 * For local development (localhost) a `?branch=slug` query parameter selects a gym.
 */
const KEY = 'prochia.branch';

function readOverride(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('branch');
  if (fromQuery) {
    try {
      sessionStorage.setItem(KEY, fromQuery);
    } catch {
      /* storage unavailable */
    }
    return fromQuery;
  }
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const override = readOverride();

export function branchHeader(): Record<string, string> {
  return override ? { 'x-branch': override } : {};
}

/** Scopes browser storage per gym so carts never leak between subdomains in development. */
export const branchKey = override ?? window.location.hostname.split('.')[0] ?? 'default';
