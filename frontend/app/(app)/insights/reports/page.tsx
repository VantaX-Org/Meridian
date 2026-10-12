"use client";

/** Insights > Reports: the report library. Pick a scope, pick a report, preview it, download it. */

import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card, Field, Input, Pill, Select } from "@/design";
import { downloadAuthenticated } from "@/lib/api/download";
import { getAuditEntries } from "@/lib/api/audit";
import { getHeatmap, getOverview, l1Label } from "@/lib/api/insights";
import { getRecordReportUrl, getReportCatalogue, type CatalogueEntry } from "@/lib/api/reports";
import { formatDate, formatModuleName } from "@/lib/format";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { usePermissions } from "@/lib/permissions";
import { CardSkeleton, InsightFrame, formatMoney } from "../_components/InsightFrame";
import { useInsightScope } from "../_components/useInsightScope";

const NONE = "none";
const EXT: Record<CatalogueEntry["format"], string> = { PDF: "pdf", XLSX: "xlsx", JSON: "json" };

export default function ReportsPage() {
  const { can, has } = usePermissions();
  const { run: scopedRun, runs, versions } = useInsightScope();
  const [picked, setPicked] = useState("");
  const [compare, setCompare] = useState(NONE);
  const [module, setModule] = useState(NONE);
  const [recordKey, setRecordKey] = useState("");
  const [selected, setSelected] = useState("board");
  const versionId = picked || scopedRun || "";
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
  const runLabel = (id: string) => { const v = runs.find((r) => r.id === id); return v?.label || (v ? formatDate(v.run_at, "datetime") : id); };

  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = entries.findIndex((x) => x.id === current?.id);
    const next = entries[Math.min(entries.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    setSelected(next.id);
    e.currentTarget.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
  };

  const download = () => { if (current && href) void downloadAuthenticated(href, `${current.id}_${versionId}.${EXT[current.format]}`); };
  const copy = async () => {
    if (!href) return;
    try { await navigator.clipboard.writeText(new URL(href, window.location.origin).toString()); toast.success("Link copied"); } catch { toast.error("Could not copy the link"); }
  };

  const o = overview.data;
  const scopeLine = [runLabel(versionId), cmp ? `compared with ${runLabel(cmp)}` : "no comparison run", mod ? formatModuleName(mod) : "all objects"].join(", ");

  return (
    <InsightFrame
      title="Reports"
      meta={versionId ? `Scope: ${scopeLine}` : "Latest completed runs"}
      skeleton={<CardSkeleton height={300} />}
      insight={{
        situation: { sentence: `${runs.length} completed ${runs.length === 1 ? "run is" : "runs are"} available. Reports are rendered from the run you choose.`, tone: runs.length ? "go" : "at-risk" },
        changed: { sentence: "—" },
        why: { sentence: can("export") ? `${entries.length} reports in the library.` : "Export needs the auditor or analyst role." },
        next: can("export") && href
          ? { sentence: "Download the selected report.", action: { label: `Download ${current?.name ?? "report"}`, onClick: download } }
          : { sentence: can("export") ? "Choose a run." : "Export needs the auditor or analyst role.", action: { label: "Open runs", href: "/runs" } },
      }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Analysis run" value={versionId} onValueChange={setPicked} placeholder="Choose a run" options={runs.map((v) => ({ value: v.id, label: v.label || formatDate(v.run_at, "datetime") }))} />
          <Select label="Compare with" value={compare} onValueChange={setCompare} options={[{ value: NONE, label: "No comparison" }, ...runs.filter((v) => v.id !== versionId).map((v) => ({ value: v.id, label: v.label || formatDate(v.run_at, "datetime") }))]} />
          <Select label="Object" value={module} onValueChange={setModule} options={[{ value: NONE, label: "All objects" }, ...(heat.data?.rows ?? []).map((r) => ({ value: r.module, label: formatModuleName(r.module) }))]} />
        </div>
      }
      state={versions.isLoading ? "loading" : isListFailure(versions) ? "error" : runs.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No completed run yet", detail: "Reports are rendered from a finished run.", ghost: "table", action: <Button variant="secondary" render={<Link href="/runs">Open runs</Link>} /> }}
      errorProps={{ message: apiErrorMessage(versions.error), onRetry: () => void versions.refetch() }}
    >
      <>
      {!can("export") ? (
        <Card title="Reports"><p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>Export needs the auditor or analyst role.</p></Card>
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
              {catalogue.isLoading ? <CardSkeleton height={300} /> : (
                <div role="listbox" aria-label="Reports" onKeyDown={onKeys} className="flex flex-col gap-2">
                  {entries.map((e) => (
                    <button
                      key={e.id} type="button" role="option" data-id={e.id} aria-selected={e.id === current?.id}
                      tabIndex={e.id === current?.id ? 0 : -1} onClick={() => setSelected(e.id)}
                      className="m-lift flex flex-col gap-1 rounded p-3 text-left"
                      style={{ background: e.id === current?.id ? "var(--m-surface-2)" : "var(--m-surface)", color: "var(--m-ink)" }}
                    >
                      <span className="flex items-center gap-2 font-medium">{e.name}<Pill tone="neutral">{e.format}</Pill></span>
                      <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{e.about}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <div className="@5xl:col-span-7">
            <Card title={current ? `Preview: ${current.name}` : "Preview"}>
              {current && (
                <div className="flex flex-col gap-3">
                  <p className="m-text-body">{current.about}</p>
                  <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{`About ${current.page_estimate} pages. Scope: ${scopeLine}.`}</p>
                  {current.sections.length > 0 && (
                    <ul className="list-disc pl-5 m-text-body">{current.sections.map((s) => <li key={s}>{s}</li>)}</ul>
                  )}
                  {o && (
                    <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
                      {`Key figures: DQS ${o.dqs.composite ?? "not scored"}, ${o.blockers.count} blockers`}
                      {o.value_at_risk.worst_l1 ? `, largest L1 at risk ${l1Label(o.value_at_risk.worst_l1)} ${formatMoney(o.value_at_risk.worst_l1_amount, o.value_at_risk.currency)}` : ""}.
                    </p>
                  )}
                  {current.requires.length > 0 && !href && <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{`Needs: ${current.requires.join(", ")}.`}</p>}
                  {current.id === "record" && (
                    <Field label="Record key">
                      <Input value={recordKey} onChange={(e) => setRecordKey(e.target.value)} placeholder="For example a material number" />
                    </Field>
                  )}
                  {current.last_built_at && <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{`Last built ${formatDate(current.last_built_at, "datetime")}.`}</p>}
                  <div className="flex gap-2">
                    <Button variant="primary" disabled={!href} onClick={download}>Download</Button>
                    <Button variant="secondary" disabled={!href} onClick={() => void copy()}>Copy link</Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
      {canSeeAudit && (
        <div className="mt-4">
          <Card title="Recent exports">
            {recent.isError ? (
              <p className="m-text-body" role="alert">{`Recent exports did not load. ${apiErrorMessage(recent.error)}`}</p>
            ) : (recent.data?.entries ?? []).length === 0 ? (
              <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>{recent.isLoading ? "Loading" : "No exports yet."}</p>
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
