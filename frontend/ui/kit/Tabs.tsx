"use client";

import type { KeyboardEvent } from "react";

export interface TabItem { id: string; label: string; badge?: string }

/** Accessible tab list: arrow keys move, Home and End jump. The panel is the caller's, with id `${idBase}-panel-${value}`. */
export function Tabs({ idBase, label, items, value, onChange }: { idBase: string; label: string; items: TabItem[]; value: string; onChange: (id: string) => void }) {
  const move = (e: KeyboardEvent, i: number) => {
    const n = e.key === "ArrowRight" ? (i + 1) % items.length : e.key === "ArrowLeft" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    onChange(items[n].id);
    document.getElementById(`${idBase}-tab-${items[n].id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="mx-tabs">
      {items.map((x, i) => (
        <button key={x.id} id={`${idBase}-tab-${x.id}`} type="button" role="tab" className="mx-tab" aria-selected={x.id === value} aria-controls={`${idBase}-panel-${x.id}`} tabIndex={x.id === value ? 0 : -1} onClick={() => onChange(x.id)} onKeyDown={(e) => move(e, i)}>
          {x.label}{x.badge ? <span className="mx-tab-badge">{x.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
