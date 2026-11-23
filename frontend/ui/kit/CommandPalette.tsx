"use client";

import { Fragment, useMemo, useState } from "react";

export interface Command { id: string; label: string; hint?: string; /** Key hint shown beside the label, for example "G" or "Shift+A". */ shortcut?: string; /** Group header text, already translated. */ group?: string; run: () => void }

const KEY = "mx-palette-recent";
const readRecent = (): string[] => { try { const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
const saveRecent = (id: string) => { try { localStorage.setItem(KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 5))); } catch { /* storage blocked */ } };

/**
 * Search box over a list of commands. The last row always asks Aletheia the typed text (onAsk). Arrows move, Enter runs, Escape closes.
 * onQuery hears every keystroke; extra rows (server search hits for that text) lead the list while text is typed, unfiltered.
 */
type Props = {
  open: boolean; onClose: () => void; commands: Command[]; onAsk: (q: string) => void;
  label: string; placeholder: string; askLabel: (q: string) => string; emptyLabel: string;
  onQuery?: (q: string) => void; extra?: Command[];
  /** Actions the current screen registers (filter by, group by, accept all, open rule). They lead the list under `contextLabel`. */
  context?: Command[]; contextLabel?: string;
  /** Header for the recent list, and the key hints in the footer. */
  recentLabel?: string; footer?: string[]; askGroup?: string;
};

export function CommandPalette(p: Props) { return p.open ? <Body {...p} /> : null; }

/** Mounted only while open, so the text and the highlighted row reset on every open. */
function Body({ onClose, commands, onAsk, label, placeholder, askLabel, emptyLabel, onQuery, extra, recentLabel, footer, askGroup, context, contextLabel }: Props) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = context?.length ? [...context.map((c) => ({ ...c, group: contextLabel ?? c.group })), ...commands] : commands;
    const hit = all.filter((c) => !s || `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(s));
    if (!s && recentLabel) {
      const ids = readRecent();
      const rec = ids.map((id) => all.find((c) => c.id === id)).filter((c): c is Command => !!c).map((c) => ({ ...c, id: `recent-${c.id}`, group: recentLabel }));
      return [...rec, ...hit];
    }
    return s ? [...(extra ?? []), ...hit, { id: "__ask", label: askLabel(q.trim()), hint: undefined, group: askGroup, run: () => onAsk(q.trim()) }] : hit;
  }, [commands, context, contextLabel, extra, q, askLabel, onAsk, recentLabel, askGroup]);
  const go = (i: number) => { const r = rows[i]; if (r) { if (r.id !== "__ask") saveRecent(r.id.replace(/^recent-/, "")); onClose(); r.run(); } };
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
            <Fragment key={r.id}>
            {r.group && r.group !== rows[i - 1]?.group ? <li role="presentation" className="mx-palette-group">{r.group}</li> : null}
            <li id={`mx-pal-${r.id}`} role="option" aria-selected={i === at} data-ask={r.id === "__ask" ? "" : undefined} onMouseEnter={() => setAt(i)} onClick={() => go(i)}>
              <span>{r.label}</span>{r.hint ? <span className="mx-muted">{r.hint}</span> : null}{r.shortcut ? <kbd className="mx-kbd">{r.shortcut}</kbd> : null}
            </li>
            </Fragment>
          ))}
        </ul>
        {footer?.length ? <p className="mx-palette-foot">{footer.map((f) => <span key={f}>{f}</span>)}</p> : null}
      </div>
    </div>
  );
}
