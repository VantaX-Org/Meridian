"use client";

import { useRef, type KeyboardEvent } from "react";
import { cx } from "./cx";

export interface Segment<V extends string> {
  value: V;
  label: string;
}

/** A radio group drawn as a pill strip. Arrow keys move and select, as native radios do. */
export function SegmentedControl<V extends string>({ items, value, onChange, label }: {
  items: Segment<V>[];
  value: V;
  onChange: (v: V) => void;
  label: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = items.length;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next].value);
  };
  return (
    <div role="radiogroup" aria-label={label} className="nx-seg">
      {items.map((it, i) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={cx("nx-seg-item", on && "nx-seg-on")}
            onClick={() => onChange(it.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
