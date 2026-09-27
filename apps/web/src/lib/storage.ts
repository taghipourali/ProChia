/** Browser storage that never throws (private mode, blocked site data). */
export const storage = {
  get<T>(key: string, fallback: T, session = false): T {
    try {
      const raw = (session ? sessionStorage : localStorage).getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown, session = false) {
    try {
      (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  remove(key: string, session = false) {
    try {
      (session ? sessionStorage : localStorage).removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
