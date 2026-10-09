"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "../primitives/Button";
import { useJobs } from "../../hooks/use-jobs";
import type { DayOneStep } from "../../hooks/use-day-one";

interface Step {
  label: string;
  done: boolean;
}

/** The day-one onboarding ladder (spec 9.2): System connected → Configuration loaded → Extraction run → Analysis complete. */
export function JourneyStepper({
  systemsConnected,
  configLoaded,
  extracted,
  complete,
  step,
}: {
  systemsConnected: boolean;
  configLoaded: boolean;
  extracted: boolean;
  complete: boolean;
  step: DayOneStep | null;
}) {
  const { active } = useJobs();
  const runningJob = active[0];

  const steps: Step[] = [
    { label: "System connected", done: systemsConnected },
    { label: "Configuration loaded", done: configLoaded },
    { label: "Extraction run", done: extracted },
    { label: "Analysis complete", done: complete },
  ];
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 480 }}>
      <ol className="flex items-start">
        {steps.map((s, i) => {
          const isCurrent = i === currentIndex;
          const isDone = s.done;
          return (
            <li key={s.label} className="flex flex-1 flex-col items-center gap-2 text-center">
              <div className="flex w-full items-center">
                {i > 0 && (
                  <span
                    className="flex-1"
                    style={{ height: 2, background: steps[i - 1].done ? "var(--m-pass)" : "var(--m-line)" }}
                  />
                )}
                {i === 0 && <span className="flex-1" />}
              </div>
              <span
                aria-hidden
                className={isCurrent ? "m-motion-rise" : undefined}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  background: isDone ? "var(--m-pass)" : isCurrent ? "var(--m-accent-soft)" : "transparent",
                  border: isDone ? "none" : `1px solid ${isCurrent ? "var(--m-accent)" : "var(--m-line)"}`,
                  color: isDone ? "var(--m-sheet)" : isCurrent ? "var(--m-accent)" : "var(--m-ink-3)",
                }}
              >
                {isDone ? <Check size={14} /> : i + 1}
              </span>
              <span className="text-[12px] leading-[16px]" style={{ color: isCurrent ? "var(--m-ink)" : "var(--m-ink-3)" }}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {step && (
        <div className="flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--m-line)" }}>
          <p className="text-[13px] leading-[18px] font-medium" style={{ color: "var(--m-ink)" }}>{step.label}</p>
          <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-3)" }}>{step.detail}</p>
          {step.key === "running" && runningJob ? (
            <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>
              {runningJob.label} — {runningJob.status} ({runningJob.percent}%)
            </p>
          ) : (
            <Button render={<Link href={step.href}>{step.label}</Link>} className="self-start" />
          )}
        </div>
      )}
    </div>
  );
}
