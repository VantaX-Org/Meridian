"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SmallMultiples, scoreDomain } from "@/design/v2/charts";
import { shortDate } from "@/design/v2/RunTimeline";
import { useRunsPage, type RunStatusFilter } from "@/lib/api/next/runs";
import type { VersionHead } from "@/lib/api/v2/runs";
import { formatInt } from "@/lib/format";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { runLabel, runStatusWord } from "@/lib/v2/run-label";
import { Button, Chip, DataTable, EmptyState, LargeTitle, SegmentedControl, type Column } from "../kit";
import { useSheets } from "../shell/SheetHost";
import { MAX_COMPARE_RUNS } from "./CompareSheet";
import { isForbidden } from "./draft";
import "./runs.css";

const PAGE = 25;
const STATUSES = ["all", "active", "complete", "failed"] as const;
type StatusUi = (typeof STATUSES)[number];
const STATUS_WORD: Record<StatusUi, () => string> = { all: () => t("All"), active: () => t("Running"), complete: () => t("Finished"), failed: () => t("Failed") };
const TONE = { running: "warn", failed: "bad" } as const;

/** The best single number for a run: the mean of its scored objects, null when none is scored. */
export function runScore(h: VersionHead): number | null {
  const v = Object.values(h.dqs_summary ?? {}).map((o) => o.composite_score).filter((n): n is number => typeof n === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function Runs() {
  const router = useRouter();
  const sheets = useSheets();
  const { can } = useV2Session();
  const landscape = useLandscape(null).data;
  const [system, setSystem] = useUrlParam<string>("system", "");
  const [module, setModule] = useUrlParam<string>("object", "");
  const [status, setStatus] = useUrlParam<StatusUi>("status", "all", STATUSES);
  const [offset, setOffset] = useState(0);
  const [gen, setGen] = useState(0);
  const filters = { system_id: system || null, module: module || null, status: status === "all" ? null : (status as RunStatusFilter) };
  const q = useRunsPage({ ...filters, limit: PAGE, offset });
  const timeline = useTimeline(system || null, 12, module || undefined);
  const rows = q.data?.versions ?? [];
  const total = q.data?.total;
  const reset = <T,>(set: (v: T) => void) => (v: T) => { setOffset(0); setGen((g) => g + 1); set(v); };

  const trend = useMemo(() => {
    const runs = [...(timeline.data?.runs ?? [])].reverse();
    const mods = [...new Set(runs.flatMap((r) => Object.keys(r.objects)))].sort();
    const items = mods.map((m) => {
      const values = runs.map((r) => r.objects[m]?.score ?? null);
      const last = [...values].reverse().find((v): v is number => v != null);
      return { id: m, title: moduleText(m), label: t("{object} score over the last runs", { object: moduleText(m) }), values, last: last == null ? t("Not scored") : last.toFixed(1) };
    });
    return { items, domain: scoreDomain(items.flatMap((i) => i.values.filter((v): v is number => v != null))) };
  }, [timeline.data]);

  const columns: Column<VersionHead>[] = [
    { id: "run", label: t("Run"), cell: (r) => <Link className="nx-rn-link nx-rn-trunc" href={`/next/run/${r.id}`} title={runLabel(r.system_name, r.run_number)} onClick={(e) => e.stopPropagation()}>{runLabel(r.system_name, r.run_number)}</Link> },
    { id: "when", label: t("Started"), cell: (r) => shortDate(r.run_at) },
    { id: "status", label: t("Status"), cell: (r) => <Chip tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>{runStatusWord(r.status)}</Chip> },
    { id: "objects", label: t("Objects"), align: "end", cell: (r) => formatInt(Object.keys(r.dqs_summary ?? r.metadata?.module_rows ?? {}).length) },
    { id: "score", label: t("Score"), align: "end", cell: (r) => { const s = runScore(r); return s == null ? <span className="nx-rn-sub">{t("Not scored")}</span> : s.toFixed(1); } },
  ];

  const systems = landscape?.systems ?? [];
  const objects = landscape?.objects ?? [];
  const forbidden = q.isError && isForbidden(q.error);
  const anyFilter = Boolean(system || module || status !== "all");

  return (
    <main className="nx-rn-page" data-testid="runs-page">
      <LargeTitle
        title={t("Runs")}
        subtitle={total != null ? `${formatInt(total)} ${t("{n, plural, one {run} other {runs}}", { n: total })}` : undefined}
        primary={{ label: t("Start a run"), onClick: () => sheets.open({ kind: "run", id: "new" }), disabled: !can("analyse"), reason: can("analyse") ? undefined : t("Your role cannot start a run.") }}
      />
      <div className="nx-rn-filters" role="group" aria-label={t("Filter runs")}>
        <label>{t("System")}
          <select value={system} onChange={(e) => reset(setSystem)(e.target.value)}>
            <option value="">{t("All systems")}</option>
            {systems.map((s) => <option key={s.id} value={s.id} title={s.name}>{s.name}</option>)}
          </select>
        </label>
        <label>{t("Object")}
          <select value={module} onChange={(e) => reset(setModule)(e.target.value)}>
            <option value="">{t("All objects")}</option>
            {objects.map((o) => <option key={o.module} value={o.module}>{moduleText(o.module) || o.label}</option>)}
          </select>
        </label>
        <SegmentedControl label={t("Status")} value={status} onChange={reset(setStatus)} items={STATUSES.map((s) => ({ value: s, label: STATUS_WORD[s]() }))} />
        {anyFilter ? <Button variant="quiet" size={32} onClick={() => { reset(setSystem)(""); reset(setModule)(""); reset(setStatus)("all"); }}>{t("Clear filters")}</Button> : null}
      </div>

      {trend.items.length ? (
        <section className="nx-rn-trend" aria-label={t("Score of each object over the last runs")}>
          <SmallMultiples items={trend.items} domain={trend.domain} testId="runs-trend" />
        </section>
      ) : null}

      {forbidden ? (
        <EmptyState icon="alert" heading={t("You cannot see runs")}>{t("Ask an administrator for access to this system's runs.")}</EmptyState>
      ) : (
        <DataTable<VersionHead>
          key={`${system}-${module}-${status}-${offset}-${gen}`}
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowLabel={(r) => runLabel(r.system_name, r.run_number)}
          caption={t("Runs, newest first")}
          total={total}
          selectable
          bulkActions={(keys) => (
            <>
              <Button variant="primary" size={32} disabled={keys.length < 2} reason={keys.length < 2 ? t("Tick two or more runs to compare.") : undefined} onClick={() => sheets.open({ kind: "compare", id: keys.slice(0, MAX_COMPARE_RUNS).join(",") })}>
                {t("Compare ({n})", { n: keys.length })}
              </Button>
              {keys.length > MAX_COMPARE_RUNS ? <span role="status" className="nx-rn-sub">{t("Only the first {n} are compared.", { n: MAX_COMPARE_RUNS })}</span> : null}
              {keys.length === 2 ? <Link className="nx-rn-link" href={`/next/run/${keys[0]}/vs/${keys[1]}`}>{t("Open as a page")}</Link> : null}
            </>
          )}
          onOpenRow={(r) => router.push(`/next/run/${r.id}`)}
          loading={q.isLoading}
          error={q.isError ? { sentence: t("The runs could not be loaded."), onRetry: () => void q.refetch() } : undefined}
          empty={anyFilter
            ? { heading: t("No run matches"), text: t("Change or clear the filters to see more runs.") }
            : { heading: t("No run yet"), text: t("A run reads an object from a system and scores it."), action: can("analyse") ? <Button variant="primary" onClick={() => sheets.open({ kind: "run", id: "new" })}>{t("Start a run")}</Button> : undefined }}
        />
      )}

      {!forbidden && total != null && total > 0 ? (
        <nav className="nx-rn-pager" aria-label={t("Pages of runs")}>
          <span aria-live="polite">{t("Showing {a} to {b} of {n}", { a: formatInt(offset + 1), b: formatInt(Math.min(offset + PAGE, total)), n: formatInt(total) })}</span>
          <Button variant="secondary" size={32} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("Newer")}</Button>
          <Button variant="secondary" size={32} disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>{t("Older")}</Button>
        </nav>
      ) : null}
    </main>
  );
}
