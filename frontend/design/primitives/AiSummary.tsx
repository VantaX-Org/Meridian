"use client";

// frontend/design/primitives/AiSummary.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { IconButton } from "./IconButton";
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
  /** Shown to admins when the LLM is off. */
  adminHref?: string;
  onFeedback?: (vote: "up" | "down") => void;
}

export function AiSummary({ text, llmOk, fallback, findingsCount, runId, loading, adminHref, onFeedback }: AiSummaryProps) {
  const on = llmOk === true && !!text;
  return (
    <details open className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
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
          <p className="mt-1 m-text-label" style={{ color: "var(--m-ink-3)" }}>
            Generated from {findingsCount ?? 0} findings{runId ? <> in run <Mono>{runId}</Mono></> : null}. The model saw aggregates only.
            {onFeedback && (
              <span className="ml-2 inline-flex gap-1">
                <IconButton aria-label="Helpful" onClick={() => onFeedback("up")}><ThumbsUp size={14} aria-hidden /></IconButton>
                <IconButton aria-label="Not helpful" onClick={() => onFeedback("down")}><ThumbsDown size={14} aria-hidden /></IconButton>
              </span>
            )}
          </p>
        )}
        {!on && !loading && adminHref && (
          <Link href={adminHref} className="mt-1 inline-block m-text-label underline-offset-2 hover:underline" style={{ color: "var(--m-ink-3)" }}>
            Enable in Admin &gt; AI
          </Link>
        )}
      </div>
    </details>
  );
}
