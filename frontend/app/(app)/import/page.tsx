"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DrillLink, Button, Card, DataTable, EmptyState, ErrorState, Mono, Notice, PageHeader, Pill, Score, Select, Skeleton, type PillTone, PageFrame, Status, ProgressFill, toast } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getSystems } from "@/lib/api/connectivity";
import { getModuleFieldMappings } from "@/lib/api/field-mappings";
import { matchColumns, pollAnalysisStatus, uploadFile, type MatchResponse } from "@/lib/api/upload";
import { getVersions } from "@/lib/api/versions";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatModuleName, labelOf, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { runName } from "@/lib/run-scope";
import { formatSize, readHeaderSample } from "@/lib/upload-preview";
import type { Version } from "@/types/api";
import { clsx } from "clsx";

/** Backend step ids to the label shown under the progress bar. */
const STEP_LABEL: Record<string, string> = {
  queued: "Queued", processing: "Processing", parsing: "Reading the file", mapping: "Mapping columns", validating: "Validating records",
  running_checks: "Running checks", checks: "Running checks", scoring: "Scoring", running_agents: "Analysing findings", agents: "Analysing findings",
  enriching: "Enriching", complete: "Complete", completed: "Complete", failed: "Failed",
};
const stepLabel = (step: string) => STEP_LABEL[step] ?? labelOf(step);

const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xls,.json,.parquet";
const TERMINAL = new Set(["complete", "agents_complete", "ai_enriched", "failed", "agents_failed"]);
const NOT_MAPPED = "";

type Job = { versionId: string; status: "queued" | "processing" | "completed" | "failed"; percent: number; step: string; error: string | null };

function versionDqs(v: Version): number | null {
  const scores = Object.values(v.dqs_summary ?? {}).flatMap((m) => (m.composite_score == null ? [] : [m.composite_score]));
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
}
const confidenceTone = (c: number): PillTone => (c >= 0.85 ? "go" : c >= 0.6 ? "at-risk" : "no-go");

export default function ImportPage() {
  const qc = useQueryClient();
  const { can } = useRole();
  const canUpload = can("upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [targetModule, setTargetModule] = useState<string | null>(null);
  // The user's corrections to the proposed mapping, by source column; the proposal stands where there is none.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [uploadPct, setUploadPct] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const [dragging, setDragging] = useState(false);

  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, staleTime: 60_000 });
  const recent = useQuery({
    queryKey: queryKeys.versionsList({ limit: 50 }),
    queryFn: () => getVersions({ limit: 50 }),
    refetchInterval: (q) => (q.state.data?.versions.some((v) => !TERMINAL.has(v.status)) ? 5000 : false),
  });
  const fieldsQ = useQuery({
    queryKey: ["field-mappings", "module", targetModule],
    queryFn: () => getModuleFieldMappings(targetModule!),
    enabled: !!targetModule,
    retry: false,
    meta: { ignoreError: true },
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
    setMatch(null); setTargetModule(null); setOverrides({}); setJob(null); setUploadPct(0);
    matchMut.mutate(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const targetOf = (m: MatchResponse["mappings"][number]) => overrides[m.source_column] ?? m.target_field ?? NOT_MAPPED;
  const run = useMutation({
    mutationFn: async () => {
      if (!file || !targetModule || !match) throw new Error("Pick a file and a module first");
      const mapping = Object.fromEntries(match.mappings.flatMap((m) => (targetOf(m) ? [[m.source_column, targetOf(m)]] : [])));
      const up = await uploadFile(file, targetModule, Object.keys(mapping).length ? mapping : null, setUploadPct);
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
  const mapped = match?.mappings.filter((m) => targetOf(m)).length ?? 0;
  const canRun = !!file && !!match && !!targetModule && !matchMut.isPending && !run.isPending && !job;

  const pick = (f: File | null) => { if (f) setFile(f); };
  const clear = () => { setFile(null); setMatch(null); setTargetModule(null); setOverrides({}); setJob(null); setUploadPct(0); if (inputRef.current) inputRef.current.value = ""; };

  const columns = useMemo<ColumnDef<Version>[]>(() => [
    {
      id: "file", header: "File",
      cell: ({ row }) => <Link href={`/runs/${row.original.id}`} className="underline">{row.original.metadata?.file_name ?? runName(row.original)}</Link>,
    },
    { id: "modules", header: "Objects", cell: ({ row }) => (row.original.metadata?.modules ?? []).map(formatModuleName).join(", ") },
    { id: "rows", header: "Records", cell: ({ row }) => (row.original.metadata?.row_count != null ? <DrillLink href={`/runs/${row.original.id}`}>{row.original.metadata.row_count.toLocaleString()}</DrillLink> : "") },
    { id: "dqs", header: "Score", cell: ({ row }) => { const d = versionDqs(row.original); return d === null ? "" : <Score size="sm" value={d}><DrillLink href={`/runs/${row.original.id}`}>{d.toFixed(1)}</DrillLink></Score>; } },
    { id: "status", header: "Status", cell: ({ row }) => <Status kind="lifecycle" value={row.original.status} /> },
    { id: "when", header: "Imported", cell: ({ row }) => relativeTime(row.original.run_at) },
    { id: "open", header: "", size: 80, cell: ({ row }) => <Link href={`/runs/${row.original.id}`} className="m-ink-accent-ink underline">Open</Link> },
  ], []);
  // The module's standard fields, so a wrong proposal can be corrected before the import; read-only until they load.
  const fieldOptions = useMemo(() => [
    { value: NOT_MAPPED, label: "Not mapped" },
    ...(fieldsQ.data?.mappings ?? []).map((f) => ({ value: f.standard_field, label: f.standard_label ? `${f.standard_field}, ${f.standard_label}` : f.standard_field })),
  ], [fieldsQ.data]);
  const editable = (fieldsQ.data?.mappings.length ?? 0) > 0 && !job;
  const mapColumns = useMemo<ColumnDef<MatchResponse["mappings"][number]>[]>(() => [
    { id: "source", header: "Your column", cell: ({ row }) => row.original.source_column },
    {
      id: "target", header: "Standard field",
      cell: ({ row }) => {
        const target = targetOf(row.original);
        if (editable) {
          const options = target && !fieldOptions.some((o) => o.value === target) ? [...fieldOptions, { value: target, label: target }] : fieldOptions;
          return <Select label={`Standard field for ${row.original.source_column}`} value={target} options={options} onValueChange={(v) => setOverrides((o) => ({ ...o, [row.original.source_column]: v }))} />;
        }
        return <>{target ? <Mono>{target}</Mono> : <span className="m-ink-3">Not mapped</span>}{row.original.is_required ? " (required)" : ""}</>;
      },
    },
    { id: "confidence", header: "Confidence", cell: ({ row }) => (overrides[row.original.source_column] !== undefined ? "Set by you" : `${Math.round(row.original.confidence * 100)}%`) },
    { id: "match", header: "Match", cell: ({ row }) => (overrides[row.original.source_column] !== undefined ? <Pill tone="go">Chosen</Pill> : <Pill tone={confidenceTone(row.original.confidence)}>{labelOf(row.original.match_type)}</Pill>) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [editable, fieldOptions, overrides]);
  const rankedMappings = useMemo(
    () => [...(match?.mappings ?? [])].sort((a, b) => Number(!!targetOf(a)) - Number(!!targetOf(b)) || a.confidence - b.confidence),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [match, overrides],
  );
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
        meta="Score an SAP export without connecting a system. Choose a file, check which object and fields it maps to, then run the import"
        actions={canUpload ? <Button variant={file ? "secondary" : "primary"} onClick={() => inputRef.current?.click()}>{file ? "Choose another file" : "Choose file"}</Button> : undefined}
      />

      <Card padding="lg">
        <div className="flex flex-col [gap:var(--m-section-gap)]">
          <label
            className={clsx(
              "flex cursor-pointer flex-col items-center gap-2 px-6 py-10 text-center [border:1px_dashed_var(--m-line-strong)] [border-radius:var(--m-radius-sheet)]",
              dragging && "[outline:2px_solid_var(--m-accent)]",
            )}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (canUpload) pick(e.dataTransfer.files?.[0] ?? null); }}
          >
            <input ref={inputRef} type="file" accept={ACCEPT} disabled={!canUpload} onChange={(e) => pick(e.target.files?.[0] ?? null)} hidden />
            <strong className="m-text-h">{file ? file.name : canUpload ? "Drop a CSV or XLSX, or choose a file" : "Your role cannot import files. Ask an admin for upload access"}</strong>
            <span className="m-text-body m-ink-3">{file ? fileNote : "CSV, TSV, XLSX, XLS, JSON or Parquet, up to 2 GB"}</span>
          </label>

          {running || (run.isPending && !job) ? (
            <div className="flex flex-col gap-1">
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="[height:2px] [background:var(--m-line)]">
                <ProgressFill value={pct} />
              </div>
              <p className="m-text-meta m-ink-3">{job ? stepLabel(job.step) : `Uploading ${uploadPct}%`}</p>
            </div>
          ) : null}
          {job?.error ? <Notice tone="danger">Analysis failed: {job.error}</Notice> : null}
          {job?.error ? (
            <div><Button variant="secondary" onClick={() => { setJob(null); setUploadPct(0); }}>Try again</Button></div>
          ) : null}
          {job?.status === "completed" ? (
            <Notice tone="success" action={<Button render={<Link href={`/runs/${job.versionId}`}>Open the run</Link>} />}>
              The file is imported and scored.
            </Notice>
          ) : null}

          {match ? (
            <section className="flex flex-col gap-3" aria-label="Column mapping">
              <header className="flex items-center gap-3">
                <h2 className="m-text-h flex-1 font-semibold m-ink">{`Column mapping${match.mappings.length ? `, ${mapped} of ${match.mappings.length} mapped` : ""}`}</h2>
                <Button variant="ghost" onClick={clear}>Clear</Button>
                <Button onClick={() => run.mutate()} disabled={!canRun}>{run.isPending ? `Uploading ${uploadPct}%` : job ? "Imported" : "Run import"}</Button>
              </header>
              <p className="m-text-body m-ink-2">
                {targetModule ? "Which SAP object this file holds. Change it if Meridian guessed wrong." : "Pick the SAP object this file holds to run the import."}
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Object">
                {match.available_modules.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => { setTargetModule(m.value); setOverrides({}); }}
                    aria-pressed={targetModule === m.value}
                    className="px-2 py-0.5 m-text-meta rounded-full border m-ink [border-color:var(--m-line)] aria-pressed:[border-color:var(--m-accent)] aria-pressed:[color:var(--m-accent)]"
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
                <>
                  <DataTable columns={mapColumns} data={rankedMappings} getRowId={(m) => m.source_column} />
                  <p className="m-text-meta m-ink-3">
                    {editable ? "Change a standard field here for this import only. " : ""}
                    Standing mappings for this object are under <Link href="/admin/mappings" className="underline">Field mapping</Link>.
                  </p>
                </>
              ) : null}
            </section>
          ) : null}
        </div>
      </Card>

      <Card title="Recent imports" meta={versions.length ? `${versions.length.toLocaleString()} files` : undefined}>
        {recent.isLoading ? (
          <div className="flex flex-col gap-1" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={36} />)}
          </div>
        ) : recent.isError ? (
          <ErrorState {...apiErrorState(recent.error)} onRetry={() => void recent.refetch()} />
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

      {systemsQ.data?.length && can("trigger_sync") ? (
        <Notice>
          {systemsQ.data.length} SAP {systemsQ.data.length === 1 ? "system is" : "systems are"} connected. Extracting objects straight
          from a system keeps runs comparable run to run; file imports suit one-off assessments.{" "}
          <Link href="/systems" className="underline">Open systems</Link>
        </Notice>
      ) : null}
    </PageFrame>
  );
}
