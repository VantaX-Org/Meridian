"use client";

import { useEffect, type ReactNode } from "react";

/** A centred confirm dialog. Focus starts on Cancel; Escape cancels. */
export function Confirm({ open, title, children, confirmLabel, cancelLabel, onConfirm, onCancel, danger }: { open: boolean; title: string; children?: ReactNode; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="mx-scrim" data-place="center" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="mx-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2 className="mx-dialog-h">{title}</h2>
        {children}
        <div className="mx-dialog-f">
          <button type="button" className="mx-btn" autoFocus onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="mx-btn" data-variant="primary" data-danger={danger ? "" : undefined} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
