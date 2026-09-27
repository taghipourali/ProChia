import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { formatNumber, formatToman } from '@prochia/shared';
import { Icon, type IconName } from './Icon';

type ButtonVariant = 'default' | 'primary' | 'ink' | 'ghost' | 'danger';

export function Button({
  variant = 'default',
  size = 'm',
  block,
  loading,
  icon,
  iconOnly,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 's' | 'm' | 'l';
  block?: boolean;
  loading?: boolean;
  icon?: IconName;
  iconOnly?: boolean;
}) {
  const classes = [
    'pc-btn',
    variant !== 'default' && `pc-btn--${variant}`,
    size !== 'm' && `pc-btn--${size}`,
    block && 'pc-btn--block',
    iconOnly && 'pc-btn--icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span
          className="pc-spinner"
          style={{ width: 16, height: 16, borderTopColor: 'currentColor' }}
        />
      ) : (
        icon && <Icon name={icon} size={size === 's' ? 16 : 20} />
      )}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="pc-field">
      {label && (
        <label className="pc-field__label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <span className="pc-field__error">{error}</span>
      ) : (
        hint && <span className="pc-field__hint">{hint}</span>
      )}
    </div>
  );
}

export function Tag({
  tone,
  children,
}: {
  tone?: 'green' | 'lime' | 'danger' | 'warning' | 'info' | 'ink';
  children: ReactNode;
}) {
  return <span className={tone ? `pc-tag pc-tag--${tone}` : 'pc-tag'}>{children}</span>;
}

export function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="pc-chip" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="pc-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Toman amount with Persian digits; the unit is set smaller so the number reads first. */
export function Money({
  amount,
  unit = true,
  className,
}: {
  amount: number;
  unit?: boolean;
  className?: string;
}) {
  return (
    <span className={['num', className].filter(Boolean).join(' ')}>
      {formatToman(amount, { unit: false })}
      {unit && (
        <small style={{ fontSize: '0.72em', fontWeight: 500, marginInlineStart: 4 }}>تومان</small>
      )}
    </span>
  );
}

export function Num({
  value,
  digits = 0,
  className,
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  return (
    <span className={['num', className].filter(Boolean).join(' ')}>
      {formatNumber(value, digits)}
    </span>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      className="pc-spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label="در حال بارگذاری"
    />
  );
}

export function Skeleton({
  height = 16,
  width = '100%',
  radius,
}: {
  height?: number;
  width?: number | string;
  radius?: number;
}) {
  return <div className="pc-skeleton" style={{ height, width, borderRadius: radius }} />;
}

export function Empty({
  icon = 'info',
  title,
  children,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="pc-empty">
      <Icon name={icon} size={32} />
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Progress({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(Math.max(value / max, 0), 1) * 100 : 0;
  return (
    <div
      className="pc-progress"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/**
 * Placeholder brand mark until the real logo arrives: a green tile with three "chia seeds".
 * Replace this component (or its SVG) with the final logo.
 */
export function Wordmark({ size = 28, subtitle }: { size?: number; subtitle?: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="var(--green-700)" />
        <circle cx="11" cy="20" r="3" fill="#fff" />
        <circle cx="19" cy="14" r="3" fill="#fff" />
        <circle cx="22.5" cy="22.5" r="2.2" fill="var(--lime)" />
      </svg>
      <span style={{ display: 'grid', lineHeight: 1.15 }}>
        <span style={{ fontWeight: 900, fontSize: size * 0.68, letterSpacing: '-0.02em' }}>
          پروچیا
        </span>
        {subtitle && (
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 600 }}>{subtitle}</span>
        )}
      </span>
    </span>
  );
}
