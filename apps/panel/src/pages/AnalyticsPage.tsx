import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PaymentMethod } from '@prochia/shared';
import {
  PAYMENT_METHOD_LABELS,
  WEEKDAYS_FA,
  WEEKDAY_ORDER,
  formatJalali,
  formatNumber,
  formatPercent,
  formatToman,
  formatTomanCompact,
  toFaDigits,
} from '@prochia/shared';
import { Money, Segmented, Spinner } from '@prochia/ui';
import { ColumnChart } from '../components/ColumnChart';
import { BarList, Kpi, Page, Panel } from '../components/kit';
import { api } from '../lib/api';

interface Overview {
  kpi: {
    revenue: number;
    orders: number;
    averageOrder: number;
    creditsValue: number;
    discounts: number;
    preorderShare: number;
    proteinServedKg: number;
    foodCost: number;
    foodCostPct: number;
    repeatRate: number;
  };
  daily: { day: string; revenue: number; orders: number; rejected: number }[];
  topItems: { menuItemId: string; name: string; quantity: number; revenue: number }[];
  heatmap: { weekday: number; hour: number; orders: number }[];
  paymentMix: { method: PaymentMethod; amount: number; count: number }[];
  service: {
    medianAcceptMinutes: number | null;
    medianTotalMinutes: number | null;
    stations: {
      stationId: string;
      stationName: string;
      tickets: number;
      medianPrepMinutes: number | null;
      medianWaitMinutes: number | null;
    }[];
  };
  ratings: {
    distribution: { rating: number | null; count: number }[];
    average: number | null;
    recentLow: {
      orderId: string;
      number: number;
      rating: number;
      comment: string | null;
      firstName: string | null;
    }[];
  };
  funnel: { name: string; visitors: number }[];
  suggestions: { shown: number; clicked: number };
  members: { total: number; pending: number; joined: number; vip: number; walletFloat: number };
  wallet: { topups: number; bonuses: number; refunds: number };
  plans: { count: number; revenue: number };
  inventory: { value: number; lowCount: number; wasteCost: number };
}

const FUNNEL_LABELS: Record<string, string> = {
  menu_view: 'دیدن منو',
  item_view: 'دیدن جزئیات غذا',
  add_to_cart: 'افزودن به سبد',
  checkout_start: 'رفتن به پرداخت',
  order_placed: 'ثبت سفارش',
};

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);
const min = (v: number | null) => (v === null ? '—' : `${formatNumber(v, 1)} دقیقه`);

export function AnalyticsPage() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const from = new Date(Date.now() - Number(days) * 86_400_000).toISOString();
  const q = useQuery({
    queryKey: ['analytics', days],
    queryFn: () => api<Overview>(`/staff/analytics?from=${encodeURIComponent(from)}`),
  });
  const d = q.data;

  return (
    <Page
      title="گزارش‌ها"
      subtitle="فروش، سرعت سرویس، رفتار اعضا در اپ و وضعیت انبار."
      actions={
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { value: '7', label: '۷ روز' },
            { value: '30', label: '۳۰ روز' },
            { value: '90', label: '۹۰ روز' },
          ]}
        />
      }
    >
      {!d ? (
        <Spinner />
      ) : (
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          <div className="kpis">
            <Kpi
              hero
              label="فروش (سفارش‌های تحویل‌شده)"
              value={<Money amount={d.kpi.revenue} />}
              hint={`${toFaDigits(d.kpi.orders)} سفارش`}
            />
            <Kpi
              label="میانگین هر سفارش"
              value={formatTomanCompact(d.kpi.averageOrder)}
              hint="تومان"
            />
            <Kpi
              label="بهای مواد مصرفی"
              value={formatPercent(d.kpi.foodCostPct * 100)}
              hint={`${formatTomanCompact(d.kpi.foodCost)} تومان`}
            />
            <Kpi
              label="مشتری برگشتی"
              value={formatPercent(d.kpi.repeatRate * 100)}
              hint="از خریداران این دوره"
            />
            <Kpi
              label="پیش‌سفارش"
              value={formatPercent(d.kpi.preorderShare * 100)}
              hint="سهم از سفارش‌ها"
            />
            <Kpi label="پروتئین سرو‌شده" value={`${formatNumber(d.kpi.proteinServedKg, 1)} کیلو`} />
          </div>

          <Panel title="فروش روزانه">
            <ColumnChart
              data={d.daily.map((x) => ({
                key: x.day,
                label: formatJalali(new Date(`${x.day}T12:00:00+03:30`), 'dayMonth'),
                value: x.revenue,
              }))}
              format={(v) => formatTomanCompact(v)}
            />
          </Panel>

          <div className="grid-2">
            <Panel title="پرفروش‌ترین‌ها (تعداد)">
              <BarList
                rows={d.topItems.map((i) => ({
                  label: i.name,
                  value: i.quantity,
                  note: `· ${formatTomanCompact(i.revenue)}`,
                }))}
              />
            </Panel>
            <Panel title="ساعت‌های شلوغ">
              <div className="heat" role="img" aria-label="تعداد سفارش بر اساس روز و ساعت">
                <span className="lbl" />
                {HOURS.map((h) => (
                  <span key={h} className="lbl" style={{ justifyItems: 'center', fontSize: 10 }}>
                    {h % 3 === 0 ? toFaDigits(h) : ''}
                  </span>
                ))}
                {WEEKDAY_ORDER.map((wd) => {
                  const maxCell = Math.max(...d.heatmap.map((c) => c.orders), 1);
                  return [
                    <span key={`l${wd}`} className="lbl">
                      {WEEKDAYS_FA[wd]}
                    </span>,
                    ...HOURS.map((h) => {
                      const n =
                        d.heatmap.find((c) => c.weekday === wd && c.hour === h)?.orders ?? 0;
                      return (
                        <span
                          key={`${wd}-${h}`}
                          title={`${WEEKDAYS_FA[wd]} ساعت ${toFaDigits(h)}: ${toFaDigits(n)} سفارش`}
                          style={{
                            background: n
                              ? `color-mix(in srgb, var(--green-700) ${Math.round(12 + (n / maxCell) * 88)}%, var(--surface-2))`
                              : 'var(--surface-2)',
                          }}
                        />
                      );
                    }),
                  ];
                })}
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                رنگ پررنگ‌تر = سفارش بیشتر. برای برنامه‌ریزی نیرو و فرآوری قبل از ساعت‌های اوج.
              </p>
            </Panel>
          </div>

          <div className="grid-2">
            <Panel title="سرعت سرویس (میانه)">
              <div className="stack">
                <div className="row-between">
                  <span>از ثبت تا تأیید رستوران</span>
                  <b className="num">{min(d.service.medianAcceptMinutes)}</b>
                </div>
                <div className="row-between">
                  <span>از ثبت تا آماده (سفارش فوری)</span>
                  <b className="num">{min(d.service.medianTotalMinutes)}</b>
                </div>
                <table className="data">
                  <thead>
                    <tr>
                      <th>ایستگاه</th>
                      <th className="n">تیکت</th>
                      <th className="n">انتظار در صف</th>
                      <th className="n">آماده‌سازی</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.service.stations.map((s) => (
                      <tr key={s.stationId}>
                        <td>{s.stationName}</td>
                        <td className="n">{toFaDigits(s.tickets)}</td>
                        <td className="n">{min(s.medianWaitMinutes)}</td>
                        <td className="n">{min(s.medianPrepMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="مسیر سفارش در اپ (بازدیدکننده روزانه)">
              <BarList
                rows={d.funnel.map((f) => ({
                  label: FUNNEL_LABELS[f.name] ?? f.name,
                  value: f.visitors,
                  note: d.funnel[0]!.visitors
                    ? `(${formatPercent((f.visitors / d.funnel[0]!.visitors) * 100)})`
                    : undefined,
                }))}
              />
              <p className="hint" style={{ marginTop: 'var(--space-3)' }}>
                پیشنهادهای شخصی: {toFaDigits(d.suggestions.shown)} بار نمایش،{' '}
                {toFaDigits(d.suggestions.clicked)} کلیک (
                {d.suggestions.shown
                  ? formatPercent((d.suggestions.clicked / d.suggestions.shown) * 100)
                  : '—'}
                )
              </p>
            </Panel>
          </div>

          <div className="grid-2">
            <Panel
              title={`رضایت مشتری — میانگین ${d.ratings.average ? formatNumber(d.ratings.average, 1) : '—'} از ۵`}
            >
              <BarList
                rows={[5, 4, 3, 2, 1].map((r) => ({
                  label: `${toFaDigits(r)} ستاره`,
                  value: d.ratings.distribution.find((x) => x.rating === r)?.count ?? 0,
                }))}
              />
              {d.ratings.recentLow.length > 0 && (
                <div className="stack" style={{ marginTop: 'var(--space-4)', gap: 6 }}>
                  <b>نظرهای ضعیف اخیر</b>
                  {d.ratings.recentLow.map((r) => (
                    <div key={r.orderId} className="row-between hint">
                      <span>
                        سفارش {toFaDigits(r.number)} · {r.firstName}: «{r.comment ?? 'بدون توضیح'}»
                      </span>
                      <span className="num">{toFaDigits(r.rating)}★</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="روش‌های پرداخت">
              <BarList
                rows={d.paymentMix.map((p) => ({
                  label: PAYMENT_METHOD_LABELS[p.method],
                  value: p.amount,
                  note: `· ${toFaDigits(p.count)} بار`,
                }))}
                format={(v) => formatTomanCompact(v)}
              />
            </Panel>
          </div>

          <div className="kpis">
            <Kpi
              label="اعضای فعال"
              value={toFaDigits(d.members.total)}
              hint={`${toFaDigits(d.members.joined)} عضو جدید · ${toFaDigits(d.members.pending)} منتظر تأیید`}
            />
            <Kpi
              label="موجودی کیف پول اعضا"
              value={formatTomanCompact(d.members.walletFloat)}
              hint={`شارژ دوره ${formatTomanCompact(d.wallet.topups)} · هدیه ${formatTomanCompact(d.wallet.bonuses)}`}
            />
            <Kpi
              label="فروش بسته‌ها"
              value={formatTomanCompact(d.plans.revenue)}
              hint={`${toFaDigits(d.plans.count)} بسته · اعتبار مصرف‌شده ${formatTomanCompact(d.kpi.creditsValue)}`}
            />
            <Kpi
              label="تخفیف‌های داده‌شده"
              value={formatTomanCompact(d.kpi.discounts)}
              hint="تومان"
            />
            <Kpi
              label="ارزش انبار"
              value={formatTomanCompact(d.inventory.value)}
              hint={`${toFaDigits(d.inventory.lowCount)} قلم کم · ضایعات ${formatToman(d.inventory.wasteCost)}`}
            />
          </div>
        </div>
      )}
    </Page>
  );
}
