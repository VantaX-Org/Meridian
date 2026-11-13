"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";

export type FeedTone = "neutral" | "good" | "warn" | "bad" | "aletheia";
export interface FeedAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

/**
 * One item in a feed: what it is, why it is here (one sentence), the numbers, and what you can do. With `href` the
 * whole card is the link (a stretched anchor on the title), so the actions stay separate controls.
 */
export function FeedCard({ glyph, title, reason, meta = [], tone = "neutral", actions = [], href, children, className, ...rest }: {
  glyph?: ReactNode;
  title: string;
  reason: string;
  meta?: Array<{ label: string; value: string }>;
  tone?: FeedTone;
  actions?: FeedAction[];
  href?: string;
  children?: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <article className={cx("nx-feed", href && "nx-feed-link", className)} data-tone={tone} {...rest}>
      {glyph ? <span className="nx-feed-glyph" aria-hidden="true">{glyph}</span> : null}
      <div className="nx-feed-main">
        <h3 className="nx-feed-title">{href ? <a href={href} className="nx-feed-a">{title}</a> : title}</h3>
        <p className="nx-feed-reason">{reason}</p>
        {meta.length ? (
          <dl className="nx-feed-meta">
            {meta.map((m) => (
              <div key={m.label}><dt>{m.label}</dt><dd className="nx-num">{m.value}</dd></div>
            ))}
          </dl>
        ) : null}
        {children ? <div className="nx-feed-body">{children}</div> : null}
        {actions.length ? (
          <div className="nx-feed-actions">
            {actions.map((a) => (
              <Button key={a.label} size={32} variant={a.primary ? "primary" : "quiet"} onClick={a.onClick}>{a.label}</Button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
