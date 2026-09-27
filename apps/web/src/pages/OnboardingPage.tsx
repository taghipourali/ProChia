import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { HealthProfileDto } from '@prochia/shared';
import { GOAL_LABELS } from '@prochia/shared';
import { Button, Field, Wordmark, useToast } from '@prochia/ui';
import {
  BodyFields,
  DietFields,
  TrainingFields,
  emptyDraft,
  toInput,
  type HealthDraft,
} from '../components/HealthForm';
import { TargetsCard } from '../components/TargetsCard';
import { api, errorMessage } from '../lib/api';
import { keys, useMember } from '../lib/queries';

const STEPS = ['name', 'body', 'training', 'diet', 'result'] as const;

export function OnboardingPage() {
  const { user, membership } = useMember();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';
  const client = useQueryClient();
  const toast = useToast();

  const [step, setStep] = useState<(typeof STEPS)[number]>(user?.firstName ? 'body' : 'name');
  const [first, setFirst] = useState(user?.firstName ?? '');
  const [last, setLast] = useState(user?.lastName ?? '');
  const [draft, setDraft] = useState<HealthDraft>(emptyDraft);
  const [result, setResult] = useState<HealthProfileDto | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof HealthDraft>(key: K, value: HealthDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const saveName = async () => {
    setBusy(true);
    try {
      await api('/me/profile', {
        method: 'PUT',
        body: { firstName: first, lastName: last, birthDate: null, sex: null },
      });
      setStep('body');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveHealth = async () => {
    const input = toInput(draft);
    if (!input) return;
    setBusy(true);
    try {
      setResult(await api<HealthProfileDto>('/me/health', { method: 'PUT', body: input }));
      await client.invalidateQueries({ queryKey: keys.me });
      setStep('result');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const index = STEPS.indexOf(step);
  const bodyValid = Boolean(draft.sex && draft.birthDate && draft.heightCm && draft.weightKg);

  return (
    <main className="auth">
      <div className="row-between">
        <Wordmark />
        {step !== 'name' && step !== 'result' && (
          <button
            type="button"
            className="pc-btn pc-btn--ghost pc-btn--s"
            onClick={() => navigate(next, { replace: true })}
          >
            بعداً
          </button>
        )}
      </div>
      <div className="steps-bar" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span key={s} data-done={i <= index} />
        ))}
      </div>

      {step === 'name' && (
        <form
          className="stack-l"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <div className="stack">
            <h1 className="auth__title">خوش آمدی!</h1>
            <p className="muted">اسمت را بگو تا سفارش‌ها با نام خودت صدا زده شوند.</p>
          </div>
          <Field label="نام">
            <input
              className="pc-input"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              autoComplete="given-name"
              autoFocus
            />
          </Field>
          <Field label="نام خانوادگی">
            <input
              className="pc-input"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              autoComplete="family-name"
            />
          </Field>
          {membership?.status === 'pending' && (
            <p className="notice notice--warning">
              عضویتت ثبت شد و پس از تأیید پذیرش باشگاه می‌توانی سفارش بدهی.
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="l"
            block
            loading={busy}
            disabled={!first.trim() || !last.trim()}
          >
            ادامه
          </Button>
        </form>
      )}

      {step === 'body' && (
        <div className="stack-l">
          <div className="stack">
            <h1 className="auth__title">بدنت را بشناسیم</h1>
            <p className="muted">
              با این اطلاعات نیاز روزانه‌ات را حساب می‌کنیم. فقط خودت و آشپزخانه پروچیا آن را
              می‌بینید.
            </p>
          </div>
          <BodyFields draft={draft} set={set} />
          <Button
            variant="primary"
            size="l"
            block
            disabled={!bodyValid}
            onClick={() => setStep('training')}
          >
            ادامه
          </Button>
        </div>
      )}

      {step === 'training' && (
        <div className="stack-l">
          <h1 className="auth__title">تمرین و هدف</h1>
          <TrainingFields draft={draft} set={set} />
          <div className="row">
            <Button onClick={() => setStep('body')}>قبلی</Button>
            <Button
              variant="primary"
              size="l"
              block
              disabled={!draft.goal}
              onClick={() => setStep('diet')}
            >
              ادامه
            </Button>
          </div>
        </div>
      )}

      {step === 'diet' && (
        <div className="stack-l">
          <h1 className="auth__title">حساسیت و رژیم</h1>
          <DietFields draft={draft} set={set} />
          <div className="row">
            <Button onClick={() => setStep('training')}>قبلی</Button>
            <Button
              variant="primary"
              size="l"
              block
              loading={busy}
              disabled={!toInput(draft)}
              onClick={() => void saveHealth()}
            >
              محاسبه برنامه من
            </Button>
          </div>
          {!toInput(draft) && (
            <p className="pc-field__error">قد، وزن یا درصد چربی در محدوده معتبر نیست.</p>
          )}
        </div>
      )}

      {step === 'result' && result && (
        <div className="stack-l">
          <div className="stack">
            <h1 className="auth__title">برنامه روزانه تو برای {GOAL_LABELS[result.goal]}</h1>
            <p className="muted">
              از این به بعد کنار هر غذا می‌بینی چند درصد از این نیاز را پوشش می‌دهد.
            </p>
          </div>
          <TargetsCard targets={result.targets} bmi={result.bmi} bmiBand={result.bmiBand} />
          <Button
            variant="primary"
            size="l"
            block
            onClick={() => navigate(next, { replace: true })}
          >
            دیدن منو و پیشنهادهای من
          </Button>
        </div>
      )}
    </main>
  );
}
