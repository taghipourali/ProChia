import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Goal, PromotionAudience, TierDto } from '@prochia/shared';
import {
  GOALS,
  GOAL_LABELS,
  PROMOTION_AUDIENCES,
  PROMOTION_AUDIENCE_LABELS,
  formatJalali,
  formatToman,
  toFaDigits,
} from '@prochia/shared';
import { Button, Field, Tag, useToast } from '@prochia/ui';
import { Drawer, NumberInput, Page, Panel, Switch, Tabs } from '../components/kit';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

type Tab = 'promotions' | 'tiers' | 'cashback';

interface Promotion {
  id: string;
  title: string;
  description: string | null;
  kind: 'percent' | 'amount';
  value: number;
  maxDiscount: number | null;
  minOrder: number;
  code: string | null;
  audience: PromotionAudience;
  tierId: string | null;
  goal: Goal | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  perMemberLimit: number;
  personalCodeDays: number;
  isActive: boolean;
}

interface CashbackRule {
  id: string;
  title: string;
  minAmount: number;
  percent: number;
  maxBonus: number | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export function ClubPage() {
  const [tab, setTab] = useState<Tab>('promotions');
  return (
    <Page
      title="باشگاه مشتریان و تخفیف"
      subtitle="سطح‌های وفاداری، کدهای تخفیف، هدیه تولد و هدیه شارژ کیف پول."
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'promotions', label: 'تخفیف‌ها' },
          { value: 'tiers', label: 'سطح‌های باشگاه' },
          { value: 'cashback', label: 'هدیه شارژ کیف پول' },
        ]}
      />
      {tab === 'promotions' && <Promotions />}
      {tab === 'tiers' && <Tiers />}
      {tab === 'cashback' && <Cashback />}
    </Page>
  );
}

function Promotions() {
  const auth = useAuth();
  const list = useQuery({
    queryKey: ['promotions'],
    queryFn: () =>
      api<{ promotion: Promotion; used: number; discountGiven: number }[]>('/staff/promotions'),
  });
  const tiers = useQuery({
    queryKey: ['tiers'],
    queryFn: () => api<(TierDto & { members: number })[]>('/staff/tiers'),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api<{ branch: { settings: { birthdayPromotionId: string | null } } }>('/staff/settings'),
    enabled: auth.can('settings.edit'),
  });
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const birthdayId = settings.data?.branch.settings.birthdayPromotionId;
  return (
    <Panel
      flush
      title="تخفیف‌ها"
      actions={
        auth.can('club.edit') && (
          <Button icon="plus" onClick={() => setEditing('new')}>
            تخفیف جدید
          </Button>
        )
      }
    >
      <table className="data">
        <thead>
          <tr>
            <th>عنوان</th>
            <th>کد</th>
            <th>مخاطب</th>
            <th>مقدار</th>
            <th className="n">استفاده</th>
            <th className="n">جمع تخفیف</th>
            <th>تا</th>
            <th>وضعیت</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map(({ promotion: p, used, discountGiven }) => (
            <tr
              key={p.id}
              className="clickable"
              onClick={() => auth.can('club.edit') && setEditing(p)}
            >
              <td>
                <b>{p.title}</b> {p.id === birthdayId && <Tag tone="lime">هدیه تولد</Tag>}
              </td>
              <td className="ltr num">
                {p.code ?? (p.audience === 'personal' ? 'کد شخصی' : 'خودکار')}
              </td>
              <td>
                {PROMOTION_AUDIENCE_LABELS[p.audience]}
                {p.audience === 'tier' &&
                  ` — ${tiers.data?.find((t) => t.id === p.tierId)?.name ?? ''}`}
                {p.audience === 'goal' && p.goal && ` — ${GOAL_LABELS[p.goal]}`}
              </td>
              <td>{p.kind === 'percent' ? `${toFaDigits(p.value)}٪` : formatToman(p.value)}</td>
              <td className="n">{toFaDigits(used)}</td>
              <td className="n">{formatToman(discountGiven, { unit: false })}</td>
              <td className="num">{p.endsAt ? formatJalali(new Date(p.endsAt)) : '—'}</td>
              <td>{p.isActive ? <Tag tone="green">فعال</Tag> : <Tag>غیرفعال</Tag>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <PromotionDrawer
          promo={editing === 'new' ? null : editing}
          tiers={tiers.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

function PromotionDrawer({
  promo,
  tiers,
  onClose,
}: {
  promo: Promotion | null;
  tiers: TierDto[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [p, setP] = useState<Omit<Promotion, 'id'>>(
    promo ?? {
      title: '',
      description: null,
      kind: 'percent',
      value: 10,
      maxDiscount: null,
      minOrder: 0,
      code: null,
      audience: 'all',
      tierId: null,
      goal: null,
      startsAt: null,
      endsAt: null,
      usageLimit: null,
      perMemberLimit: 1,
      personalCodeDays: 7,
      isActive: true,
    },
  );
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => setP((x) => ({ ...x, [k]: v }));
  const [endDays, setEndDays] = useState<number | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api(promo ? `/staff/promotions/${promo.id}` : '/staff/promotions', {
        method: promo ? 'PUT' : 'POST',
        body: {
          ...p,
          code: p.code?.trim() ? p.code.trim().toUpperCase() : null,
          endsAt: endDays ? new Date(Date.now() + endDays * 86_400_000).toISOString() : p.endsAt,
        },
      }),
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['promotions'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Drawer
      open
      onClose={onClose}
      title={promo ? promo.title : 'تخفیف جدید'}
      footer={
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!p.title}
          onClick={() => save.mutate()}
        >
          ذخیره
        </Button>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <div className="form-grid">
          <Field label="عنوان">
            <input
              className="pc-input"
              value={p.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <Field label="مخاطب">
            <select
              className="pc-input"
              value={p.audience}
              onChange={(e) => set('audience', e.target.value as PromotionAudience)}
            >
              {PROMOTION_AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {PROMOTION_AUDIENCE_LABELS[a]}
                </option>
              ))}
            </select>
          </Field>
          {p.audience === 'tier' && (
            <Field label="سطح">
              <select
                className="pc-input"
                value={p.tierId ?? ''}
                onChange={(e) => set('tierId', e.target.value || null)}
              >
                <option value="">انتخاب</option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {p.audience === 'goal' && (
            <Field label="هدف تمرینی">
              <select
                className="pc-input"
                value={p.goal ?? ''}
                onChange={(e) => set('goal', (e.target.value || null) as Goal | null)}
              >
                <option value="">انتخاب</option>
                {GOALS.map((g) => (
                  <option key={g} value={g}>
                    {GOAL_LABELS[g]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {p.audience !== 'personal' && (
            <Field label="کد (خالی = خودکار برای همه مخاطبان)">
              <input
                className="pc-input pc-input--ltr"
                value={p.code ?? ''}
                onChange={(e) => set('code', e.target.value.toUpperCase() || null)}
                placeholder="SUMMER"
              />
            </Field>
          )}
          {p.audience === 'personal' && (
            <Field label="اعتبار هر کد شخصی (روز)">
              <NumberInput
                value={p.personalCodeDays}
                onChange={(v) => set('personalCodeDays', v ?? 7)}
              />
            </Field>
          )}
          <Field label="نوع">
            <select
              className="pc-input"
              value={p.kind}
              onChange={(e) => set('kind', e.target.value as 'percent' | 'amount')}
            >
              <option value="percent">درصدی</option>
              <option value="amount">مبلغ ثابت</option>
            </select>
          </Field>
          <Field label={p.kind === 'percent' ? 'درصد' : 'مبلغ (تومان)'}>
            <NumberInput value={p.value} onChange={(v) => set('value', v ?? 0)} />
          </Field>
          <Field label="سقف تخفیف (تومان)">
            <NumberInput value={p.maxDiscount} onChange={(v) => set('maxDiscount', v)} />
          </Field>
          <Field label="حداقل سفارش (تومان)">
            <NumberInput value={p.minOrder} onChange={(v) => set('minOrder', v ?? 0)} />
          </Field>
          <Field label="دفعات مجاز برای هر عضو">
            <NumberInput value={p.perMemberLimit} onChange={(v) => set('perMemberLimit', v ?? 1)} />
          </Field>
          <Field label="سقف کل استفاده">
            <NumberInput value={p.usageLimit} onChange={(v) => set('usageLimit', v)} />
          </Field>
          <Field
            label="مدت اعتبار از امروز (روز)"
            hint={p.endsAt ? `فعلاً تا ${formatJalali(new Date(p.endsAt))}` : 'خالی = بدون پایان'}
          >
            <NumberInput value={endDays} onChange={setEndDays} />
          </Field>
          <Field label="توضیح برای مشتری">
            <input
              className="pc-input"
              value={p.description ?? ''}
              onChange={(e) => set('description', e.target.value || null)}
            />
          </Field>
        </div>
        <Switch checked={p.isActive} onChange={(v) => set('isActive', v)} label="فعال" />
        {p.audience === 'personal' && (
          <p className="hint">
            برای هدیه تولد، این تخفیف را در تنظیمات به‌عنوان «تخفیف تولد» انتخاب کنید.
          </p>
        )}
      </div>
    </Drawer>
  );
}

function Tiers() {
  const auth = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const tiers = useQuery({
    queryKey: ['tiers'],
    queryFn: () => api<(TierDto & { members: number })[]>('/staff/tiers'),
  });
  const [draft, setDraft] = useState<Partial<TierDto> | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api(draft?.id ? `/staff/tiers/${draft.id}` : '/staff/tiers', {
        method: draft?.id ? 'PUT' : 'POST',
        body: {
          name: draft?.name,
          minSpend: draft?.minSpend ?? 0,
          discountPct: draft?.discountPct ?? 0,
          perks: draft?.perks ?? null,
          sort: draft?.sort ?? 0,
        },
      }),
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['tiers'] });
      setDraft(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Panel
      flush
      title="سطح‌ها (بر اساس خرید دوره اخیر)"
      actions={
        auth.can('club.edit') && (
          <Button icon="plus" onClick={() => setDraft({})}>
            سطح جدید
          </Button>
        )
      }
    >
      <table className="data">
        <thead>
          <tr>
            <th>نام</th>
            <th className="n">حداقل خرید</th>
            <th className="n">تخفیف همیشگی</th>
            <th>مزایا</th>
            <th className="n">اعضا</th>
          </tr>
        </thead>
        <tbody>
          {tiers.data?.map((t) => (
            <tr
              key={t.id}
              className="clickable"
              onClick={() => auth.can('club.edit') && setDraft(t)}
            >
              <td>
                <b>{t.name}</b>
              </td>
              <td className="n">{formatToman(t.minSpend)}</td>
              <td className="n">{toFaDigits(t.discountPct)}٪</td>
              <td className="hint">{t.perks}</td>
              <td className="n">{toFaDigits(t.members)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft && (
        <Drawer
          open
          onClose={() => setDraft(null)}
          width={460}
          title={draft.id ? draft.name : 'سطح جدید'}
          footer={
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!draft.name}
              onClick={() => save.mutate()}
            >
              ذخیره
            </Button>
          }
        >
          <div className="stack">
            <Field label="نام">
              <input
                className="pc-input"
                value={draft.name ?? ''}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="حداقل خرید در دوره (تومان)">
              <NumberInput
                value={draft.minSpend ?? null}
                onChange={(v) => setDraft({ ...draft, minSpend: v ?? 0 })}
              />
            </Field>
            <Field label="تخفیف همیشگی (٪)">
              <NumberInput
                value={draft.discountPct ?? null}
                onChange={(v) => setDraft({ ...draft, discountPct: v ?? 0 })}
              />
            </Field>
            <Field label="مزایا (نمایش به مشتری)">
              <input
                className="pc-input"
                value={draft.perks ?? ''}
                onChange={(e) => setDraft({ ...draft, perks: e.target.value })}
              />
            </Field>
          </div>
        </Drawer>
      )}
    </Panel>
  );
}

function Cashback() {
  const auth = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const rules = useQuery({
    queryKey: ['cashback'],
    queryFn: () => api<CashbackRule[]>('/staff/cashback'),
  });
  const [draft, setDraft] = useState<Partial<CashbackRule> | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api(draft?.id ? `/staff/cashback/${draft.id}` : '/staff/cashback', {
        method: draft?.id ? 'PUT' : 'POST',
        body: {
          title: draft?.title,
          minAmount: draft?.minAmount ?? 0,
          percent: draft?.percent ?? 0,
          maxBonus: draft?.maxBonus ?? null,
          isActive: draft?.isActive ?? true,
          startsAt: draft?.startsAt ?? null,
          endsAt: draft?.endsAt ?? null,
        },
      }),
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['cashback'] });
      setDraft(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Panel
      flush
      title="هدیه شارژ: هرچه شارژ بیشتر، درصد هدیه بیشتر"
      actions={
        auth.can('club.edit') && (
          <Button icon="plus" onClick={() => setDraft({ isActive: true })}>
            پله جدید
          </Button>
        )
      }
    >
      <table className="data">
        <thead>
          <tr>
            <th>عنوان</th>
            <th className="n">از مبلغ</th>
            <th className="n">هدیه</th>
            <th className="n">سقف هدیه</th>
            <th className="n">مثال</th>
            <th>وضعیت</th>
          </tr>
        </thead>
        <tbody>
          {rules.data?.map((r) => (
            <tr
              key={r.id}
              className="clickable"
              onClick={() => auth.can('club.edit') && setDraft(r)}
            >
              <td>{r.title}</td>
              <td className="n">{formatToman(r.minAmount)}</td>
              <td className="n">{toFaDigits(r.percent)}٪</td>
              <td className="n">{r.maxBonus ? formatToman(r.maxBonus) : '—'}</td>
              <td className="n hint">
                شارژ {formatToman(r.minAmount, { unit: false })} ← +
                {formatToman(Math.min((r.minAmount * r.percent) / 100, r.maxBonus ?? Infinity), {
                  unit: false,
                })}
              </td>
              <td>{r.isActive ? <Tag tone="green">فعال</Tag> : <Tag>غیرفعال</Tag>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft && (
        <Drawer
          open
          onClose={() => setDraft(null)}
          width={460}
          title={draft.id ? draft.title : 'پله هدیه جدید'}
          footer={
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!draft.title || !draft.minAmount || !draft.percent}
              onClick={() => save.mutate()}
            >
              ذخیره
            </Button>
          }
        >
          <div className="stack">
            <Field label="عنوان">
              <input
                className="pc-input"
                value={draft.title ?? ''}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </Field>
            <Field label="حداقل مبلغ شارژ (تومان)">
              <NumberInput
                value={draft.minAmount ?? null}
                onChange={(v) => setDraft({ ...draft, minAmount: v ?? 0 })}
              />
            </Field>
            <Field label="درصد هدیه">
              <NumberInput
                value={draft.percent ?? null}
                onChange={(v) => setDraft({ ...draft, percent: v ?? 0 })}
              />
            </Field>
            <Field label="سقف هدیه (تومان، اختیاری)">
              <NumberInput
                value={draft.maxBonus ?? null}
                onChange={(v) => setDraft({ ...draft, maxBonus: v })}
              />
            </Field>
            <Switch
              checked={draft.isActive ?? true}
              onChange={(v) => setDraft({ ...draft, isActive: v })}
              label="فعال"
            />
          </div>
        </Drawer>
      )}
    </Panel>
  );
}
