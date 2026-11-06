"use client";

import type { ReactNode } from "react";
import { useLandscape } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { currentRunFor } from "@/lib/v2/fix-run";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { Dash } from "./parts";
import { RunChip } from "./RunChip";
import "./fix.css";

/**
 * Stage 4 parts. Ledger rows carry an object but rarely a run id, and every ledger is Current-only, so the run shown is
 * the one the object stands at now. No match gives a dash with the reason, never a guessed run.
 */
export function ObjectRunChip({ module, systemId }: { module: string | null | undefined; systemId?: string | null }) {
  const land = useLandscape(null);
  if (!module) return <Dash why={t("No object is stored.")} />;
  const cell = land.data?.cells.find((c) => c.module === module && (!systemId || c.system_id === systemId));
  return (
    <span className="m2-objrun">
      {moduleText(module)}
      {cell ? <Inner module={module} systemId={cell.system_id} /> : <Dash why={land.isPending ? t("Reading the current run.") : t("This object has no scored run yet.")} />}
    </span>
  );
}

function Inner({ module, systemId }: { module: string; systemId: string }) {
  const land = useLandscape(null);
  const tl = useTimeline(systemId, 50);
  const hit = currentRunFor(land.data, tl.data?.runs, module, systemId);
  const name = land.data?.systems.find((s) => s.id === systemId)?.name ?? null;
  if (!hit) return <>{" "}<Dash why={tl.isPending ? t("Reading the current run.") : t("The run is not in the recent list.")} /></>;
  return <>{" "}<RunChip run={hit.run} system={name} /></>;
}

/** What each figure on a screen means, one line each, closed until asked. */
export function Means({ items }: { items: [string, string][] }) {
  return (
    <details className="m2-means" data-testid="means">
      <summary>{t("What the figures mean")}</summary>
      <dl>
        {items.map(([term, meaning]) => (
          <div key={term}><dt><b>{term}</b></dt><dd className="m2-meta">{meaning}</dd></div>
        ))}
      </dl>
    </details>
  );
}

/** Lede plus Means, the head every Fix screen shares. */
export function FixHead({ lede, means }: { lede: ReactNode; means: [string, string][] }) {
  return <><p className="m2-lede" data-testid="lede">{lede}</p><Means items={means} /></>;
}

/** The run a row was read at when it says so (version_id), else the object's current run. */
export function RowRunChip({ module, versionId }: { module: string | null | undefined; versionId?: string | null }) {
  const tl = useTimeline(null, 50);
  const land = useLandscape(null);
  const run = versionId ? tl.data?.runs.find((r) => r.id === versionId) : undefined;
  if (!run) return <ObjectRunChip module={module} />;
  const name = land.data?.systems.find((s) => s.id === run.system_id)?.name ?? null;
  return <span className="m2-objrun">{module ? moduleText(module) : null}{" "}<RunChip run={run} system={name} /></span>;
}

/** A run named in words from its id; a dash with the reason when the id is not in the system's recent runs. */
export function RunById({ id, systemId, system }: { id: string | null | undefined; systemId: string | null | undefined; system?: string | null }) {
  const tl = useTimeline(systemId && systemId !== "upload" ? systemId : null, 50);
  const run = id ? tl.data?.runs.find((r) => r.id === id) : undefined;
  return run ? <RunChip run={run} system={system} /> : <Dash why={tl.isPending ? t("Reading the run.") : t("This run is not in the recent list.")} />;
}

export type FlowStep = { label: string; hint: string; count?: string };

/** Multi-step work: the step the user is on, and what follows. Plain words first; detail stays in the panels below. */
export function FlowSteps({ steps, current, label }: { steps: FlowStep[]; current: number; label: string }) {
  return (
    <ol className="m2-flow" aria-label={label} data-testid="flow-steps">
      {steps.map((s, i) => (
        <li key={s.label} className={i === current ? "m2-flow-on" : i < current ? "m2-flow-done" : undefined} aria-current={i === current ? "step" : undefined}>
          <span className="m2-flow-n">{i + 1}</span>
          <span className="m2-flow-t"><b>{s.label}</b>{s.count ? <span className="m2-meta"> {s.count}</span> : null}<span className="m2-meta m2-flow-h">{s.hint}</span></span>
        </li>
      ))}
    </ol>
  );
}

/** What will happen if the user takes the action beside it, said before they take it. */
export function Consequence({ children }: { children: ReactNode }) {
  return <p className="m2-meta m2-conseq" data-testid="consequence">{children}</p>;
}

/** Detail kept one click away. Content stays in the page; nothing is removed. */
export function MoreDetail({ title, children }: { title: string; children: ReactNode }) {
  return <details className="m2-more" data-testid="more-detail"><summary>{title}</summary><div className="m2-more-body">{children}</div></details>;
}
