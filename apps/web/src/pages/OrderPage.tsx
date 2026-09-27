import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  formatDateTime,
  formatNumber,
  formatTime,
  formatToman,
  toFaDigits,
} from '@prochia/shared';
import {
  Button,
  Empty,
  Field,
  Icon,
  MacroBar,
  MacroLegend,
  Money,
  Skeleton,
  Tag,
  useToast,
} from '@prochia/ui';
import { OrderTimeline, orderStatusTone } from '../components/OrderStatus';
import { api, errorMessage } from '../lib/api';
import { keys, useLiveOrder } from '../lib/queries';

export function OrderPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const order = useLiveOrder(id);
  const client = useQueryClient();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const cancel = useMutation({
    mutationFn: () => api(`/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast('سفارش لغو شد؛ مبلغ پرداختی به کیف پول برگشت', 'success');
      void client.invalidateQueries({ queryKey: keys.order(id) });
      void client.invalidateQueries({ queryKey: keys.me });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const rate = useMutation({
    mutationFn: () =>
      api(`/orders/${id}/rating`, {
        method: 'POST',
        body: { rating, comment: comment.trim() || undefined },
      }),
    onSuccess: () => {
      toast('ممنون از نظرت!', 'success');
      void client.invalidateQueries({ queryKey: keys.order(id) });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (order.isLoading) {
    return (
      <div className="stack" style={{ paddingTop: 'var(--space-4)' }}>
        <Skeleton height={150} />
        <Skeleton height={220} />
      </div>
    );
  }
  if (!order.data) return <Empty icon="receipt" title="سفارش پیدا نشد" />;
  const o = order.data;

  return (
    <div>
      {params.get('payment') === 'failed' && (
        <div className="notice notice--danger" style={{ marginTop: 'var(--space-4)' }}>
          <Icon name="alert" />
          پرداخت انجام نشد و سفارش ثبت نشد. می‌توانید دوباره از سبد خرید اقدام کنید.
        </div>
      )}

      <div className="order-hero">
        <span className="muted">شماره سفارش</span>
        <span className="order-hero__number">{toFaDigits(o.number)}</span>
        <div className="row-between">
          <span className="order-hero__status">{ORDER_STATUS_LABELS[o.status]}</span>
          <Tag tone={orderStatusTone(o.status)}>
            {o.spot ? o.spot.label : ORDER_TYPE_LABELS[o.type]}
          </Tag>
        </div>
        {o.scheduledFor && (
          <span className="muted">
            پیش‌سفارش برای ساعت <b className="num">{formatTime(new Date(o.scheduledFor))}</b> —{' '}
            {formatDateTime(new Date(o.scheduledFor))}
          </span>
        )}
      </div>

      {o.status === 'ready' && (
        <div className="notice notice--green" style={{ marginTop: 'var(--space-3)' }}>
          <Icon name="bell" />
          <div>
            سفارش آماده است.{' '}
            {o.type === 'dine_in'
              ? 'همین الان سر میز می‌آوریم.'
              : `تحویل از ${o.tickets
                  .filter((t) => t.status === 'ready')
                  .map((t) => [t.stationName, t.floorLabel].filter(Boolean).join(' '))
                  .join(' و ')}.`}
          </div>
        </div>
      )}

      <section className="section">
        <OrderTimeline order={o} />
      </section>

      {o.pendingPayment?.status === 'awaiting_review' && (
        <div className="notice notice--warning">
          <Icon name="clock" />
          پرداخت کارت‌به‌کارت شما در حال بررسی توسط صندوق است.
        </div>
      )}

      <section className="section">
        <div className="section-title">اقلام</div>
        <div className="list">
          {o.lines.map((l) => (
            <div key={l.id} className="cart-line" style={l.removed ? { opacity: 0.5 } : undefined}>
              <div>
                <div className="cart-line__name">
                  {toFaDigits(l.quantity)}× {l.name}
                </div>
                {l.options.length > 0 && (
                  <div className="cart-line__opts">{l.options.map((x) => x.name).join('، ')}</div>
                )}
                {l.removed && <Tag tone="danger">ناموجود بود و حذف شد</Tag>}
                {l.creditsUsed > 0 && (
                  <Tag tone="green">{toFaDigits(l.creditsUsed)} وعده از بسته</Tag>
                )}
              </div>
              <Money amount={l.lineTotal} />
            </div>
          ))}
        </div>
        <div className="stack" style={{ marginTop: 'var(--space-4)', gap: 6 }}>
          <span className="page-sub num">{formatNumber(o.nutrition.kcal)} کالری در کل سفارش</span>
          <MacroBar nutrition={o.nutrition} />
          <MacroLegend nutrition={o.nutrition} />
        </div>
      </section>

      <section className="section summary">
        {o.creditsValue > 0 && (
          <div className="summary__saving">
            <span>اعتبار بسته</span>
            <span className="num">−{formatToman(o.creditsValue)}</span>
          </div>
        )}
        {o.memberDiscount + o.promoDiscount > 0 && (
          <div className="summary__saving">
            <span>تخفیف</span>
            <span className="num">−{formatToman(o.memberDiscount + o.promoDiscount)}</span>
          </div>
        )}
        <div className="summary__total">
          <span>
            {o.paymentState === 'paid'
              ? 'پرداخت شد'
              : o.paymentState === 'postpaid'
                ? 'به حساب اعتباری'
                : o.paymentState === 'refunded'
                  ? 'به کیف پول برگشت'
                  : 'قابل پرداخت در صندوق'}
          </span>
          <Money amount={o.total} />
        </div>
        <span className="page-sub">روش پرداخت: {PAYMENT_METHOD_LABELS[o.paymentMethod]}</span>
      </section>

      {(o.status === 'placed' || o.status === 'awaiting_payment') && (
        <section className="section">
          <Button variant="danger" block loading={cancel.isPending} onClick={() => cancel.mutate()}>
            لغو سفارش
          </Button>
          <p className="page-sub" style={{ marginTop: 8 }}>
            تا قبل از تأیید رستوران می‌توانید سفارش را لغو کنید.
          </p>
        </section>
      )}

      {o.status === 'completed' && (
        <section className="section stack">
          <div className="section-title">نظرت درباره این سفارش؟</div>
          {o.rating ? (
            <p className="muted">
              امتیاز شما: {toFaDigits(o.rating)} از ۵{o.ratingComment && ` — «${o.ratingComment}»`}
            </p>
          ) : (
            <>
              <div className="stars" role="group" aria-label="امتیاز">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={n <= rating}
                    aria-label={`${toFaDigits(n)} ستاره`}
                    onClick={() => setRating(n)}
                  >
                    <Icon name="star" size={30} />
                  </button>
                ))}
              </div>
              {rating > 0 && (
                <>
                  <Field label="توضیح (اختیاری)">
                    <textarea
                      className="pc-input"
                      rows={2}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </Field>
                  <Button variant="ink" loading={rate.isPending} onClick={() => rate.mutate()}>
                    ثبت نظر
                  </Button>
                </>
              )}
            </>
          )}
        </section>
      )}

      <section className="section">
        <Link to="/" className="pc-btn pc-btn--block">
          بازگشت به منو
        </Link>
      </section>
    </div>
  );
}
