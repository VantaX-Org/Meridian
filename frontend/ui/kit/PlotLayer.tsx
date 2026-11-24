"use client";

import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

export interface PlotRange { from: number; to: number }

/**
 * The interaction layer every chart shares: a crosshair and readout that follow the pointer, one keyboard stop that
 * walks the points with the arrow keys, `onSelect` from a click or Enter, and an optional drag (or Shift plus arrows)
 * that reports a range. Charts hand it the number of points and a sentence per point; it never reads chart internals.
 * `inset` is the share of the width the plot leaves free at each end, so point positions line up with the drawing.
 */
export function PlotLayer({ n, describe, label, onSelect, brush, onRange, inset = { start: 0, end: 0 }, children }: {
  n: number; describe: (i: number) => string; label: string; onSelect?: (i: number) => void; brush?: boolean;
  onRange?: (r: PlotRange | null) => void; inset?: { start: number; end: number }; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [drag, setDrag] = useState<PlotRange | null>(null);
  const [range, setRange] = useState<PlotRange | null>(null);

  const span = 1 - inset.start - inset.end;
  const pct = (i: number) => (inset.start + (n < 2 ? 0.5 : i / (n - 1)) * span) * 100;
  const indexAt = (clientX: number): number | null => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0 || n < 1) return null;
    const raw = (((clientX - r.left) / r.width - inset.start) / span) * (n - 1);
    return Math.max(0, Math.min(n - 1, Math.round(raw)));
  };
  const norm = (a: number, b: number): PlotRange => ({ from: Math.min(a, b), to: Math.max(a, b) });
  const commit = (r: PlotRange | null) => { setRange(r); onRange?.(r); };

  const move = (e: MouseEvent) => {
    const i = indexAt(e.clientX);
    if (i === null) return;
    setActive(i);
    if (drag) setDrag({ from: drag.from, to: i });
  };
  const down = (e: MouseEvent) => {
    if (!brush) return;
    const i = indexAt(e.clientX);
    if (i !== null) setDrag({ from: i, to: i });
  };
  const up = () => {
    if (!drag) return;
    if (drag.from === drag.to) onSelect?.(drag.from);
    else commit(norm(drag.from, drag.to));
    setDrag(null);
  };
  const key = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step !== 0 && n > 0) {
      e.preventDefault();
      const next = active === null ? (step > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, active + step));
      if (brush && e.shiftKey) {
        anchor.current ??= active ?? next;
        commit(norm(anchor.current, next));
      } else anchor.current = null;
      setActive(next);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : n - 1);
    } else if ((e.key === "Enter" || e.key === " ") && active !== null && onSelect) {
      e.preventDefault();
      onSelect(active);
    } else if (e.key === "Escape") {
      anchor.current = null;
      setActive(null);
      if (range) commit(null);
    }
  };

  const shown = drag ?? range;
  const tipAt = active === null ? 0 : Math.max(12, Math.min(88, pct(active)));
  return (
    <div ref={box} className="mx-plot" tabIndex={0} role="group" aria-label={label} data-brush={brush ? "" : undefined}
      onMouseMove={move} onMouseDown={down} onMouseUp={up} onMouseLeave={() => { setDrag(null); setActive(null); }}
      onClick={brush ? undefined : () => { if (active !== null) onSelect?.(active); }}
      onKeyDown={key} onBlur={() => setActive(null)}>
      {children}
      {shown ? <span className="mx-brush" data-testid="brush" style={{ insetInlineStart: `${pct(shown.from)}%`, inlineSize: `${pct(shown.to) - pct(shown.from)}%` }} /> : null}
      {active !== null ? (
        <>
          <span className="mx-xhair" aria-hidden="true" style={{ insetInlineStart: `${pct(active)}%` }} />
          <span className="mx-plot-tip" role="status" style={{ insetInlineStart: `${tipAt}%` }}>{describe(active)}</span>
        </>
      ) : null}
    </div>
  );
}
