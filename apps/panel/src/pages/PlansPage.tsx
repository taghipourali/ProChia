import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Goal, PlanDto, PlanKind, StaffMenuDto } from '@prochia/shared';
import {
  GOALS,
  GOAL_LABELS,
  PLAN_KIND_LABELS,
  formatJalali,
  formatToman,
  maskMobile,
  toFaDigits,
} from '@prochia/shared';
import { Button, Chip, Field, Tag, useToast } from '@prochia/ui';
import { Drawer, NumberInput, Page, Panel, Switch, Tabs } from '../components/kit';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

type StaffPlan = PlanDto & { stats: { active: number; sold: number; revenue: number } };
interface SubRow {
  subscription: {
    id: string;
    status: string;
    credits: number;
    creditsUsed: number;
    expiresOn: string;
    pricePaid: number;
    createdAt: string;
  };
  planName: string;
  member: { firstName: string | null; lastName: string | null; phone: string };
}

export function PlansPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<'plans' | 'subs'>('plans');
  const [editing, setEditing] = useState<StaffPlan | 'new' | null>(null);
  const plans = useQuery({
    queryKey: ['staff-plans'],
    queryFn: () => api<StaffPlan[]>('/staff/plans'),
  });
  const subs = useQuery({
    queryKey: ['staff-subs'],
    queryFn: () => api<SubRow[]>('/staff/subscriptions'),
    enabled: tab === 'subs',
  });
  return (
    <Page
      title="بسته‌ها و برنامه‌های غذایی"
      subtitle="پیش‌فروش وعده با تخفیف؛ اعتبار بسته هنگام سفارش خودکار کسر می‌شود."
      actions={
        auth.can('plans.edit') && (
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            بسته جدید
          </Button>
        )
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'plans', label: 'بسته‌ها' },
          { value: 'subs', label: 'خریدهای اعضا' },
        ]}
      />
      {tab === 'plans' && (
        <Panel flush>
          <table className="data">
            <thead>
              <tr>
                <th>نام</th>
                <th>نوع</th>
                <th className="n">وعده</th>
                <th className="n">اعتبار</th>
                <th className="n">قیمت</th>
                <th className="n">هر وعده</th>
                <th className="n">صرفه</th>
                <th className="n">فعال / فروخته</th>
                <th className="n">فروش</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {plans.data?.map((p) => (
                <tr
                  key={p.id}
                  className="clickable"
                  onClick={() => auth.can('plans.edit') && setEditing(p)}
                  style={p.isActive ? undefined : { opacity: 0.5 }}
                >
                  <td>
                    <b>{p.name}</b> {p.isFeatured && <Tag tone="lime">ویژه</Tag>}
                  </td>
                  <td>
                    {PLAN_KIND_LABELS[p.kind]}
                    {p.goal && ` · ${GOAL_LABELS[p.goal]}`}
                  </td>
                  <td className="n">{toFaDigits(p.meals)}</td>
                  <td className="n">{toFaDigits(p.validityDays)} روز</td>
                  <td className="n">{formatToman(p.price, { unit: false })}</td>
                  <td className="n">{formatToman(p.pricePerMeal, { unit: false })}</td>
                  <td className="n">{p.savingPct ? `${toFaDigits(p.savingPct)}٪` : '—'}</td>
                  <td className="n">
                    {toFaDigits(p.stats.active)} / {toFaDigits(p.stats.sold)}
                  </td>
                  <td className="n">{formatToman(p.stats.revenue, { unit: false })}</td>
                  <td>{!p.isActive && <Tag>غیرفعال</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {tab === 'subs' && (
        <Panel flush>
          <table className="data">
            <thead>
              <tr>
                <th>عضو</th>
                <th>بسته</th>
                <th className="n">مصرف</th>
                <th>تا</th>
                <th className="n">مبلغ</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {subs.data?.map((s) => (
                <tr key={s.subscription.id}>
                  <td>
                    {[s.member.firstName, s.member.lastName].filter(Boolean).join(' ') || '—'}
                    <div className="hint ltr num">{maskMobile(s.member.phone)}</div>
                  </td>
                  <td>{s.planName}</td>
                  <td className="n">
                    {toFaDigits(s.subscription.creditsUsed)} از {toFaDigits(s.subscription.credits)}
                  </td>
                  <td className="num">
                    {formatJalali(new Date(`${s.subscription.expiresOn}T12:00:00+03:30`))}
                  </td>
                  <td className="n">{formatToman(s.subscription.pricePaid, { unit: false })}</td>
                  <td>
                    <Tag
                      tone={
                        s.subscription.status === 'active'
                          ? 'green'
                          : s.subscription.status === 'pending_payment'
                            ? 'warning'
                            : undefined
                      }
                    >
                      {{
                        active: 'فعال',
                        expired: 'منقضی',
                        cancelled: 'لغو',
                        pending_payment: 'در انتظار پرداخت',
                      }[s.subscription.status] ?? s.subscription.status}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {editing && (
        <PlanDrawer plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Page>
  );
}

function PlanDrawer({ plan, onClose }: { plan: StaffPlan | null; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const menu = useQuery({ queryKey: ['menu'], queryFn: () => api<StaffMenuDto>('/staff/menu') });
  const [p, setP] = useState({
    kind: (plan?.kind ?? 'package') as PlanKind,
    name: plan?.name ?? '',
    description: plan?.description ?? null,
    goal: (plan?.goal ?? null) as Goal | null,
    meals: plan?.meals ?? 10,
    validityDays: plan?.validityDays ?? 30,
    price: plan?.price ?? 0,
    compareAtPrice: plan?.compareAtPrice ?? null,
    mealsPerDay: plan?.mealsPerDay ?? null,
    eligibleCategoryIds: plan?.eligibleCategoryIds ?? [],
    maxItemPrice: plan?.maxItemPrice ?? null,
    isFeatured: plan?.isFeatured ?? false,
    isActive: plan?.isActive ?? true,
    sort: plan?.sort ?? 0,
  });
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => setP((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      api(plan ? `/staff/plans/${plan.id}` : '/staff/plans', {
        method: plan ? 'PUT' : 'POST',
        body: p,
      }),
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['staff-plans'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const perMeal = p.meals ? Math.round(p.price / p.meals) : 0;
  return (
    <Drawer
      open
      onClose={onClose}
      title={plan ? plan.name : 'بسته جدید'}
      footer={
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!p.name || !p.price}
          onClick={() => save.mutate()}
        >
          ذخیره
        </Button>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <div className="form-grid">
          <Field label="نام">
            <input
              className="pc-input"
              value={p.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="بسته ۳۰ وعده"
            />
          </Field>
          <Field label="نوع">
            <select
              className="pc-input"
              value={p.kind}
              onChange={(e) => set('kind', e.target.value as PlanKind)}
            >
              <option value="package">بسته وعده (استفاده آزاد)</option>
              <option value="meal_plan">برنامه غذایی هدف‌دار (سفارش خودکار)</option>
            </select>
          </Field>
          {p.kind === 'meal_plan' && (
            <>
              <Field label="هدف">
                <select
                  className="pc-input"
                  value={p.goal ?? ''}
                  onChange={(e) => set('goal', (e.target.value || null) as Goal | null)}
                >
                  <option value="">—</option>
                  {GOALS.map((g) => (
                    <option key={g} value={g}>
                      {GOAL_LABELS[g]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="وعده در روز">
                <NumberInput value={p.mealsPerDay} onChange={(v) => set('mealsPerDay', v)} />
              </Field>
            </>
          )}
          <Field label="تعداد وعده">
            <NumberInput value={p.meals} onChange={(v) => set('meals', v ?? 1)} />
          </Field>
          <Field label="اعتبار (روز)">
            <NumberInput value={p.validityDays} onChange={(v) => set('validityDays', v ?? 30)} />
          </Field>
          <Field
            label="قیمت بسته (تومان)"
            hint={perMeal ? `هر وعده ${formatToman(perMeal)}` : undefined}
          >
            <NumberInput value={p.price} onChange={(v) => set('price', v ?? 0)} />
          </Field>
          <Field label="قیمت بدون بسته (برای نمایش صرفه‌جویی)">
            <NumberInput value={p.compareAtPrice} onChange={(v) => set('compareAtPrice', v)} />
          </Field>
          <Field label="سقف قیمت هر آیتم" hint="برای گران‌ترها مشتری فقط مابه‌التفاوت را می‌دهد">
            <NumberInput value={p.maxItemPrice} onChange={(v) => set('maxItemPrice', v)} />
          </Field>
          <Field label="توضیح">
            <input
              className="pc-input"
              value={p.description ?? ''}
              onChange={(e) => set('description', e.target.value || null)}
            />
          </Field>
        </div>
        <Field label="دسته‌بندی‌های قابل استفاده (هیچ = همه)">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {menu.data?.categories.map((c) => (
              <Chip
                key={c.id}
                pressed={p.eligibleCategoryIds.includes(c.id)}
                onClick={() =>
                  set(
                    'eligibleCategoryIds',
                    p.eligibleCategoryIds.includes(c.id)
                      ? p.eligibleCategoryIds.filter((x) => x !== c.id)
                      : [...p.eligibleCategoryIds, c.id],
                  )
                }
              >
                {c.name}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="row" style={{ gap: 'var(--space-5)' }}>
          <Switch
            checked={p.isFeatured}
            onChange={(v) => set('isFeatured', v)}
            label="ویژه (بیشترین صرفه)"
          />
          <Switch checked={p.isActive} onChange={(v) => set('isActive', v)} label="فعال" />
        </div>
      </div>
    </Drawer>
  );
}
