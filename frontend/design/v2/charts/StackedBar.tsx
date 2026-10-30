"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useMeasuredWidth } from "../RunTimeline";
import { Legend, Readout, usePointer } from "./Frame";
import { stack } from "./scale";

/**
 * One whole split into its parts: findings by severity, objects by verdict. A 12 pixel bar, the parts in their order with
 * a 2 pixel gap of the sheet between them, each part's colour from the palette tokens (the severity scale, the
 * verdicts), the legend under it with each part's mark, word and count, so no part is told by colour alone. The pointer
 * or the arrow keys read one part at a time.
 */
export interface StackPart {
  key: string;
  label: string;
  value: number;
  /** A palette token: "--m2-sev-crit". */
  colour: string;
  /** The shape that says the same as the colour. */
  mark?: ReactNode;
  /** The reading of this part: "Critical: 70 findings, 3 percent". */
  title: string;
}

export const STACK_H = 12;

export function StackedBar({ parts, label, format, fallbackWidth = 480, testId }: { parts: readonly StackPart[]; label: string; format: (v: number) => string; fallbackWidth?: number; testId?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const width = Math.max(120, useMeasuredWidth(box, fallbackWidth));
  const segs = useMemo(() => stack(parts.map((p) => p.value), width), [parts, width]);
  const centres = segs.map((s) => s.x + s.w / 2);
  const shown = parts.map((p, i) => ({ p, s: segs[i], i })).filter((x) => x.s.w > 0);
  const nav = usePointer(shown.length, shown.map((x) => centres[x.i]));
  const a = nav.active != null ? shown[nav.active] : null;
  return (
    <>
      <div className="m2-viz-plot" ref={box}>
        <svg
          className="m2-stack"
          width={width}
          height={STACK_H}
          viewBox={`0 0 ${width} ${STACK_H}`}
          role="img"
          aria-label={label}
          tabIndex={0}
          aria-roledescription="chart"
          data-testid={testId}
          onKeyDown={nav.onKeyDown}
          onPointerMove={nav.onPointerMove}
          onPointerLeave={nav.onPointerLeave}
          onBlur={nav.onPointerLeave}
        >
          {shown.length === 0 ? <rect className="m2-stack-empty" x={0} y={0} width={width} height={STACK_H} rx={2} /> : null}
          {shown.map(({ p, s }, k) => (
            <rect key={p.key} className="m2-stack-s" data-part={p.key} data-on={a?.p.key === p.key ? "true" : undefined} x={s.x} y={0} width={s.w} height={STACK_H} rx={k === 0 || k === shown.length - 1 ? 2 : 0} style={{ fill: `var(${p.colour})` }}>
              <title>{p.title}</title>
            </rect>
          ))}
        </svg>
        <Readout text={a ? a.p.title : null} x={a ? centres[a.i] : 0} y={STACK_H + 4} align={a && a.i === 0 ? "start" : a && a.i === parts.length - 1 ? "end" : "center"} />
      </div>
      <Legend items={parts.map((p) => ({ key: p.key, label: p.label, colour: p.colour, value: format(p.value), mark: p.mark }))} />
    </>
  );
}
