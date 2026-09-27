import type { DailyTargets, Nutrition } from '@prochia/shared';
import { formatNumber, macroEnergySplit } from '@prochia/shared';

const MACRO_COLORS = {
  protein: 'var(--protein)',
  carbs: 'var(--carbs)',
  fat: 'var(--fat)',
} as const;

/** Share of energy from protein / carbs / fat as a single thin bar. */
export function MacroBar({
  nutrition,
}: {
  nutrition: Pick<Nutrition, 'protein' | 'carbs' | 'fat'>;
}) {
  const split = macroEnergySplit(nutrition);
  return (
    <div className="pc-macrobar" aria-hidden="true">
      {(['protein', 'carbs', 'fat'] as const).map((k) => (
        <span key={k} style={{ width: `${split[k] * 100}%`, background: MACRO_COLORS[k] }} />
      ))}
    </div>
  );
}

export function MacroLegend({
  nutrition,
}: {
  nutrition: Pick<Nutrition, 'protein' | 'carbs' | 'fat'>;
}) {
  return (
    <div className="pc-macro-legend">
      <span>
        <i style={{ background: MACRO_COLORS.protein }} />
        پروتئین <b className="num">{formatNumber(nutrition.protein)}</b>
      </span>
      <span>
        <i style={{ background: MACRO_COLORS.carbs }} />
        کربوهیدرات <b className="num">{formatNumber(nutrition.carbs)}</b>
      </span>
      <span>
        <i style={{ background: MACRO_COLORS.fat }} />
        چربی <b className="num">{formatNumber(nutrition.fat)}</b>
      </span>
    </div>
  );
}

/** One-line macro summary for list rows: "۶۲۱ کالری · پروتئین ۵۶ · کربو ۵۹ · چربی ۱۷". */
export function MacroLine({
  nutrition,
  className,
}: {
  nutrition: Pick<Nutrition, 'kcal' | 'protein' | 'carbs' | 'fat'>;
  className?: string;
}) {
  const sep = <span style={{ color: 'var(--line-2)', margin: '0 5px' }}>·</span>;
  return (
    <span
      className={['num', className].filter(Boolean).join(' ')}
      style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)', lineHeight: 1.9 }}
    >
      <b style={{ color: 'var(--ink)', fontWeight: 750 }}>{formatNumber(nutrition.kcal)}</b> کالری
      {sep}
      <span style={{ color: 'var(--ink)' }}>
        پروتئین <b style={{ fontWeight: 750 }}>{formatNumber(Math.round(nutrition.protein))}</b>
      </span>
      {sep}کربو {formatNumber(Math.round(nutrition.carbs))}
      {sep}چربی {formatNumber(Math.round(nutrition.fat))}
    </span>
  );
}

const pct = (value: number, target: number | undefined) =>
  target && target > 0 ? `${formatNumber(Math.round((value / target) * 100))}٪` : '';

/**
 * The signature element: a Persian take on the familiar nutrition-facts panel. With the member's
 * targets it shows how much of their day each nutrient covers.
 */
export function NutritionLabel({
  nutrition,
  servingGrams,
  targets,
  title = 'ارزش غذایی',
}: {
  nutrition: Nutrition;
  servingGrams?: number | null;
  targets?: Pick<DailyTargets, 'kcal' | 'protein' | 'carbs' | 'fat' | 'fiber'> | null;
  title?: string;
}) {
  const f1 = (v: number) => formatNumber(v, v < 10 && v % 1 ? 1 : 0);
  return (
    <section className="pc-label" aria-label={title}>
      <div className="pc-label__title">{title}</div>
      <div className="pc-label__serving">
        <span>یک وعده</span>
        {servingGrams ? <b className="num">حدود {formatNumber(servingGrams)} گرم</b> : null}
      </div>
      <hr className="pc-rule pc-rule--heavy" />
      <div className="pc-label__energy">
        <span>کالری</span>
        <strong className="num">{formatNumber(nutrition.kcal)}</strong>
      </div>
      <hr className="pc-rule pc-rule--mid" />
      {targets && (
        <div
          className="pc-label__row"
          style={{ borderTop: 0, justifyContent: 'flex-end', fontSize: 'var(--text-xs)' }}
        >
          <b>از نیاز روزانه شما</b>
        </div>
      )}
      <div className="pc-label__row">
        <span>
          <b>پروتئین</b> <span className="num">{f1(nutrition.protein)} گرم</span>
        </span>
        <em className="num" style={{ color: 'var(--protein)' }}>
          {pct(nutrition.protein, targets?.protein)}
        </em>
      </div>
      <div className="pc-label__row">
        <span>
          <b>کربوهیدرات</b> <span className="num">{f1(nutrition.carbs)} گرم</span>
        </span>
        <em className="num">{pct(nutrition.carbs, targets?.carbs)}</em>
      </div>
      <div className="pc-label__row pc-label__row--sub">
        <span>
          فیبر <span className="num">{f1(nutrition.fiber)} گرم</span>
        </span>
        <em className="num">{pct(nutrition.fiber, targets?.fiber)}</em>
      </div>
      <div className="pc-label__row pc-label__row--sub">
        <span>
          قند <span className="num">{f1(nutrition.sugar)} گرم</span>
        </span>
      </div>
      <div className="pc-label__row">
        <span>
          <b>چربی</b> <span className="num">{f1(nutrition.fat)} گرم</span>
        </span>
        <em className="num">{pct(nutrition.fat, targets?.fat)}</em>
      </div>
      <div className="pc-label__row">
        <span>
          <b>سدیم</b> <span className="num">{formatNumber(nutrition.sodium)} میلی‌گرم</span>
        </span>
      </div>
      <hr className="pc-rule pc-rule--heavy" />
      <p className="pc-label__note">
        {targets
          ? `درصدها بر اساس نیاز روزانه شما (${formatNumber(targets.kcal)} کالری) محاسبه شده است.`
          : 'برای دیدن سهم این غذا از نیاز روزانه‌تان، پروفایل سلامت را کامل کنید.'}
      </p>
    </section>
  );
}
