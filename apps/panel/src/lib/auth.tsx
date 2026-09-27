import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission, StaffMeDto } from '@prochia/shared';
import { can } from '@prochia/shared';
import { api, setUnauthorizedHandler } from './api';
import { session } from './session';

interface AuthState {
  me: StaffMeDto | null;
  loading: boolean;
  can: (permission: Permission) => boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [token, setToken] = useState(session.token);
  const me = useQuery({
    queryKey: ['staff-me', token, session.branch],
    queryFn: () => api<StaffMeDto>('/staff/me'),
    enabled: Boolean(token),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const reset = useCallback(() => {
    session.token = null;
    setToken(null);
    client.clear();
  }, [client]);

  useEffect(() => setUnauthorizedHandler(reset), [reset]);

  const value = useMemo<AuthState>(
    () => ({
      me: me.data ?? null,
      loading: Boolean(token) && me.isLoading,
      can: (permission) => (me.data ? can(me.data.staff.role, permission) : false),
      login: async (username, password) => {
        const res = await api<{ token: string }>('/staff/auth/login', {
          method: 'POST',
          body: { username, password },
        });
        session.token = res.token;
        setToken(res.token);
      },
      logout: async () => {
        await api('/staff/auth/logout', { method: 'POST' }).catch(() => {});
        reset();
      },
    }),
    [me.data, me.isLoading, token, reset],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
