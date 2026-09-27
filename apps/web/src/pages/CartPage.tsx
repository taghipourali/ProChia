import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentMethod, PlaceOrderResultDto, QuoteDto } from '@prochia/shared';
import { formatNumber, formatToman, tehranDateTime, toFaDigits } from '@prochia/shared';
import {
  Button,
  Empty,
  Field,
  Icon,
  MacroBar,
  MacroLegend,
  Money,
  Segmented,
  Skeleton,
  useToast,
} from '@prochia/ui';
import { Stepper } from '../components/Stepper';
import { useItemIndex, unitPrice } from '../components/useCartTotal';
import { ApiError, api, errorMessage } from '../lib/api';
import { useCart } from '../lib/cart';
import { keys, useBranch, useMember } from '../lib/queries';
import { preorderDays, preorderSlots } from '../lib/slots';
import { track } from '../lib/track';

type When = 'now' | 'later';

export function CartPage() {
  const cart = useCart();
  const items = useItemIndex();
  const branch = useBranch();
  const { user, membership, isActive, isLoading: meLoading } = useMember();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();

  const [when, setWhen] = useState<When>(() =>
    branch.data && !branch.data.isOpen ? 'later' : 'now',
  );
  const [day, setDay] = useState<string>('');
  const [time, setTime] = useState<string>('');
  const [useCredits, setUseCredits] = useState(true);
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState<string | undefined>();
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [tracking, setTracking] = useState('');
  const [last4, setLast4] = useState('');
  const [note, setNote] = useState('');
  const dineIn = Boolean(cart.table);

  useEffect(() => {
    if (cart.count) track('checkout_start', { items: cart.count });
    // Only once per visit to the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (branch.data && !branch.data.isOpen) setWhen('later');
  }, [branch.data]);

  const lines = cart.lines.filter((l) => items.has(l.itemId));
  const cartBody = useMemo(
    () => ({
      lines: lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        optionIds: l.optionIds,
        note: l.note,
      })),
      promoCode,
      useCredits,
    }),
    [lines, promoCode, useCredits],
  );

  const quote = useQuery({
    queryKey: ['quote', cartBody],
    queryFn: () => api<QuoteDto>('/cart/quote', { method: 'POST', body: cartBody }),
    enabled: isActive && lines.length > 0,
    placeholderData: (prev) => prev,
    retry: false,
  });

  const now = new Date();
  const days = branch.data ? preorderDays(now, branch.data.preorder.maxDays) : [];
  const slots =
    branch.data && day
      ? preorderSlots(day, now, branch.data.preorder.minLeadMinutes, branch.data.openingHours)
      : [];
  useEffect(() => {
    if (when === 'later' && !day && days.length) {
      const first = days.find(
        (d) =>
          branch.data &&
          preorderSlots(
            d.iso,
            new Date(),
            branch.data.preorder.minLeadMinutes,
            branch.data.openingHours,
          ).length,
      );
      if (first) setDay(first.iso);
    }
  }, [when, day, days, branch.data]);
  useEffect(() => {
    if (slots.length && !slots.includes(time)) setTime(slots[0]!);
  }, [slots, time]);

  const q = quote.data;
  const total = q?.total ?? null;
  const needsPayment = total !== null && total > 0;

  const methods: { key: PaymentMethod; label: string; hint: string; disabled?: boolean }[] = [];
  if (q) {
    methods.push({
      key: 'wallet',
      label: 'کیف پول',
      hint: `موجودی ${formatToman(q.wallet.balance)}`,
      disabled: q.wallet.balance < q.total,
    });
    methods.push({ key: 'gateway', label: 'پرداخت آنلاین', hint: 'درگاه بانکی شتاب' });
    if (branch.data?.cardNumber)
      methods.push({
        key: 'card_to_card',
        label: 'کارت‌به‌کارت',
        hint: 'پس از بررسی صندوق تأیید می‌شود',
      });
    methods.push({ key: 'counter', label: 'پرداخت در صندوق', hint: 'هنگام تحویل سفارش' });
    if (q.postpaid.allowed) {
      methods.push({
        key: 'postpaid',
        label: 'پرداخت بعدی (VIP)',
        hint: `اعتبار باقی‌مانده ${formatToman(q.postpaid.available)}`,
        disabled: q.postpaid.available < q.total,
      });
    }
  }
  const selected =
    method && methods.find((m) => m.key === method && !m.disabled)
      ? method
      : (methods.find((m) => !m.disabled)?.key ?? null);

  const place = useMutation({
    mutationFn: () => {
      const scheduledFor =
        when === 'later' && day && time ? tehranDateTime(day, time).toISOString() : null;
      return api<PlaceOrderResultDto>('/orders', {
        method: 'POST',
        body: {
          ...cartBody,
          type: dineIn && when === 'now' ? 'dine_in' : 'pickup',
          tableCode: dineIn && when === 'now' ? cart.table!.code : undefined,
          scheduledFor,
          note: note.trim() || undefined,
          paymentMethod: needsPayment ? selected : 'wallet',
          cardToCard:
            selected === 'card_to_card' ? { trackingCode: tracking, cardLast4: last4 } : undefined,
        },
      });
    },
    onSuccess: (result) => {
      track('order_placed', { number: result.number });
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      cart.clear();
      void client.invalidateQueries({ queryKey: keys.me });
      void client.invalidateQueries({ queryKey: keys.orders });
      void client.invalidateQueries({ queryKey: keys.wallet });
      navigate(`/orders/${result.orderId}`);
    },
    onError: (err) => {
      toast(errorMessage(err), 'error');
      if (
        err instanceof ApiError &&
        (err.code === 'out_of_stock' || err.code === 'item_unavailable')
      ) {
        void client.invalidateQueries({ queryKey: keys.menu });
      }
    },
  });

  if (cart.count === 0) {
    return (
      <Empty icon="bag" title="سبد خرید خالی است">
        <Link to="/" className="pc-btn pc-btn--s" style={{ marginTop: 8 }}>
          رفتن به منو
        </Link>
      </Empty>
    );
  }

  const cardInvalid =
    selected === 'card_to_card' &&
    (tracking.trim().length < 4 || !/^[\d۰-۹]{4}$/.test(last4.trim()));
  const timeInvalid = when === 'later' && (!day || !time);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">سبد خرید</h1>
          <p className="page-sub">
            {dineIn ? `سفارش برای ${cart.table!.label}` : 'تحویل حضوری از پیشخوان'}
          </p>
        </div>
        <button type="button" className="pc-btn pc-btn--ghost pc-btn--s" onClick={cart.clear}>
          خالی کردن
        </button>
      </div>

      <section className="list" aria-label="اقلام سفارش">
        {lines.map((l) => {
          const item = items.get(l.itemId)!;
          const opts = item.groups
            .flatMap((g) => g.options)
            .filter((o) => l.optionIds.includes(o.id));
          return (
            <div key={l.key} className="cart-line">
              <div>
                <div className="cart-line__name">{item.name}</div>
                {opts.length > 0 && (
                  <div className="cart-line__opts">{opts.map((o) => o.name).join('، ')}</div>
                )}
                {!item.available && <span className="pc-tag pc-tag--danger">تمام شد</span>}
              </div>
              <Money amount={unitPrice(item, l.optionIds) * l.quantity} />
              <span />
              <Stepper value={l.quantity} onChange={(v) => cart.setQuantity(l.key, v)} />
            </div>
          );
        })}
      </section>

      {!meLoading && !user && (
        <div className="section stack">
          <p className="muted">برای ثبت سفارش، با شماره موبایلت وارد شو. سبد خریدت حفظ می‌شود.</p>
          <Link to="/login?next=/cart" className="pc-btn pc-btn--primary pc-btn--l pc-btn--block">
            ورود و ادامه سفارش
          </Link>
        </div>
      )}

      {user && membership && !isActive && (
        <div className="section">
          <div className="notice notice--warning">
            <Icon name="clock" />
            <div>
              عضویت شما در انتظار تأیید پذیرش باشگاه است. سفارش آنلاین فقط برای اعضای باشگاه فعال
              است؛ پس از تأیید پیامک می‌گیرید.
            </div>
          </div>
        </div>
      )}

      {isActive && (
        <>
          {q && (
            <section className="section stack">
              <div className="section-title">
                ارزش غذایی این سفارش
                <small className="num">{formatNumber(q.nutrition.kcal)} کالری</small>
              </div>
              <MacroBar nutrition={q.nutrition} />
              <MacroLegend nutrition={q.nutrition} />
            </section>
          )}

          <section className="section stack">
            <div className="section-title">زمان تحویل</div>
            <Segmented<When>
              label="زمان تحویل"
              value={when}
              onChange={setWhen}
              options={[
                { value: 'now', label: dineIn ? 'همین الان، سر میز' : 'همین الان' },
                { value: 'later', label: 'پیش‌سفارش' },
              ]}
            />
            {when === 'now' && branch.data && !branch.data.isOpen && (
              <div className="notice notice--warning">
                <Icon name="clock" />
                الان خارج از ساعت کاری هستیم؛ پیش‌سفارش ثبت کنید.
              </div>
            )}
            {when === 'later' && (
              <div className="stack">
                <div className="scroll-x">
                  {days.map((d) => (
                    <button
                      key={d.iso}
                      type="button"
                      className="pc-chip"
                      aria-pressed={d.iso === day}
                      onClick={() => setDay(d.iso)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                {slots.length ? (
                  <Field
                    label="ساعت تحویل"
                    hint="سفارش طوری شروع می‌شود که سر همین ساعت آماده باشد."
                  >
                    <select
                      className="pc-input num"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    >
                      {slots.map((s) => (
                        <option key={s} value={s}>
                          {toFaDigits(s)}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <p className="page-sub">برای این روز زمان آزادی نمانده است.</p>
                )}
              </div>
            )}
          </section>

          {q && (q.creditsUsed > 0 || !useCredits) && (
            <section className="section">
              <label className="pay-option">
                <input
                  type="checkbox"
                  checked={useCredits}
                  onChange={(e) => setUseCredits(e.target.checked)}
                />
                <span className="pay-option__label">
                  استفاده از اعتبار بسته
                  <small>
                    {useCredits
                      ? `${toFaDigits(q.creditsUsed)} وعده از بسته شما کسر می‌شود`
                      : 'این بار با پول پرداخت می‌کنم'}
                  </small>
                </span>
                <Icon name="box" />
              </label>
            </section>
          )}

          <section className="section stack">
            <div className="section-title">کد تخفیف</div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                setPromoCode(promoInput.trim() || undefined);
              }}
            >
              <input
                className="pc-input pc-input--ltr"
                placeholder="PROMO"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                aria-label="کد تخفیف"
              />
              <Button type="submit">اعمال</Button>
            </form>
            {q?.promoError && <p className="pc-field__error">{q.promoError}</p>}
            {q?.promotion && <p className="summary__saving">«{q.promotion.title}» اعمال شد</p>}
          </section>

          {quote.isError && (
            <div className="notice notice--danger">{errorMessage(quote.error)}</div>
          )}
          {q && q.unavailable.length > 0 && (
            <div className="notice notice--danger">
              <Icon name="alert" />
              این آیتم‌ها الان قابل تهیه نیستند: {q.unavailable.join('، ')}
            </div>
          )}

          {needsPayment && (
            <section className="section stack">
              <div className="section-title">روش پرداخت</div>
              {methods.map((m) => (
                <label key={m.key} className="pay-option" aria-disabled={m.disabled}>
                  <input
                    type="radio"
                    name="method"
                    checked={selected === m.key}
                    disabled={m.disabled}
                    onChange={() => setMethod(m.key)}
                  />
                  <span className="pay-option__label">
                    {m.label}
                    <small>{m.disabled && m.key === 'wallet' ? 'موجودی کافی نیست' : m.hint}</small>
                  </span>
                  {m.key === 'wallet' && m.disabled && (
                    <Link to="/wallet" className="pc-btn pc-btn--s">
                      شارژ
                    </Link>
                  )}
                </label>
              ))}
              {selected === 'card_to_card' && branch.data?.cardNumber && (
                <div className="stack">
                  <div className="card-copy">
                    <div>
                      <div className="card-copy__number ltr num">
                        {toFaDigits(branch.data.cardNumber)}
                      </div>
                      <div className="page-sub">به نام {branch.data.cardHolder}</div>
                    </div>
                    <Button
                      size="s"
                      icon="copy"
                      onClick={() =>
                        void navigator.clipboard
                          ?.writeText(branch.data!.cardNumber!.replace(/\D/g, ''))
                          .then(() => toast('شماره کارت کپی شد'))
                      }
                    >
                      کپی
                    </Button>
                  </div>
                  <p className="page-sub">
                    مبلغ <b>{q && formatToman(q.total)}</b> را واریز کنید و اطلاعات تراکنش را
                    بنویسید.
                  </p>
                  <div className="row">
                    <Field label="کد پیگیری">
                      <input
                        className="pc-input pc-input--ltr"
                        inputMode="numeric"
                        value={tracking}
                        onChange={(e) => setTracking(e.target.value)}
                      />
                    </Field>
                    <Field label="۴ رقم آخر کارت شما">
                      <input
                        className="pc-input pc-input--ltr"
                        inputMode="numeric"
                        maxLength={4}
                        value={last4}
                        onChange={(e) => setLast4(e.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="section">
            <Field label="یادداشت برای آشپزخانه (اختیاری)">
              <textarea
                className="pc-input"
                rows={2}
                maxLength={280}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="مثلاً بدون پیاز"
              />
            </Field>
          </section>

          <section className="section">
            {q ? (
              <div className="summary">
                <div>
                  <span>جمع سفارش</span>
                  <Money amount={q.subtotal} />
                </div>
                {q.creditsValue > 0 && (
                  <div className="summary__saving">
                    <span>با اعتبار بسته ({toFaDigits(q.creditsUsed)} وعده)</span>
                    <span className="num">−{formatToman(q.creditsValue)}</span>
                  </div>
                )}
                {q.memberDiscount > 0 && (
                  <div className="summary__saving">
                    <span>تخفیف عضویت ({toFaDigits(q.memberDiscountPct)}٪)</span>
                    <span className="num">−{formatToman(q.memberDiscount)}</span>
                  </div>
                )}
                {q.promoDiscount > 0 && (
                  <div className="summary__saving">
                    <span>{q.promotion?.title ?? 'کد تخفیف'}</span>
                    <span className="num">−{formatToman(q.promoDiscount)}</span>
                  </div>
                )}
                <div className="summary__total">
                  <span>مبلغ قابل پرداخت</span>
                  <Money amount={q.total} />
                </div>
              </div>
            ) : (
              <Skeleton height={90} />
            )}
          </section>

          <div className="checkout-bar">
            <Button
              variant="primary"
              size="l"
              block
              loading={place.isPending}
              disabled={
                !q ||
                quote.isFetching ||
                q.unavailable.length > 0 ||
                (needsPayment && !selected) ||
                cardInvalid ||
                timeInvalid
              }
              onClick={() => place.mutate()}
            >
              {!q
                ? 'در حال محاسبه…'
                : !needsPayment
                  ? 'ثبت سفارش'
                  : selected === 'gateway'
                    ? `پرداخت ${formatToman(q.total)}`
                    : `ثبت سفارش — ${formatToman(q.total)}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
