"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { ExplainArgs, ExplainMetric, ExplainRow } from "@/lib/api/v2/object";
import { useExplain } from "@/lib/v2/object-queries";
import { Skeleton } from "./parts";
import "./object.css";

/**
 * The "i" that explains a number. One popover at a time, 320 pixels wide, drawn from GET /explain/{metric}: a title,
 * the plain-language text and the arithmetic behind it. It is a button with aria-expanded; the popover is a dialog
 * that takes focus when it opens, closes on Esc (focus returns to the "i"), on a click outside and on Tab out.
 */

let openId: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getOpen = () => openId;
function setOpen(id: string | null): void {
  if (openId === id) return;
  openId = id;
  listeners.forEach((l) => l());
}

const WIDTH = 320;
const GAP = 8;

function format(row: ExplainRow): string {
  if (row.value == null) return "—";
  const v = typeof row.value === "number" ? row.value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : row.value;
  return row.unit ? `${v} ${row.unit}` : String(v);
}

export interface ExplainProps extends ExplainArgs {
  metric: ExplainMetric;
  /** What the number is, for the button's name: "About Tolerance". */
  label: string;
}

export function Explain({ metric, label, module, run, dimension, checkId }: ExplainProps) {
  const id = useId();
  const current = useSyncExternalStore(subscribe, getOpen, () => null);
  const open = current === id;
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const q = useExplain(metric, { module, run, dimension, checkId }, open);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(GAP, Math.min(r.left + r.width / 2 - WIDTH / 2, window.innerWidth - WIDTH - GAP));
    setPos({ top: r.bottom + 6, left });
  }, []);

  const toggle = () => {
    if (open) return setOpen(null);
    place();
    setOpen(id);
  };

  useEffect(() => {
    if (!open) return;
    pop.current?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(null);
        btn.current?.focus();
      } else if (e.key === "Tab") setOpen(null);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      if (openId === id) setOpen(null);
    };
  }, [open, place, id]);

  return (
    <>
      <button ref={btn} type="button" className="m2-ibtn" aria-label={`About ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
        <span aria-hidden="true">i</span>
      </button>
      {open ? (
        <div ref={pop} id={id} className="m2-pop" role="dialog" aria-label={q.data?.title ?? label} tabIndex={-1} style={{ top: pos.top, left: pos.left, width: WIDTH }} data-testid="explain">
          {q.isPending ? (
            <div aria-busy="true">
              <Skeleton width={160} height={14} />
              <div style={{ height: 8 }} />
              <Skeleton width="100%" height={12} />
              <div style={{ height: 6 }} />
              <Skeleton width="80%" height={12} />
            </div>
          ) : q.isError ? (
            <p role="alert">The explanation could not be read for this run.</p>
          ) : (
            <>
              <h4>{q.data.title}</h4>
              <p>{q.data.text}</p>
              {q.data.computation.length > 0 ? (
                <dl className="m2-calc">
                  {q.data.computation.map((row, i) => (
                    <div key={`${row.label}-${i}`}>
                      <dt>{row.label}</dt>
                      <dd>{format(row)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
