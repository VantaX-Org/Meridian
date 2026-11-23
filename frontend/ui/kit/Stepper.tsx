import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";

export type StepState = "done" | "current" | "todo" | "blocked" | "error";
export interface Step {
  id: string;
  label: string;
  state?: StepState; // default derives from `current`
  hint?: string; // one line under the label
  href?: string; // honoured on done and current steps only
  optional?: boolean;
}

const WORD: Record<StepState, () => string> = {
  done: () => t("Completed"), current: () => t("Current step"), todo: () => t("Not started"), blocked: () => t("Blocked"), error: () => t("Failed"),
};
const MARK: Partial<Record<StepState, string>> = { done: "✓", blocked: "\u{1F512}︎", error: "!" };

/** The state of step `i`: its own, else derived from `current`. */
const stateOf = (s: Step, i: number, current: number): StepState => s.state ?? (i < current ? "done" : i === current ? "current" : "todo");

/**
 * A process stepper. Each state has its own marker and a visually hidden word, never colour alone.
 * Under 48rem it folds to one "Step n of m" line inside a native <details> that lists every step.
 */
export function Stepper({ steps, current, label, size = "header", onStep, mobileLabel }: {
  steps: Step[]; current: number; label: string; size?: "header" | "compact";
  onStep?: (id: string) => void;
  mobileLabel?: (n: number, total: number, label: string) => string;
}) {
  const states = steps.map((s, i) => stateOf(s, i, current));
  const at = Math.min(Math.max(states.findIndex((s) => s === "current" || s === "blocked" || s === "error"), 0), Math.max(steps.length - 1, 0));
  const cur = steps[at];
  const line = (mobileLabel ?? ((n: number, total: number, l: string) => t("Step {n} of {total}: {name}", { n, total, name: l })))(at + 1, steps.length, cur?.label ?? "");
  const item = (s: Step, i: number, hints: boolean): ReactNode => {
    const st = states[i];
    const live = (st === "done" || st === "current") && (s.href || onStep);
    const text = <>{s.label}{s.optional ? <span className="mx-step-opt">{t("Optional")}</span> : null}</>;
    return (
      <li key={s.id} data-state={st} aria-current={st === "current" ? "step" : undefined}>
        <span className="mx-step-n" aria-hidden="true">{MARK[st] ?? i + 1}</span>
        <span className="mx-step-body">
          <span className="mx-step-label">
            {live ? (s.href ? <a href={s.href} onClick={onStep ? (e) => { e.preventDefault(); onStep(s.id); } : undefined}>{text}</a> : <button type="button" onClick={() => onStep?.(s.id)}>{text}</button>) : text}
            <span className="mx-sr">{`, ${WORD[st]()}`}</span>
          </span>
          {hints && s.hint ? <span className="mx-step-hint" data-keep={st === "current" || st === "blocked" || st === "error"}>{s.hint}</span> : null}
        </span>
      </li>
    );
  };
  return (
    <div className="mx-stepper-wrap" data-size={size}>
      <ol className="mx-stepper" aria-label={label}>{steps.map((s, i) => item(s, i, true))}</ol>
      <details className="mx-stepper-fold">
        <summary>
          <span className="mx-stepper-bar" aria-hidden="true">{states.map((st, i) => <i key={steps[i].id} data-state={st} />)}</span>
          <span>{line}</span>
          {cur?.hint ? <span className="mx-muted">{cur.hint}</span> : null}
        </summary>
        <ol className="mx-stepper mx-stepper-list" aria-label={label}>{steps.map((s, i) => item(s, i, true))}</ol>
      </details>
    </div>
  );
}
