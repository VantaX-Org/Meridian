"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Icon, type IconName } from "../Icon";
import { cx } from "./cx";

export type StepState = "done" | "current" | "future" | "running" | "failed";

export interface StepItem {
  id: string;
  label: string;
  state: StepState;
  /** The status line under the label ("Pulled 9 Nov, 184,220 records"). */
  detail?: ReactNode;
}

const ICON: Record<StepState, IconName> = { done: "check", current: "play", future: "circle-dashed", running: "loader", failed: "x" };
const WORD: Record<StepState, () => string> = {
  done: () => t("Done"),
  current: () => t("Current step"),
  future: () => t("Not started"),
  running: () => t("Running"),
  failed: () => t("Failed"),
};

/**
 * Five steps, horizontal or vertical. Each step carries its state as an icon and a word (read aloud, shown on the
 * running and failed ones), the current one as aria-current="step". Arrow keys move between steps, Enter or Space opens one.
 */
export function Stepper({ steps, orientation = "horizontal", label, onSelect, selectedId }: {
  steps: StepItem[];
  orientation?: "horizontal" | "vertical";
  label: string;
  onSelect?: (id: string) => void;
  /** The step whose sheet is open, when it is not the current one. */
  selectedId?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? steps.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[Math.max(0, Math.min(steps.length - 1, next))]?.focus();
  };
  return (
    <ol className={cx("nx-stepper", orientation === "vertical" && "nx-stepper-v")} aria-label={label}>
      {steps.map((s, i) => {
        const body = (
          <>
            <span className={cx("nx-step-dot", `nx-step-${s.state}`)}>
              <span className={s.state === "done" ? "nx-tick" : s.state === "running" ? "nx-spinner" : undefined}>
                <Icon name={ICON[s.state]} />
              </span>
            </span>
            <span className="nx-step-text">
              <span className="nx-step-label">
                {i + 1}. {s.label}
              </span>
              <span className={cx(s.state !== "running" && s.state !== "failed" && "nx-sr", "nx-step-word")}>{WORD[s.state]()}</span>
              {s.detail ? <span className="nx-step-detail">{s.detail}</span> : null}
            </span>
          </>
        );
        return (
          <li key={s.id} className="nx-step" data-state={s.state}>
            {onSelect ? (
              <button
                type="button"
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className="nx-step-btn"
                aria-current={s.state === "current" ? "step" : undefined}
                data-open={selectedId === s.id || undefined}
                onClick={() => onSelect(s.id)}
                onKeyDown={(e) => onKey(e, i)}
              >
                {body}
              </button>
            ) : (
              <div className="nx-step-btn" aria-current={s.state === "current" ? "step" : undefined}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
