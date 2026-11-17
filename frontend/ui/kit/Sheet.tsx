"use client";

import { useEffect, type ReactNode } from "react";

/** A modal sheet over a scrim. On a stacked (narrow) layout it rises from the bottom. Escape and the close button dismiss it. */
export function Sheet({ open, onClose, label, closeLabel, children }: { open: boolean; onClose: () => void; label: string; closeLabel: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="mx-scrim" data-place="bottom" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="mx-sheet" data-place="bottom" role="dialog" aria-modal="true" aria-label={label}>
        <div className="mx-sheet-h"><button type="button" className="mx-btn" data-variant="ghost" onClick={onClose}>{closeLabel}</button></div>
        {children}
      </aside>
    </div>
  );
}
