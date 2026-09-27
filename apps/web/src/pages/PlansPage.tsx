import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlanDto, SubscriptionDto, SubscriptionScheduleInput } from '@prochia/shared';
import {
  GOAL_LABELS,
  WEEKDAYS_FA,
  WEEKDAY_ORDER,
  formatJalali,
  formatToman,
  toFaDigits,
} from '@prochia/shared';
import {
  Button,
  Chip,
  Field,
  Icon,
  Money,
  Progress,
  Segmented,
  Sheet,
  Skeleton,
  Tag,
  useToast,
} from '@prochia/ui';
import { api, errorMessage } from '../lib/api';
import { keys, useMember, useMenu, usePlans, useSubscriptions } from '../lib/queries';
import { track } from '../lib/track';

const dateOf = (iso: string) => new Date(`${iso}T12:00:00+03:30`);

export function PlansPage() {
  const plans = usePlans();
  const { user, isActive, membership } = useMember();
  const subs = useSubscriptions(isActive);
  const [buying, setBuying] = useState<PlanDto | null>(null);
  const [scheduling, setScheduling] = useState<SubscriptionDto | null>(null);
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const client = useQueryClient();

  useEffect(() => track('plan_view'), []);
  useEffect(() => {
    const result = params.get('purchase');
    if (!result) return;
    toast(
      result === 'ok' ? 'بسته فعال شد' : 'پرداخت انجام نشد',
      result === 'ok' ? 'success' : 'error',
    );
    setParams({}, { replace: true });
    void client.invalidateQueries({ queryKey: keys.subscriptions });
  }, [params, setParams, toast, client]);

  const active = (subs.data ?? []).filter(
    (s) => s.status === 'active' || s.status === 'pending_payment',
  );
  const packages = (plans.data ?? []).filter((p) => p.kind === 'package');
  const mealPlans = (plans.data ?? []).filter((p) => p.kind === 'meal_plan');

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">بسته‌ها و برنامه‌ها</h1>
          <p className="page-sub">پیش‌خرید وعده با تخفیف؛ هنگام سفارش خودکار از بسته کم می‌شود.</p>
        </div>
      </div>

      {active.length > 0 && (
        <section className="section stack" style={{ borderTop: 0, paddingTop: 0 }}>
          <div className="section-title">بسته‌های من</div>
          {active.map((s) => (
            <div key={s.id} className="plan">
              <div className="row-between">
                <b>{s.plan.name}</b>
                {s.status === 'pending_payment' ? (
                  <Tag tone="warning">در انتظار پرداخت</Tag>
                ) : (
                  <Tag tone="green">فعال</Tag>
                )}
              </div>
              <Progress value={s.remaining} max={s.credits} />
              <div className="row-between page-sub num">
                <span>
                  {toFaDigits(s.remaining)} از {toFaDigits(s.credits)} وعده باقی‌مانده
                </span>
                <span>تا {formatJalali(dateOf(s.expiresOn), 'long')}</span>
              </div>
              {s.status === 'active' && (
                <div className="row-between">
                  <span className="page-sub">
                    {s.schedule?.enabled
                      ? `سفارش خودکار: ${s.schedule.days.map((d) => WEEKDAYS_FA[d]).join('، ')} ساعت ${toFaDigits(s.schedule.time)}`
                      : 'سفارش خودکار خاموش است'}
                  </span>
                  <Button size="s" icon="calendar" onClick={() => setScheduling(s)}>
                    برنامه تحویل
                  </Button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {plans.isLoading && <Skeleton height={300} />}

      {packages.length > 0 && (
        <section className="section stack">
          <div className="section-title">
            بسته وعده
            <small>هر وقت خواستی استفاده کن</small>
          </div>
          {packages.map((p) => (
            <PlanCard key={p.id} plan={p} onBuy={() => setBuying(p)} canBuy={isActive} />
          ))}
        </section>
      )}

      {mealPlans.length > 0 && (
        <section className="section stack">
          <div className="section-title">
            برنامه غذایی هدف‌دار
            <small>هر روز خودکار سفارش داده می‌شود</small>
          </div>
          {mealPlans.map((p) => (
            <PlanCard key={p.id} plan={p} onBuy={() => setBuying(p)} canBuy={isActive} />
          ))}
        </section>
      )}

      {!user && (
        <Link to="/login?next=/plans" className="pc-btn pc-btn--primary pc-btn--block">
          برای خرید وارد شوید
        </Link>
      )}

      {buying && (
        <PurchaseSheet
          plan={buying}
          walletBalance={membership?.walletBalance ?? 0}
          onClose={() => setBuying(null)}
        />
      )}
      {scheduling && (
        <ScheduleSheet subscription={scheduling} onClose={() => setScheduling(null)} />
      )}
    </div>
  );
}

function PlanCard({ plan, onBuy, canBuy }: { plan: PlanDto; onBuy: () => void; canBuy: boolean }) {
  return (
    <article className={plan.isFeatured ? 'plan plan--featured' : 'plan'}>
      <div className="row-between">
        <h3 style={{ fontWeight: 850, fontSize: 'var(--text-l)' }}>{plan.name}</h3>
        <div className="row" style={{ gap: 6 }}>
          {plan.isFeatured && <Tag tone="lime">بیشترین صرفه</Tag>}
          {plan.goal && <Tag tone="green">{GOAL_LABELS[plan.goal]}</Tag>}
        </div>
      </div>
      {plan.description && <p className="page-sub">{plan.description}</p>}
      <div className="plan__price">
        <strong>
          <Money amount={plan.price} />
        </strong>
        {plan.compareAtPrice && <s className="num">{formatToman(plan.compareAtPrice)}</s>}
        {plan.savingPct > 0 && <Tag tone="green">{toFaDigits(plan.savingPct)}٪ صرفه‌جویی</Tag>}
      </div>
      <div className="row-between page-sub num">
        <span>
          {toFaDigits(plan.meals)} وعده · اعتبار {toFaDigits(plan.validityDays)} روز
        </span>
        <span>هر وعده {formatToman(plan.pricePerMeal)}</span>
      </div>
      {plan.maxItemPrice && (
        <p className="page-sub">
          غذاهای تا {formatToman(plan.maxItemPrice)} کامل پوشش داده می‌شوند؛ برای گران‌ترها فقط
          مابه‌التفاوت را می‌دهید.
        </p>
      )}
      <Button variant={plan.isFeatured ? 'primary' : 'ink'} disabled={!canBuy} onClick={onBuy}>
        خرید
      </Button>
    </article>
  );
}

function PurchaseSheet({
  plan,
  walletBalance,
  onClose,
}: {
  plan: PlanDto;
  walletBalance: number;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<'wallet' | 'gateway'>(
    walletBalance >= plan.price ? 'wallet' : 'gateway',
  );
  const client = useQueryClient();
  const toast = useToast();
  const buy = useMutation({
    mutationFn: () =>
      api<{ redirectUrl: string | null }>(`/plans/${plan.id}/purchase`, {
        method: 'POST',
        body: { method },
      }),
    onSuccess: (res) => {
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl;
        return;
      }
      toast(`${plan.name} فعال شد`, 'success');
      void client.invalidateQueries({ queryKey: keys.subscriptions });
      void client.invalidateQueries({ queryKey: keys.me });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title={`خرید ${plan.name}`}
      footer={
        <Button
          variant="primary"
          size="l"
          block
          loading={buy.isPending}
          onClick={() => buy.mutate()}
        >
          پرداخت {formatToman(plan.price)}
        </Button>
      }
    >
      <div className="stack-l">
        <div className="summary">
          <div>
            <span>{toFaDigits(plan.meals)} وعده</span>
            <Money amount={plan.price} />
          </div>
          <div>
            <span>اعتبار</span>
            <span className="num">{toFaDigits(plan.validityDays)} روز از امروز</span>
          </div>
        </div>
        <Segmented
          value={method}
          onChange={setMethod}
          options={[
            { value: 'wallet', label: `کیف پول (${formatToman(walletBalance)})` },
            { value: 'gateway', label: 'پرداخت آنلاین' },
          ]}
        />
        {method === 'wallet' && walletBalance < plan.price && (
          <div className="notice notice--warning">
            <div>
              موجودی کافی نیست.{' '}
              <Link to="/wallet">
                <b>شارژ کیف پول</b>
              </Link>{' '}
              با هدیه شارژ، بسته ارزان‌تر هم می‌شود.
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ScheduleSheet({
  subscription,
  onClose,
}: {
  subscription: SubscriptionDto;
  onClose: () => void;
}) {
  const menu = useMenu();
  const toast = useToast();
  const client = useQueryClient();
  const [schedule, setSchedule] = useState<SubscriptionScheduleInput>(
    subscription.schedule ?? {
      enabled: true,
      days: [6, 0, 1, 2, 3],
      time: '19:30',
      mode: 'auto',
      itemIds: [],
    },
  );
  const eligible = useMemo(
    () =>
      (menu.data?.categories ?? [])
        .flatMap((c) => c.items)
        .filter(
          (i) =>
            i.creditEligible &&
            i.groups.every((g) => g.minSelect === 0 || g.options.some((o) => o.isDefault)),
        ),
    [menu.data],
  );
  const save = useMutation({
    mutationFn: () =>
      api(`/subscriptions/${subscription.id}/schedule`, { method: 'PUT', body: schedule }),
    onSuccess: () => {
      toast('برنامه تحویل ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: keys.subscriptions });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const set = <K extends keyof SubscriptionScheduleInput>(k: K, v: SubscriptionScheduleInput[K]) =>
    setSchedule((s) => ({ ...s, [k]: v }));
  const times = Array.from({ length: 64 }, (_, i) => {
    const m = 7 * 60 + i * 15;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title="برنامه تحویل خودکار"
      footer={
        <Button
          variant="primary"
          size="l"
          block
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          ذخیره
        </Button>
      }
    >
      <div className="stack-l">
        <p className="muted">
          در روزهای انتخابی، چهار ساعت قبل از زمان تحویل سفارش ثبت می‌شود و پس از تأیید رستوران سر
          ساعت آماده است. هر روز پیامک می‌گیری.
        </p>
        <label className="pay-option">
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          <span className="pay-option__label">سفارش خودکار روشن باشد</span>
          <Icon name="clock" />
        </label>
        <Field label="روزها">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {WEEKDAY_ORDER.map((d) => (
              <Chip
                key={d}
                pressed={schedule.days.includes(d)}
                onClick={() =>
                  set(
                    'days',
                    schedule.days.includes(d)
                      ? schedule.days.filter((x) => x !== d)
                      : [...schedule.days, d],
                  )
                }
              >
                {WEEKDAYS_FA[d]}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="ساعت تحویل">
          <select
            className="pc-input num"
            value={schedule.time}
            onChange={(e) => set('time', e.target.value)}
          >
            {times.map((t) => (
              <option key={t} value={t}>
                {toFaDigits(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="انتخاب غذا">
          <Segmented
            value={schedule.mode}
            onChange={(v) => set('mode', v)}
            options={[
              { value: 'auto', label: 'به انتخاب پروچیا بر اساس هدفم' },
              { value: 'fixed', label: 'خودم انتخاب می‌کنم' },
            ]}
          />
        </Field>
        {schedule.mode === 'fixed' && (
          <Field label="غذاها (به‌ترتیب هر روز یکی)">
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {eligible.map((i) => (
                <Chip
                  key={i.id}
                  pressed={schedule.itemIds.includes(i.id)}
                  onClick={() =>
                    set(
                      'itemIds',
                      schedule.itemIds.includes(i.id)
                        ? schedule.itemIds.filter((x) => x !== i.id)
                        : [...schedule.itemIds, i.id],
                    )
                  }
                >
                  {i.name}
                </Chip>
              ))}
            </div>
          </Field>
        )}
      </div>
    </Sheet>
  );
}
