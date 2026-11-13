"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Icon } from "../Icon";
import { cx } from "./cx";
import { trapTab } from "./focus";

/** A drag past this share of the sheet's height dismisses it. */
export const DISMISS_SHARE = 0.25;

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "auto" | "full";
  testId?: string;
}

/**
 * A modal layer. Desktop: centred, up to --nx-sheet-max, over a scrim. Phone: rises from the bottom with a handle that
 * drags down to dismiss. Focus is trapped, Esc and a click on the scrim close, and focus returns to the opener.
 */
export function Sheet({ open, onClose, title, children, size = "auto", testId }: SheetProps) {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const drag = useRef<{ y: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => opener.current?.focus?.();
  }, [open]);

  if (!open) return null;
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const h = box.current?.getBoundingClientRect().height || 0;
    const far = h > 0 && dy > h * DISMISS_SHARE;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDy(0);
    if (far) onClose();
  };
  return (
    <div className="nx-scrim nx-sheet-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        data-testid={testId}
        data-size={size}
        className="nx-sheet nx-m-sheet"
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          trapTab(e, box.current);
        }}
      >
        <div
          className="nx-sheet-handle"
          aria-hidden="true"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY };
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => drag.current && setDy(Math.max(0, e.clientY - drag.current.y))}
          onPointerUp={end}
          onPointerCancel={end}
        />
        <header className={cx("nx-sheet-head", scrolled && "nx-glass-strong")} data-scrolled={scrolled || undefined}>
          <h2 id={id} className="nx-dialog-title">{title}</h2>
          <button type="button" className="nx-icon-btn" aria-label={t("Close")} onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </header>
        <div className="nx-sheet-body" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>{children}</div>
      </div>
    </div>
  );
}
