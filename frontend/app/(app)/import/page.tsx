"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DrillLink, Button, Card, ChoiceGroup, DataTable, EmptyState, ErrorState, Field, Mono, Notice, PageHeader, Pill, RetryJobButton, Score, Select, Skeleton, type PillTone, PageFrame, Status, ProgressFill, toast } from "@/design";
import { JobError } from "@/components/job-error";
import { explainJobError } from "@/lib/job-error";
import { JOBS_QUERY_KEY } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { getJobs } from "@/lib/api/jobs";
import { getSystems } from "@/lib/api/connectivity";
import { getModuleFieldMappings } from "@/lib/api/field-mappings";
import { matchColumns, pollAnalysisStatus, uploadFile, type MatchResponse } from "@/lib/api/upload";
import { getVersions } from "@/lib/api/versions";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { MODULE_LABELS, formatModuleName, labelOf, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { runName } from "@/lib/run-scope";
import { formatSize, readHeaderSample } from "@/lib/upload-preview";
import type { Version } from "@/types/api";
import type { Job as TrackedJob } from "@/types/jobs";
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
const FAILED = new Set(["failed", "agents_failed"]);
const NOT_MAPPED = "";
const NO_SYSTEM = "";

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
  const [systemId, setSystemId] = useState(NO_SYSTEM);
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
  // A failed import's reason lives on its job (the shell's job list); read it only when a row needs it.
  const hasFailed = !!recent.data?.versions.some((v) => FAILED.has(v.status));
  const jobsQ = useQuery({ queryKey: JOBS_QUERY_KEY, queryFn: () => getJobs({ limit: 100 }), enabled: hasFailed, staleTime: 5_000, retry: false, meta: { ignoreError: true } });
  const failedJobs = useMemo(() => {
    const byVersion = new Map<string, TrackedJob>();
    for (const j of jobsQ.data ?? []) if (j.status === "failed" && j.version_id && !byVersion.has(j.version_id)) byVersion.set(j.version_id, j);
    return byVersion;
  }, [jobsQ.data]);
  const fieldsQ = useQuery({
    queryKey: ["field-mappings", "module", targetModule],
    queryFn: () => getModuleFieldMappings(targetModule!),
    enabled: !!targetModule,
    retry: false,
    meta: { ignoreError: true },
  });

  // The file's header row and sample, read once per file, so choosing another object re-matches the same columns.
  const sampleRef = useRef<{ headers: string[]; sample: string[][]; name: string } | null>(null);
  // The object the user chose last; a re-match for an object they have since left is dropped.
  const wantedModule = useRef<string | null>(null);
  // What Meridian detected on the first read, so the note can tell a guess from the user's choice.
  const [detected, setDetected] = useState<string | null>(null);
  // The object was picked by hand after the columns could not be read.
  const [manual, setManual] = useState(false);
  const matchMut = useMutation({
    mutationFn: async ({ f, hint }: { f: File; hint?: string }) => {
      if (hint === undefined || !sampleRef.current) {
        const { headers, sample } = await readHeaderSample(f);
        sampleRef.current = { headers, sample, name: f.name };
      }
      const s = sampleRef.current;
      return { res: await matchColumns(s.headers, s.sample, s.name, hint), parsed: s.headers.length > 0, hint };
    },
    onSuccess: ({ res, parsed, hint }) => {
      if (hint !== undefined && hint !== wantedModule.current) return;
      setMatch(res);
      if (hint === undefined) { setDetected(res.detected_module); setTargetModule(parsed ? res.detected_module : null); }
    },
    onError: (e, { hint }) => { if (hint !== undefined) toast.error(apiErrorMessage(e)); },
  });
  const readColumns = (f: File) => {
    sampleRef.current = null; wantedModule.current = null; setManual(false);
    setMatch(null); setDetected(null); setTargetModule(null); setOverrides({}); setJob(null); setUploadPct(0);
    matchMut.mutate({ f });
  };
  useEffect(() => {
    if (!file) return;
    readColumns(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  // Reading the columns failed (unreadable file or the match request): the object can still be chosen by hand,
  // and the columns are then read from the file when it imports.
  const readFailed = !!file && !match && matchMut.isError && matchMut.variables?.hint === undefined;
  const chooseObject = (value: string) => {
    setTargetModule(value); setOverrides({});
    wantedModule.current = value;
    // Re-match the columns against the chosen object: the guessed matches belong to the detected one.
    if (file && match && sampleRef.current?.headers.length && value !== match.detected_module) matchMut.mutate({ f: file, hint: value });
  };
  const manualObject = (value: string) => {
    wantedModule.current = value;
    setManual(true);
    setTargetModule(value); setOverrides({});
    setMatch({
      detected_module: value, module_confidence: 0, module_label: formatModuleName(value), mappings: [], unmapped_required: [],
      available_modules: Object.keys(MODULE_LABELS).map((m) => ({ value: m, label: formatModuleName(m) })),
    });
  };

  const targetOf = (m: MatchResponse["mappings"][number]) => overrides[m.source_column] ?? m.target_field ?? NOT_MAPPED;
  const run = useMutation({
    mutationFn: async () => {
      if (!file || !targetModule || !match) throw new Error("Pick a file and a module first");
      const mapping = Object.fromEntries(match.mappings.flatMap((m) => (targetOf(m) ? [[m.source_column, targetOf(m)]] : [])));
      const up = await uploadFile(file, targetModule, Object.keys(mapping).length ? mapping : null, setUploadPct, { systemId });
      setJob({ versionId: up.version_id, status: "queued", percent: 0, step: "queued", error: null });
      const final = await pollAnalysisStatus(up.version_id, (s) => setJob({
        versionId: up.version_id, status: s.status, percent: s.progress?.percent_complete ?? 0,
        step: s.progress?.current_step || s.status, error: s.error ?? null,
      }));
      return final;
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["versions-list"] });
      if (s.status === "completed") toast.success("Import analysed"); else toast.error(explainJobError(s.error)?.summary ?? "The analysis failed");
    },
    onError: (e) => { const m = apiErrorMessage(e); toast.error(m); setJob((j) => j ? { ...j, status: "failed", error: m } : null); },
  });

  const noHeaders = !!match && match.mappings.length === 0;
  const mapped = match?.mappings.filter((m) => targetOf(m)).length ?? 0;
  const rematching = !!match && matchMut.isPending;
  // The object's required fields with no column in the mapping as it stands now, the user's corrections included.
  const unmappedRequired = useMemo(() => {
    if (!match) return [];
    const required = new Set([...match.unmapped_required, ...match.mappings.flatMap((m) => (m.is_required && m.target_field ? [m.target_field] : []))]);
    const covered = new Set(match.mappings.map(targetOf).filter(Boolean));
    return [...required].filter((f) => !covered.has(f)).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, overrides]);
  const canRun = !!file && !!match && !!targetModule && !matchMut.isPending && !run.isPending && !job;

  const pick = (f: File | null) => { if (f) setFile(f); };
  const clear = () => { sampleRef.current = null; wantedModule.current = null; matchMut.reset(); setManual(false); setFile(null); setMatch(null); setDetected(null); setTargetModule(null); setOverrides({}); setJob(null); setUploadPct(0); if (inputRef.current) inputRef.current.value = ""; };

  const columns = useMemo<ColumnDef<Version>[]>(() => [
    {
      id: "file", header: "File",
      cell: ({ row }) => <Link href={`/runs/${row.original.id}`} className="underline">{row.original.metadata?.file_name ?? runName(row.original)}</Link>,
    },
    { id: "modules", header: "Objects", cell: ({ row }) => (row.original.metadata?.modules ?? []).map(formatModuleName).join(", ") },
    { id: "rows", header: "Records", cell: ({ row }) => (row.original.metadata?.row_count != null ? <DrillLink href={`/runs/${row.original.id}`}>{row.original.metadata.row_count.toLocaleString()}</DrillLink> : "") },
    { id: "dqs", header: "Score", cell: ({ row }) => { const d = versionDqs(row.original); return d === null ? "" : <Score size="sm" value={d}><DrillLink href={`/runs/${row.original.id}`}>{d.toFixed(1)}</DrillLink></Score>; } },
    {
      id: "status", header: "Status",
      cell: ({ row }) => {
        const v = row.original;
        if (!FAILED.has(v.status)) return <Status kind="lifecycle" value={v.status} />;
        const j = failedJobs.get(v.id);
        return (
          <div className="flex flex-col items-start gap-1 py-1">
            <Status kind="lifecycle" value={v.status} />
            {j?.error ? <JobError error={j.error} compact /> : <span className="m-text-meta m-ink-3">No reason was recorded</span>}
            <span className="inline-flex items-center gap-3">
              {j ? <RetryJobButton job={j} /> : null}
              <Link href="/admin/jobs" className="m-text-meta m-ink-accent-ink underline">Job history</Link>
            </span>
          </div>
        );
      },
    },
    { id: "when", header: "Imported", cell: ({ row }) => relativeTime(row.original.run_at) },
    { id: "open", header: "", size: 80, cell: ({ row }) => <Link href={`/runs/${row.original.id}`} className="m-ink-accent-ink underline">Open</Link> },
  ], [failedJobs]);
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

  const fileNote = rematching ? `Matching the columns to ${formatModuleName(targetModule ?? "")}`
    : matchMut.isPending ? "Reading the columns"
    : match && targetModule && targetModule !== detected ? `${formatSize(file?.size ?? 0)}, set to ${match.module_label}, ${mapped} columns mapped`
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
          {job?.error ? <Notice tone="danger"><span className="flex flex-col gap-1"><span>The analysis failed.</span><JobError error={job.error} /></span></Notice> : null}
          {job?.error ? (
            <div><Button variant="secondary" onClick={() => { setJob(null); setUploadPct(0); }}>Try again</Button></div>
          ) : null}
          {job?.status === "completed" ? (
            <Notice tone="success" action={<Button render={<Link href={`/runs/${job.versionId}`}>Open the run</Link>} />}>
              The file is imported and scored.
            </Notice>
          ) : null}

          {readFailed && file ? (
            <section className="flex flex-col gap-3" aria-label="Columns not read">
              <Notice tone="danger" action={<Button variant="secondary" onClick={() => readColumns(file)}>Retry</Button>}>
                The columns could not be read. {apiErrorMessage(matchMut.error)}
              </Notice>
              <p className="m-text-body m-ink-2">Retry, or pick the SAP object this file holds; the columns are then read from the file when it imports.</p>
              <Select
                label="Object"
                value=""
                placeholder="Choose the object"
                onValueChange={(v) => { if (v) manualObject(v); }}
                options={Object.keys(MODULE_LABELS).map((m) => ({ value: m, label: formatModuleName(m) }))}
              />
            </section>
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
              <ChoiceGroup
                label="Object"
                value={targetModule ?? ""}
                onChange={chooseObject}
                options={match.available_modules}
              />
              {systemsQ.data?.length ? (
                <div className="flex flex-col gap-1.5">
                  <Field label="System">
                    <Select
                      value={systemId}
                      onValueChange={setSystemId}
                      options={[{ value: NO_SYSTEM, label: "No system: a one-off file" }, ...systemsQ.data.map((s) => ({ value: s.id, label: s.name }))]}
                    />
                  </Field>
                  <p className="m-text-meta m-ink-3">Attach the file to a system so its runs compare with that system&apos;s extractions</p>
                </div>
              ) : null}
              {noHeaders ? (
                <Notice tone="warning">{manual
                  ? "The columns were not read, so they cannot be previewed. The columns are read from the file when it imports"
                  : "Columns cannot be previewed for this format. Pick the object above; the columns are read from the file when it imports"}</Notice>
              ) : null}
              {rematching ? (
                <div className="flex flex-col gap-1" aria-busy="true">
                  <p className="m-text-meta m-ink-3">Matching the columns to {formatModuleName(targetModule ?? "")}</p>
                  <Skeleton height={120} />
                </div>
              ) : null}
              {!rematching && unmappedRequired.length ? (
                <Notice tone="warning">{unmappedRequired.length} required {unmappedRequired.length === 1 ? "field has" : "fields have"} no column: {unmappedRequired.join(", ")}. Checks that need them are skipped</Notice>
              ) : null}
              {!rematching && match.mappings.length ? (
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
