import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HealthProfileDto,
  MemberListItemDto,
  MembershipStatus,
  OrderDto,
  SubscriptionDto,
  WalletEntryDto,
} from '@prochia/shared';
import {
  GOAL_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  WALLET_ENTRY_LABELS,
  formatAgo,
  formatDateTime,
  formatNumber,
  formatToman,
  maskMobile,
  normalizeIranMobile,
  toFaDigits,
} from '@prochia/shared';
import { Button, Empty, Field, Money, Segmented, Tag, useToast } from '@prochia/ui';
import { Drawer, NumberInput, Page, Panel, Switch } from '../components/kit';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

type Filter = 'all' | MembershipStatus | 'vip';

export function MembersPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const params = new URLSearchParams({ limit: '200' });
  if (q.trim()) params.set('q', q.trim());
  if (filter === 'vip') params.set('vip', '1');
  else if (filter !== 'all') params.set('status', filter);
  const list = useQuery({
    queryKey: ['members', filter, q],
    queryFn: () => api<MemberListItemDto[]>(`/staff/members?${params}`),
  });

  const approve = useMutation({
    mutationFn: (id: string) =>
      api(`/staff/members/${id}`, { method: 'PATCH', body: { status: 'active' } }),
    onSuccess: () => {
      toast('عضویت تأیید شد', 'success');
      void client.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Page
      title="اعضا"
      subtitle="فقط اعضای باشگاه می‌توانند سفارش دهند. شماره‌های فهرست باشگاه خودکار تأیید می‌شوند."
      actions={
        auth.can('members.edit') && (
          <Button icon="upload" onClick={() => setImporting(true)}>
            فهرست اعضای باشگاه
          </Button>
        )
      }
    >
      <Panel
        flush
        title={
          <div className="row">
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'همه' },
                { value: 'pending', label: 'منتظر تأیید' },
                { value: 'active', label: 'فعال' },
                { value: 'vip', label: 'VIP' },
                { value: 'suspended', label: 'مسدود' },
              ]}
            />
            <input
              className="pc-input"
              style={{ width: 240, minHeight: 38 }}
              placeholder="نام، موبایل یا کد عضویت"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        }
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>نام</th>
                <th>موبایل</th>
                <th>کد باشگاه</th>
                <th>وضعیت</th>
                <th>هدف</th>
                <th>سطح</th>
                <th className="n">کیف پول</th>
                <th>آخرین سفارش</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => setOpenId(m.id)}>
                  <td>
                    <b>{[m.firstName, m.lastName].filter(Boolean).join(' ') || '—'}</b>{' '}
                    {m.isVip && <Tag tone="ink">VIP</Tag>}
                  </td>
                  <td className="ltr num">{m.phone}</td>
                  <td className="num">{m.gymMemberCode ?? '—'}</td>
                  <td>
                    <Tag
                      tone={
                        m.status === 'active'
                          ? 'green'
                          : m.status === 'pending'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {MEMBERSHIP_STATUS_LABELS[m.status]}
                    </Tag>
                  </td>
                  <td>{m.goal ? GOAL_LABELS[m.goal] : <span className="hint">—</span>}</td>
                  <td>{m.tierName ?? '—'}</td>
                  <td className="n">{formatToman(m.walletBalance, { unit: false })}</td>
                  <td className="hint">
                    {m.lastOrderAt ? formatAgo(new Date(m.lastOrderAt)) : '—'}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {m.status === 'pending' && auth.can('members.edit') && (
                      <Button size="s" variant="primary" onClick={() => approve.mutate(m.id)}>
                        تأیید عضویت
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.length === 0 && <Empty icon="users" title="عضوی پیدا نشد" />}
        </div>
      </Panel>
      {openId && <MemberDrawer id={openId} onClose={() => setOpenId(null)} />}
      {importing && <WhitelistDrawer onClose={() => setImporting(false)} />}
    </Page>
  );
}

interface MemberDetail {
  membership: {
    id: string;
    status: MembershipStatus;
    isVip: boolean;
    creditLimit: number;
    personalDiscountPct: number;
    walletBalance: number;
    gymMemberCode: string | null;
    note: string | null;
    createdAt: string;
  };
  user: {
    firstName: string | null;
    lastName: string | null;
    phone: string;
    birthDate: string | null;
  };
  tierName: string | null;
  health: Omit<HealthProfileDto, 'bmi' | 'bmiBand'> | null;
  wallet: WalletEntryDto[];
  orders: OrderDto[];
  subscriptions: SubscriptionDto[];
  postpaidOwed: number;
}

function MemberDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const auth = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const detail = useQuery({
    queryKey: ['member', id],
    queryFn: () => api<MemberDetail>(`/staff/members/${id}`),
  });
  const [topup, setTopup] = useState<number | null>(null);
  const [adjust, setAdjust] = useState<number | null>(null);
  const [adjustNote, setAdjustNote] = useState('');
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['member', id] });
    void client.invalidateQueries({ queryKey: ['members'] });
  };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/staff/members/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const wallet = useMutation({
    mutationFn: (body: { kind: 'topup' | 'adjustment'; amount: number; note: string }) =>
      api(`/staff/members/${id}/wallet`, { method: 'POST', body }),
    onSuccess: () => {
      toast('کیف پول به‌روز شد', 'success');
      setTopup(null);
      setAdjust(null);
      setAdjustNote('');
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const settle = useMutation({
    mutationFn: () => api(`/staff/members/${id}/settle-postpaid`, { method: 'POST' }),
    onSuccess: () => {
      toast('حساب اعتباری تسویه شد', 'success');
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const d = detail.data;
  const finance = auth.can('members.finance');
  return (
    <Drawer
      open
      onClose={onClose}
      width={720}
      title={
        d
          ? [d.user.firstName, d.user.lastName].filter(Boolean).join(' ') ||
            maskMobile(d.user.phone)
          : 'عضو'
      }
    >
      {!d ? null : (
        <div className="stack" style={{ gap: 'var(--space-5)' }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <Tag tone={d.membership.status === 'active' ? 'green' : 'warning'}>
              {MEMBERSHIP_STATUS_LABELS[d.membership.status]}
            </Tag>
            {d.tierName && <Tag tone="lime">{d.tierName}</Tag>}
            {d.membership.isVip && <Tag tone="ink">VIP</Tag>}
            <span className="ltr num hint">{d.user.phone}</span>
            {d.membership.gymMemberCode && (
              <span className="hint">کد باشگاه {d.membership.gymMemberCode}</span>
            )}
          </div>

          <div className="kpis">
            <div className="kpi">
              <span>کیف پول</span>
              <strong>
                <Money amount={d.membership.walletBalance} />
              </strong>
            </div>
            <div className="kpi">
              <span>بدهی اعتباری</span>
              <strong>
                <Money amount={d.postpaidOwed} />
              </strong>
              {d.membership.isVip && <small>سقف {formatToman(d.membership.creditLimit)}</small>}
            </div>
            <div className="kpi">
              <span>وعده‌های بسته</span>
              <strong className="num">
                {toFaDigits(
                  d.subscriptions
                    .filter((s) => s.status === 'active')
                    .reduce((s, x) => s + x.remaining, 0),
                )}
              </strong>
            </div>
          </div>

          {d.health && (
            <Panel title="پروفایل سلامت">
              <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-4)' }}>
                <span>
                  هدف: <b>{GOAL_LABELS[d.health.goal]}</b>
                </span>
                <span className="num">
                  قد {formatNumber(d.health.heightCm)} · وزن {formatNumber(d.health.weightKg, 1)}
                </span>
                <span className="num">
                  روزانه {formatNumber(d.health.targets.kcal)} کالری · پروتئین{' '}
                  {formatNumber(d.health.targets.protein)} گرم
                </span>
              </div>
            </Panel>
          )}

          {auth.can('members.edit') && (
            <Panel title="کیف پول و تسویه">
              <div className="stack">
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <Field label="شارژ حضوری (نقد یا کارتخوان) — با هدیه شارژ">
                    <NumberInput value={topup} onChange={setTopup} placeholder="مبلغ به تومان" />
                  </Field>
                  <Button
                    variant="primary"
                    disabled={!topup || topup <= 0}
                    loading={wallet.isPending}
                    onClick={() =>
                      wallet.mutate({ kind: 'topup', amount: topup!, note: 'شارژ حضوری در صندوق' })
                    }
                  >
                    شارژ
                  </Button>
                </div>
                {d.postpaidOwed > 0 && (
                  <Button variant="ink" loading={settle.isPending} onClick={() => settle.mutate()}>
                    دریافت {formatToman(d.postpaidOwed)} و تسویه حساب اعتباری
                  </Button>
                )}
                {finance && (
                  <div className="row" style={{ alignItems: 'flex-end' }}>
                    <Field label="اصلاح موجودی (مثبت یا منفی)">
                      <NumberInput value={adjust} onChange={setAdjust} />
                    </Field>
                    <Field label="علت">
                      <input
                        className="pc-input"
                        value={adjustNote}
                        onChange={(e) => setAdjustNote(e.target.value)}
                      />
                    </Field>
                    <Button
                      disabled={!adjust || adjustNote.trim().length < 2}
                      onClick={() =>
                        wallet.mutate({ kind: 'adjustment', amount: adjust!, note: adjustNote })
                      }
                    >
                      ثبت
                    </Button>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {finance && <VipPanel membership={d.membership} onSave={(body) => patch.mutate(body)} />}

          <div className="row">
            {d.membership.status !== 'active' && auth.can('members.edit') && (
              <Button variant="primary" onClick={() => patch.mutate({ status: 'active' })}>
                فعال کردن عضویت
              </Button>
            )}
            {d.membership.status === 'active' && auth.can('members.edit') && (
              <Button variant="danger" onClick={() => patch.mutate({ status: 'suspended' })}>
                مسدود کردن
              </Button>
            )}
          </div>

          <Panel title="سفارش‌های اخیر" flush>
            <table className="data">
              <tbody>
                {d.orders.map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 900 }}>{toFaDigits(o.number)}</td>
                    <td>{ORDER_STATUS_LABELS[o.status]}</td>
                    <td className="hint">{o.lines.map((l) => l.name).join('، ')}</td>
                    <td className="n">{formatToman(o.total, { unit: false })}</td>
                    <td className="num hint">{formatDateTime(new Date(o.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="گردش کیف پول" flush>
            <table className="data">
              <tbody>
                {d.wallet.map((w) => (
                  <tr key={w.id}>
                    <td>{WALLET_ENTRY_LABELS[w.kind]}</td>
                    <td className="hint">{w.note}</td>
                    <td
                      className="n"
                      style={{ color: w.amount > 0 ? 'var(--green-700)' : undefined }}
                    >
                      {w.amount > 0 ? '+' : '−'}
                      {formatToman(Math.abs(w.amount), { unit: false })}
                    </td>
                    <td className="num hint">{formatDateTime(new Date(w.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
    </Drawer>
  );
}

function VipPanel({
  membership,
  onSave,
}: {
  membership: MemberDetail['membership'];
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [limit, setLimit] = useState<number | null>(membership.creditLimit);
  const [discount, setDiscount] = useState<number | null>(membership.personalDiscountPct);
  return (
    <Panel title="VIP و تخفیف اختصاصی">
      <div className="stack">
        <Switch
          checked={membership.isVip}
          onChange={(v) => onSave({ isVip: v })}
          label="عضو VIP (سفارش اعتباری، پرداخت بعدی)"
        />
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="سقف اعتبار (تومان)">
            <NumberInput value={limit} onChange={setLimit} />
          </Field>
          <Field
            label="تخفیف اختصاصی (٪)"
            hint="مثلاً برای مربی‌ها؛ بیشترینِ این و تخفیف سطح اعمال می‌شود."
          >
            <NumberInput value={discount} onChange={setDiscount} />
          </Field>
          <Button
            onClick={() =>
              onSave({
                creditLimit: limit ?? 0,
                personalDiscountPct: Math.min(Math.max(discount ?? 0, 0), 100),
              })
            }
          >
            ذخیره
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function WhitelistDrawer({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const entries = text
    .split(/\n/)
    .map((line) => line.split(/[,\t;]/).map((c) => c.trim()))
    .map(([phone, code]) => ({
      phone: normalizeIranMobile(phone ?? ''),
      gymMemberCode: code || null,
    }))
    .filter((e): e is { phone: string; gymMemberCode: string | null } => Boolean(e.phone));
  const save = useMutation({
    mutationFn: () =>
      api<{ added: number }>('/staff/whitelist', {
        method: 'POST',
        body: { entries: entries.map((e) => ({ ...e, note: null })) },
      }),
    onSuccess: (r) => {
      toast(`${toFaDigits(r.added)} شماره ثبت شد`, 'success');
      void client.invalidateQueries({ queryKey: ['members'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      title="فهرست اعضای باشگاه"
      footer={
        <Button
          variant="primary"
          disabled={!entries.length}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          ثبت {toFaDigits(entries.length)} شماره
        </Button>
      }
    >
      <div className="stack">
        <p className="hint">
          از نرم‌افزار پذیرش باشگاه خروجی بگیرید و اینجا بچسبانید: هر خط یک عضو، «موبایل، کد عضویت».
          اعضای منتظر با این شماره‌ها همین حالا تأیید می‌شوند.
        </p>
        <textarea
          className="pc-input ltr"
          rows={14}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'09121234567, G-1201\n09351234567, G-1202'}
          style={{ width: '100%', display: 'block' }}
        />
      </div>
    </Drawer>
  );
}
