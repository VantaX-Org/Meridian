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
      {/* Wraps below ~600px: the title block takes the row and the actions drop under it at full width. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-[min(100%,20rem)] flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="m-text-title min-w-0 font-bold [overflow-wrap:anywhere]" style={{ color: "var(--m-ink)", letterSpacing: "var(--m-tracking-title)" }}>{title}</h2>
            {status}
          </div>
          {meta != null && <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{meta}</p>}
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div>}
      </div>
      {tabs}
    </header>
  );
}
