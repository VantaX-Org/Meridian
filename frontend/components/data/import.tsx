"use client";

/**
 * Import: drop a file, see how its columns match an object's standard
 * fields, pick the object, run the import and follow the analysis to the end.
 * Every import is a version; recent ones are listed with their DQS.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, EmptyState, Mono, PageHeader, SectionCard, StatusBadge, Tally,
  type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { getSystems } from "@/lib/api/systems";
import { matchColumns, pollAnalysisStatus, uploadFile, type MatchResponse } from "@/lib/api/upload";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName, relativeTime } from "@/lib/format";
import { formatSize, readHeaderSample } from "@/lib/upload-preview";
import type { Version } from "@/types/api";
import { ProgressBar, StageStepper } from "./job-card";

const meta = (m: AuroraColumnMeta) => m;
const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xls,.json,.parquet";
const TERMINAL = new Set(["complete", "agents_complete", "ai_enriched", "failed", "agents_failed"]);

type Job = { versionId: string; status: "queued" | "processing" | "completed" | "failed"; percent: number; step: string; error: string | null };

function versionDqs(v: Version): number | null {
  const scores = Object.values(v.dqs_summary ?? {}).map((m) => m.composite_score);
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
}
const versionStatus = (s: string): Status => s === "failed" || s === "agents_failed" ? "failed" : TERMINAL.has(s) ? "ok" : "running";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ImportSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  const canUpload = can("upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [module, setModule] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const [dragging, setDragging] = useState(false);

  const systemsQ = useQuery({ queryKey: ["systems.list"], queryFn: getSystems, staleTime: 60_000 });
  const recent = useQuery({
    queryKey: ["versions.list", { limit: 50 }], queryFn: () => getVersions({ limit: 50 }),
    refetchInterval: (q) => (q.state.data?.versions.some((v) => !TERMINAL.has(v.status)) ? 5000 : false),
  });

  const matchMut = useMutation({
    mutationFn: async (f: File) => {
      const { headers, sample } = await readHeaderSample(f);
      return { res: await matchColumns(headers, sample, f.name), parsed: headers.length > 0 };
    },
    onSuccess: ({ res, parsed }) => { setMatch(res); setModule(parsed ? res.detected_module : null); },
    onError: (e) => toast.error((e as Error).message || "Could not read the file"),
  });
  useEffect(() => {
    if (!file) return;
    setMatch(null); setModule(null); setJob(null); setUploadPct(0);
    matchMut.mutate(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const run = useMutation({
    mutationFn: async () => {
      if (!file || !module) throw new Error("Pick a file and a module first");
      const up = await uploadFile(file, module, null, setUploadPct);
      setJob({ versionId: up.version_id, status: "queued", percent: 0, step: "Queued", error: null });
      const final = await pollAnalysisStatus(up.version_id, (s) => setJob({
        versionId: up.version_id, status: s.status, percent: s.progress?.percent_complete ?? 0,
        step: s.progress?.current_step || s.status, error: s.error ?? null,
      }));
      return final;
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["versions.list"] }); qc.invalidateQueries({ queryKey: ["reports.versions"] });
      if (s.status === "completed") toast.success("Import analysed"); else toast.error(s.error || "Analysis failed");
    },
    onError: (e) => { toast.error((e as Error).message || "Import failed"); setJob((j) => j ? { ...j, status: "failed", error: (e as Error).message } : null); },
  });

  const stage = job ? "run" : match ? "mapping" : file ? "preview" : "source";
  const order = ["source", "preview", "mapping", "run"] as const;
  const stages = order.map((id) => ({
    id, label: { source: "Source", preview: "Preview", mapping: "Mapping", run: "Run" }[id],
    status: (job?.status === "completed" ? "done" : job?.status === "failed" && id === "run" ? "failed"
      : order.indexOf(id) < order.indexOf(stage) ? "done" : id === stage ? (job ? "running" : "running") : "queued") as "done" | "failed" | "running" | "queued",
  }));
  const noHeaders = !!match && match.mappings.length === 0;
  const mapped = match?.mappings.filter((m) => m.target_field).length ?? 0;
  const canRun = !!file && !!match && !!module && !matchMut.isPending && !run.isPending && !job;

  const pick = (f: File | null) => { if (f) setFile(f); };
  const clear = () => { setFile(null); setMatch(null); setModule(null); setJob(null); setUploadPct(0); if (inputRef.current) inputRef.current.value = ""; };

  const columns = useMemo<ColumnDef<Version, unknown>[]>(() => [
    { id: "file", header: "File", meta: meta({ sticky: "start", width: 240 }), cell: ({ row }) => (
      <Link href={`/data/runs/${row.original.id}`} className="ui-link">{row.original.metadata?.file_name ?? row.original.label ?? row.original.id.slice(0, 8)}</Link>) },
    { id: "modules", header: "Objects", cell: ({ row }) => (row.original.metadata?.modules ?? []).map(formatModuleName).join(", ") },
    { id: "rows", header: "Records", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => row.original.metadata?.row_count?.toLocaleString() ?? "" },
    { id: "dqs", header: "Score", meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => { const d = versionDqs(row.original); return d === null ? "" : d.toFixed(1); } },
    { id: "status", header: "Status", meta: meta({ width: 140 }), cell: ({ row }) => <StatusBadge status={versionStatus(row.original.status)}>{cap(row.original.status.replace(/_/g, " "))}</StatusBadge> },
    { id: "when", header: "Imported", meta: meta({ width: 110 }), cell: ({ row }) => relativeTime(row.original.run_at) },
  ], []);
  // Runs read from a system are listed under Runs; imports are the versions that came from a file.
  const versions = (recent.data?.versions ?? []).filter((v) => v.metadata?.source !== "extraction");
  const rowsImported = versions.reduce((a, v) => a + (v.metadata?.row_count ?? 0), 0);

  const fileNote = matchMut.isPending ? "Reading the columns"
    : match ? `${formatSize(file?.size ?? 0)}, looks like ${match.module_label} (${Math.round(match.module_confidence * 100)}% sure), ${mapped} columns mapped`
    : file ? formatSize(file.size) : "";

  return (
    <div className="ui-page">
      <PageHeader
        title="Import"
        summary="Drop an extract, check how its columns map to standard SAP fields, then run the analysis. Every import becomes a version."
      />
      {systemsQ.data?.length ? (
        <Banner tone="info" title={`${systemsQ.data.length} SAP ${systemsQ.data.length === 1 ? "system is" : "systems are"} connected`}
          action={<Link href="/data?tab=systems" className="ui-link">Download from the source</Link>}>
          Pulling objects straight from a connected system keeps versions comparable run to run. File imports suit one-off assessments.
        </Banner>
      ) : null}
      <Tally level={4} label="Imports" figures={[
        { label: "Files imported", value: versions.length, href: "/data?tab=import", loading: recent.isLoading, verdict: versions.length ? "Each one is a run you can open." : "Nothing imported yet." },
        { label: "Records imported", value: rowsImported, href: "/data?tab=import", loading: recent.isLoading, verdict: "Across all imported files." },
        { label: "Last import", value: null, text: versions[0] ? relativeTime(versions[0].run_at) : undefined, href: versions[0] ? `/data/runs/${versions[0].id}` : "/data?tab=import", loading: recent.isLoading,
          verdict: versions[0]?.metadata?.file_name ?? "Never imported. Drop a file below to start." },
      ]} />

      <div className="aurora-import">
        <label className={`aurora-import__drop${dragging ? " is-over" : ""}${file ? " has-file" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (canUpload) pick(e.dataTransfer.files?.[0] ?? null); }}>
          <input ref={inputRef} type="file" accept={ACCEPT} disabled={!canUpload} onChange={(e) => pick(e.target.files?.[0] ?? null)} hidden />
          <div className="ui-stack">
            <strong>{file ? file.name : canUpload ? "Drop a file here, or click to choose one" : "Importing needs the upload permission"}</strong>
            <span className="ui-note">{file ? fileNote : "CSV, TSV, XLSX, XLS, JSON or Parquet, up to 2 GB"}</span>
          </div>
        </label>
        <div className="aurora-import__side">
          <StageStepper stages={stages} />
          {job && job.status !== "completed" && job.status !== "failed" ? <p className="ui-note">{cap(job.step.replace(/_/g, " "))}</p> :
            run.isPending && !job ? <ProgressBar percent={uploadPct} live label={`Uploading ${uploadPct} of 100 percent`} /> : null}
          {job?.error ? <Banner tone="danger" title="Analysis failed">{job.error}</Banner> : null}
          {job?.status === "completed" ? <Link href={`/data/runs/${job.versionId}`} className="ui-link">Open the run</Link> : null}
        </div>
      </div>

      {match ? (
        <SectionCard title="Column mapping" meta={match.mappings.length ? `${mapped} of ${match.mappings.length} mapped` : undefined}
          action={<div className="ui-page-header__actions">
            <Button variant="ghost" onClick={clear}>Clear</Button>
            <Button onClick={() => run.mutate()} disabled={!canRun}>{run.isPending ? `Uploading ${uploadPct}%` : job ? "Imported" : "Run import"}</Button>
          </div>}>
          <div className="ui-stack">
            <div className="ui-filterbar" role="group" aria-label="Object">
              <div className="ui-filterbar__chips">
                {match.available_modules.map((m) => (
                  <Chip key={m.value} selected={module === m.value} onClick={() => setModule(m.value)}>{m.label}</Chip>
                ))}
              </div>
            </div>
            {noHeaders ? <Banner tone="warning" title="Columns cannot be previewed for this format">Pick the object above; the columns are read from the file when it imports.</Banner> : null}
            {match.unmapped_required.length ? <Banner tone="warning" title={`${match.unmapped_required.length} required fields have no column`}>{match.unmapped_required.join(", ")}. Checks that need them are skipped.</Banner> : null}
            {match.mappings.length ? (
              <div className="ui-matrix-scroll">
                <table className="ui-mini-table">
                  <thead><tr><th>Your column</th><th>Standard field</th><th className="aurora-number">Confidence</th><th>Match</th></tr></thead>
                  <tbody>
                    {match.mappings.slice(0, 14).map((m) => (
                      <tr key={m.source_column}>
                        <td>{m.source_column}</td>
                        <td>{m.target_field ? <Mono>{m.target_field}</Mono> : <span className="ui-note">Not mapped</span>}{m.is_required ? " (required)" : ""}</td>
                        <td className="aurora-number">{Math.round(m.confidence * 100)}%</td>
                        <td><StatusBadge status={m.confidence >= 0.85 ? "ok" : m.confidence >= 0.6 ? "low" : "medium"}>{cap(m.match_type)}</StatusBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Recent imports" meta={versions.length || undefined} flush>
        {versions.length || recent.isLoading
          ? <DataTable columns={columns} data={versions} getRowId={(v) => v.id} ariaLabel="Recent imports" maxHeight="48vh" empty="Loading imports" />
          : <EmptyState>Nothing imported yet. Every import becomes a version you can analyse, compare and set as a baseline.</EmptyState>}
      </SectionCard>
    </div>
  );
}
