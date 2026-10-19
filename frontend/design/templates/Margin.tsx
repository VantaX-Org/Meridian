"use client";

// frontend/design/templates/Margin.tsx
//
// The margin: the four sentences of a page (situation, what changed, why it matters, do next) set as
// marginalia beside the numbers, in the column the Datum reserves for them. The explanation is always in the
// same place, so the reader's eye goes left for the figure and right for the meaning.
import Link from "next/link";
import { Button } from "../primitives/Button";
import { Skeleton } from "../primitives/Skeleton";
import { AiSummary } from "../primitives/AiSummary";
import type { InsightCell, InsightHeaderProps } from "./InsightHeader";

const TONE: Record<string, string> = {
  neutral: "var(--m-ink-4)",
  go: "var(--m-go)",
  "at-risk": "var(--m-at-risk)",
  "no-go": "var(--m-no-go)",
  info: "var(--m-info)",
};

function Note({ label, cell, loading, children }: { label: string; cell: InsightCell; loading?: boolean; children?: React.ReactNode }) {
  const body = loading ? <Skeleton height={16} /> : cell.sentence;
  return (
    <div className="m-margin-note">
      <span className="m-margin-label">
        <span aria-hidden className="m-margin-dot" style={{ background: TONE[cell.tone ?? "neutral"] }} />
        {label}
      </span>
      {cell.href && !loading ? (
        <Link href={cell.href} className="m-text-body underline-offset-2 hover:underline" style={{ color: "var(--m-ink)" }}>{body}</Link>
      ) : (
        <span className="m-text-body" style={{ color: "var(--m-ink)" }}>{body}</span>
      )}
      {children}
    </div>
  );
}

export type MarginProps = Pick<InsightHeaderProps, "situation" | "changed" | "why" | "next" | "aiSummary" | "loading">;

export function Margin({ situation, changed, why, next, aiSummary, loading }: MarginProps) {
  const a = next.action;
  return (
    <aside aria-label="Insight" className="m-margin m-motion-stagger">
      {aiSummary ? (
        <AiSummary {...aiSummary} />
      ) : (
        <>
          <Note label="Situation" cell={situation} loading={loading} />
          <Note label="What changed" cell={changed} loading={loading} />
          <Note label="Why it matters" cell={why} loading={loading} />
          <Note label="Do next" cell={next} loading={loading}>
            {a && !loading && (
              <span className="mt-1 inline-flex items-center gap-2">
                {a.href ? <Button size="sm" render={<Link href={a.href}>{a.label}</Link>} /> : <Button size="sm" onClick={a.onClick}>{a.label}</Button>}
                {a.impact && <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{a.impact}</span>}
              </span>
            )}
          </Note>
        </>
      )}
    </aside>
  );
}
