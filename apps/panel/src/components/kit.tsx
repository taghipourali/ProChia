import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatNumber } from '@prochia/shared';
import { Button, Icon } from '@prochia/ui';

export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="topbar">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="toolbar">{actions}</div>}
      </div>
      {children}
    </>
  );
}

export function Panel({
  title,
  actions,
  children,
  flush,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="panel">
      {(title || actions) && (
        <div className="panel__head">
          <div className="panel__title">{title}</div>
          {actions && <div className="toolbar">{actions}</div>}
        </div>
      )}
      <div className={flush ? undefined : 'panel__body'}>{children}</div>
    </section>
  );
}

/** Side panel for editing records without leaving the list. */
export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
  width,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="drawer" role="dialog" aria-modal="true">
      <div className="drawer__scrim" onClick={onClose} />
      <div
        className="drawer__panel"
        style={width ? { width: `min(${width}px, 100vw)` } : undefined}
      >
        <div className="drawer__head">
          <div className="drawer__title">{title}</div>
          <Button variant="ghost" size="s" iconOnly aria-label="بستن" onClick={onClose}>
            <Icon name="close" size={18} />
          </Button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer && <div className="drawer__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Kpi({
  label,
  value,
  hint,
  hero,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  hero?: boolean;
}) {
  return (
    <div className={hero ? 'kpi kpi--hero' : 'kpi'}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * Horizontal bars for ranked lists (top items, payment mix, funnel). One series, one hue;
 * the value is written beside each bar, so nothing depends on colour.
 */
export function BarList({
  rows,
  format = (v) => formatNumber(v),
  color,
}: {
  rows: { label: ReactNode; value: number; note?: ReactNode }[];
  format?: (v: number) => ReactNode;
  color?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="barlist">
      {rows.map((r, i) => (
        <div
          key={i}
          className="barlist__row"
          title={typeof r.label === 'string' ? r.label : undefined}
        >
          <span>{r.label}</span>
          <div className="barlist__track">
            <div
              className="barlist__fill"
              style={{ width: `${(r.value / max) * 100}%`, background: color }}
            />
          </div>
          <span className="num" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            {format(r.value)}
            {r.note && <span className="hint"> {r.note}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Numeric input that accepts Persian digits and returns a number (or null when empty). */
export function NumberInput({
  value,
  onChange,
  placeholder,
  className,
  ...rest
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  // Follow outside changes without clobbering what is being typed ("12." stays "12.").
  useEffect(() => {
    setText((current) =>
      parseNumber(current) === value ? current : value === null ? '' : String(value),
    );
  }, [value]);
  return (
    <input
      className={['pc-input num', className].filter(Boolean).join(' ')}
      inputMode="decimal"
      dir="ltr"
      style={{ textAlign: 'right' }}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseNumber(e.target.value));
      }}
      {...rest}
    />
  );
}

function parseNumber(input: string): number | null {
  const raw = input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,٬\s]/g, '')
    .replace('٫', '.');
  if (raw === '' || raw === '-') return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}
