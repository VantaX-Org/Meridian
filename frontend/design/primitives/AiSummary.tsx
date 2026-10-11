"use client";

// frontend/design/primitives/AiSummary.tsx
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Skeleton } from "./Skeleton";
import { Mono } from "./Mono";

export interface AiSummaryProps {
  /** Model text. Ignored unless `llmOk` is true. */
  text?: string;
  /** Result of GET /health/llm. Anything but true shows the deterministic fallback. */
  llmOk: boolean | undefined;
  /** The rule-built summary shown whenever the model is off or has said nothing. */
  fallback: ReactNode;
  findingsCount?: number;
  runId?: string;
  loading?: boolean;
  /** Thumbs are shown only when a handler is passed. */
  onFeedback?: (vote: "up" | "down") => void;
}

export function AiSummary({ text, llmOk, fallback, findingsCount, runId, loading, onFeedback }: AiSummaryProps) {
  const on = llmOk === true && !!text;
  return (
    <details className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>
      <summary className="inline-flex cursor-pointer items-center gap-2" style={{ color: on ? "var(--m-ink)" : "var(--m-ink-3)" }}>
        <Sparkles size={14} aria-hidden />
        <span>{on || loading ? "AI summary from deterministic findings" : "AI summary off — showing the deterministic summary"}</span>
      </summary>
      <div className="mt-2">
        {loading ? (
          <div className="grid gap-1" aria-label="Loading summary">
            <Skeleton height={14} />
            <Skeleton width="70%" height={14} />
          </div>
        ) : (
          <p style={{ color: "var(--m-ink)" }}>{on ? text : fallback}</p>
        )}
        {on && !loading && (
          <p className="mt-1 text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
            Generated from {findingsCount ?? 0} findings{runId ? <> in run <Mono>{runId}</Mono></> : null}. The model saw aggregates only.
            {onFeedback && (
              <span className="ml-2 inline-flex gap-1">
                <button type="button" aria-label="Helpful" onClick={() => onFeedback("up")}>Helpful</button>
                <button type="button" aria-label="Not helpful" onClick={() => onFeedback("down")}>Not helpful</button>
              </span>
            )}
          </p>
        )}
      </div>
    </details>
  );
}
