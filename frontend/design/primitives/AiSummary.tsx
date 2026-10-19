"use client";

// frontend/design/primitives/AiSummary.tsx
import type { ReactNode } from "react";
import { IconList } from "../icons";
import { Button } from "./Button";
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
  /** Feedback buttons are shown only when a handler is passed. */
  onFeedback?: (vote: "up" | "down") => void;
}

/** A summary paragraph, labelled by its source. Model text reads like every other sentence on the page: no sparkle, no badge. */
export function AiSummary({ text, llmOk, fallback, findingsCount, runId, loading, onFeedback }: AiSummaryProps) {
  const on = llmOk === true && !!text;
  return (
    <details open className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
      <summary className="inline-flex cursor-pointer items-center gap-2" style={{ color: on ? "var(--m-ink)" : "var(--m-ink-3)" }}>
        <IconList size={14} />
        <span>{on || loading ? "Summary, written by the model from the findings" : "Summary from the findings (the model is off)"}</span>
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
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 m-text-label" style={{ color: "var(--m-ink-3)" }}>
            <span>
              Written from {findingsCount ?? 0} findings{runId ? <> in run <Mono>{runId}</Mono></> : null}. The model saw aggregates only.
            </span>
            {onFeedback && (
              <span className="inline-flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => onFeedback("up")}>Helpful</Button>
                <Button variant="ghost" size="sm" onClick={() => onFeedback("down")}>Not helpful</Button>
              </span>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
