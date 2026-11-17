"use client";

import { useMemo, useState } from "react";

export interface Command { id: string; label: string; hint?: string; run: () => void }

/**
 * Search box over a list of commands. The last row always asks Aletheia the typed text (onAsk). Arrows move, Enter runs, Escape closes.
 * onQuery hears every keystroke; extra rows (server search hits for that text) lead the list while text is typed, unfiltered.
 */
type Props = {
  open: boolean; onClose: () => void; commands: Command[]; onAsk: (q: string) => void;
  label: string; placeholder: string; askLabel: (q: string) => string; emptyLabel: string;
  onQuery?: (q: string) => void; extra?: Command[];
};

export function CommandPalette(p: Props) { return p.open ? <Body {...p} /> : null; }

/** Mounted only while open, so the text and the highlighted row reset on every open. */
function Body({ onClose, commands, onAsk, label, placeholder, askLabel, emptyLabel, onQuery, extra }: Props) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = commands.filter((c) => !s || `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(s));
    return s ? [...(extra ?? []), ...hit, { id: "__ask", label: askLabel(q.trim()), hint: undefined, run: () => onAsk(q.trim()) }] : hit;
  }, [commands, extra, q, askLabel, onAsk]);
  const go = (i: number) => { const r = rows[i]; if (r) { onClose(); r.run(); } };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(at); }
  };
  return (
    <div className="mx-scrim" data-place="top" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mx-palette" role="dialog" aria-modal="true" aria-label={label} onKeyDown={key}>
        <input className="mx-input" autoFocus role="combobox" aria-expanded="true" aria-controls="mx-palette-list" aria-activedescendant={rows[at] ? `mx-pal-${rows[at].id}` : undefined} aria-label={label} placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setAt(0); onQuery?.(e.target.value); }} />
        <ul id="mx-palette-list" role="listbox" aria-label={label}>
          {rows.length === 0 ? <li className="mx-muted">{emptyLabel}</li> : rows.map((r, i) => (
            <li key={r.id} id={`mx-pal-${r.id}`} role="option" aria-selected={i === at} data-ask={r.id === "__ask" ? "" : undefined} onMouseEnter={() => setAt(i)} onClick={() => go(i)}>
              <span>{r.label}</span>{r.hint ? <span className="mx-muted">{r.hint}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
