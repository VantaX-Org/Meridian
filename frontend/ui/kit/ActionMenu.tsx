"use client";

import { useEffect, useRef, useState } from "react";

export interface ActionMenuItem { id: string; label: string; onClick: () => void; disabled?: boolean }

/** A secondary button that opens a short list of actions. Escape and an outside click close it. */
export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="mx-actionmenu" ref={ref}>
      <button type="button" className="mx-btn" data-variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{label}</button>
      <div className="mx-menu" role="menu" aria-label={label} hidden={!open}>
          {items.map((m) => <button key={m.id} type="button" role="menuitem" className="mx-menuitem" disabled={m.disabled} onClick={() => { setOpen(false); m.onClick(); }}>{m.label}</button>)}
      </div>
    </div>
  );
}
