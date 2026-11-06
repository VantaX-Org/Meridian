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
