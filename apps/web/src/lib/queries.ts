import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BranchDto,
  ClubDto,
  InsightsDto,
  MeDto,
  MealSlot,
  MenuDto,
  OrderDto,
  PlanDto,
  RecommendationsDto,
  SubscriptionDto,
  WalletDto,
} from '@prochia/shared';
import { api } from './api';
import { branchHeader } from './branch';

export const keys = {
  branch: ['branch'] as const,
  menu: ['menu'] as const,
  me: ['me'] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['orders', id] as const,
  wallet: ['wallet'] as const,
  plans: ['plans'] as const,
  subscriptions: ['subscriptions'] as const,
  club: ['club'] as const,
  insights: ['insights'] as const,
  recommendations: (slot?: MealSlot) => ['recommendations', slot ?? 'auto'] as const,
};

export const useBranch = () =>
  useQuery({
    queryKey: keys.branch,
    queryFn: () => api<BranchDto>('/branch'),
    staleTime: 5 * 60_000,
  });

/** Availability changes as the kitchen works, so the menu refreshes every half minute. */
export const useMenu = () =>
  useQuery({
    queryKey: keys.menu,
    queryFn: () => api<MenuDto>('/menu'),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api<MeDto>('/me'), staleTime: 60_000 });

export function useMember() {
  const me = useMe();
  const data = me.data;
  return {
    ...me,
    user: data?.user ?? null,
    membership: data?.membership ?? null,
    health: data?.health ?? null,
    isActive: data?.membership?.status === 'active',
  };
}

export const useOrders = (enabled = true) =>
  useQuery({ queryKey: keys.orders, queryFn: () => api<OrderDto[]>('/orders'), enabled });

/** One order, kept live over server-sent events while the page is open. */
export function useLiveOrder(id: string) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: keys.order(id),
    queryFn: () => api<OrderDto>(`/orders/${id}`),
  });
  const status = query.data?.status;
  const closed = status === 'completed' || status === 'rejected' || status === 'cancelled';

  useEffect(() => {
    if (closed) return;
    // EventSource cannot send headers; in development the branch goes in the query string.
    const branch = branchHeader()['x-branch'];
    const source = new EventSource(
      `/api/v1/orders/${id}/stream${branch ? `?branch=${branch}` : ''}`,
      { withCredentials: true },
    );
    const refresh = () => void client.invalidateQueries({ queryKey: keys.order(id) });
    source.addEventListener('order.updated', refresh);
    source.addEventListener('ticket.updated', refresh);
    return () => source.close();
  }, [id, closed, client]);

  return query;
}

export const useWallet = (enabled = true) =>
  useQuery({ queryKey: keys.wallet, queryFn: () => api<WalletDto>('/wallet'), enabled });
export const usePlans = () =>
  useQuery({
    queryKey: keys.plans,
    queryFn: () => api<PlanDto[]>('/plans'),
    staleTime: 5 * 60_000,
  });
export const useSubscriptions = (enabled = true) =>
  useQuery({
    queryKey: keys.subscriptions,
    queryFn: () => api<SubscriptionDto[]>('/subscriptions'),
    enabled,
  });
export const useClub = (enabled = true) =>
  useQuery({ queryKey: keys.club, queryFn: () => api<ClubDto>('/club'), enabled });
export const useInsights = (enabled = true) =>
  useQuery({ queryKey: keys.insights, queryFn: () => api<InsightsDto>('/me/insights'), enabled });
export const useRecommendations = (enabled: boolean, slot?: MealSlot) =>
  useQuery({
    queryKey: keys.recommendations(slot),
    queryFn: () => api<RecommendationsDto>(`/me/recommendations${slot ? `?slot=${slot}` : ''}`),
    enabled,
    staleTime: 5 * 60_000,
  });
