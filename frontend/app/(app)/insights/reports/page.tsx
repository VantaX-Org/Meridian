"use client";

/** Insights > Reports: the report library. Pick a scope, pick a report, preview it, download it. */

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card, Field, Input, Pill, Select, asyncStateOf } from "@/design";
import { downloadAuthenticated } from "@/lib/api/download";
import { getAuditEntries } from "@/lib/api/audit";
import { getHeatmap, getOverview, l1Label } from "@/lib/api/insights";
import { getRecordReportUrl, getReportCatalogue, type CatalogueEntry } from "@/lib/api/reports";
import { formatDate, formatModuleName, plural, runOptionLabels } from "@/lib/format";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { usePermissions } from "@/lib/permissions";
import { lineageOf, previousInLineage } from "@/lib/runs";
import { reportFilename } from "@/lib/report-filename";
import { runName } from "@/lib/run-scope";
import { CardSkeleton, InsightFrame, formatMoney, useRunLabel } from "../_components/InsightFrame";
import { useInsightScope } from "../_components/useInsightScope";
import { PAGE_PURPOSE } from "../_components/InsightViews";

const NONE = "none";
const EXT: Record<CatalogueEntry["format"], string> = { PDF: "pdf", XLSX: "xlsx", JSON: "json" };
/** One name per report, the same on every page; a report the catalogue adds keeps its own name. */
const REPORT_NAME: Record<string, string> = {
  executive: "Executive report", board: "Board pack", trend: "Progress report", compare: "Comparison report",
  workbook: "Comparison workbook", analysis: "Run report (analysis)", full: "Narrative report",
};
const nameOf = (e: CatalogueEntry) => REPORT_NAME[e.id] ?? e.name;
/** What a report still needs before it can download, as the step the reader takes (the API's `requires` tokens). */
const REQUIRES_STEP: Record<string, string> = { module: "Choose an object", record: "Enter a record key" };
const requiresSentence = (requires: readonly string[]) =>
  requires.map((t, i) => {
    const step = REQUIRES_STEP[t] ?? `Add ${t.replace(/_/g, " ")}`;
    return i === 0 ? step : step.charAt(0).toLowerCase() + step.slice(1);
  }).join(" and ");

export default function ReportsPage() {
  const { can, has } = usePermissions();
  const { run: scopedRun, runs, versions } = useInsightScope();
  // null until the reader picks: the default is the run before this one in its lineage (previousInLineage), so a board
  // pack states what changed instead of reading as a first run.
  const [compareChoice, setCompare] = useState<string | null>(null);
  const [module, setModule] = useState(NONE);
  const [recordKey, setRecordKey] = useState("");
  const [selected, setSelected] = useState("board");
  const [building, setBuilding] = useState<string | null>(null);
  const versionId = scopedRun || "";
  const scopedLabel = useRunLabel(versionId);
  // Only runs of the same lineage (same system, or uploads of the same objects) can be compared.
  const currentRun = runs.find((r) => r.id === versionId);
  const comparableRuns = runs.filter((v) => v.id !== versionId && (!currentRun || lineageOf(v) === lineageOf(currentRun)));
  // Runs that share a label are told apart by date and time.
  const compareLabels = runOptionLabels(comparableRuns);
  const previous = currentRun ? previousInLineage(currentRun, runs) : null;
  const compare = compareChoice ?? previous?.id ?? NONE;
  const cmp = compare === NONE ? undefined : compare;
  const mod = module === NONE ? undefined : module;

  const catalogue = useQuery({
    queryKey: queryKeys.reportCatalogue(versionId, mod, cmp),
    queryFn: () => getReportCatalogue({ version_id: versionId, module: mod, compare: cmp }),
    enabled: !!versionId && can("export"),
  });
  const canSeeAudit = has("audit", "view") || has("users", "admin");
  const recent = useQuery({
    queryKey: queryKeys.reportExports(5),
    queryFn: () => getAuditEntries({ action: "report.export", limit: 5 }),
    enabled: canSeeAudit,
  });
  const overview = useQuery({ queryKey: queryKeys.insights("overview", versionId, mod), queryFn: () => getOverview({ version_id: versionId, module: mod }), enabled: !!versionId });
  const heat = useQuery({ queryKey: queryKeys.insights("heatmap", versionId), queryFn: () => getHeatmap({ version_id: versionId }), enabled: !!versionId });

  const entries = catalogue.data ?? [];
  const current = entries.find((e) => e.id === selected) ?? entries[0];
  const key = recordKey.trim();
  const urlOf = (e: CatalogueEntry): string | null => (e.id === "record" ? (key && versionId ? getRecordReportUrl(versionId, key) : null) : e.url);
  const href = current ? urlOf(current) : null;
  // The shared run label formatter: the run's name, else its date and time; never a raw id.
  const runLabel = (id: string) => { const v = runs.find((r) => r.id === id); return v?.label || (v ? formatDate(v.run_at, "datetime") : id === versionId && scopedLabel ? scopedLabel : "this run"); };

  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = entries.findIndex((x) => x.id === current?.id);
    const next = entries[Math.min(entries.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    setSelected(next.id);
    e.currentTarget.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
  };

  // A PDF renders server-side before it downloads; the button shows that while it does.
  const download = async () => {
    if (!current || !href) return;
    setBuilding(current.id);
    try {
      const run = runs.find((r) => r.id === versionId);
      await downloadAuthenticated(href, reportFilename({ name: nameOf(current), ext: EXT[current.format] }, run ? runName(run) : scopedLabel));
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBuilding(null);
    }
  };
  const o = overview.data;
  const scopeLine = [versionId ? runLabel(versionId) : "no run", cmp ? `compared with ${runLabel(cmp)}` : "no comparison run", mod ? formatModuleName(mod) : "every object in the run"].join(", ");

  return (
    <InsightFrame
      title="Reports"
      purpose={PAGE_PURPOSE["/insights/reports"]}
      scope
      meta={versionId ? `${cmp ? `compared with ${runLabel(cmp)}` : "no comparison"}, ${mod ? formatModuleName(mod) : "every object in the run"}` : undefined}
      run={versionId || undefined}
      module={mod}
      skeleton={<CardSkeleton height={300} />}
      insight={{
        situation: { sentence: `Reports are built from ${versionId ? runLabel(versionId) : "the selected run"}; ${plural(runs.length, "finished run is", "finished runs are")} available.`, tone: runs.length ? "go" : "at-risk" },
        changed: { sentence: cmp ? `Comparing with ${runLabel(cmp)}.` : comparableRuns.length ? `${plural(comparableRuns.length, "earlier run")} of the same system or upload can be compared.` : "No earlier run of the same system or upload to compare with." },
        why: { sentence: can("export") ? `${plural(entries.length, "report")} in the library.` : "Export needs the auditor or analyst role." },
        next: can("export") && href
          ? { sentence: "Download the selected report.", action: { label: building ? "Rendering" : `Download ${current ? nameOf(current) : "report"}`, onClick: () => void download() } }
          : can("export")
            ? current?.id === "record" && !key
              ? { sentence: "Enter the record key in the preview, then download." }
              : { sentence: "Choose a report from the list.", action: { label: "Open runs", href: "/runs" } }
            : { sentence: "Ask an admin for the auditor or analyst role to export.", action: { label: "Open runs", href: "/runs" } },
      }}
      controls={
        <>
          <Select label="Compare with" value={compare} onValueChange={setCompare} options={[{ value: NONE, label: "No comparison" }, ...comparableRuns.map((v) => ({ value: v.id, label: compareLabels.get(v.id) ?? formatDate(v.run_at, "datetime") }))]} />
          <Select label="Object" value={module} onValueChange={setModule} options={[{ value: NONE, label: "All objects" }, ...(heat.data?.rows ?? []).map((r) => ({ value: r.module, label: formatModuleName(r.module) }))]} />
        </>
      }
      state={asyncStateOf(versions, () => runs.length === 0, true)}
      emptyProps={{ title: "No completed run yet", detail: "Reports are rendered from a finished run.", ghost: "table", action: <Button variant="secondary" render={<Link href="/runs">Open runs</Link>} /> }}
      errorProps={{ error: versions.error, onRetry: () => void versions.refetch() }}
    >
      <>
      {!can("export") ? (
        <Card title="Reports"><p className="m-text-body m-ink-2">Downloading reports needs the auditor or analyst role. Ask an admin to add it. <Link href="/insights" className="m-ink-accent underline underline-offset-2">Back to the overview</Link></p></Card>
      ) : catalogue.isError ? (
        <Card title="Reports">
          <div className="flex items-center gap-3 m-text-body" role="alert">
            <span>The report library did not load. {apiErrorMessage(catalogue.error)}</span>
            <Button variant="secondary" onClick={() => void catalogue.refetch()}>Retry</Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 @5xl:grid-cols-12">
          <div className="@5xl:col-span-5">
            <Card title="Available reports">
              {catalogue.isLoading ? <CardSkeleton height={300} /> : entries.length === 0 ? (
                <p className="m-text-body m-ink-2">No report is available for this run yet. <Link href="/runs" className="m-ink-accent underline underline-offset-2">Open runs</Link></p>
              ) : (
                <div role="listbox" aria-label="Reports" onKeyDown={onKeys} className="flex flex-col gap-2">
                  {entries.map((e) => (
                    <button
                      key={e.id} type="button" role="option" data-id={e.id} aria-selected={e.id === current?.id}
                      tabIndex={e.id === current?.id ? 0 : -1} onClick={() => setSelected(e.id)}
                      className="m-lift flex flex-col gap-1 rounded-[var(--m-radius-control)] p-3 text-left m-ink [background:var(--m-sheet-raised)]! aria-selected:[background:var(--m-accent-soft)]! aria-selected:[color:var(--m-accent-ink)]"
                    >
                      <span className="flex items-center gap-2 font-medium">{nameOf(e)}<Pill tone="neutral">{e.format}</Pill></span>
                      <span className="m-text-meta m-ink-3">{e.about}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <div className="@5xl:col-span-7">
            <Card title={current ? `Preview: ${nameOf(current)}` : "Preview"}>
              {current && (
                <div className="flex flex-col gap-3">
                  <p className="m-text-body">{current.about}</p>
                  <p className="m-text-meta m-ink-3">{`About ${current.page_estimate} pages. Covers ${scopeLine}.`}</p>
                  {current.sections.length > 0 && (
                    <ul className="list-disc pl-5 m-text-body">{current.sections.map((s) => <li key={s}>{s}</li>)}</ul>
                  )}
                  {o && (
                    <p className="m-text-body m-ink-2">
                      {`Key figures: DQS ${o.dqs.composite ?? "not scored"}, ${plural(o.blockers.count, "blocking finding")}`}
                      {o.value_at_risk.worst_l1 ? `, largest L1 at risk ${l1Label(o.value_at_risk.worst_l1)} ${formatMoney(o.value_at_risk.worst_l1_amount, o.value_at_risk.currency)}` : ""}.
                    </p>
                  )}
                  {current.requires.length > 0 && !href && <p className="m-text-meta m-ink-3">{requiresSentence(current.requires)}</p>}
                  {current.id === "record" && (
                    <Field label="Record key">
                      <Input value={recordKey} onChange={(e) => setRecordKey(e.target.value)} placeholder="For example a material number" />
                    </Field>
                  )}
                  {current.last_built_at && <p className="m-text-meta m-ink-3">{`Last built ${formatDate(current.last_built_at, "datetime")}.`}</p>}
                  <div className="flex gap-2">
                    <Button variant="primary" disabled={!href} pending={building === current.id} onClick={() => void download()}>{building === current.id ? "Rendering" : "Download"}</Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
      {canSeeAudit && (
        <div className="mt-4">
          <Card title="Recent exports" meta="The last five reports anyone downloaded">
            {recent.isError ? (
              <div className="flex items-center gap-3 m-text-body" role="alert">
                <span>{`Recent exports did not load. ${apiErrorMessage(recent.error)}`}</span>
                <Button variant="secondary" onClick={() => void recent.refetch()}>Retry</Button>
              </div>
            ) : (recent.data?.entries ?? []).length === 0 ? (
              recent.isLoading ? <CardSkeleton height={60} /> : <p className="m-text-body m-ink-2">No report has been downloaded yet. Downloads from this page show here.</p>
            ) : (
              <ul className="flex flex-col gap-1 m-text-body">
                {recent.data?.entries.map((e) => {
                  const kind = (e.after_json as { kind?: string } | null)?.kind ?? "report";
                  return <li key={e.id}>{`${formatDate(e.created_at, "datetime")}: ${kind} by ${e.actor_email ?? "unknown"}`}</li>;
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
      </>
    </InsightFrame>
  );
}
