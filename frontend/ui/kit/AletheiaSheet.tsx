"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Message } from "./aletheia/Message";

export interface ChatAction { id: string; label: string; href?: string; onClick?: () => void }
export interface ChatMessage {
  id: string;
  role: "user" | "aletheia";
  text: string;
  /** Short facts the answer rests on, taken from the object's rule data. */
  evidence?: string[];
  actions?: ChatAction[];
  /** Streamed answers: the figures with their rule codes, an inline chart, a grounding footer, links and a pending flag. */
  facts?: ChatFact[];
  chart?: { kind: "bar" | "line"; data: { label: string; value: number }[] };
  footer?: { n: number; coverage: number; phrased: boolean };
  links?: { label: string; href: string }[];
  pending?: boolean;
}
export interface ChatFact { statement: string; value?: number | null; href?: string | null; checks: { check_id: string; module?: string | null }[] }
export interface AletheiaLabels {
  title: string;
  scope: string;
  close: string;
  inputLabel: string;
  send: string;
  evidence: string;
  suggestionsLabel: string;
  threadLabel: string;
}

/**
 * Aletheia as a chat sheet scoped to one object: thread, suggested prompts,
 * evidence and action chips on each answer. The caller supplies answers.
 */
export function AletheiaSheet({ open, onClose, labels, thread, suggestions, onAsk, scopeChip }: { scopeChip?: ReactNode; open: boolean; onClose: () => void; labels: AletheiaLabels; thread: ChatMessage[]; suggestions: string[]; onAsk: (prompt: string) => void }) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, onClose]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }); }, [thread.length, open]);
  if (!open) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q) return;
    onAsk(q);
    setDraft("");
  };
  return (
    <div className="mx-scrim">
      <aside className="mx-sheet" role="dialog" aria-modal="true" aria-label={labels.title}>
        <header className="mx-sheet-h">
          <div>
            <h2 className="mx-card-t"><span className="mx-aletheia-mark" aria-hidden="true" />{labels.title}</h2>
            <p className="mx-card-s">{labels.scope}</p>
          </div>
          <button type="button" className="mx-btn" data-variant="ghost" onClick={onClose}>{labels.close}</button>
        </header>
        {scopeChip}
        <div className="mx-thread" role="log" aria-label={labels.threadLabel}>
          {thread.map((m) => (
            <Message key={m.id} m={m} evidenceLabel={labels.evidence} onAsk={onAsk} />
          ))}
          <div ref={endRef} />
        </div>
        <div className="mx-chips" role="group" aria-label={labels.suggestionsLabel}>
          {suggestions.map((s) => <button key={s} type="button" className="mx-chip-btn" data-tone="aletheia" onClick={() => onAsk(s)}>{s}</button>)}
        </div>
        <form className="mx-compose" onSubmit={submit}>
          <input className="mx-input" aria-label={labels.inputLabel} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={labels.inputLabel} />
          <button type="submit" className="mx-btn" data-variant="primary" data-tone="aletheia" disabled={!draft.trim()}>{labels.send}</button>
        </form>
      </aside>
    </div>
  );
}
