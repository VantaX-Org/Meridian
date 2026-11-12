"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Button } from "./Button";
import { trapTab } from "./focus";

/**
 * A modal that states the consequence in numbers ("This writes 4,210 records to the live system"). For a live system
 * the person types a phrase first; the confirm button says why it is off until they do.
 */
export function Confirm({ open, title, consequence, confirmLabel, danger, phrase, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  consequence: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** The phrase to type before the confirm button works (live systems). */
  phrase?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const tid = useId();
  const did = useId();
  const ok = !phrase || typed.trim() === phrase;

  useEffect(() => {
    if (!open) return;
    setTyped("");
    opener.current = document.activeElement as HTMLElement | null;
    // The safe choice takes focus: Cancel, or the phrase box.
    const el = box.current?.querySelector<HTMLElement>("[data-autofocus]");
    el?.focus();
    return () => opener.current?.focus?.();
  }, [open]);

  if (!open) return null;
  return (
    <div className="nx-scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={tid}
        aria-describedby={did}
        className="nx-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
          trapTab(e, box.current);
        }}
      >
        <h2 id={tid} className="nx-dialog-title">{title}</h2>
        <div id={did} className="nx-dialog-body">{consequence}</div>
        {phrase ? (
          <label className="nx-field">
            <span>{t("Type {phrase} to confirm", { phrase })}</span>
            <input data-autofocus className="nx-input nx-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        ) : null}
        <div className="nx-dialog-actions">
          <Button variant="quiet" onClick={onCancel} {...(phrase ? {} : { "data-autofocus": true })}>{t("Cancel")}</Button>
          <Button variant={danger ? "danger" : "primary"} disabled={!ok} reason={!ok ? t("Type the phrase first") : undefined} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
