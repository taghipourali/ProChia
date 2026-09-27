import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Goal, TierDto } from '@prochia/shared';
import { GOALS, GOAL_LABELS, formatDateTime, maskMobile, toFaDigits } from '@prochia/shared';
import { Button, Field, Tag, useToast } from '@prochia/ui';
import { NumberInput, Page, Panel, Switch, Tabs } from '../components/kit';
import { api, errorMessage } from '../lib/api';

interface Campaign {
  id: string;
  title: string;
  body: string;
  status: 'draft' | 'sent';
  recipients: number;
  createdAt: string;
  sentAt: string | null;
}
interface SmsRow {
  id: string;
  phone: string;
  template: string;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

const TEMPLATE_LABELS: Record<string, string> = {
  otp: 'کد ورود',
  order_accepted: 'تأیید پیش‌سفارش',
  order_rejected: 'رد سفارش',
  order_ready: 'آماده بودن سفارش',
  birthday: 'تولد',
  plan_expiring: 'انقضای بسته',
  low_credits: 'اتمام اعتبار بسته',
  payment_reviewed: 'بررسی پرداخت',
  campaign: 'کمپین',
};

export function SmsPage() {
  const [tab, setTab] = useState<'compose' | 'log'>('compose');
  return (
    <Page
      title="پیامک"
      subtitle="پیامک‌های سفارش خودکار ارسال می‌شوند؛ اینجا کمپین باشگاه مشتریان بفرستید."
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'compose', label: 'کمپین‌ها' },
          { value: 'log', label: 'گزارش ارسال' },
        ]}
      />
      {tab === 'compose' ? <Campaigns /> : <SmsLog />}
    </Page>
  );
}

function Campaigns() {
  const client = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<Campaign[]>('/staff/campaigns'),
  });
  const tiers = useQuery({ queryKey: ['tiers'], queryFn: () => api<TierDto[]>('/staff/tiers') });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [goal, setGoal] = useState<Goal | ''>('');
  const [tierId, setTierId] = useState('');
  const [vipOnly, setVipOnly] = useState(false);
  const [inactiveDays, setInactiveDays] = useState<number | null>(null);
  const audience = { goal: goal || null, tierId: tierId || null, vipOnly, inactiveDays };
  const preview = useQuery({
    queryKey: ['campaign-preview', audience],
    queryFn: () =>
      api<{ audienceSize: number }>('/staff/campaigns/preview', {
        method: 'POST',
        body: { title: 'x', body: 'x', audience },
      }),
  });
  const create = useMutation({
    mutationFn: async () => {
      const c = await api<Campaign>('/staff/campaigns', {
        method: 'POST',
        body: { title, body, audience },
      });
      return api<{ recipients: number }>(`/staff/campaigns/${c.id}/send`, { method: 'POST' });
    },
    onSuccess: (r) => {
      toast(`برای ${toFaDigits(r.recipients)} نفر در صف ارسال قرار گرفت`, 'success');
      setTitle('');
      setBody('');
      void client.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const segments = Math.max(1, Math.ceil((body.length + 6) / 70));
  return (
    <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <Panel title="کمپین جدید">
        <div className="stack">
          <Field label="عنوان داخلی">
            <input
              className="pc-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="پیشنهاد آخر هفته"
            />
          </Field>
          <Field
            label="متن پیامک"
            hint={`${toFaDigits(body.length)} نویسه · ${toFaDigits(segments)} پیامک. «لغو۱۱» خودکار اضافه می‌شود.`}
          >
            <textarea
              className="pc-input"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={300}
            />
          </Field>
          <div className="form-grid">
            <Field label="هدف تمرینی">
              <select
                className="pc-input"
                value={goal}
                onChange={(e) => setGoal(e.target.value as Goal | '')}
              >
                <option value="">همه</option>
                {GOALS.map((g) => (
                  <option key={g} value={g}>
                    {GOAL_LABELS[g]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="سطح باشگاه">
              <select
                className="pc-input"
                value={tierId}
                onChange={(e) => setTierId(e.target.value)}
              >
                <option value="">همه</option>
                {tiers.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="سفارش نداده در (روز اخیر)">
              <NumberInput value={inactiveDays} onChange={setInactiveDays} placeholder="مثلاً ۱۴" />
            </Field>
          </div>
          <Switch checked={vipOnly} onChange={setVipOnly} label="فقط اعضای VIP" />
          <div
            className="row-between"
            style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--space-3)' }}
          >
            <span>
              گیرندگان: <b className="num">{toFaDigits(preview.data?.audienceSize ?? 0)}</b> نفر
            </span>
            <Button
              variant="primary"
              disabled={!title || body.length < 5 || !preview.data?.audienceSize}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              ارسال
            </Button>
          </div>
        </div>
      </Panel>
      <Panel title="کمپین‌های قبلی" flush>
        <table className="data">
          <tbody>
            {list.data?.map((c) => (
              <tr key={c.id}>
                <td>
                  <b>{c.title}</b>
                  <div className="hint">{c.body}</div>
                </td>
                <td className="n">{toFaDigits(c.recipients)} نفر</td>
                <td className="num hint">
                  {c.sentAt ? formatDateTime(new Date(c.sentAt)) : 'پیش‌نویس'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function SmsLog() {
  const log = useQuery({
    queryKey: ['sms-log'],
    queryFn: () => api<SmsRow[]>('/staff/sms'),
    refetchInterval: 15_000,
  });
  return (
    <Panel flush>
      <table className="data">
        <thead>
          <tr>
            <th>گیرنده</th>
            <th>نوع</th>
            <th>متن</th>
            <th>وضعیت</th>
            <th>زمان</th>
          </tr>
        </thead>
        <tbody>
          {log.data?.map((m) => (
            <tr key={m.id}>
              <td className="ltr num">{maskMobile(m.phone)}</td>
              <td>{TEMPLATE_LABELS[m.template] ?? m.template}</td>
              <td className="hint" style={{ maxWidth: 420 }}>
                {m.body}
              </td>
              <td>
                <Tag
                  tone={
                    m.status === 'sent' ? 'green' : m.status === 'failed' ? 'danger' : 'warning'
                  }
                >
                  {m.status === 'sent'
                    ? 'ارسال شد'
                    : m.status === 'failed'
                      ? `ناموفق (${m.lastError ?? ''})`
                      : 'در صف'}
                </Tag>
              </td>
              <td className="num hint">{formatDateTime(new Date(m.createdAt))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
