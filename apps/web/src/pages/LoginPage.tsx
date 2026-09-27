import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { maskMobile, normalizeIranMobile, toEnDigits, toFaDigits } from '@prochia/shared';
import { Button, Field, Icon, Wordmark, useToast } from '@prochia/ui';
import { ApiError, api, errorMessage } from '../lib/api';
import { keys, useBranch } from '../lib/queries';

export function LoginPage() {
  const branch = useBranch();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';
  const client = useQueryClient();
  const toast = useToast();

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const normalized = normalizeIranMobile(phone);

  const requestCode = async () => {
    if (!normalized) {
      setError('شماره موبایل را درست وارد کنید، مثل ۰۹۱۲۱۲۳۴۵۶۷');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ resendIn: number; devCode?: string }>('/auth/otp', {
        method: 'POST',
        body: { phone: normalized },
      });
      setStep('code');
      setResendIn(res.resendIn);
      if (res.devCode) {
        setCode(res.devCode);
        toast(`کد آزمایشی: ${toFaDigits(res.devCode)}`);
      }
      window.setTimeout(() => codeInput.current?.focus(), 50);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'otp_wait') {
        setStep('code');
        setResendIn((e.details as { retryAfter: number }).retryAfter);
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    const digits = toEnDigits(value).replace(/\D/g, '');
    if (digits.length !== 5 || !normalized) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ needsOnboarding: boolean; membershipStatus: string }>(
        '/auth/verify',
        {
          method: 'POST',
          body: { phone: normalized, code: digits },
        },
      );
      await client.invalidateQueries();
      await client.fetchQuery({ queryKey: keys.me, queryFn: () => api('/me') });
      navigate(res.needsOnboarding ? `/welcome?next=${encodeURIComponent(next)}` : next, {
        replace: true,
      });
    } catch (e) {
      setError(errorMessage(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="row-between">
        <Wordmark subtitle={branch.data?.gymName} />
        <Link to="/" className="pc-btn pc-btn--ghost pc-btn--icon" aria-label="بازگشت به منو">
          <Icon name="close" />
        </Link>
      </div>

      {step === 'phone' ? (
        <form
          className="stack-l"
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode();
          }}
        >
          <div className="stack">
            <h1 className="auth__title">ورود یا عضویت</h1>
            <p className="muted">
              شماره‌ای که در پذیرش {branch.data?.gymName ?? 'باشگاه'} ثبت کرده‌ای را وارد کن. کد
              تأیید پیامک می‌شود.
            </p>
          </div>
          <Field label="شماره موبایل" error={error} htmlFor="phone">
            <input
              id="phone"
              className="pc-input pc-input--ltr"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="0912 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
          </Field>
          <Button type="submit" variant="primary" size="l" block loading={busy} disabled={!phone}>
            دریافت کد
          </Button>
        </form>
      ) : (
        <form
          className="stack-l"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <div className="stack">
            <h1 className="auth__title">کد ۵ رقمی را وارد کن</h1>
            <p className="muted">
              به شماره <span className="ltr num">{normalized && maskMobile(normalized)}</span> پیامک
              شد.{' '}
              <button
                type="button"
                className="pc-btn pc-btn--ghost pc-btn--s"
                onClick={() => setStep('phone')}
              >
                تغییر شماره
              </button>
            </p>
          </div>
          <Field error={error}>
            <input
              ref={codeInput}
              className="pc-input otp-input num"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={5}
              value={code}
              aria-label="کد تأیید"
              onChange={(e) => {
                const v = toEnDigits(e.target.value).replace(/\D/g, '').slice(0, 5);
                setCode(v);
                if (v.length === 5) void verify(v);
              }}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="l"
            block
            loading={busy}
            disabled={code.length !== 5}
          >
            ورود
          </Button>
          <Button
            variant="ghost"
            disabled={resendIn > 0 || busy}
            onClick={() => void requestCode()}
          >
            {resendIn > 0
              ? `ارسال دوباره تا ${toFaDigits(resendIn)} ثانیه دیگر`
              : 'ارسال دوباره کد'}
          </Button>
        </form>
      )}
    </main>
  );
}
