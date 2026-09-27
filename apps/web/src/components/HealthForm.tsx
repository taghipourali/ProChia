import { useMemo, useState, type ReactNode } from 'react';
import type {
  ActivityLevel,
  Allergen,
  DietPreference,
  Goal,
  HealthProfileInput,
  Sex,
  TrainingTime,
} from '@prochia/shared';
import {
  ACTIVITY_LABELS,
  ACTIVITY_LEVELS,
  ALLERGENS,
  ALLERGEN_LABELS,
  DIET_PREFERENCES,
  DIET_PREFERENCE_LABELS,
  GOALS,
  GOAL_LABELS,
  JALALI_MONTHS,
  TRAINING_TIMES,
  TRAINING_TIME_LABELS,
  isoDateToJalali,
  jalaliMonthLength,
  jalaliToIsoDate,
  toEnDigits,
  toFaDigits,
  toJalali,
} from '@prochia/shared';
import { Chip, Field, Segmented } from '@prochia/ui';
import { Stepper } from './Stepper';

export const GOAL_HINTS: Record<Goal, string> = {
  cut: 'کاهش چربی با حفظ عضله',
  recomp: 'چربی کمتر، عضله بیشتر؛ آرام و پیوسته',
  maintain: 'حفظ وزن و انرژی تمرین',
  bulk: 'افزایش حجم و قدرت',
};

export type HealthDraft = {
  sex: Sex | null;
  birthDate: string | null;
  heightCm: string;
  weightKg: string;
  bodyFatPct: string;
  activity: ActivityLevel;
  goal: Goal | null;
  trainingTime: TrainingTime;
  trainingDaysPerWeek: number;
  mealsPerDay: number;
  allergens: Allergen[];
  dietPreferences: DietPreference[];
};

export const emptyDraft = (): HealthDraft => ({
  sex: null,
  birthDate: null,
  heightCm: '',
  weightKg: '',
  bodyFatPct: '',
  activity: 'moderate',
  goal: null,
  trainingTime: 'evening',
  trainingDaysPerWeek: 4,
  mealsPerDay: 4,
  allergens: [],
  dietPreferences: [],
});

const num = (v: string) => Number(toEnDigits(v).replace(/[^\d.]/g, ''));

export function toInput(d: HealthDraft): HealthProfileInput | null {
  const height = num(d.heightCm);
  const weight = num(d.weightKg);
  const fat = d.bodyFatPct.trim() ? num(d.bodyFatPct) : null;
  if (
    !d.sex ||
    !d.birthDate ||
    !d.goal ||
    !(height >= 120 && height <= 230) ||
    !(weight >= 30 && weight <= 250)
  )
    return null;
  if (fat !== null && !(fat >= 3 && fat <= 60)) return null;
  return {
    sex: d.sex,
    birthDate: d.birthDate,
    heightCm: height,
    weightKg: weight,
    bodyFatPct: fat,
    activity: d.activity,
    goal: d.goal,
    trainingTime: d.trainingTime,
    trainingDaysPerWeek: d.trainingDaysPerWeek,
    mealsPerDay: d.mealsPerDay,
    allergens: d.allergens,
    dietPreferences: d.dietPreferences,
  };
}

/** Birth date as three Jalali selects — faster on phones than any calendar widget. */
export function JalaliDateInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (iso: string) => void;
}) {
  const initial = value ? isoDateToJalali(value) : null;
  const [jy, setJy] = useState<number | ''>(initial?.jy ?? '');
  const [jm, setJm] = useState<number | ''>(initial?.jm ?? '');
  const [jd, setJd] = useState<number | ''>(initial?.jd ?? '');
  const thisYear = useMemo(() => toJalali(new Date()).jy, []);
  const years = Array.from({ length: 70 }, (_, i) => thisYear - 12 - i);
  const days = jy && jm ? jalaliMonthLength(jy, jm) : 31;

  const update = (y: number | '', m: number | '', d: number | '') => {
    setJy(y);
    setJm(m);
    setJd(d);
    if (y && m && d && d <= jalaliMonthLength(y, m))
      onChange(jalaliToIsoDate({ jy: y, jm: m, jd: d }));
  };

  return (
    <div className="date-selects">
      <select
        className="pc-input num"
        aria-label="روز"
        value={jd}
        onChange={(e) => update(jy, jm, Number(e.target.value))}
      >
        <option value="">روز</option>
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {toFaDigits(d)}
          </option>
        ))}
      </select>
      <select
        className="pc-input"
        aria-label="ماه"
        value={jm}
        onChange={(e) => update(jy, Number(e.target.value), jd)}
      >
        <option value="">ماه</option>
        {JALALI_MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select
        className="pc-input num"
        aria-label="سال"
        value={jy}
        onChange={(e) => update(Number(e.target.value), jm, jd)}
      >
        <option value="">سال</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {toFaDigits(y)}
          </option>
        ))}
      </select>
    </div>
  );
}

function Toggle<T extends string>({
  values,
  labels,
  selected,
  onChange,
}: {
  values: readonly T[];
  labels: Record<T, string>;
  selected: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
      {values.map((v) => (
        <Chip
          key={v}
          pressed={selected.includes(v)}
          onClick={() =>
            onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
          }
        >
          {labels[v]}
        </Chip>
      ))}
    </div>
  );
}

type Set = <K extends keyof HealthDraft>(key: K, value: HealthDraft[K]) => void;

export function BodyFields({ draft, set }: { draft: HealthDraft; set: Set }) {
  return (
    <div className="stack-l">
      <Field label="جنسیت">
        <Segmented<Sex | ''>
          value={draft.sex ?? ''}
          onChange={(v) => v && set('sex', v)}
          options={[
            { value: 'male', label: 'مرد' },
            { value: 'female', label: 'زن' },
          ]}
        />
      </Field>
      <Field label="تاریخ تولد">
        <JalaliDateInput value={draft.birthDate} onChange={(v) => set('birthDate', v)} />
      </Field>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Field label="قد (سانتی‌متر)">
          <input
            className="pc-input num"
            inputMode="numeric"
            placeholder="۱۷۵"
            value={draft.heightCm}
            onChange={(e) => set('heightCm', e.target.value)}
          />
        </Field>
        <Field label="وزن (کیلوگرم)">
          <input
            className="pc-input num"
            inputMode="decimal"
            placeholder="۷۲"
            value={draft.weightKg}
            onChange={(e) => set('weightKg', e.target.value)}
          />
        </Field>
      </div>
      <Field
        label="درصد چربی بدن (اختیاری)"
        hint="اگر از دستگاه آنالیز بدن باشگاه داری، دقت محاسبه بیشتر می‌شود."
      >
        <input
          className="pc-input num"
          inputMode="decimal"
          placeholder="مثلاً ۱۸"
          value={draft.bodyFatPct}
          onChange={(e) => set('bodyFatPct', e.target.value)}
        />
      </Field>
    </div>
  );
}

export function TrainingFields({ draft, set }: { draft: HealthDraft; set: Set }) {
  return (
    <div className="stack-l">
      <Field label="هدف">
        <div className="choice-grid">
          {GOALS.map((g) => (
            <button
              key={g}
              type="button"
              className="choice"
              aria-pressed={draft.goal === g}
              onClick={() => set('goal', g)}
            >
              <b>{GOAL_LABELS[g]}</b>
              <small>{GOAL_HINTS[g]}</small>
            </button>
          ))}
        </div>
      </Field>
      <Field label="سطح فعالیت">
        <select
          className="pc-input"
          value={draft.activity}
          onChange={(e) => set('activity', e.target.value as ActivityLevel)}
        >
          {ACTIVITY_LEVELS.map((a) => (
            <option key={a} value={a}>
              {ACTIVITY_LABELS[a]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="معمولاً چه ساعتی تمرین می‌کنی؟">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {TRAINING_TIMES.map((t) => (
            <Chip key={t} pressed={draft.trainingTime === t} onClick={() => set('trainingTime', t)}>
              {TRAINING_TIME_LABELS[t]}
            </Chip>
          ))}
        </div>
      </Field>
      <div className="row-between">
        <span className="pc-field__label">جلسه تمرین در هفته</span>
        <Stepper
          value={draft.trainingDaysPerWeek}
          onChange={(v) => set('trainingDaysPerWeek', v)}
          min={0}
          max={7}
        />
      </div>
      <div className="row-between">
        <span className="pc-field__label">تعداد وعده در روز</span>
        <Stepper
          value={draft.mealsPerDay}
          onChange={(v) => set('mealsPerDay', v)}
          min={2}
          max={6}
        />
      </div>
    </div>
  );
}

export function DietFields({ draft, set }: { draft: HealthDraft; set: Set }) {
  return (
    <div className="stack-l">
      <Field
        label="به چه چیزهایی حساسیت داری؟"
        hint="غذاهای حاوی این مواد در منو علامت می‌خورند و پیشنهاد نمی‌شوند."
      >
        <Toggle
          values={ALLERGENS}
          labels={ALLERGEN_LABELS}
          selected={draft.allergens}
          onChange={(v) => set('allergens', v)}
        />
      </Field>
      <Field label="رژیم غذایی">
        <Toggle
          values={DIET_PREFERENCES}
          labels={DIET_PREFERENCE_LABELS}
          selected={draft.dietPreferences}
          onChange={(v) => set('dietPreferences', v)}
        />
      </Field>
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}
