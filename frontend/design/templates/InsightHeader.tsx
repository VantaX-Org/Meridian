"use client";

// frontend/design/templates/InsightHeader.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "../primitives/Button";
import { Skeleton } from "../primitives/Skeleton";
import { AiSummary, type AiSummaryProps } from "../primitives/AiSummary";
import type { PillTone } from "../primitives/Pill";

export interface InsightCell {
  sentence: ReactNode;
  href?: string;
  tone?: PillTone;
}

export interface InsightHeaderProps {
  situation: InsightCell;
  changed: InsightCell;
  why: InsightCell;
  next: InsightCell & { action?: { label: string; href?: string; onClick?: () => void; impact?: string } };
  aiSummary?: AiSummaryProps;
  loading?: boolean;
}

const TONE: Record<PillTone, string> = {
  neutral: "var(--m-ink-3)",
  go: "var(--m-go)",
  "at-risk": "var(--m-medium)",
  "no-go": "var(--m-no-go)",
  info: "var(--m-info)",
};

function Cell({ label, cell, loading, children }: { label: string; cell: InsightCell; loading?: boolean; children?: ReactNode }) {
  const body = loading ? <Skeleton height={16} /> : cell.sentence;
  return (
    <div className="grid content-start gap-1 p-3" style={{ borderTop: `2px solid ${TONE[cell.tone ?? "neutral"]}` }}>
      <span className="text-[11px] leading-[14px] font-medium" style={{ color: "var(--m-ink-3)" }}>{label}</span>
      {cell.href && !loading ? (
        <Link href={cell.href} className="text-[13px] leading-[18px] underline-offset-2 hover:underline" style={{ color: "var(--m-ink)" }}>{body}</Link>
      ) : (
        <span className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>{body}</span>
      )}
      {children}
    </div>
  );
}

export function InsightHeader({ situation, changed, why, next, aiSummary, loading }: InsightHeaderProps) {
  const a = next.action;
  return (
    <section aria-label="Insight" className="m-motion-rise rounded" style={{ background: "var(--m-sheet)", boxShadow: "var(--m-elev-1)", borderRadius: "var(--m-radius-sheet)" }}>
      <div className="grid gap-px md:grid-cols-4">
        <Cell label="Situation" cell={situation} loading={loading} />
        <Cell label="What changed" cell={changed} loading={loading} />
        <Cell label="Why it matters" cell={why} loading={loading} />
        <Cell label="Do next" cell={next} loading={loading}>
          {a && !loading && (
            <span className="mt-1 inline-flex items-center gap-2">
              {a.href ? (
                <Button render={<Link href={a.href}>{a.label}</Link>} />
              ) : (
                <Button onClick={a.onClick}>{a.label}</Button>
              )}
              {a.impact && <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{a.impact}</span>}
            </span>
          )}
        </Cell>
      </div>
      {aiSummary && <div className="px-3 pb-3"><AiSummary {...aiSummary} /></div>}
    </section>
  );
}
