import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CashbackRuleDto } from '@prochia/shared';
import {
  WALLET_ENTRY_LABELS,
  formatDateTime,
  formatToman,
  formatTomanCompact,
  toEnDigits,
  toFaDigits,
} from '@prochia/shared';
import { Button, Empty, Field, Icon, Money, Segmented, Skeleton, useToast } from '@prochia/ui';
import { api, errorMessage } from '../lib/api';
import { keys, useBranch, useMember, useWallet } from '../lib/queries';

const bonusFor = (rules: CashbackRuleDto[], amount: number) =>
  rules.reduce(
    (best, r) =>
      amount >= r.minAmount
        ? Math.max(best, Math.min(Math.floor((amount * r.percent) / 100), r.maxBonus ?? Infinity))
        : best,
    0,
  );

export function WalletPage() {
  const { isActive, isLoading } = useMember();
  const wallet = useWallet(isActive);
  const branch = useBranch();
  const client = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [amount, setAmount] = useState<number>(0);
  const [custom, setCustom] = useState('');
  const [method, setMethod] = useState<'gateway' | 'card_to_card'>('gateway');
  const [tracking, setTracking] = useState('');
  const [last4, setLast4] = useState('');

  useEffect(() => {
    const topup = params.get('topup') ?? params.get('settle');
    if (!topup) return;
    toast(
      topup === 'ok' ? 'پرداخت موفق بود' : 'پرداخت انجام نشد',
      topup === 'ok' ? 'success' : 'error',
    );
    setParams({}, { replace: true });
    void client.invalidateQueries({ queryKey: keys.wallet });
    void client.invalidateQueries({ queryKey: keys.me });
  }, [params, setParams, toast, client]);

  const rules = useMemo(() => wallet.data?.cashback ?? [], [wallet.data]);
  const presets = useMemo(() => {
    const fromRules = rules.map((r) => r.minAmount);
    return [...new Set([500_000, ...fromRules])].sort((a, b) => a - b).slice(0, 6);
  }, [rules]);
  const chosen = custom ? Number(toEnDigits(custom).replace(/\D/g, '')) : amount;
  const bonus = bonusFor(rules, chosen);

  const onDone = (res: { redirectUrl: string | null }) => {
    if (res.redirectUrl) {
      window.location.href = res.redirectUrl;
      return;
    }
    toast('درخواست ثبت شد؛ پس از تأیید صندوق، کیف پول شارژ می‌شود', 'success');
    setTracking('');
    setLast4('');
    void client.invalidateQueries({ queryKey: keys.wallet });
  };

  const topup = useMutation({
    mutationFn: () =>
      api<{ redirectUrl: string | null }>('/wallet/topup', {
        method: 'POST',
        body: {
          amount: chosen,
          method,
          cardToCard:
            method === 'card_to_card' ? { trackingCode: tracking, cardLast4: last4 } : undefined,
        },
      }),
    onSuccess: onDone,
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const settle = useMutation({
    mutationFn: (m: 'wallet' | 'gateway') =>
      api<{ redirectUrl: string | null }>('/postpaid/settle', {
        method: 'POST',
        body: { method: m },
      }),
    onSuccess: (res) => {
      if (res.redirectUrl) window.location.href = res.redirectUrl;
      else {
        toast('حساب اعتباری تسویه شد', 'success');
        void client.invalidateQueries({ queryKey: keys.wallet });
        void client.invalidateQueries({ queryKey: keys.me });
      }
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (isLoading) return null;
  if (!isActive) return <Empty icon="wallet" title="کیف پول برای اعضای فعال باشگاه است" />;
  if (!wallet.data) return <Skeleton height={300} />;
  const w = wallet.data;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">کیف پول</h1>
      </div>

      <div className="balance">
        <span>موجودی</span>
        <strong>
          <Money amount={w.balance} />
        </strong>
        <span>با کیف پول سریع‌تر سفارش بده؛ هر شارژ بزرگ‌تر، هدیه بیشتر.</span>
      </div>

      {w.postpaid && (
        <section className="section stack">
          <div className="section-title">
            حساب اعتباری VIP
            <small>سقف {formatToman(w.postpaid.limit)}</small>
          </div>
          <div className="row-between">
            <span className="muted">بدهی فعلی</span>
            <Money amount={w.postpaid.owed} className="num" />
          </div>
          {w.postpaid.owed > 0 && (
            <div className="row">
              <Button
                variant="ink"
                block
                loading={settle.isPending}
                disabled={w.balance < w.postpaid.owed}
                onClick={() => settle.mutate('wallet')}
              >
                تسویه از کیف پول
              </Button>
              <Button block loading={settle.isPending} onClick={() => settle.mutate('gateway')}>
                پرداخت آنلاین
              </Button>
            </div>
          )}
        </section>
      )}

      <section className="section stack">
        <div className="section-title">شارژ کیف پول</div>
        <div className="amount-grid">
          {presets.map((p) => {
            const b = bonusFor(rules, p);
            return (
              <button
                key={p}
                type="button"
                className="amount"
                aria-pressed={!custom && amount === p}
                onClick={() => {
                  setCustom('');
                  setAmount(p);
                }}
              >
                <b className="num">{formatTomanCompact(p)} تومان</b>
                <small>{b > 0 ? `+ ${formatTomanCompact(b)} تومان هدیه` : ' '}</small>
              </button>
            );
          })}
        </div>
        <Field label="یا مبلغ دلخواه (تومان)">
          <input
            className="pc-input num"
            inputMode="numeric"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="۲۰۰۰۰۰۰"
          />
        </Field>
        {chosen > 0 && (
          <div className="notice notice--green">
            <Icon name="gift" />
            <div>
              با شارژ <b>{formatToman(chosen)}</b>
              {bonus > 0 ? (
                <>
                  ، <b>{formatToman(bonus)}</b> هدیه می‌گیری و موجودی‌ات{' '}
                  <b>{formatToman(chosen + bonus)}</b> بیشتر می‌شود.
                </>
              ) : (
                ' موجودی‌ات اضافه می‌شود.'
              )}
            </div>
          </div>
        )}
        {rules.length > 0 && (
          <p className="page-sub">
            {rules
              .map((r) => `از ${formatTomanCompact(r.minAmount)}: ${toFaDigits(r.percent)}٪`)
              .join(' · ')}
          </p>
        )}
        <Segmented
          value={method}
          onChange={setMethod}
          options={[
            { value: 'gateway', label: 'پرداخت آنلاین' },
            ...(branch.data?.cardNumber
              ? [{ value: 'card_to_card' as const, label: 'کارت‌به‌کارت' }]
              : []),
          ]}
        />
        {method === 'card_to_card' && branch.data?.cardNumber && (
          <div className="stack">
            <div className="card-copy">
              <div>
                <div className="card-copy__number ltr num">
                  {toFaDigits(branch.data.cardNumber)}
                </div>
                <div className="page-sub">به نام {branch.data.cardHolder}</div>
              </div>
            </div>
            <div className="row">
              <Field label="کد پیگیری">
                <input
                  className="pc-input pc-input--ltr"
                  inputMode="numeric"
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                />
              </Field>
              <Field label="۴ رقم آخر کارت">
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
        <Button
          variant="primary"
          size="l"
          block
          loading={topup.isPending}
          disabled={
            chosen < 100_000 ||
            (method === 'card_to_card' && (tracking.length < 4 || last4.length !== 4))
          }
          onClick={() => topup.mutate()}
        >
          {chosen >= 100_000 ? `شارژ ${formatToman(chosen)}` : 'حداقل ۱۰۰ هزار تومان'}
        </Button>
      </section>

      <section className="section">
        <div className="section-title">تراکنش‌ها</div>
        {w.entries.length === 0 ? (
          <p className="muted">هنوز تراکنشی ندارید.</p>
        ) : (
          <div className="list">
            {w.entries.map((e) => (
              <div key={e.id} className="ledger-row">
                <div>
                  <b>{WALLET_ENTRY_LABELS[e.kind]}</b>
                  <div className="page-sub num">
                    {formatDateTime(new Date(e.createdAt))}
                    {e.note && ` · ${e.note}`}
                  </div>
                </div>
                <b className={`num ${e.amount > 0 ? 'plus' : ''}`}>
                  {e.amount > 0 ? '+' : '−'}
                  {formatToman(Math.abs(e.amount), { unit: false })}
                </b>
              </div>
            ))}
          </div>
        )}
      </section>

      <Link to="/plans" className="notice" style={{ color: 'inherit' }}>
        <Icon name="box" />
        با خرید بسته وعده، هر وعده ارزان‌تر تمام می‌شود.
      </Link>
    </div>
  );
}
