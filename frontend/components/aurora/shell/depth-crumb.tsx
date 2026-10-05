/**
 * Aurora <DepthCrumb>: where you are, level by level (Portfolio, hub, tab).
 * Earlier levels are petrol links; the current level is ink. Below 720px only
 * the last two segments show (CSS).
 */

import type { ReactNode } from "react";

export interface DepthSegment {
  level: string;
  label: ReactNode;
  href?: string;
}

export interface DepthCrumbProps {
  segments: ReadonlyArray<DepthSegment>;
  renderLink?: (props: { href: string; children: ReactNode; className: string }) => ReactNode;
}

export function DepthCrumb({ segments, renderLink }: DepthCrumbProps) {
  return (
    <nav className="aurora-depth-crumb" aria-label="Depth">
      <ol>
        {segments.map((s, i) => {
          const last = i === segments.length - 1;
          return (
            <li key={s.level}>
              {!last && s.href ? (
                renderLink ? renderLink({ href: s.href, children: s.label, className: "aurora-depth-crumb__link" }) : (
                  <a href={s.href} className="aurora-depth-crumb__link">{s.label}</a>
                )
              ) : (
                <span className="aurora-depth-crumb__current" aria-current={last ? "page" : undefined}>{s.label}</span>
              )}
              {!last ? <span className="aurora-depth-crumb__sep" aria-hidden>›</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
