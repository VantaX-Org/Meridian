"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** A button that opens a floating panel. Closes on outside press and Escape. The panel gets a close function. */
export function Popover({ label, trigger, children, className, triggerClassName, panelClassName, align = "end", triggerProps }: {
  label: string; trigger: ReactNode; children: (close: () => void) => ReactNode; className?: string; triggerClassName?: string; panelClassName?: string; align?: "start" | "end";
  triggerProps?: Record<`data-${string}`, string | undefined>;
}) {
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
    <div className={`mx-user mx-pop ${className ?? ""}`} ref={ref}>
      <button type="button" className={triggerClassName ?? "mx-gbtn"} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)} {...triggerProps}>{trigger}</button>
      {open ? <div className={`mx-pop-panel ${panelClassName ?? ""}`} data-align={align} role="dialog" aria-label={label}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}
