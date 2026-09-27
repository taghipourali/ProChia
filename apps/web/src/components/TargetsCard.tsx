import type { DailyTargets } from '@prochia/shared';
import { BMI_BAND_LABELS, formatNumber, type BmiBand } from '@prochia/shared';

/** Daily targets as a label-style panel: energy on top, three macros beneath. */
export function TargetsCard({
  targets,
  bmi,
  bmiBand,
}: {
  targets: DailyTargets;
  bmi?: number;
  bmiBand?: BmiBand;
}) {
  return (
    <div className="stack">
      <div className="targets">
        <div className="targets__kcal">
          <div>
            <div className="page-sub">انرژی روزانه</div>
            <strong>{formatNumber(targets.kcal)}</strong> <span className="muted">کالری</span>
          </div>
          <div style={{ textAlign: 'end' }} className="page-sub num">
            سوخت‌وساز پایه {formatNumber(targets.bmr)}
            <br />
            مصرف روزانه {formatNumber(targets.tdee)}
          </div>
        </div>
        {(
          [
            ['protein', 'پروتئین', 'var(--protein)'],
            ['carbs', 'کربوهیدرات', 'var(--carbs)'],
            ['fat', 'چربی', 'var(--fat)'],
          ] as const
        ).map(([key, label, color]) => (
          <div key={key} className="targets__macro">
            <i style={{ background: color }} />
            <strong>{formatNumber(targets[key])}</strong>
            <span>گرم {label}</span>
          </div>
        ))}
      </div>
      <p className="page-sub num">
        {bmi !== undefined && bmiBand && (
          <>
            شاخص توده بدنی {formatNumber(bmi, 1)} ({BMI_BAND_LABELS[bmiBand]}) ·{' '}
          </>
        )}
        آب: حدود {formatNumber(targets.waterMl / 1000, 1)} لیتر · فیبر {formatNumber(targets.fiber)}{' '}
        گرم
      </p>
    </div>
  );
}
