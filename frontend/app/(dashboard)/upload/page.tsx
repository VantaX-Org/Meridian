"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHead, SectionHeader, ModChip, StatusDot } from "@/components/meridian/atoms";
import {
  ArrowRight,
  FileTextIcon,
  MoreH,
  UploadCloudIcon,
} from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  matchColumns,
  pollAnalysisStatus,
  uploadFile,
  type MatchResponse,
} from "@/lib/api/upload";
import { getVersions } from "@/lib/api/versions";
import { copyToClipboard } from "@/components/meridian/actions";
import { relativeTime } from "@/lib/format";
import type { Version } from "@/types/api";

const TYPE_PALETTE: Record<string, { bg: string; fg: string; l: string }> = {
  csv:  { bg: "var(--mn-pos-bg)",      fg: "var(--mn-pos)",         l: "CSV" },
  xlsx: { bg: "var(--mn-primary-50)",  fg: "var(--mn-primary-700)", l: "XLSX" },
  xls:  { bg: "var(--mn-primary-50)",  fg: "var(--mn-primary-700)", l: "XLS" },
  json: { bg: "rgba(124,58,237,0.12)", fg: "#7C3AED",               l: "JSON" },
  parquet: { bg: "var(--mn-warn-bg)",  fg: "var(--mn-warn)",        l: "PARQ" },
};

const STAGES = [
  { k: "source",  l: "1. Source",  d: "File or stream" },
  { k: "preview", l: "2. Preview", d: "Schema + sample" },
  { k: "mapping", l: "3. Mapping", d: "Map to canonical" },
  { k: "run",     l: "4. Run",     d: "Ingest + validate" },
] as const;

// Version statuses that are settled — anything else is still being analysed
// and the recent-imports list should keep polling until it lands here.
const TERMINAL_VERSION_STATUSES: string[] = [
  "complete",
  "agents_complete",
  "ai_enriched",
  "failed",
  "agents_failed",
];

function paletteFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "csv";
  return TYPE_PALETTE[ext] ?? TYPE_PALETTE.csv;
}

/** Mean composite DQS across a version's modules — null until it is scored. */
function versionDqs(v: Version): number | null {
  const summary = v.dqs_summary;
  if (!summary) return null;
  const scores = Object.values(summary).map((m) => m.composite_score);
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

/** Colour band for a DQS value — mirrors the platform's 85 / 70 cap thresholds. */
function dqsColor(dqs: number): string {
  if (dqs >= 85) return "var(--mn-pos)";
  if (dqs >= 70) return "var(--mn-warn)";
  return "var(--mn-neg)";
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

/* Light-weight CSV/TSV preview parser. Handles double-quote escapes but
   does not support multi-line quoted cells — fine for header detection. */
function parseCsvPreview(text: string, maxRows = 6): string[][] {
  const sep = text.includes("\t") && !text.includes(",") ? "\t" : ",";
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0).slice(0, maxRows + 1);
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        quoted = !quoted;
      } else if (ch === sep && !quoted) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  });
}

async function readHeaderSample(file: File): Promise<{ headers: string[]; sample: string[][] }> {
  const name = file.name.toLowerCase();

  // CSV / TSV / TXT — parse the first 32 KB as delimited text.
  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    const text = await file.slice(0, 32 * 1024).text();
    const rows = parseCsvPreview(text, 6);
    if (rows.length === 0) return { headers: [], sample: [] };
    const [headers, ...sample] = rows;
    return { headers, sample };
  }

  // XLSX / XLS — read the first worksheet with SheetJS. Loaded on demand so
  // the library only enters the bundle when a workbook is actually picked.
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) return { headers: [], sample: [] };
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
      }) as unknown[][];
      if (rows.length === 0) return { headers: [], sample: [] };
      const headers = (rows[0] ?? []).map((c) => String(c ?? "").trim());
      const sample = rows.slice(1, 7).map((r) => (r ?? []).map((c) => String(c ?? "")));
      return { headers, sample };
    } catch {
      return { headers: [], sample: [] };
    }
  }

  // JSON / Parquet — cannot be previewed in the browser. The backend reads
  // the schema from the file itself once uploaded.
  return { headers: [], sample: [] };
}

interface UploadJob {
  versionId: string;
  taskId: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  error: string | null;
}

export default function UploadPage() {
  const qc = useQueryClient();

  // ── Selection state
  const [file, setFile] = useState<File | null>(null);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [moduleOverride, setModuleOverride] = useState<string | null>(null);

  // ── Pipeline state
  const [uploadPct, setUploadPct] = useState(0);
  const [job, setJob] = useState<UploadJob | null>(null);

  const matchMut = useMutation({
    mutationFn: async (f: File) => {
      // CSV/XLSX headers are parsed in-browser; JSON/Parquet come back empty.
      // Either way we hit the match endpoint — with no headers it still returns
      // the full module catalogue so the user can pick the module by hand.
      const { headers, sample } = await readHeaderSample(f);
      const result = await matchColumns(headers, sample, f.name);
      return { ...result, parsedHeaders: headers.length };
    },
    onSuccess: ({ parsedHeaders, ...resp }) => {
      setMatch(resp);
      // Only trust auto-detection when we actually had headers to match on.
      setModuleOverride(parsedHeaders > 0 ? resp.detected_module : null);
    },
  });

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const module = moduleOverride ?? match?.detected_module ?? "";
      if (!module) throw new Error("No module selected");
      setUploadPct(0);
      const response = await uploadFile(
        file,
        module,
        null,
        (pct) => setUploadPct(pct),
      );
      return response;
    },
    onSuccess: async (resp) => {
      setJob({
        versionId: resp.version_id,
        taskId: resp.job_id,
        status: "queued",
        progress: 0,
        error: null,
      });
      try {
        await pollAnalysisStatus(resp.version_id, (data) => {
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  status: data.status,
                  progress: data.progress.percent_complete ?? 0,
                  error: data.error,
                }
              : prev,
          );
        });
        qc.invalidateQueries({ queryKey: ["reports.versions"] });
        qc.invalidateQueries({ queryKey: ["versions.list"] });
      } catch (err) {
        setJob((prev) =>
          prev ? { ...prev, status: "failed", error: (err as Error).message } : prev,
        );
      }
    },
  });

  const recentQ = useQuery({
    queryKey: ["versions.list", { limit: 6 }],
    queryFn: () => getVersions({ limit: 6 }),
    // While any recent import is still being analysed, poll so its row
    // settles from "under review" to its final status on its own.
    refetchInterval: (query) => {
      const vs = query.state.data?.versions ?? [];
      const stillProcessing = vs.some((v) => !TERMINAL_VERSION_STATUSES.includes(v.status));
      return stillProcessing ? 5000 : false;
    },
  });

  // When a new file is picked, kick off column detection.
  useEffect(() => {
    if (!file) return;
    setMatch(null);
    setModuleOverride(null);
    setJob(null);
    setUploadPct(0);
    matchMut.mutate(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const onPickFile = useCallback((f: File) => setFile(f), []);

  const stage: (typeof STAGES)[number]["k"] = !file
    ? "source"
    : match
      ? job
        ? "run"
        : "mapping"
      : "preview";
  const stageIdx = STAGES.findIndex((s) => s.k === stage);

  // Per-step state for the pipeline tracker. Once the run job reaches a
  // terminal status the "Run" step must settle to done/failed — otherwise
  // it stays stuck on the orange "active" state forever.
  const stepClass = (k: string, i: number): "active" | "done" | "failed" | "" => {
    if (job?.status === "completed") return "done";
    if (k === "run" && job?.status === "failed") return "failed";
    if (stage === k) return "active";
    if (i < stageIdx) return "done";
    return "";
  };

  const versions = recentQ.data?.versions ?? [];

  // A matched file with zero column mappings means the browser could not read
  // a header row (JSON / Parquet). The module is picked by hand instead.
  const noHeaders = match !== null && match.mappings.length === 0;

  return (
    <>
      <PageHead
        title="Import"
        route="Analyse · /import"
        sub={
          file
            ? `Staged · ${file.name} · ${formatSize(file.size)}`
            : "Drop a file to start. CSV, XLSX, JSON or Parquet — up to 2 GB."
        }
        actions={
          <>
            <button
              type="button"
              className="mn-btn mn-btn-ghost"
              onClick={() => {
                setFile(null);
                setMatch(null);
                setJob(null);
              }}
              disabled={!file}
            >
              Clear
            </button>
            <button
              type="button"
              className="mn-btn mn-btn-primary"
              onClick={() => uploadMut.mutate()}
              disabled={!file || !match || !moduleOverride || uploadMut.isPending || !!job}
            >
              {uploadMut.isPending ? `Uploading… ${uploadPct}%` : "Run import"} <ArrowRight size={13} />
            </button>
          </>
        }
      />

      {/* Drop area + stepper */}
      <div className="mn-row mn-row-12" style={{ marginBottom: 18 }}>
        <div className="mn-col-7" style={{ gridColumn: "span 7" }}>
          <FileDropZone selectedFile={file} onPickFile={onPickFile} />
        </div>
        <div className="mn-col-5" style={{ gridColumn: "span 5" }}>
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader title="Pipeline" caption="Steps the file passes through" />
            <ol className="mn-stepper">
              {STAGES.map((s, i) => {
                const cls = stepClass(s.k, i);
                return (
                  <li key={s.k} className={cls}>
                    <span className="dot">
                      {cls === "done" ? "✓" : cls === "failed" ? "✕" : i + 1}
                    </span>
                    <div>
                      <div className="lbl">{s.l}</div>
                      <div className="d">{s.d}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>

      {/* Schema preview */}
      {file && (
        <>
          <SectionHeader
            title={`Staging · ${file.name}`}
            caption={
              matchMut.isPending
                ? "Detecting module…"
                : matchMut.error
                  ? "Could not reach the column-matching service."
                  : noHeaders
                    ? "No header row to preview — choose the module on the right, then run the import."
                    : match
                      ? `${match.module_label} · ${Math.round(match.module_confidence * 100)}% confidence · ${match.mappings.length} columns mapped`
                      : "Awaiting detection."
            }
          />
          <div className="mn-row mn-row-12" style={{ marginBottom: 18 }}>
            <div className="mn-col-8">
              <div className="mn-card mn-card-pad">
                <SectionHeader title="Detected schema" caption="Source → canonical mapping" />
                {matchMut.isPending && <Skeleton className="h-40 rounded-[10px] mt-2" />}
                {matchMut.error && (
                  <div
                    className="mn-narrative"
                    style={{ marginTop: 10, padding: 10, borderLeftColor: "var(--mn-warn)" }}
                  >
                    <div className="ico" style={{ background: "var(--mn-warn-bg)", color: "var(--mn-warn)" }}>!</div>
                    <div style={{ flex: 1, fontSize: 12.5, color: "var(--mn-ink-700)" }}>
                      {(matchMut.error as Error).message}
                    </div>
                  </div>
                )}
                {!matchMut.isPending && !matchMut.error && noHeaders && (
                  <div
                    className="mn-narrative"
                    style={{ marginTop: 10, padding: 10 }}
                  >
                    <div className="ico"><FileTextIcon size={13} /></div>
                    <div style={{ flex: 1, fontSize: 12.5, color: "var(--mn-ink-700)" }}>
                      This file type has no header row the browser can preview. Pick the
                      module on the right — the backend reads the column schema from the
                      file itself when you run the import.
                    </div>
                  </div>
                )}
                {match && match.mappings.length > 0 && (
                  <div className="mn-table-wrap" style={{ marginTop: 8 }}>
                    <table className="mn-table">
                      <thead>
                        <tr>
                          <th style={{ paddingLeft: 0 }}>Source</th>
                          <th></th>
                          <th>Canonical</th>
                          <th>Confidence</th>
                          <th>Match</th>
                          <th>Required</th>
                        </tr>
                      </thead>
                      <tbody>
                        {match.mappings.slice(0, 12).map((m) => (
                          <tr key={m.source_column}>
                            <td>
                              <span
                                className="mn-tabular"
                                style={{
                                  font: "600 12px/1 'JetBrains Mono', monospace",
                                  color: "var(--mn-ink-700)",
                                }}
                              >
                                {m.source_column}
                              </span>
                            </td>
                            <td>
                              <ArrowRight size={12} style={{ color: "var(--mn-ink-300)" }} />
                            </td>
                            <td>
                              {m.target_field ? (
                                <span
                                  className="mn-tabular"
                                  style={{
                                    font: "500 12px/1 'JetBrains Mono', monospace",
                                    color: "var(--mn-primary-700)",
                                  }}
                                >
                                  {m.target_field}
                                </span>
                              ) : (
                                <span style={{ color: "var(--mn-ink-300)" }}>unmapped</span>
                              )}
                            </td>
                            <td
                              className="mn-tabular"
                              style={{
                                color:
                                  m.confidence >= 0.85
                                    ? "var(--mn-pos)"
                                    : m.confidence >= 0.6
                                      ? "var(--mn-primary)"
                                      : "var(--mn-warn)",
                              }}
                            >
                              {Math.round(m.confidence * 100)}%
                            </td>
                            <td>
                              <ModChip>{m.match_type}</ModChip>
                            </td>
                            <td>
                              {m.is_required ? (
                                <span style={{ color: "var(--mn-warn)", fontSize: 12 }}>Yes</span>
                              ) : (
                                <span style={{ color: "var(--mn-ink-300)" }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            <div className="mn-col-4">
              <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
                <SectionHeader
                  title="Module"
                  caption={noHeaders ? "Select the module for this file" : "Detected or overridden"}
                />
                {match ? (
                  <div className="mn-segment" style={{ marginTop: 12, flexWrap: "wrap" }}>
                    {match.available_modules.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        className={moduleOverride === m.value ? "on" : ""}
                        onClick={() => setModuleOverride(m.value)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "var(--mn-ink-400)", marginTop: 12, fontSize: 13 }}>
                    Awaiting detection.
                  </p>
                )}

                {match && match.unmapped_required.length > 0 && (
                  <div className="mn-detail-section">
                    <div className="mn-eyebrow">Unmapped required</div>
                    <div className="mn-chip-row" style={{ marginTop: 8 }}>
                      {match.unmapped_required.map((c) => (
                        <span
                          key={c}
                          style={{
                            display: "inline-flex",
                            padding: "3px 7px",
                            borderRadius: 3,
                            background: "var(--mn-warn-bg)",
                            color: "var(--mn-warn)",
                            font: "600 11px/1 'JetBrains Mono', monospace",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {job && (
                  <div style={{ marginTop: 18 }}>
                    <div className="mn-eyebrow">Job · {job.versionId.slice(0, 8)}</div>
                    <div
                      style={{
                        marginTop: 10,
                        padding: 12,
                        borderRadius: 8,
                        background:
                          job.status === "completed"
                            ? "var(--mn-pos-bg)"
                            : job.status === "failed"
                              ? "var(--mn-neg-bg)"
                              : "var(--mn-primary-50)",
                        color:
                          job.status === "completed"
                            ? "var(--mn-pos)"
                            : job.status === "failed"
                              ? "var(--mn-neg)"
                              : "var(--mn-primary-700)",
                        fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{job.status.toUpperCase()}</div>
                      <div style={{ marginTop: 4 }}>
                        {job.error ?? `${Math.round(job.progress)}% complete`}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <SectionHeader title="Recent imports" caption="Last 6 versions" />
      <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
        {recentQ.isLoading ? (
          <div style={{ padding: 16 }}>
            <Skeleton className="h-12 rounded-[10px] mb-2" />
            <Skeleton className="h-12 rounded-[10px] mb-2" />
            <Skeleton className="h-12 rounded-[10px]" />
          </div>
        ) : recentQ.error ? (
          <div className="mn-card-pad" style={{ color: "var(--mn-neg)" }}>
            Could not reach <code>/api/v1/versions</code>.
          </div>
        ) : (
          <div className="mn-table-wrap">
            <table className="mn-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>File</th>
                  <th>Modules</th>
                  <th className="right">Rows</th>
                  <th className="right">DQS</th>
                  <th>Status</th>
                  <th>At</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v: Version) => {
                  const fileName = v.metadata?.file_name ?? v.label ?? "—";
                  const pal = paletteFor(fileName);
                  const modules = v.metadata?.modules ?? [];
                  return (
                    <tr key={v.id}>
                      <td style={{ paddingLeft: 20 }}>
                        <Link
                          href={`/findings?version_id=${v.id}`}
                          className="ico-cell"
                          style={{ color: "inherit" }}
                          title="View findings for this import"
                        >
                          <span
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: 6,
                              background: pal.bg,
                              color: pal.fg,
                              display: "grid",
                              placeItems: "center",
                            }}
                          >
                            <FileTextIcon size={14} />
                          </span>
                          <span className="module" style={{ color: "var(--mn-primary-700)" }}>
                            {fileName}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span
                          className="mn-tabular"
                          style={{
                            font: "500 11.5px/1 'JetBrains Mono', monospace",
                            color: "var(--mn-ink-500)",
                          }}
                        >
                          {modules.length > 0 ? modules.join(" · ") : "—"}
                        </span>
                      </td>
                      <td className="right mn-tabular">
                        {v.metadata?.row_count?.toLocaleString() ?? "—"}
                      </td>
                      <td className="right">
                        {(() => {
                          const dqs = versionDqs(v);
                          return dqs === null ? (
                            <span style={{ color: "var(--mn-ink-300)" }}>—</span>
                          ) : (
                            <span
                              className="mn-tabular"
                              style={{ font: "600 13px/1 'Inter Tight'", color: dqsColor(dqs) }}
                            >
                              {dqs}
                            </span>
                          );
                        })()}
                      </td>
                      <td>
                        <StatusDot
                          status={
                            v.status === "complete" || v.status === "agents_complete" || v.status === "ai_enriched"
                              ? "healthy"
                              : v.status === "failed" || v.status === "agents_failed"
                                ? "down"
                                : "in-review"
                          }
                        />
                      </td>
                      <td
                        className="mn-tabular"
                        style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                      >
                        {relativeTime(v.run_at)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="mn-icon-btn"
                          style={{ width: 26, height: 26 }}
                          aria-label="Copy version ID"
                          onClick={() => copyToClipboard(v.id, "Version ID copied")}
                        >
                          <MoreH size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {versions.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                      No imports yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Drop zone ────────────────────────────────────────────────────── */
function FileDropZone({
  selectedFile,
  onPickFile,
}: {
  selectedFile: File | null;
  onPickFile: (f: File) => void;
}) {
  const [hover, setHover] = useState(false);
  const accept = ".csv,.tsv,.txt,.xlsx,.xls,.json,.parquet";

  return (
    <label
      className="mn-import-drop"
      style={{ cursor: "pointer", borderColor: hover ? "var(--mn-primary)" : undefined }}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPickFile(f);
      }}
    >
      <div className="mn-import-drop-icon"><UploadCloudIcon size={28} /></div>
      <div className="mn-import-drop-h">
        {selectedFile ? selectedFile.name : "Drop a file to begin"}
      </div>
      <p className="mn-import-drop-sub">
        {selectedFile
          ? `${formatSize(selectedFile.size)} · last modified ${new Date(selectedFile.lastModified).toLocaleString()}`
          : "CSV · XLSX · JSON · Parquet — up to 2 GB."}
      </p>
      <div className="mn-import-formats">
        {Object.entries(TYPE_PALETTE).map(([k, t]) => (
          <span key={k} className="mn-import-fmt" style={{ background: t.bg, color: t.fg }}>
            {t.l}
          </span>
        ))}
      </div>
      <input
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickFile(f);
        }}
      />
    </label>
  );
}
