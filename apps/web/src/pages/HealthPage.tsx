import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { HealthProfileDto } from '@prochia/shared';
import { formatJalali, formatNumber, toEnDigits, toFaDigits } from '@prochia/shared';
import { Button, Empty, Field, useToast } from '@prochia/ui';
import {
  BodyFields,
  DietFields,
  FormSection,
  TrainingFields,
  emptyDraft,
  toInput,
  type HealthDraft,
} from '../components/HealthForm';
import { TargetsCard } from '../components/TargetsCard';
import { api, errorMessage } from '../lib/api';
import { keys, useInsights, useMember } from '../lib/queries';

const fromProfile = (
  h: HealthProfileDto,
  sex: HealthDraft['sex'],
  birthDate: string | null,
): HealthDraft => ({
  sex,
  birthDate,
  heightCm: toFaDigits(h.heightCm),
  weightKg: toFaDigits(h.weightKg),
  bodyFatPct: h.bodyFatPct ? toFaDigits(h.bodyFatPct) : '',
  activity: h.activity,
  goal: h.goal,
  trainingTime: h.trainingTime,
  trainingDaysPerWeek: h.trainingDaysPerWeek,
  mealsPerDay: h.mealsPerDay,
  allergens: h.allergens,
  dietPreferences: h.dietPreferences,
});

export function HealthPage() {
  const { user, health, isActive, isLoading } = useMember();
  const insights = useInsights(isActive);
  const client = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<HealthDraft>(emptyDraft);
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (health && user) setDraft(fromProfile(health, user.sex, user.birthDate));
  }, [health, user]);

  if (isLoading) return null;
  if (!user) return <Empty icon="user" title="ابتدا وارد شوید" />;
  const set = <K extends keyof HealthDraft>(key: K, value: HealthDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    const input = toInput(draft);
    if (!input) return toast('قد و وزن را درست وارد کنید', 'error');
    setBusy(true);
    try {
      await api('/me/health', { method: 'PUT', body: input });
      await client.invalidateQueries({ queryKey: keys.me });
      await client.invalidateQueries({ queryKey: ['recommendations'] });
      toast('پروفایل و اهداف به‌روز شد', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const logWeight = async () => {
    const value = Number(toEnDigits(weight));
    if (!(value >= 30 && value <= 250)) return toast('وزن معتبر نیست', 'error');
    try {
      await api('/me/weight', { method: 'POST', body: { weightKg: value } });
      setWeight('');
      await client.invalidateQueries({ queryKey: keys.me });
      await client.invalidateQueries({ queryKey: keys.insights });
      toast('وزن امروز ثبت شد و اهداف دوباره محاسبه شد', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const weights = insights.data?.weights ?? [];
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">پروفایل سلامت</h1>
      </div>

      {health && <TargetsCard targets={health.targets} bmi={health.bmi} bmiBand={health.bmiBand} />}

      <FormSection title="وزن امروز">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="وزن (کیلوگرم)">
            <input
              className="pc-input num"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder={health ? toFaDigits(health.weightKg) : ''}
            />
          </Field>
          <Button onClick={() => void logWeight()} disabled={!weight}>
            ثبت
          </Button>
        </div>
        {weights.length > 1 && (
          <div className="list" style={{ marginTop: 'var(--space-3)' }}>
            {weights
              .slice(-5)
              .reverse()
              .map((w) => (
                <div key={w.date} className="ledger-row">
                  <span className="num">
                    {formatJalali(new Date(`${w.date}T12:00:00+03:30`), 'long')}
                  </span>
                  <b className="num">{formatNumber(w.weightKg, 1)} کیلوگرم</b>
                </div>
              ))}
          </div>
        )}
      </FormSection>

      <FormSection title="مشخصات بدن">
        <BodyFields draft={draft} set={set} />
      </FormSection>
      <FormSection title="تمرین و هدف">
        <TrainingFields draft={draft} set={set} />
      </FormSection>
      <FormSection title="حساسیت و رژیم">
        <DietFields draft={draft} set={set} />
      </FormSection>

      <div className="checkout-bar">
        <Button variant="primary" size="l" block loading={busy} onClick={() => void save()}>
          ذخیره و محاسبه دوباره
        </Button>
      </div>
    </div>
  );
}
