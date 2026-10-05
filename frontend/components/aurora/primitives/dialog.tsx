"use client";

/**
 * Aurora <Dialog> primitive. Native `<dialog>` opened with showModal(), so
 * focus trap, inert background and Esc come from the platform. While
 * `dismissible` is false, Esc and backdrop clicks do nothing (use it for work
 * in flight).
 */

import { useEffect, useId, useRef, type ReactNode } from "react";
import { clsx } from "./internal";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Esc and backdrop click close the dialog. Default true. */
  dismissible?: boolean;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Dialog({ open, onClose, title, description, dismissible = true, footer, className, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={clsx("aurora-dialog", className)}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      {open ? (
        <div className="aurora-dialog__panel">
          <h2 id={`${id}-t`} className="aurora-dialog__title">{title}</h2>
          {description ? <p id={`${id}-d`} className="aurora-dialog__desc">{description}</p> : null}
          <div className="aurora-dialog__body">{children}</div>
          {footer ? <div className="aurora-dialog__footer">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
