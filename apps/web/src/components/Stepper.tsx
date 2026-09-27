import { toFaDigits } from '@prochia/shared';
import { Icon } from '@prochia/ui';

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 20,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <span className="stepper" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="یکی بیشتر"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
      >
        <Icon name="plus" size={16} />
      </button>
      <span className="num" aria-live="polite">
        {toFaDigits(value)}
      </span>
      <button
        type="button"
        aria-label="یکی کمتر"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
      >
        <Icon name="minus" size={16} />
      </button>
    </span>
  );
}
