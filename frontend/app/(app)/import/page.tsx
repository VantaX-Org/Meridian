"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, Mono, Pill, Stat, type PillTone } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getSystems } from "@/lib/api/systems";
import { matchColumns, pollAnalysisStatus, uploadFile, type MatchResponse } from "@/lib/api/upload";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName, labelOf, relativeTime } from "@/lib/format";
import { formatSize, readHeaderSample } from "@/lib/upload-preview";
import type { Version } from "@/types/api";

const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xls,.json,.parquet";
const TERMINAL = new Set(["complete", "agents_complete", "ai_enriched", "failed", "agents_failed"]);

type Job = { versionId: string; status: "queued" | "processing" | "completed" | "failed"; percent: number; step: string; error: string | null };

function versionDqs(v: Version): number | null {
  const scores = Object.values(v.dqs_summary ?? {}).map((m) => m.composite_score);
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

  const systemsQ = useQuery({ queryKey: ["systems.list"], queryFn: getSystems, staleTime: 60_000 });
  const recent = useQuery({
    queryKey: ["versions.list", { limit: 50 }],
    queryFn: () => getVersions({ limit: 50 }),
    refetchInterval: (q) => (q.state.data?.versions.some((v) => !TERMINAL.has(v.status)) ? 5000 : false),
  });

  const matchMut = useMutation({
    mutationFn: async (f: File) => {
      const { headers, sample } = await readHeaderSample(f);
      return { res: await matchColumns(headers, sample, f.name), parsed: headers.length > 0 };
    },
    onSuccess: ({ res, parsed }) => { setMatch(res); setTargetModule(parsed ? res.detected_module : null); },
    onError: (e) => toast.error((e as Error).message || "Could not read the file"),
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
      setJob({ versionId: up.version_id, status: "queued", percent: 0, step: "Queued", error: null });
      const final = await pollAnalysisStatus(up.version_id, (s) => setJob({
        versionId: up.version_id, status: s.status, percent: s.progress?.percent_complete ?? 0,
        step: s.progress?.current_step || s.status, error: s.error ?? null,
      }));
      return final;
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["versions.list"] });
      if (s.status === "completed") toast.success("Import analysed"); else toast.error(s.error || "Analysis failed");
    },
    onError: (e) => { toast.error((e as Error).message || "Import failed"); setJob((j) => j ? { ...j, status: "failed", error: (e as Error).message } : null); },
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
    { id: "rows", header: "Records", cell: ({ row }) => row.original.metadata?.row_count?.toLocaleString() ?? "" },
    { id: "dqs", header: "Score", cell: ({ row }) => { const d = versionDqs(row.original); return d === null ? "" : d.toFixed(1); } },
    { id: "status", header: "Status", cell: ({ row }) => <Pill tone={versionTone(row.original.status)}>{labelOf(row.original.status)}</Pill> },
    { id: "when", header: "Imported", cell: ({ row }) => relativeTime(row.original.run_at) },
  ], []);
  const versions = (recent.data?.versions ?? []).filter((v) => v.metadata?.source !== "extraction");
  const rowsImported = versions.reduce((a, v) => a + (v.metadata?.row_count ?? 0), 0);

  const fileNote = matchMut.isPending ? "Reading the columns"
    : match ? `${formatSize(file?.size ?? 0)}, looks like ${match.module_label} (${Math.round(match.module_confidence * 100)}% sure), ${mapped} columns mapped`
    : file ? formatSize(file.size) : "";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
        Drop an extract, check how its columns map to standard SAP fields, then run the analysis. Every import becomes a version.
      </p>
      {systemsQ.data?.length ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          {systemsQ.data.length} SAP {systemsQ.data.length === 1 ? "system is" : "systems are"} connected. Pulling objects straight
          from a system keeps versions comparable run to run. File imports suit one-off assessments.{" "}
          <Link href="/systems" className="underline">Download from the source</Link>
        </p>
      ) : null}
      {versions.length > 0 ? (
        <div className="flex gap-6">
          <Stat label="Files imported" value={versions.length} />
          <Stat label="Records imported" value={rowsImported.toLocaleString()} />
          <Stat label="Last import" value={versions[0] ? relativeTime(versions[0].run_at) : "—"} />
        </div>
      ) : null}

      <label
        className="flex flex-col gap-2 rounded border p-6 text-center cursor-pointer"
        style={{ borderColor: dragging ? "var(--m-accent)" : "var(--m-line)" }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (canUpload) pick(e.dataTransfer.files?.[0] ?? null); }}
      >
        <input ref={inputRef} type="file" accept={ACCEPT} disabled={!canUpload} onChange={(e) => pick(e.target.files?.[0] ?? null)} hidden />
        <strong>{file ? file.name : canUpload ? "Drop a file here, or click to choose one" : "Importing needs the upload permission"}</strong>
        <span className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>{file ? fileNote : "CSV, TSV, XLSX, XLS, JSON or Parquet, up to 2 GB"}</span>
      </label>

      {job && job.status !== "completed" && job.status !== "failed" ? (
        <p className="text-[13px]">{job.step.replace(/_/g, " ")}</p>
      ) : run.isPending && !job ? (
        <p className="text-[13px]">Uploading {uploadPct}%</p>
      ) : null}
      {job?.error ? (
        <div role="alert" className="rounded border px-3 py-2 text-[13px]" style={{ borderColor: "var(--m-critical)", color: "var(--m-critical)" }}>
          Analysis failed: {job.error}
        </div>
      ) : null}
      {job?.status === "completed" ? <Link href={`/runs/${job.versionId}`} className="underline">Open the run</Link> : null}

      {match ? (
        <div className="flex flex-col gap-3 rounded border p-4" style={{ borderColor: "var(--m-line)" }}>
          <div className="flex items-center justify-between">
            <strong>Column mapping{match.mappings.length ? ` — ${mapped} of ${match.mappings.length} mapped` : ""}</strong>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={clear}>Clear</Button>
              <Button onClick={() => run.mutate()} disabled={!canRun}>{run.isPending ? `Uploading ${uploadPct}%` : job ? "Imported" : "Run import"}</Button>
            </div>
          </div>
          <div className="flex gap-2" role="group" aria-label="Object">
            {match.available_modules.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setTargetModule(m.value)}
                aria-pressed={targetModule === m.value}
                className="px-2 py-0.5 text-[12px] rounded-full border"
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
            <div role="alert" className="rounded border px-3 py-2 text-[13px]" style={{ borderColor: "var(--m-medium)", color: "var(--m-medium)" }}>
              Columns cannot be previewed for this format. Pick the object above; the columns are read from the file when it imports.
            </div>
          ) : null}
          {match.unmapped_required.length ? (
            <div role="alert" className="rounded border px-3 py-2 text-[13px]" style={{ borderColor: "var(--m-medium)", color: "var(--m-medium)" }}>
              {match.unmapped_required.length} required fields have no column: {match.unmapped_required.join(", ")}. Checks that need them are skipped.
            </div>
          ) : null}
          {match.mappings.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left" style={{ color: "var(--m-ink-3)" }}>
                    <th className="py-1">Your column</th><th className="py-1">Standard field</th><th className="py-1 text-right">Confidence</th><th className="py-1">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {match.mappings.slice(0, 14).map((m) => (
                    <tr key={m.source_column} className="border-t" style={{ borderColor: "var(--m-line)" }}>
                      <td className="py-1">{m.source_column}</td>
                      <td className="py-1">{m.target_field ? <Mono>{m.target_field}</Mono> : <span style={{ color: "var(--m-ink-3)" }}>Not mapped</span>}{m.is_required ? " (required)" : ""}</td>
                      <td className="py-1 text-right">{Math.round(m.confidence * 100)}%</td>
                      <td className="py-1"><Pill tone={confidenceTone(m.confidence)}>{labelOf(m.match_type)}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <strong>Recent imports</strong>
        {versions.length || recent.isLoading ? (
          <DataTable columns={columns} data={versions} getRowId={(v) => v.id} />
        ) : (
          <EmptyState title="Nothing imported yet. Every import becomes a version you can analyse, compare and set as a baseline." />
        )}
      </div>
    </div>
  );
}
