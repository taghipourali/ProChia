import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentReviewDto } from '@prochia/shared';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_PURPOSE_LABELS,
  PAYMENT_STATUS_LABELS,
  formatDateTime,
  maskMobile,
} from '@prochia/shared';
import { Button, Empty, Money, Segmented, Tag, useToast } from '@prochia/ui';
import { Page, Panel } from '../components/kit';
import { api, errorMessage } from '../lib/api';

export function PaymentsPage() {
  const [scope, setScope] = useState<'review' | 'all'>('review');
  const client = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: ['payments', scope === 'review' ? 'awaiting_review' : 'all'],
    queryFn: () =>
      api<PaymentReviewDto[]>(`/staff/payments${scope === 'all' ? '?status=all' : ''}`),
  });
  const review = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api(`/staff/payments/${id}/review`, { method: 'POST', body: { approve } }),
    onSuccess: (_d, v) => {
      toast(
        v.approve ? 'پرداخت تأیید شد و به مشتری پیامک رفت' : 'پرداخت رد شد',
        v.approve ? 'success' : 'default',
      );
      void client.invalidateQueries({ queryKey: ['payments'] });
      void client.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Page
      title="بررسی پرداخت‌ها"
      subtitle="واریزهای کارت‌به‌کارت را با پیامک بانک تطبیق دهید و تأیید کنید."
      actions={
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'review', label: 'منتظر بررسی' },
            { value: 'all', label: 'همه پرداخت‌ها' },
          ]}
        />
      }
    >
      <Panel flush>
        {list.data?.length === 0 ? (
          <Empty icon="check" title="پرداختی برای بررسی نیست" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>مشتری</th>
                  <th>بابت</th>
                  <th>روش</th>
                  <th className="n">مبلغ</th>
                  <th>کد پیگیری</th>
                  <th>۴ رقم کارت</th>
                  <th>زمان</th>
                  <th>وضعیت</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.map(({ payment: p, member }) => (
                  <tr key={p.id}>
                    <td>
                      {[member.firstName, member.lastName].filter(Boolean).join(' ') || '—'}
                      <div className="hint ltr num">{maskMobile(member.phone)}</div>
                    </td>
                    <td>{PAYMENT_PURPOSE_LABELS[p.purpose]}</td>
                    <td>{PAYMENT_METHOD_LABELS[p.method]}</td>
                    <td className="n">
                      <Money amount={p.amount} />
                    </td>
                    <td className="ltr num">{p.trackingCode ?? '—'}</td>
                    <td className="ltr num">{p.cardLast4 ?? '—'}</td>
                    <td className="num">{formatDateTime(new Date(p.createdAt))}</td>
                    <td>
                      <Tag
                        tone={
                          p.status === 'succeeded'
                            ? 'green'
                            : p.status === 'awaiting_review'
                              ? 'warning'
                              : p.status === 'failed'
                                ? 'danger'
                                : undefined
                        }
                      >
                        {PAYMENT_STATUS_LABELS[p.status]}
                      </Tag>
                    </td>
                    <td>
                      {p.status === 'awaiting_review' && (
                        <div className="row" style={{ gap: 6 }}>
                          <Button
                            size="s"
                            variant="primary"
                            onClick={() => review.mutate({ id: p.id, approve: true })}
                          >
                            تأیید
                          </Button>
                          <Button
                            size="s"
                            variant="danger"
                            onClick={() => review.mutate({ id: p.id, approve: false })}
                          >
                            رد
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Page>
  );
}
