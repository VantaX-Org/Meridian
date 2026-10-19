"use client";

import Link from "next/link";
import { Button } from "../primitives/Button";
import { useJobs } from "../../hooks/use-jobs";
import type { DayOneStep } from "../../hooks/use-day-one";
import { IconCheck, IconGauge, IconGear, IconImport, IconServer, type Icon } from "../icons";

interface Station {
  label: string;
  done: boolean;
  icon: Icon;
}

/**
 * The day-one ladder: four stations on one rail (System connected, Configuration loaded, Data extracted,
 * First score). Done stations are filled, the current one is ringed in the accent, and the step under the
 * rail says what to do now and offers the one button that does it.
 */
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

  const stations: Station[] = [
    { label: "System connected", done: systemsConnected, icon: IconServer },
    { label: "Configuration loaded", done: configLoaded, icon: IconGear },
    { label: "Data extracted", done: extracted, icon: IconImport },
    { label: "First score", done: complete, icon: IconGauge },
  ];
  const currentIndex = stations.findIndex((s) => !s.done);

  return (
    <div className="flex flex-col">
      <ol className="m-journey">
        {stations.map((s, i) => {
          const state = s.done ? "done" : i === currentIndex ? "current" : "todo";
          const Glyph = s.icon;
          return (
            <li key={s.label} className="m-journey-station" data-state={state} data-link={i > 0 && stations[i - 1].done ? "done" : undefined}>
              <span aria-hidden className={`m-journey-dot${state === "current" ? " m-motion-rise" : ""}`}>
                {s.done ? <IconCheck size={18} strokeWidth={2} /> : <Glyph size={18} />}
              </span>
              <span className="m-journey-label">
                {s.label}
                <span className="sr-only">{s.done ? ", done" : state === "current" ? ", current step" : ", to do"}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {step && (
        <div data-testid="day-one-step" className="m-journey-step">
          <p className="m-text-h font-semibold" style={{ color: "var(--m-ink)" }}>{step.label}</p>
          <p className="m-text-body" style={{ color: "var(--m-ink-2)", maxWidth: "56ch" }}>{step.detail}</p>
          {step.key === "running" && runningJob ? (
            <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
              {runningJob.label}: {runningJob.status}, {runningJob.percent}%
            </p>
          ) : !step.actionable || !step.href ? null : (
            <Button render={<Link href={step.href}>{step.label}</Link>} className="self-start" />
          )}
        </div>
      )}
    </div>
  );
}
