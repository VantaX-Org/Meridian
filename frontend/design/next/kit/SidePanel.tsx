"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Icon } from "../Icon";

/**
 * 420 px, from the right, non-modal: the page behind stays usable. Esc closes and returns focus to the opener;
 * F6 moves focus between the panel and the page. Under 640 px it fills the screen (see kit.css).
 */
export function SidePanel({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => opener.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      } else if (e.key === "F6") {
        e.preventDefault();
        const el = ref.current;
        if (el?.contains(document.activeElement)) opener.current?.focus?.();
        else el?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <aside ref={ref} tabIndex={-1} className="nx-panel nx-side" role="complementary" aria-label={title}>
      <header className="nx-side-head">
        <h2 className="nx-side-title">{title}</h2>
        <button type="button" className="nx-icon-btn" aria-label={t("Close panel")} onClick={onClose}>
          <Icon name="x" size={20} />
        </button>
      </header>
      <div className="nx-side-body">{children}</div>
      {footer ? <footer className="nx-side-foot">{footer}</footer> : null}
    </aside>
  );
}
