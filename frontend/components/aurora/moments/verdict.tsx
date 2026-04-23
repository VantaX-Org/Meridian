/**
 * Aurora signature moments — Verdict + Fix Playbook (§12 moments 01, 03).
 *
 * <VerdictCard>
 *   Product's opening sentence. A verdict-led card: eyebrow (status word),
 *   a display-sm verdict sentence, an optional supporting line, optional
 *   KPI rail, and an action row. The halo gradient — the ONE gradient
 *   allowed in Aurora per spec §5.1.7 — tints the card by semantic
 *   (success / warning / danger / neutral). Under `prefers-reduced-motion`
 *   the halo entrance is instant.
 *
 * <FixPlaybook>
 *   Multi-step remediation card for the record drawer. Steps render with
 *   a status glyph (pending / in-progress / done / blocked) and a short
 *   verb-first label. Supports inline "Run" buttons and an "Explain"
 *   affordance that streams context from the LLM in WS6 / WS7.
 */

"use client";

import type { ReactNode } from "react";
import { clsx } from "../primitives/internal";
import { Button, Stack, Text } from "../primitives";

export type VerdictSemantic = "success" | "warning" | "danger" | "neutral";

export interface VerdictCardProps {
  /** Short status word, e.g. "OPEN · 14" or "ON TRACK". */
  eyebrow?: ReactNode;
  /** The verdict sentence itself — the product's point of view. */
  verdict: ReactNode;
  /** Optional supporting line below the verdict. */
  support?: ReactNode;
  /** Semantic tint for the halo gradient. */
  semantic?: VerdictSemantic;
  /** Optional KPI rail slot (typically <KpiRail> from WS3). */
  metrics?: ReactNode;
  /** Optional action row (typically <Button> instances). */
  actions?: ReactNode;
  className?: string;
}

export function VerdictCard({
  eyebrow,
  verdict,
  support,
  semantic = "neutral",
  metrics,
  actions,
  className,
}: VerdictCardProps) {
  return (
    <section
      className={clsx("aurora-verdict", className)}
      data-semantic={semantic}
    >
      <div className="aurora-verdict__halo" aria-hidden />
      <div className="aurora-verdict__body">
        {eyebrow ? (
          <Text
            variant="text-micro"
            tone="tertiary"
            className="aurora-verdict__eyebrow"
          >
            {eyebrow}
          </Text>
        ) : null}
        <Text variant="display-sm" className="aurora-verdict__sentence">
          {verdict}
        </Text>
        {support ? (
          <Text variant="text-lead" tone="secondary">
            {support}
          </Text>
        ) : null}
        {metrics ? <div className="aurora-verdict__metrics">{metrics}</div> : null}
        {actions ? <div className="aurora-verdict__actions">{actions}</div> : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------- FixPlaybook --- */

export type FixStepStatus = "pending" | "running" | "done" | "blocked";

export interface FixStep {
  id: string;
  label: ReactNode;
  status: FixStepStatus;
  /** Optional detail rendered below the label. */
  detail?: ReactNode;
  /** Run-this-step callback. Runs in-place; host shows progress. */
  onRun?: () => void;
  /** Explain-why streams context from LLM. */
  onExplain?: () => void;
}

export interface FixPlaybookProps {
  title?: ReactNode;
  steps: ReadonlyArray<FixStep>;
  className?: string;
}

export function FixPlaybook({ title, steps, className }: FixPlaybookProps) {
  return (
    <section className={clsx("aurora-fix-playbook", className)} aria-label="Fix playbook">
      {title ? (
        <Stack direction="column" gap={1}>
          <Text variant="text-micro" tone="tertiary">
            Fix playbook
          </Text>
          <Text variant="text-lead">{title}</Text>
        </Stack>
      ) : null}
      <ol className="aurora-fix-playbook__list">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="aurora-fix-playbook__step"
            data-status={step.status}
          >
            <span className="aurora-fix-playbook__glyph" aria-hidden>
              <StepGlyph status={step.status} index={index + 1} />
            </span>
            <div className="aurora-fix-playbook__step-body">
              <Text variant="text-body">{step.label}</Text>
              {step.detail ? (
                <Text variant="text-small" tone="secondary">
                  {step.detail}
                </Text>
              ) : null}
            </div>
            <Stack direction="row" gap={2} align="center">
              {step.onExplain ? (
                <Button size="sm" variant="ghost" onClick={step.onExplain}>
                  Explain
                </Button>
              ) : null}
              {step.onRun ? (
                <Button
                  size="sm"
                  variant={step.status === "done" ? "ghost" : "primary"}
                  onClick={step.onRun}
                  disabled={
                    step.status === "running" ||
                    step.status === "done" ||
                    step.status === "blocked"
                  }
                >
                  {step.status === "done" ? "Done" : step.status === "running" ? "Running…" : "Run"}
                </Button>
              ) : null}
            </Stack>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepGlyph({
  status,
  index,
}: {
  status: FixStepStatus;
  index: number;
}) {
  if (status === "done") {
    return (
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8l3.5 3.5L13 5" />
      </svg>
    );
  }
  if (status === "running") {
    return <span className="aurora-fix-playbook__spinner" />;
  }
  if (status === "blocked") {
    return (
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    );
  }
  return <span className="aurora-fix-playbook__index">{index}</span>;
}
