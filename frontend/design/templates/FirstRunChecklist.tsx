"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "../primitives/Button";
import { Card } from "../primitives/Card";

export interface ChecklistItem {
  id: string;
  label: string;
  /** Derived from real state by the caller, never stored here. */
  done: boolean;
  /** Where to do it. */
  href: string;
  detail?: string;
}

/**
 * Setup steps with their live state. Shown while any item is incomplete and
 * dismissible; renders nothing once every item is done (or there are none).
 * Done items carry a check mark, open ones an empty ring, so state is never colour alone.
 */
export function FirstRunChecklist({ items, onDismiss }: { items: ChecklistItem[]; onDismiss: () => void }) {
  const doneCount = items.filter((i) => i.done).length;
  if (items.length === 0 || doneCount === items.length) return null;
  return (
    <Card
      title="Get set up"
      meta={`${doneCount} of ${items.length} done`}
      padding="sm"
      actions={<Button variant="ghost" onClick={onDismiss}>Dismiss</Button>}
      dataTour="first-run-checklist"
    >
      <ul className="flex flex-col" data-testid="first-run-checklist">
        {items.map((item) => (
          <li key={item.id} data-done={item.done} className="flex items-center gap-3 py-1.5 m-text-body">
            <span
              aria-hidden
              className="inline-flex shrink-0 items-center justify-center rounded-full"
              style={{
                width: 18,
                height: 18,
                color: item.done ? "var(--m-pass)" : "var(--m-ink-3)",
                boxShadow: `inset 0 0 0 1.5px ${item.done ? "var(--m-pass)" : "var(--m-line-strong)"}`,
              }}
            >
              {item.done && <Check size={12} strokeWidth={3} />}
            </span>
            <Link href={item.href} style={{ color: item.done ? "var(--m-ink-3)" : "var(--m-accent)" }}>
              {item.label}
              <span className="sr-only">{item.done ? ", done" : ", not done yet"}</span>
            </Link>
            {item.detail && <span style={{ color: "var(--m-ink-3)" }}>{item.detail}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
