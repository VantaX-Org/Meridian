import type { ReactNode } from "react";
import { linear } from "./scale";
import { sparkGeometry } from "./Sparkline";

/**
 * Many trends side by side: each object's measured score over the same runs, one small panel each, on one shared scale
 * so the panels compare honestly. Each panel names its object and its last value in ink; its line is the quiet ink with
 * the last run as a dot in the data hue; a dashed hairline marks the shared reference (the 85 cap) where it falls in
 * the scale. The first panel carries the scale's two ends; the frame's table holds every value.
 */
export interface Multiple {
  id: string;
  title: ReactNode;
  /** The panel's accessible name: what it shows, first and last value. */
  label: string;
  values: readonly (number | null)[];
  /** The last value as written: "71.8". */
  last: string;
  href?: string;
}

export const MULTI_W = 168;
export const MULTI_H = 44;

export function SmallMultiples({ items, domain, reference, link, testId }: {
  items: readonly Multiple[];
  domain: readonly [number, number];
  reference?: { value: number; label: string } | null;
  /** Wraps a panel's title in the page's link. */
  link?: (href: string, children: ReactNode) => ReactNode;
  testId?: string;
}) {
  const refY = reference && reference.value > domain[0] && reference.value < domain[1] ? linear(domain, [MULTI_H - 2, 2])(reference.value) : null;
  return (
    <ul className="m2-multi" data-testid={testId}>
      {items.map((m, i) => {
        const g = sparkGeometry(m.values, MULTI_W, MULTI_H, domain);
        return (
          <li key={m.id} className="m2-multi-i">
            <div className="m2-multi-h">
              <span className="m2-multi-t">{m.href && link ? link(m.href, m.title) : m.title}</span>
              <span className="m2-multi-v">{m.last}</span>
            </div>
            <div className="m2-multi-pw">
            <svg className="m2-multi-p" viewBox={`0 0 ${MULTI_W} ${MULTI_H}`} width="100%" height={MULTI_H} preserveAspectRatio="none" role="img" aria-label={m.label}>
              <line className="m2-gl" x1={0} x2={MULTI_W} y1={MULTI_H - 0.5} y2={MULTI_H - 0.5} />
              {refY != null ? <line className="m2-capl" x1={0} x2={MULTI_W} y1={refY} y2={refY} /> : null}
              {g.points.includes(" ") ? <polyline className="m2-spark-l" points={g.points} /> : null}
            </svg>
            {g.last ? <span className="m2-multi-dot" style={{ left: `${(g.last.x / MULTI_W) * 100}%`, top: g.last.y }} aria-hidden="true" /> : null}
            </div>
            {i === 0 ? (
              <span className="m2-multi-sc" aria-hidden="true">
                {`${domain[0]}–${domain[1]}`}
                {reference ? `, ${reference.label}` : ""}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
