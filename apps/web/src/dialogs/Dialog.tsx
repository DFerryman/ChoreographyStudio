import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Stacking layers matter to useModalFocus: a guard confirmation always sits
 * above an import dialog, which sits above ordinary dialogs.
 */
export type DialogLayer = 'base' | 'import' | 'guard';

type DialogProps = {
  /** aria-labelledby id; useModalFocus routes Escape by this id. */
  titleId: string;
  title: ReactNode;
  eyebrow?: string;
  className?: string;
  layer?: DialogLayer;
  /** Accessible name of the heading close button; omitted for confirmations. */
  closeLabel?: string;
  closeDisabled?: boolean;
  onClose?: () => void;
  /** Close on a press on the backdrop itself. */
  dismissOnBackdrop?: boolean;
  intro?: ReactNode;
  children?: ReactNode;
};

export function Dialog({ titleId, title, eyebrow, className = '', layer = 'base', closeLabel, closeDisabled, onClose, dismissOnBackdrop, intro, children }: DialogProps) {
  const backdrop = layer === 'guard' ? 'guard-backdrop' : layer === 'import' ? 'import-backdrop' : '';
  return <div className={`modal-backdrop ${backdrop}`.trim()} onMouseDown={dismissOnBackdrop && onClose ? event => { if (event.target === event.currentTarget && !closeDisabled) onClose(); } : undefined}>
    <section className={`modal ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal-heading">
        <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2></div>
        {closeLabel && onClose && <button className="icon-button" aria-label={closeLabel} disabled={closeDisabled} onClick={onClose}><X size={19} /></button>}
      </div>
      {intro && <p className="modal-intro">{intro}</p>}
      {children}
    </section>
  </div>;
}

type ConfirmDialogProps = {
  titleId: string;
  title: ReactNode;
  eyebrow?: string;
  intro: ReactNode;
  children?: ReactNode;
  confirmLabel: ReactNode;
  confirmTone?: 'primary' | 'danger';
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A guarded yes/no decision rendered above every other dialog. */
export function ConfirmDialog({ titleId, title, eyebrow, intro, children, confirmLabel, confirmTone = 'primary', confirmDisabled, onConfirm, onCancel }: ConfirmDialogProps) {
  return <Dialog titleId={titleId} title={title} eyebrow={eyebrow} layer="guard" className="scene-confirm-modal" intro={intro}>
    {children}
    <div className="modal-actions">
      <button className="button secondary" onClick={onCancel}>取消</button>
      <button className={`button ${confirmTone}`} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </Dialog>;
}
