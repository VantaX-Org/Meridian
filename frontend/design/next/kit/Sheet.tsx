"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Icon } from "../Icon";
import { Confirm } from "./Confirm";
import { cx } from "./cx";
import { trapTab } from "./focus";
import { Stepper, type StepItem } from "./Stepper";

export type SheetSize = "small" | "medium" | "large" | "full";

export interface SheetStep {
  id: string;
  label: string;
  /** The status line under the label in the stepper. */
  detail?: ReactNode;
  failed?: boolean;
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Right of the title: a chip, a run sentence. */
  meta?: ReactNode;
  size?: SheetSize;
  /** "top" is the command sheet: it drops from the top, centred, medium width. */
  variant?: "side" | "top";
  /** Linear steps. Steps before the current one are tappable. */
  steps?: SheetStep[];
  /** One-based current step. */
  step?: number;
  onStep?: (n: number) => void;
  /** Unsaved edits: Esc and the close button ask first. */
  dirty?: boolean;
  /** The sticky footer: at most one primary and one secondary action. */
  primary?: ReactNode;
  secondary?: ReactNode;
  /** True for the lower sheet of a stack: it stays mounted but cannot take focus. */
  under?: boolean;
  children: ReactNode;
}

/**
 * The one container for every deeper task. A panel from the right on a desktop, a bottom sheet on a phone, over a
 * solid scrim. Focus stays inside and returns to the opener. Solid surface, no glass.
 */
export function Sheet({ open, onClose, title, meta, size = "medium", variant = "side", steps, step = 1, onStep, dirty, primary, secondary, under, children }: SheetProps) {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [ask, setAsk] = useState(false);
  const tid = useId();
  const top = variant === "top";

  // Latest values for the keydown listener, so it is bound once per open.
  const live = useRef({ dirty, onClose, under });
  useEffect(() => {
    live.current = { dirty, onClose, under };
  });
  const request = () => (live.current.dirty ? setAsk(true) : live.current.onClose());

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const el = box.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el)?.focus();
    return () => opener.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open || under) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      request();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, under]);

  if (!open) return null;

  const total = steps?.length ?? 0;
  const at = Math.min(Math.max(step, 1), Math.max(total, 1));
  const items: StepItem[] | undefined = steps?.map((s, i) => ({
    id: String(i + 1),
    label: s.label,
    detail: s.detail,
    state: s.failed ? "failed" : i + 1 < at ? "done" : i + 1 === at ? "current" : "future",
  }));

  return (
    <div
      className={cx("nx-sheet-scrim", top && "nx-sheet-scrim-top", under && "nx-sheet-scrim-under")}
      onMouseDown={(e) => e.target === e.currentTarget && !under && request()}
      aria-hidden={under || undefined}
      {...(under ? { inert: true } : {})}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tid}
        tabIndex={-1}
        data-testid="sheet"
        data-size={top ? "medium" : size}
        className={cx("nx-sheet", top && "nx-sheet-top", `nx-sheet-${top ? "medium" : size}`)}
        onKeyDown={(e) => trapTab(e, box.current)}
      >
        <span className="nx-sheet-handle" aria-hidden="true" />
        <header className="nx-sheet-head">
          <h2 id={tid} className="nx-sheet-title">{title}</h2>
          {meta ? <div className="nx-sheet-meta">{meta}</div> : null}
          <button type="button" className="nx-icon-btn nx-sheet-close" aria-label={t("Close")} onClick={request}>
            <Icon name="x" />
          </button>
        </header>
        {items && total > 1 ? (
          <div className="nx-sheet-steps">
            <p className="nx-sheet-count" aria-live="polite">
              {t("Step {n} of {total}, {label}", { n: at, total, label: steps![at - 1].label })}
            </p>
            <div className="nx-sheet-stepper">
              <Stepper steps={items} label={t("Steps")} onSelect={(id) => Number(id) < at && onStep?.(Number(id))} selectedId={String(at)} />
            </div>
          </div>
        ) : null}
        <div className="nx-sheet-body">{children}</div>
        {primary || secondary ? (
          <footer className="nx-sheet-foot">
            {secondary}
            {primary}
          </footer>
        ) : null}
      </div>
      <Confirm
        open={ask}
        title={t("Leave without saving?")}
        consequence={t("Your edits on this step are not saved yet.")}
        confirmLabel={t("Leave")}
        danger
        onConfirm={() => {
          setAsk(false);
          live.current.onClose();
        }}
        onCancel={() => setAsk(false)}
      />
    </div>
  );
}
