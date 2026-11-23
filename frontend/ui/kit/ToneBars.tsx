"use client";

import { score as fmt, signed } from "../screens/object/format";

const toneOf = (n: number): "go" | "watch" | "stop" => (n >= 85 ? "go" : n >= 70 ? "watch" : "stop");

export interface ToneBar { key: string; label: string; value: number | null; delta: number | null }

/**
 * One bar per dimension, coloured by the gate it sits against, with a line at the 85 go level. With `onSelect` each
 * label is a button that drills into that dimension; the selected bar keeps its tone and the rest read as muted.
 */
export function ToneBars({ items, naLabel, lineLabel, onSelect, selected }: { items: ToneBar[]; naLabel: string; lineLabel: string; onSelect?: (key: string) => void; selected?: string | null }) {
  return (
    <ul className="mx-tonebars" aria-label={lineLabel}>
      {items.map((b) => {
        const value = b.value === null ? naLabel : fmt(b.value);
        return (
          <li key={b.key} data-testid="tonebar" data-link={onSelect ? "" : undefined} data-selected={selected === b.key ? "true" : undefined} data-dim={selected && selected !== b.key ? "true" : undefined} title={`${b.label}: ${value}`}>
            <span className="mx-tb-l">{onSelect ? <button type="button" className="mx-hit" aria-pressed={selected === b.key} onClick={() => onSelect(b.key)}>{b.label}</button> : b.label}</span>
            <span className="mx-tb-track" role="img" aria-label={`${b.label} ${value}`}>
              {b.value !== null ? <span className="mx-tb-fill" data-tone={toneOf(b.value)} style={{ inlineSize: `${Math.max(0, Math.min(100, b.value))}%` }} /> : null}
              <span className="mx-tb-line" aria-hidden="true" />
            </span>
            <span className="mx-tb-v">{value}</span>
            <span className="mx-tb-d" data-sign={b.delta === null ? undefined : b.delta > 0 ? "up" : b.delta < 0 ? "down" : "flat"}>{b.delta === null ? "" : signed(b.delta)}</span>
          </li>
        );
      })}
    </ul>
  );
}
