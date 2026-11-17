"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Input } from "./Field";

export interface CommentItem { id: string; body: string; author: string; /** Already formatted. */ when: string; onDelete?: () => void }

/** A comment list with an optional composer. `empty` shows when the list is empty; the composer keeps its own draft and clears it after `onSubmit` resolves. */
export function CommentsPanel({ items, listLabel, deleteLabel, empty, composer }: {
  items: CommentItem[]; listLabel: string; deleteLabel?: string; empty: ReactNode;
  composer?: { label: string; placeholder?: string; submitLabel: string; disabled?: boolean; onSubmit: (text: string) => void | Promise<void> };
}) {
  const [text, setText] = useState("");
  return (
    <div className="mx-col">
      {items.length === 0 ? empty : (
        <ul className="mx-thread" aria-label={listLabel}>
          {items.map((c) => (
            <li key={c.id} className="mx-msg">
              <b>{c.author}</b> <span className="mx-muted">{c.when}</span>
              <p>{c.body}</p>
              {c.onDelete ? <Button variant="ghost" onClick={c.onDelete}>{deleteLabel}</Button> : null}
            </li>
          ))}
        </ul>
      )}
      {composer ? (
        <form className="mx-links" onSubmit={async (e) => { e.preventDefault(); const v = text.trim(); if (!v) return; await composer.onSubmit(v); setText(""); }}>
          <Input aria-label={composer.label} value={text} onChange={(e) => setText(e.target.value)} placeholder={composer.placeholder} />
          <Button type="submit" variant="secondary" disabled={!text.trim() || composer.disabled}>{composer.submitLabel}</Button>
        </form>
      ) : null}
    </div>
  );
}
