"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Button } from "./Button";
import { useToast } from "./Toast";
import { cx } from "./cx";

const MAX_ROWS = 6;

/**
 * An inline note box: grows to six lines, Ctrl or Cmd with Enter sends, Esc leaves the box. A successful send clears
 * the box and says so through a toast (`doneText`); a thrown error keeps the text and shows the message.
 */
export function Composer({ label, placeholder, submitLabel, onSubmit, doneText, busy = false, attach, className }: {
  label: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<unknown> | unknown;
  doneText?: string;
  busy?: boolean;
  attach?: ReactNode;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const toast = useToast();
  const empty = !text.trim();

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, lh * MAX_ROWS)}px`;
  }, [text]);

  const send = async () => {
    if (empty || pending || busy) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(text.trim());
      setText("");
      if (doneText) toast({ text: doneText, tone: "good" });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("This did not send. Your text is kept."));
    } finally {
      setPending(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
    else if (e.key === "Escape") box.current?.blur();
  };
  return (
    <div className={cx("nx-composer", className)}>
      <label htmlFor={id} className="nx-sr">{label}</label>
      <textarea id={id} ref={box} rows={1} className="nx-composer-box" value={text} placeholder={placeholder}
        aria-describedby={`${id}-h`} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      <div className="nx-composer-bar">
        <span id={`${id}-h`} className="nx-composer-hint">{t("Press Ctrl or Cmd with Enter to send.")}</span>
        {attach}
        <Button variant="primary" size={32} loading={pending || busy} loadingLabel={t("Sending")} disabled={empty} onClick={() => void send()}>{submitLabel}</Button>
      </div>
      {error ? <p role="alert" className="nx-error-line">{error}</p> : null}
    </div>
  );
}
