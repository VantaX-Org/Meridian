/**
 * The process owner home's four sentences: the verdict over every scored process, and the worst no-go process as the
 * next step (process-discovery spec §7.2). Pure, so the verdict and its link are testable without the page.
 */
import type { InsightHeaderProps } from "@/design";
import { readinessHref, type L1Readiness } from "@/components/process/shared";
import type { CatalogueRow } from "@/lib/api/process-discovery";
import { plural } from "@/lib/format";
import { runScopeLabel } from "@/lib/run-scope";
import type { Version } from "@/types/api";
import { l1Href } from "../../process/_components/shared";

export type ProcessHomeRow = CatalogueRow & { readiness: L1Readiness | undefined };

/** The no-go process failing the most records, the one to fix first. */
export function worstNoGo(rows: readonly ProcessHomeRow[]): ProcessHomeRow | undefined {
  return rows
    .filter((r) => r.readiness?.verdict === "no-go")
    .sort((a, b) => (b.readiness?.failing ?? 0) - (a.readiness?.failing ?? 0))[0];
}

/** Where a process's readiness opens: its Can it run page over the object and run that scored it, else its as-is flow. */
export function processHref(r: ProcessHomeRow, systemId: string, versionId: string | undefined): string {
  return (r.readiness && readinessHref({ l1: r.l1, object: r.readiness.module, run: versionId })) ?? l1Href(r.l1, systemId, r.last_run?.id);
}

export function processHomeInsight(rows: readonly ProcessHomeRow[], system: { id: string; name: string }, latest: Version | undefined): InsightHeaderProps {
  const scored = rows.filter((r) => r.readiness);
  const noGo = scored.filter((r) => r.readiness?.verdict === "no-go");
  const atRisk = scored.filter((r) => r.readiness?.verdict === "at-risk");
  const worst = worstNoGo(rows);
  const blocking = worst?.readiness?.worst;
  if (!latest || scored.length === 0) {
    return {
      situation: { sentence: `No finished analysis of ${system.name} scores its processes yet` },
      changed: { sentence: "Nothing to compare until a run is analysed" },
      why: { sentence: "Readiness comes from the data quality of the objects each process uses" },
      next: { sentence: `Analyse a run of ${system.name} to score each process`, action: { label: "Open system", href: `/systems/${encodeURIComponent(system.id)}` } },
    };
  }
  // Counted over every process, so "1 of 1" never sits over a table of thirteen; the unscored rest is named.
  const unscored = rows.length - scored.length;
  const rest = unscored > 0 ? `; ${unscored} not scored yet` : "";
  return {
    situation: {
      sentence: noGo.length
        ? `${noGo.length} of ${plural(rows.length, "process", "processes")} cannot run on ${system.name}${rest}`
        : atRisk.length
          ? `${atRisk.length} of ${plural(rows.length, "process", "processes")} at risk on ${system.name}, none no-go${rest}`
          : `Every scored process can run on ${system.name}${rest}`,
      tone: noGo.length ? "no-go" : atRisk.length ? "at-risk" : "go",
    },
    changed: { sentence: `Scored from ${runScopeLabel(latest)}` },
    why: worst && blocking
      // The field's own failing records, not the process's rule failures over every blocking field.
      ? { sentence: `${worst.name}: ${blocking.description || blocking.field} fails ${plural(blocking.affected_count, "record")}`, tone: "no-go" }
      : { sentence: noGo.length ? "Required fields fail on the objects these processes use" : "No required field blocks a scored process" },
    next: worst
      ? { sentence: `Clear what blocks ${worst.name} first`, action: { label: `Open ${worst.name}`, href: processHref(worst, system.id, latest.id) } }
      : { sentence: "Nothing is no-go; read the processes ranked by fitness", action: { label: "Open processes", href: `/process?system=${encodeURIComponent(system.id)}` } },
  };
}

/** One row per process for the readiness export. */
export function readinessExportRows(rows: readonly ProcessHomeRow[]): Record<string, string | number>[] {
  return rows.map((r) => ({
    process: r.name,
    l1: r.l1,
    verdict: r.readiness?.verdict ?? "",
    blocking_rule: r.readiness?.worst?.check_id ?? r.readiness?.worst?.field ?? "",
    rule_failures: r.readiness?.failing ?? "",
    coverage: r.coverage,
    fitness: r.last_run?.fitness ?? "",
  }));
}
