// frontend/app/(app)/insights/page.tsx
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Skeleton } from "@/design";
import { getPredictiveAnalytics } from "@/lib/api/analytics";
import { getExec, getProvenCost, getReadiness, largestValueAtRisk } from "@/lib/api/insights";
import { getVersions } from "@/lib/api/versions";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { InsightFrame, formatMoney } from "./_components/InsightFrame";

interface Row {
  id: string;
  href: string;
  name: string;
  headline: string | null; // null while loading, "—" when the index holds no data for it
  description: string;
  /** Fixed 1 to 6 slot of the chart palette; the tile edge keeps its colour when the list re-sorts. */
  viz: number;
  rank: number; // no-go first
  /** Own timestamp, only for pages built from the exec payload. */
  stamped?: boolean;
}

export default function InsightsIndexPage() {
  const dayOne = useDayOne();
  const exec = useQuery({ queryKey: queryKeys.insights("exec"), queryFn: () => getExec() });
  const runs = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });

  const forecast = useQuery({ queryKey: queryKeys.analyticsPredictive(), queryFn: () => getPredictiveAnalytics() });
  const cost = useQuery({ queryKey: queryKeys.insights("proven-cost", undefined), queryFn: () => getProvenCost({}) });

  const readiness = useQuery({ queryKey: queryKeys.insights("readiness", undefined), queryFn: () => getReadiness() });

  const run = runs.data?.versions.find((v) => v.id === exec.data?.version_id) ?? runs.data?.versions[0];
  const updated = run ? relativeTime(run.run_at) : "—";
  const loading = exec.isLoading;
  const d = exec.data;

  const rows = useMemo<Row[]>(() => {
    const noGo = d?.readiness_cells.filter((c) => c.verdict === "no_go").length;
    const atRisk = d ? d.impact_rows.reduce((s, r) => s + r.value_at_risk, 0) : undefined;
    const threshold = readiness.data?.threshold;
    const below = d && typeof threshold === "number" ? d.owner_rows.filter((o) => o.score < threshold).length : undefined;
    const declining = forecast.data?.forecasts.filter((f) => f.trend === "declining" || f.trend === "critical").length;
    const r = (id: string, name: string, description: string, headline: string | null = "—", rank = 1, stamped = false): Row =>
      ({ id, href: `/insights/${id}`, name, description, headline, rank, stamped, viz: 0 });
    return [
      r("readiness", "Readiness", "Go and no-go verdict per module and wave", noGo === undefined ? null : `${noGo} ${noGo === 1 ? "readiness cell is" : "readiness cells are"} no-go`, noGo ? 0 : 1, true),
      r("impact", "Impact", "Value at risk per blocked feature", atRisk === undefined ? null : `${formatMoney(atRisk, cost.data?.currency)} at risk across features`, 1, true),
      r("owners", "Owners", "Score and open items per owner", d ? (below === undefined ? (readiness.isLoading ? null : "—") : `${below} ${below === 1 ? "owner is" : "owners are"} below threshold`) : null, 1, true),
      r("exec", "Executive summary", "Readiness, risk and owners on one page", d ? (d.narrative ? d.narrative.split(/(?<=\.)\s/)[0].replace(/\.$/, "") : "—") : null, 1, true),
      r("forecast", "Forecast", "Where each module score is heading", forecast.isLoading ? null : declining === undefined ? "—" : `${declining} ${declining === 1 ? "module is" : "modules are"} trending down`),
      r("duplicates", "Duplicates", "Clusters of likely duplicate records"),
      r("operations", "Operations", "Job health and queue depth"),
      r("lineage", "Lineage", "Which fields feed which guards"),
      r("mining", "Mining", "Relationships, patterns and anomalies"),
      r("process", "Process", "Readiness per business process"),
      r("reports", "Reports", "Downloadable reports per run"),
    ].map((x, i) => ({ ...x, viz: (i % 6) + 1 })).sort((a, b) => a.rank - b.rank);
  }, [d, cost.data?.currency, readiness.data?.threshold, readiness.isLoading, forecast.data, forecast.isLoading]);

  const noGoCells = d?.readiness_cells.filter((c) => c.verdict === "no_go").length;
  const declining = forecast.data?.forecasts.filter((f) => f.trend === "declining" || f.trend === "critical").length;
  const cut = readiness.data?.threshold;
  const below = d && typeof cut === "number" ? d.owner_rows.filter((o) => o.score < cut).length : undefined;
  const topRisk = cost.data ? largestValueAtRisk(cost.data.value_at_risk_by_l1) : null;
  const empty = !loading && !exec.isError && dayOne.status !== "loading" && !d?.version_id;

  return (
    <InsightFrame
      title="Insights"
      meta={run ? `${run.label || "Latest run"}, updated ${updated}` : undefined}
      state={exec.isError ? "error" : empty ? "empty" : undefined}
      insight={{
        hero: true,
        stats: [
          { label: "No-go cells", value: noGoCells ?? "—", tone: noGoCells === undefined ? undefined : noGoCells ? "no-go" : "go", to: "/insights/readiness" },
          { label: "Largest L1 at risk", value: topRisk ? formatMoney(topRisk.value_at_risk, cost.data?.currency ?? "") : "—", to: "/insights/impact" },
          { label: "Modules trending down", value: declining ?? "—", tone: declining === undefined ? undefined : declining ? "at-risk" : "go", to: "/insights/forecast" },
          { label: "Owners below threshold", value: below ?? "—", tone: below === undefined ? undefined : below ? "at-risk" : "go", to: "/insights/owners" },
        ],
        loading: loading || cost.isLoading || forecast.isLoading,
        situation: { sentence: noGoCells === undefined ? "Checking readiness" : `${noGoCells} ${noGoCells === 1 ? "readiness cell is" : "readiness cells are"} no-go`, tone: noGoCells ? "no-go" : "go" },
        changed: { sentence: declining === undefined ? "—" : `${declining} ${declining === 1 ? "module is" : "modules are"} trending down` },
        why: { sentence: topRisk ? `${topRisk.l1} carries the most value at risk, across ${topRisk.processes} ${topRisk.processes === 1 ? "process" : "processes"}` : "—" },
        next: noGoCells
          ? { sentence: "Clear the no-go cells first", action: { label: "Open readiness", href: "/insights/readiness" } }
          : { sentence: "Review owner scores", action: { label: "Open owners", href: "/insights/owners" } },
      }}
      emptyProps={{
        title: "No insights yet",
        detail: "Insights appear after the first analysis.",
        ghost: "table",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{ message: "Could not load insights", onRetry: () => void exec.refetch() }}
    >
      <ul className="m-motion-stagger grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="insights-index">
        {rows.map((x) => (
          <li key={x.id} className="flex">
            <Link
              href={x.href}
              className="m-card m-lift relative flex min-h-28 w-full flex-col gap-1 overflow-hidden"
              style={{ color: "var(--m-ink)", paddingLeft: 24 }}
            >
              <span aria-hidden className="absolute inset-y-0 left-0" style={{ width: 4, background: `var(--m-viz-${x.viz})` }} />
              <span className="font-medium">{x.name}</span>
              <span className="m-text-body" style={{ color: "var(--m-ink)" }}>
                {x.headline === null ? <Skeleton width={200} height={14} /> : x.headline}
              </span>
              <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>
                {x.description}
                {x.stamped && !runs.isLoading ? `, updated ${updated}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </InsightFrame>
  );
}
