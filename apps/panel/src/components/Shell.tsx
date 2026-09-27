import { useCallback, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission, PaymentReviewDto } from '@prochia/shared';
import { STAFF_ROLE_LABELS, toFaDigits } from '@prochia/shared';
import { Button, Icon, Spinner, Wordmark, type IconName } from '@prochia/ui';
import { chime, notify } from '../lib/alerts';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { session } from '../lib/session';
import { useStaffStream, type StreamEvent } from '../lib/stream';
import { LoginScreen } from './LoginScreen';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  permission: Permission;
  end?: boolean;
}

const NAV: { group?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '/', label: 'سفارش‌ها', icon: 'receipt', permission: 'orders.view', end: true },
      { to: '/payments', label: 'بررسی پرداخت‌ها', icon: 'wallet', permission: 'payments.review' },
    ],
  },
  {
    group: 'آشپزخانه و انبار',
    items: [
      { to: '/inventory', label: 'انبار و فرآوری', icon: 'layers', permission: 'inventory.view' },
      { to: '/menu', label: 'منو و دستور پخت', icon: 'bowl', permission: 'menu.view' },
    ],
  },
  {
    group: 'مشتریان',
    items: [
      { to: '/members', label: 'اعضا', icon: 'users', permission: 'members.view' },
      { to: '/plans', label: 'بسته‌ها', icon: 'box', permission: 'members.view' },
      { to: '/club', label: 'باشگاه و تخفیف', icon: 'gift', permission: 'members.view' },
      { to: '/sms', label: 'پیامک', icon: 'message', permission: 'sms.send' },
    ],
  },
  {
    group: 'مدیریت',
    items: [
      { to: '/analytics', label: 'گزارش‌ها', icon: 'chart', permission: 'analytics.view' },
      { to: '/qr', label: 'QR میزها', icon: 'qr', permission: 'orders.view' },
      { to: '/settings', label: 'تنظیمات', icon: 'settings', permission: 'settings.edit' },
    ],
  },
];

export function Shell() {
  const auth = useAuth();
  const client = useQueryClient();
  const [sound, setSound] = useState(true);

  const reviews = useQuery({
    queryKey: ['payments', 'awaiting_review'],
    queryFn: () => api<PaymentReviewDto[]>('/staff/payments'),
    enabled: auth.can('payments.review'),
    refetchInterval: 60_000,
  });

  const onEvent = useCallback(
    (event: StreamEvent) => {
      if (event.type === 'order.updated' || event.type === 'ticket.updated') {
        void client.invalidateQueries({ queryKey: ['board'] });
        if (event.orderId) void client.invalidateQueries({ queryKey: ['order', event.orderId] });
      }
      if (event.type === 'order.updated' && event.status === 'placed') {
        if (sound) chime();
        void notify('سفارش جدید', `سفارش ${toFaDigits(event.number ?? 0)} منتظر تأیید است`);
      }
      if (event.type === 'payment.review')
        void client.invalidateQueries({ queryKey: ['payments'] });
      if (event.type === 'stock.changed' || event.type === 'menu.changed') {
        void client.invalidateQueries({ queryKey: ['inventory'] });
        void client.invalidateQueries({ queryKey: ['menu'] });
      }
      if (event.type === 'member.pending') void client.invalidateQueries({ queryKey: ['members'] });
    },
    [client, sound],
  );
  const connected = useStaffStream(onEvent, Boolean(auth.me));

  if (auth.loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Spinner size={28} />
      </div>
    );
  }
  if (!auth.me) return <LoginScreen />;

  const { staff, branch } = auth.me;
  const pendingReviews = reviews.data?.length ?? 0;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Wordmark subtitle={`پنل ${branch.gymName}`} />
        </div>
        <nav className="nav" aria-label="بخش‌ها">
          {NAV.map((section, i) => {
            const items = section.items.filter((item) => auth.can(item.permission));
            if (!items.length) return null;
            return (
              <div key={i} className="nav">
                {section.group && <div className="nav__group">{section.group}</div>}
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end}>
                    <Icon name={item.icon} size={18} />
                    {item.label}
                    {item.to === '/payments' && pendingReviews > 0 && (
                      <span className="badge">{toFaDigits(pendingReviews)}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar__foot">
          <span className="live" data-on={connected}>
            {connected ? 'به‌روزرسانی زنده' : 'در حال اتصال…'}
          </span>
          <label className="check" style={{ fontWeight: 500 }}>
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
            صدای سفارش جدید
          </label>
          <div>
            <b>{staff.name}</b>
            <div className="hint">{STAFF_ROLE_LABELS[staff.role]}</div>
          </div>
          {!staff.branchId && <BranchSwitcher current={branch.slug} />}
          <Button variant="ghost" size="s" icon="logout" onClick={() => void auth.logout()}>
            خروج
          </Button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

/** Owners run every gym from one account. */
function BranchSwitcher({ current }: { current: string }) {
  const client = useQueryClient();
  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => api<{ id: string; slug: string; gymName: string }[]>('/staff/branches'),
  });
  return (
    <select
      className="pc-input"
      value={current}
      onChange={(e) => {
        session.branch = e.target.value;
        client.clear();
        window.location.reload();
      }}
      aria-label="شعبه"
    >
      {(branches.data ?? []).map((b) => (
        <option key={b.id} value={b.slug}>
          {b.gymName}
        </option>
      ))}
    </select>
  );
}
