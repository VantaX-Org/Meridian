"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { DrillLink, Button, Card, DataTable, EmptyState, Mono, Notice, PageHeader, Pill, Skeleton, Stat, type PillTone, PageFrame } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getSystems } from "@/lib/api/connectivity";
import { matchColumns, pollAnalysisStatus, uploadFile, type MatchResponse } from "@/lib/api/upload";
import { getVersions } from "@/lib/api/versions";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName, labelOf, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { formatSize, readHeaderSample } from "@/lib/upload-preview";
import type { Version } from "@/types/api";

/** Backend step ids to the label shown under the progress bar. */
const STEP_LABEL: Record<string, string> = {
  queued: "Queued", processing: "Processing", parsing: "Reading the file", mapping: "Mapping columns", validating: "Validating records",
  running_checks: "Running checks", checks: "Running checks", scoring: "Scoring", running_agents: "Analysing findings", agents: "Analysing findings",
  enriching: "Enriching", complete: "Complete", completed: "Complete", failed: "Failed",
};
const stepLabel = (step: string) => STEP_LABEL[step] ?? labelOf(step);

const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xls,.json,.parquet";
const TERMINAL = new Set(["complete", "agents_complete", "ai_enriched", "failed", "agents_failed"]);

type Job = { versionId: string; status: "queued" | "processing" | "completed" | "failed"; percent: number; step: string; error: string | null };

function versionDqs(v: Version): number | null {
  const scores = Object.values(v.dqs_summary ?? {}).flatMap((m) => (m.composite_score == null ? [] : [m.composite_score]));
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
}
const versionTone = (s: string): PillTone => (s === "failed" || s === "agents_failed" ? "no-go" : TERMINAL.has(s) ? "go" : "at-risk");
const confidenceTone = (c: number): PillTone => (c >= 0.85 ? "go" : c >= 0.6 ? "at-risk" : "no-go");

export default function ImportPage() {
  const qc = useQueryClient();
  const { can } = useRole();
  const canUpload = can("upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [targetModule, setTargetModule] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const [dragging, setDragging] = useState(false);

  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, staleTime: 60_000 });
  const recent = useQuery({
    queryKey: queryKeys.versionsList({ limit: 50 }),
    queryFn: () => getVersions({ limit: 50 }),
    refetchInterval: (q) => (q.state.data?.versions.some((v) => !TERMINAL.has(v.status)) ? 5000 : false),
  });

  const matchMut = useMutation({
    mutationFn: async (f: File) => {
      const { headers, sample } = await readHeaderSample(f);
      return { res: await matchColumns(headers, sample, f.name), parsed: headers.length > 0 };
    },
    onSuccess: ({ res, parsed }) => { setMatch(res); setTargetModule(parsed ? res.detected_module : null); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  useEffect(() => {
    if (!file) return;
    setMatch(null); setTargetModule(null); setJob(null); setUploadPct(0);
    matchMut.mutate(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const run = useMutation({
    mutationFn: async () => {
      if (!file || !targetModule) throw new Error("Pick a file and a module first");
      const up = await uploadFile(file, targetModule, null, setUploadPct);
      setJob({ versionId: up.version_id, status: "queued", percent: 0, step: "queued", error: null });
      const final = await pollAnalysisStatus(up.version_id, (s) => setJob({
        versionId: up.version_id, status: s.status, percent: s.progress?.percent_complete ?? 0,
        step: s.progress?.current_step || s.status, error: s.error ?? null,
      }));
      return final;
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["versions-list"] });
      if (s.status === "completed") toast.success("Import analysed"); else toast.error(s.error || "Analysis failed");
    },
    onError: (e) => { const m = apiErrorMessage(e); toast.error(m); setJob((j) => j ? { ...j, status: "failed", error: m } : null); },
  });

  const noHeaders = !!match && match.mappings.length === 0;
  const mapped = match?.mappings.filter((m) => m.target_field).length ?? 0;
  const canRun = !!file && !!match && !!targetModule && !matchMut.isPending && !run.isPending && !job;

  const pick = (f: File | null) => { if (f) setFile(f); };
  const clear = () => { setFile(null); setMatch(null); setTargetModule(null); setJob(null); setUploadPct(0); if (inputRef.current) inputRef.current.value = ""; };

  const columns = useMemo<ColumnDef<Version>[]>(() => [
    {
      id: "file", header: "File",
      cell: ({ row }) => <Link href={`/runs/${row.original.id}`} className="underline">{row.original.metadata?.file_name ?? row.original.label ?? row.original.id.slice(0, 8)}</Link>,
    },
    { id: "modules", header: "Objects", cell: ({ row }) => (row.original.metadata?.modules ?? []).map(formatModuleName).join(", ") },
    { id: "rows", header: "Records", cell: ({ row }) => (row.original.metadata?.row_count != null ? <DrillLink href={`/runs/${row.original.id}`}>{row.original.metadata.row_count.toLocaleString()}</DrillLink> : "") },
    { id: "dqs", header: "Score", cell: ({ row }) => { const d = versionDqs(row.original); return d === null ? "" : <DrillLink href={`/runs/${row.original.id}`}>{d.toFixed(1)}</DrillLink>; } },
    { id: "status", header: "Status", cell: ({ row }) => <Pill tone={versionTone(row.original.status)}>{labelOf(row.original.status)}</Pill> },
    { id: "when", header: "Imported", cell: ({ row }) => relativeTime(row.original.run_at) },
  ], []);
  const mapColumns = useMemo<ColumnDef<MatchResponse["mappings"][number]>[]>(() => [
    { id: "source", header: "Your column", cell: ({ row }) => row.original.source_column },
    { id: "target", header: "Standard field", cell: ({ row }) => <>{row.original.target_field ? <Mono>{row.original.target_field}</Mono> : <span style={{ color: "var(--m-ink-3)" }}>Not mapped</span>}{row.original.is_required ? " (required)" : ""}</> },
    { id: "confidence", header: "Confidence", cell: ({ row }) => `${Math.round(row.original.confidence * 100)}%` },
    { id: "match", header: "Match", cell: ({ row }) => <Pill tone={confidenceTone(row.original.confidence)}>{labelOf(row.original.match_type)}</Pill> },
  ], []);
  const versions = (recent.data?.versions ?? []).filter((v) => v.metadata?.source !== "extraction");

  const fileNote = matchMut.isPending ? "Reading the columns"
    : match ? `${formatSize(file?.size ?? 0)}, looks like ${match.module_label} (${Math.round(match.module_confidence * 100)}% sure), ${mapped} columns mapped`
    : file ? formatSize(file.size) : "";

  const running = !!job && job.status !== "completed" && job.status !== "failed";
  const pct = run.isPending && !job ? uploadPct : job?.percent ?? 0;

  return (
    <PageFrame>
      <PageHeader
        title="Import file"
        meta="Check how columns map to standard SAP fields, then run the analysis, and every import becomes a version"
        actions={canUpload ? <Button variant="primary" onClick={() => inputRef.current?.click()}>Choose file</Button> : undefined}
      />
      {systemsQ.data?.length ? (
        <Notice>
          {systemsQ.data.length} SAP {systemsQ.data.length === 1 ? "system is" : "systems are"} connected. Pulling objects straight
          from a system keeps versions comparable run to run; file imports suit one-off assessments.{" "}
          <Link href="/systems" className="underline">Download from the source</Link>
        </Notice>
      ) : null}
      {versions.length > 0 ? (
        <div className="flex gap-6">
          <Stat label="Last import" value={relativeTime(versions[0].run_at)} href={`/runs/${versions[0].id}`} />
        </div>
      ) : null}

      <label
        className="block cursor-pointer [&>section]:border-dashed! [&>section]:border-(--m-line-strong)!"
        style={dragging ? { outline: "2px solid var(--m-accent)" } : undefined}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (canUpload) pick(e.dataTransfer.files?.[0] ?? null); }}
      >
        <input ref={inputRef} type="file" accept={ACCEPT} disabled={!canUpload} onChange={(e) => pick(e.target.files?.[0] ?? null)} hidden />
        <Card padding="lg">
          <div className="flex flex-col gap-2 text-center">
            <strong className="m-text-h">{file ? file.name : canUpload ? "Drop a CSV or XLSX, or choose a file" : "Importing needs the upload permission"}</strong>
            <span className="m-text-body" style={{ color: "var(--m-ink-3)" }}>{file ? fileNote : "CSV, TSV, XLSX, XLS, JSON or Parquet, up to 2 GB"}</span>
          </div>
        </Card>
      </label>

      <div className="flex flex-col gap-1" style={{ minHeight: 28 }}>
        {running || (run.isPending && !job) ? (<>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 2, background: "var(--m-line)" }}>
            <div style={{ height: 2, width: `${pct}%`, background: "var(--m-accent)" }} />
          </div>
          <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{job ? stepLabel(job.step) : `Uploading ${uploadPct}%`}</p>
        </>) : null}
      </div>
      {job?.error ? <Notice tone="danger">Analysis failed: {job.error}</Notice> : null}
      {job?.status === "completed" ? <Link href={`/runs/${job.versionId}`} className="underline">Open the run</Link> : null}

      {match ? (
        <Card title={`Column mapping${match.mappings.length ? `, ${mapped} of ${match.mappings.length} mapped` : ""}`}
          actions={
            <>
              <Button variant="ghost" onClick={clear}>Clear</Button>
              <Button onClick={() => run.mutate()} disabled={!canRun}>{run.isPending ? `Uploading ${uploadPct}%` : job ? "Imported" : "Run import"}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
          <div className="flex gap-2" role="group" aria-label="Object">
            {match.available_modules.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setTargetModule(m.value)}
                aria-pressed={targetModule === m.value}
                className="px-2 py-0.5 m-text-meta rounded-full border"
                style={{
                  borderColor: targetModule === m.value ? "var(--m-accent)" : "var(--m-line)",
                  color: targetModule === m.value ? "var(--m-accent)" : "var(--m-ink)",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          {noHeaders ? (
            <Notice tone="warning">Columns cannot be previewed for this format. Pick the object above; the columns are read from the file when it imports</Notice>
          ) : null}
          {match.unmapped_required.length ? (
            <Notice tone="warning">{match.unmapped_required.length} required fields have no column: {match.unmapped_required.join(", ")}. Checks that need them are skipped</Notice>
          ) : null}
          {match.mappings.length ? (
            <DataTable columns={mapColumns} data={match.mappings.slice(0, 14)} getRowId={(m) => m.source_column} />
          ) : null}
          </div>
        </Card>
      ) : null}

      <Card title="Recent imports">
        {recent.isLoading ? (
          <div className="flex flex-col gap-1" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={36} />)}
          </div>
        ) : versions.length ? (
          <DataTable columns={columns} data={versions} getRowId={(v) => v.id} />
        ) : (
          <EmptyState
            title="No imports yet"
            detail="Drop a CSV, XLSX, JSON or Parquet export above to create a run"
            action={
              canUpload ? (
                <Button variant="secondary" onClick={() => inputRef.current?.click()}>
                  Choose file
                </Button>
              ) : undefined
            }
          />
        )}
      </Card>
    </PageFrame>
  );
}
