import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { linear, sparkGeometry } from "./scale";
import "./charts.css";

/** One panel: an object's values over the same runs. */
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

/**
 * Many trends side by side on one shared scale, so the panels compare honestly. Each panel names its object and its
 * last value; the last run is a dot; a dashed hairline marks the shared reference where it falls in the scale. The
 * first panel carries the scale's two ends.
 */
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
    <ul className="nx-multi" data-testid={testId}>
      {items.map((m, i) => {
        const g = sparkGeometry(m.values, MULTI_W, MULTI_H, domain);
        return (
          <li key={m.id} className="nx-multi-i">
            <div className="nx-multi-h">
              <span className="nx-multi-t">{m.href && link ? link(m.href, m.title) : m.title}</span>
              <span className="nx-multi-v">{m.last}</span>
            </div>
            <div className="nx-multi-pw">
              <svg className="nx-multi-p" viewBox={`0 0 ${MULTI_W} ${MULTI_H}`} width="100%" height={MULTI_H} preserveAspectRatio="none" role="img" aria-label={m.label}>
                <line className="nx-multi-base" x1={0} x2={MULTI_W} y1={MULTI_H - 0.5} y2={MULTI_H - 0.5} />
                {refY != null ? <line className="nx-multi-ref" x1={0} x2={MULTI_W} y1={refY} y2={refY} /> : null}
                {g.points.includes(" ") ? <polyline className="nx-multi-line" points={g.points} /> : null}
              </svg>
              {g.last ? <span className="nx-multi-dot" style={{ left: `${(g.last.x / MULTI_W) * 100}%`, top: g.last.y }} aria-hidden="true" /> : null}
            </div>
            {i === 0 ? (
              <span className="nx-multi-sc" aria-hidden="true">
                {t("{lo} to {hi}", { lo: domain[0], hi: domain[1] })}
                {reference ? `, ${reference.label}` : ""}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
