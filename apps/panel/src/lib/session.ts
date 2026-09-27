/**
 * Staff session and connection settings, kept in local storage. In the browser the panel talks
 * to the API on its own origin; the Windows app stores the server address chosen at first run.
 */
const KEYS = {
  server: 'prochia.panel.server',
  token: 'prochia.panel.token',
  branch: 'prochia.panel.branch',
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** True inside the Tauri desktop shell. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const session = {
  get server() {
    return read(KEYS.server) ?? (isDesktop ? null : '');
  },
  set server(value: string | null) {
    write(KEYS.server, value?.replace(/\/+$/, '') ?? null);
  },
  get token() {
    return read(KEYS.token);
  },
  set token(value: string | null) {
    write(KEYS.token, value);
  },
  /** Owners manage several gyms and pick one; everyone else is bound to their own. */
  get branch() {
    return read(KEYS.branch);
  },
  set branch(value: string | null) {
    write(KEYS.branch, value);
  },
};

export function apiUrl(path: string) {
  return `${session.server ?? ''}/api/v1${path}`;
}

export function assetUrl(path: string | null) {
  if (!path) return null;
  return path.startsWith('http') ? path : `${session.server ?? ''}${path}`;
}
