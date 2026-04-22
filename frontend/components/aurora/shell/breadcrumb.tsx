/**
 * Aurora <Breadcrumb> — WS4.
 *
 * Top-bar breadcrumb rendered as a list of segments separated by a small
 * chevron. Final segment is visually prominent (primary ink); earlier
 * segments are secondary and clickable. Consumers pass any `renderLink` to
 * integrate with Next.js / React Router routing.
 *
 * The component is purely presentational — it does not read any URL on
 * its own. Callers compute the segments from their route tree.
 */

import type { ReactNode } from "react";
import { clsx } from "../primitives/internal";

export interface BreadcrumbItem {
  /** Visible label. */
  label: ReactNode;
  /** If provided, renders as a link. Last item should omit href. */
  href?: string;
}

export interface BreadcrumbProps {
  items: ReadonlyArray<BreadcrumbItem>;
  renderLink?: (props: {
    href: string;
    children: ReactNode;
    className: string;
  }) => ReactNode;
  className?: string;
}

export function Breadcrumb({ items, renderLink, className }: BreadcrumbProps) {
  return (
    <nav className={clsx("aurora-breadcrumb", className)} aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const content = item.label;
          return (
            <li key={index} data-last={isLast ? "true" : undefined}>
              {!isLast && item.href ? (
                renderLink ? (
                  renderLink({
                    href: item.href,
                    children: content,
                    className: "aurora-breadcrumb__link",
                  })
                ) : (
                  <a href={item.href} className="aurora-breadcrumb__link">
                    {content}
                  </a>
                )
              ) : (
                <span
                  className="aurora-breadcrumb__current"
                  aria-current={isLast ? "page" : undefined}
                >
                  {content}
                </span>
              )}
              {!isLast ? (
                <svg
                  className="aurora-breadcrumb__sep"
                  viewBox="0 0 16 16"
                  width="10"
                  height="10"
                  aria-hidden
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 3l5 5-5 5" />
                </svg>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
