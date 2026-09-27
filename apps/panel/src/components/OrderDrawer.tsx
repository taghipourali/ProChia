import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StaffOrderDto } from '@prochia/shared';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  TICKET_STATUS_LABELS,
  formatNumber,
  formatTime,
  formatToman,
  maskMobile,
  toFaDigits,
} from '@prochia/shared';
import { Button, Field, Icon, MacroLegend, Money, Tag, useToast } from '@prochia/ui';
import { ApiError, api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { paymentLabel, scheduleLabel } from '../lib/board';
import { printOrder } from '../lib/print';
import { Drawer } from './kit';

const EVENT_LABELS: Record<string, string> = {
  placed: 'ثبت سفارش',
  accepted: 'تأیید رستوران',
  preparing: 'شروع آماده‌سازی',
  ready: 'آماده شد',
  completed: 'تحویل شد',
  rejected: 'رد شد',
  cancelled: 'لغو شد',
  payment_succeeded: 'پرداخت موفق',
  payment_rejected: 'پرداخت کارت‌به‌کارت رد شد',
  auto_accept_skipped: 'تأیید خودکار انجام نشد',
  postpaid_settled: 'تسویه اعتباری',
};

interface Shortage {
  name: string;
  unit: string;
  required: number;
  onHand: number;
}

export function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const auth = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const [remove, setRemove] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [shortages, setShortages] = useState<Shortage[] | null>(null);

  const order = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api<StaffOrderDto>(`/staff/orders/${orderId}`),
    enabled: Boolean(orderId),
  });
  useEffect(() => {
    setRemove([]);
    setReason('');
    setShortages(null);
  }, [orderId]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['board'] });
    void client.invalidateQueries({ queryKey: ['order', orderId] });
  };
  const run = (fn: () => Promise<unknown>, done: string) =>
    fn()
      .then(() => {
        toast(done, 'success');
        refresh();
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'insufficient_stock') {
          setShortages((e.details as { shortages: Shortage[] }).shortages);
        }
        toast(errorMessage(e), 'error');
      });

  const accept = useMutation({
    mutationFn: (force: boolean) =>
      run(
        () =>
          api(`/staff/orders/${orderId}/accept`, {
            method: 'POST',
            body: { removeLineIds: remove, force },
          }),
        'سفارش تأیید شد',
      ),
  });
  const reject = useMutation({
    mutationFn: () =>
      run(
        () => api(`/staff/orders/${orderId}/reject`, { method: 'POST', body: { reason } }),
        'سفارش رد شد و مبلغ برگشت داده شد',
      ),
  });
  const handover = useMutation({
    mutationFn: (collect: boolean) =>
      run(
        () => api(`/staff/orders/${orderId}/handover`, { method: 'POST', body: { collect } }),
        'تحویل شد',
      ),
  });
  const collect = useMutation({
    mutationFn: () =>
      run(
        () => api(`/staff/orders/${orderId}/collect`, { method: 'POST' }),
        'پرداخت در صندوق ثبت شد',
      ),
  });
  const ticket = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'ready' | 'reopen' }) =>
      run(() => api(`/staff/tickets/${id}`, { method: 'POST', body: { action } }), 'به‌روز شد'),
  });

  const o = order.data;
  const pay = o ? paymentLabel(o) : null;
  const unpaid = o ? o.paymentState === 'unpaid' && o.total > o.paidAmount : false;

  return (
    <Drawer
      open={Boolean(orderId)}
      onClose={onClose}
      title={o ? `سفارش ${toFaDigits(o.number)} — ${ORDER_STATUS_LABELS[o.status]}` : 'سفارش'}
      footer={
        o && (
          <>
            <Button
              variant="ghost"
              icon="printer"
              onClick={() => printOrder(o, auth.me?.branch.gymName ?? '')}
            >
              چاپ فیش
            </Button>
            {o.status === 'placed' && auth.can('orders.accept') && (
              <>
                <Button
                  variant="primary"
                  loading={accept.isPending}
                  onClick={() => accept.mutate(false)}
                >
                  {remove.length ? `تأیید بدون ${toFaDigits(remove.length)} قلم` : 'تأیید سفارش'}
                </Button>
                {shortages && (
                  <Button
                    variant="ink"
                    loading={accept.isPending}
                    onClick={() => accept.mutate(true)}
                  >
                    تأیید با وجود کسری انبار
                  </Button>
                )}
              </>
            )}
            {o.status === 'ready' && auth.can('orders.handover') && (
              <Button
                variant="primary"
                loading={handover.isPending}
                onClick={() => handover.mutate(unpaid)}
              >
                {unpaid ? `دریافت ${formatToman(o.total - o.paidAmount)} و تحویل` : 'تحویل شد'}
              </Button>
            )}
            {unpaid &&
              o.status !== 'ready' &&
              !['rejected', 'cancelled', 'completed'].includes(o.status) &&
              auth.can('orders.handover') && (
                <Button loading={collect.isPending} onClick={() => collect.mutate()}>
                  ثبت پرداخت در صندوق
                </Button>
              )}
          </>
        )
      }
    >
      {!o ? null : (
        <div className="stack" style={{ gap: 'var(--space-5)' }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {o.spot && <Tag tone="ink">{o.spot.label}</Tag>}
            {scheduleLabel(o) && <Tag tone="info">{scheduleLabel(o)}</Tag>}
            {pay && <Tag tone={pay.tone}>{pay.text}</Tag>}
            <Tag>{PAYMENT_METHOD_LABELS[o.paymentMethod]}</Tag>
            {o.source === 'subscription' && <Tag tone="green">سفارش خودکار بسته</Tag>}
          </div>

          {o.member && (
            <div className="row-between">
              <div>
                <b>{o.member.name ?? 'بدون نام'}</b> {o.member.isVip && <Tag tone="ink">VIP</Tag>}{' '}
                {o.member.tierName && <Tag tone="lime">{o.member.tierName}</Tag>}
                <div className="hint ltr num">{maskMobile(o.member.phone)}</div>
              </div>
              <span className="hint num">{formatTime(new Date(o.createdAt))}</span>
            </div>
          )}

          {shortages && (
            <div className="notice notice--danger">
              <Icon name="alert" />
              <div>
                <b>کسری انبار:</b>
                {shortages.map((s) => (
                  <div key={s.name} className="num">
                    {s.name}: لازم {formatNumber(s.required)}، موجود {formatNumber(s.onHand)}
                  </div>
                ))}
                <div>
                  اقلام ناموجود را علامت بزنید تا حذف شوند، یا اگر موجودی واقعی کافی است با وجود
                  کسری تأیید کنید.
                </div>
              </div>
            </div>
          )}

          <div>
            {o.tickets.map((t) => (
              <div key={t.id} style={{ marginBottom: 'var(--space-4)' }}>
                <div
                  className="row-between"
                  style={{
                    borderBottom: '2px solid var(--ink)',
                    paddingBottom: 4,
                    marginBottom: 6,
                  }}
                >
                  <b>
                    {t.stationName} {t.floorLabel && <span className="hint">· {t.floorLabel}</span>}
                  </b>
                  <div className="row" style={{ gap: 6 }}>
                    <Tag
                      tone={
                        t.status === 'ready'
                          ? 'green'
                          : t.status === 'preparing'
                            ? 'lime'
                            : undefined
                      }
                    >
                      {TICKET_STATUS_LABELS[t.status]}
                    </Tag>
                    {auth.can('tickets.update') && ['queued', 'scheduled'].includes(t.status) && (
                      <Button size="s" onClick={() => ticket.mutate({ id: t.id, action: 'start' })}>
                        شروع
                      </Button>
                    )}
                    {auth.can('tickets.update') && t.status === 'preparing' && (
                      <Button
                        size="s"
                        variant="primary"
                        onClick={() => ticket.mutate({ id: t.id, action: 'ready' })}
                      >
                        آماده
                      </Button>
                    )}
                    {auth.can('tickets.update') &&
                      t.status === 'ready' &&
                      o.status !== 'completed' && (
                        <Button
                          size="s"
                          variant="ghost"
                          onClick={() => ticket.mutate({ id: t.id, action: 'reopen' })}
                        >
                          برگرداندن
                        </Button>
                      )}
                  </div>
                </div>
                {o.lines
                  .filter((l) => l.stationId === t.stationId)
                  .map((l) => (
                    <label
                      key={l.id}
                      className="row-between"
                      style={{ padding: '6px 0', opacity: l.removed ? 0.45 : 1 }}
                    >
                      <span className="row" style={{ gap: 8 }}>
                        {o.status === 'placed' && (
                          <input
                            type="checkbox"
                            aria-label="حذف این قلم"
                            checked={remove.includes(l.id)}
                            onChange={(e) =>
                              setRemove((r) =>
                                e.target.checked ? [...r, l.id] : r.filter((x) => x !== l.id),
                              )
                            }
                          />
                        )}
                        <span>
                          <b className="num">{toFaDigits(l.quantity)}×</b> {l.name}
                          {l.options.length > 0 && (
                            <span className="hint">
                              {' '}
                              — {l.options.map((x) => x.name).join('، ')}
                            </span>
                          )}
                          {l.note && <div className="hint">یادداشت: {l.note}</div>}
                          {l.removed && <Tag tone="danger">حذف شد</Tag>}
                        </span>
                      </span>
                      <Money amount={l.lineTotal} />
                    </label>
                  ))}
              </div>
            ))}
            {o.status === 'placed' && remove.length > 0 && (
              <p className="hint">
                اقلام علامت‌خورده حذف و مابه‌التفاوت به کیف پول مشتری برمی‌گردد.
              </p>
            )}
          </div>

          {o.note && <div className="notice notice--warning">یادداشت مشتری: {o.note}</div>}

          <div className="stack" style={{ gap: 6 }}>
            <div className="row-between">
              <span>جمع</span>
              <Money amount={o.subtotal} />
            </div>
            {o.creditsValue > 0 && (
              <div className="row-between">
                <span>اعتبار بسته</span>
                <span className="num">−{formatToman(o.creditsValue)}</span>
              </div>
            )}
            {o.memberDiscount + o.promoDiscount > 0 && (
              <div className="row-between">
                <span>تخفیف</span>
                <span className="num">−{formatToman(o.memberDiscount + o.promoDiscount)}</span>
              </div>
            )}
            <div
              className="row-between"
              style={{ borderTop: '3px solid var(--ink)', paddingTop: 6, fontWeight: 850 }}
            >
              <span>مبلغ</span>
              <Money amount={o.total} />
            </div>
            <MacroLegend nutrition={o.nutrition} />
          </div>

          {o.pendingPayment?.status === 'awaiting_review' && (
            <div className="notice notice--warning">
              <div>
                کارت‌به‌کارت: کد پیگیری <b className="ltr num">{o.pendingPayment.trackingCode}</b> —
                کارت ****{o.pendingPayment.cardLast4}. از بخش «بررسی پرداخت‌ها» تأیید کنید.
              </div>
            </div>
          )}

          {(o.status === 'placed' || o.status === 'accepted') && auth.can('orders.accept') && (
            <div className="stack">
              <Field label="رد سفارش (مبلغ پرداختی به کیف پول مشتری برمی‌گردد و پیامک می‌گیرد)">
                <input
                  className="pc-input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثلاً مرغ تمام شده است"
                />
              </Field>
              <Button
                variant="danger"
                disabled={reason.trim().length < 2}
                loading={reject.isPending}
                onClick={() => reject.mutate()}
              >
                رد سفارش
              </Button>
            </div>
          )}

          <div>
            <b>تاریخچه</b>
            <div className="stack" style={{ gap: 4, marginTop: 8 }}>
              {o.events.map((e) => (
                <div key={e.id} className="row-between hint">
                  <span>{EVENT_LABELS[e.type] ?? e.type}</span>
                  <span className="num">{formatTime(new Date(e.createdAt))}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
