"use client";

import type { ReactNode } from "react";
import { usePageTitleShown } from "../shell/page-title-store";
export interface PageHeaderProps {
  /** Rendered as an h2: the shell Breadcrumb owns the page's single h1 (it is present in every loading, error and drill state). */
  title: string;
  /** One line under the title: counts, run, timestamp. */
  meta?: ReactNode;
  /** Optional `<Pill>` beside the title. */
  status?: ReactNode;
  /** Right-aligned buttons. */
  actions?: ReactNode;
  /** Tab strip under the header. */
  tabs?: ReactNode;
}

export function PageHeader({ title, meta, status, actions, tabs }: PageHeaderProps) {
  usePageTitleShown();
  return (
    <header className="flex flex-col gap-3" style={{ borderBottom: "1px solid var(--m-line)", paddingBottom: tabs ? 0 : "var(--m-space-3)" }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-3">
            <h2 className="m-text-title font-semibold" style={{ color: "var(--m-ink)", letterSpacing: "var(--m-tracking-title)" }}>{title}</h2>
            {status}
          </div>
          {meta != null && <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{meta}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {tabs}
    </header>
  );
}
