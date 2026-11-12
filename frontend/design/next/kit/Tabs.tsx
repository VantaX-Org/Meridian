"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface TabItem {
  id: string;
  label: string;
  /** A count or short status shown after the label. */
  badge?: ReactNode;
}

/**
 * Tabs bound to a value the caller owns (the URL search param, in the app). Roving tabindex, arrow keys, Home and End.
 * The caller renders the panel with id `${idBase}-panel-${id}`.
 */
export function Tabs({ items, value, onChange, label, idBase = "nx-tabs" }: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  idBase?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = items.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next].id);
  };
  return (
    <div role="tablist" aria-label={label} className="nx-tabs">
      {items.map((it, i) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${it.id}`}
            aria-selected={on}
            aria-controls={`${idBase}-panel-${it.id}`}
            tabIndex={on ? 0 : -1}
            className={cx("nx-tab", on && "nx-tab-on")}
            onClick={() => onChange(it.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {it.label}
            {it.badge !== undefined ? <span className="nx-tab-badge">{it.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
