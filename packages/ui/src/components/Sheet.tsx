import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

let openSheets = 0;

/**
 * Bottom sheet on phones, centred dialog on wider screens. Closes on Escape and on the scrim,
 * locks page scroll while open, and returns focus to whatever opened it.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  center,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  center?: boolean;
  labelledBy?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    openSheets++;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      openSheets--;
      if (openSheets === 0) document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className={center ? 'pc-sheet pc-sheet--center' : 'pc-sheet'}>
      <div className="pc-sheet__scrim" onClick={onClose} />
      <div
        ref={panel}
        className="pc-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
      >
        {title !== undefined && (
          <div className="pc-sheet__head">
            <div className="pc-sheet__title">{title}</div>
            <button
              type="button"
              className="pc-btn pc-btn--ghost pc-btn--icon pc-btn--s"
              onClick={onClose}
              aria-label="بستن"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        <div className="pc-sheet__body">{children}</div>
        {footer && (
          <div
            style={{
              position: 'sticky',
              bottom: 0,
              padding:
                'var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom))',
              background: 'var(--surface)',
              borderTop: '1px solid var(--line)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
