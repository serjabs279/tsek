import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { Modal } from '@shared/components/ui';

export function ScreenHead({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="m-row m-row--between" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1
          style={{
            margin: '2px 0 0',
            fontFamily: 'var(--serif)',
            fontWeight: 500,
            fontSize: 'clamp(1.35rem, 3vw, 1.8rem)',
            lineHeight: 1.15,
          }}
        >
          {title}
        </h1>
        {subtitle && <p className="m-tiny" style={{ margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {actions && <div className="m-row">{actions}</div>}
    </div>
  );
}

export function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
  return (
    <div className="m-stat">
      <div className="m-stat__label">{label}</div>
      <div className="m-stat__value">{value}</div>
      {detail && <div className="m-stat__detail">{detail}</div>}
    </div>
  );
}

export function EmptyBlock({
  icon,
  title,
  message,
  action,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon}</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

export function MobileSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="m-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="m-overlay__head">
        <button className="m-iconbtn" onClick={onClose} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="m-overlay__title">
          <strong>{title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
        <button className="m-iconbtn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="m-overlay__body">{children}</div>
      {footer && <div className="m-overlay__foot">{footer}</div>}
    </div>
  );
}

/**
 * Destructive actions always need the exact phrase typed. A single tap is too
 * easy to repeat by accident on a tablet, and the workspace has no undo for a
 * deleted exam.
 */
export function TypeToConfirm({
  open,
  title,
  message,
  phrase,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  phrase: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const ready = typed.trim() === phrase;

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--danger"
            disabled={!ready}
            onClick={() => {
              if (!ready) return;
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="m-tiny" style={{ fontSize: '0.82rem', color: 'var(--ink-2)' }}>{message}</div>
      <label className="m-field m-confirm-type">
        <span className="m-field__label">Type {phrase} to confirm</span>
        <input
          className="input"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={phrase}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
    </Modal>
  );
}

export function FieldBlock({
  label,
  children,
  wide = false,
  hint,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  hint?: string;
}) {
  return (
    <label className={`m-field ${wide ? 'm-span' : ''}`}>
      <span className="m-field__label">{label}</span>
      {children}
      {hint && <span className="m-tiny">{hint}</span>}
    </label>
  );
}
