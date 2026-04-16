"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import Link from "next/link";
import {
  Upload,
  FileUp,
  CheckCircle,
  AlertTriangle,
  X,
  Info,
  Sparkles,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import {
  uploadFile,
  matchColumns,
  pollAnalysisStatus,
  getAnalysisStatus,
  type AnalysisStatusResponse,
  type ColumnMapping,
  type MatchResponse,
} from "@/lib/api/upload";
import { getVersion } from "@/lib/api/versions";
import { getReportDownloadUrl, getReportJsonExportUrl } from "@/lib/api/reports";
import { getConfigMatchesExportUrl } from "@/lib/api/config-matches";
import { getSystems } from "@/lib/api/systems";
import { scoreColor, formatModuleName } from "@/lib/format";
import type { Version } from "@/types/api";
import {
  AnalysisProgressBar,
  type AnalysisStatusData,
} from "@/components/upload/analysis-progress-bar";

const ACTIVE_TASK_STORAGE_KEY = "meridian:active-analysis-task";

const ACCEPTED = ".csv,.xlsx,.xls";
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

type Step = "select" | "matching" | "review" | "uploading" | "analysing" | "complete" | "error";

/* ─── Helpers ─── */

function confidenceBadge(confidence: number, matchType: string) {
  if (matchType === "exact" || matchType === "alias" || matchType === "short_name") {
    return (
      <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-700 text-[11px]">
        {matchType === "exact" ? "Exact match" : matchType === "alias" ? "Known alias" : "Short name"}
      </Badge>
    );
  }
  if (matchType === "ai" && confidence >= 0.8) {
    return (
      <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-[11px]">
        <Sparkles className="mr-1 h-3 w-3" /> AI match
      </Badge>
    );
  }
  if (matchType === "ai" && confidence >= 0.5) {
    return (
      <Badge variant="outline" className="border-yellow-500/30 bg-yellow-500/10 text-yellow-700 text-[11px]">
        <Sparkles className="mr-1 h-3 w-3" /> AI (low conf.)
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-700 text-[11px]">
      Unmapped
    </Badge>
  );
}

function confidenceDot(confidence: number) {
  if (confidence >= 0.8) return <span className="inline-block h-2 w-2 rounded-full bg-green-500" />;
  if (confidence >= 0.5) return <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />;
  return <span className="inline-block h-2 w-2 rounded-full bg-red-500" />;
}

async function readFileHeaders(
  file: File
): Promise<{ headers: string[]; rows: string[][] }> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "xlsx" || ext === "xls") {
      // Use dynamic import for SheetJS
      import("xlsx").then((XLSX) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
          const headers = (json[0] || []).map((h) => String(h).trim());
          const rows = json.slice(1, 6).map((row) =>
            (row as string[]).map((c) => String(c ?? "").trim())
          );
          resolve({ headers, rows });
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file.slice(0, 512 * 1024));
      }).catch(() => {
        // Fallback: treat as CSV
        readCsvHeaders(file).then(resolve).catch(reject);
      });
      return;
    }

    // CSV
    readCsvHeaders(file).then(resolve).catch(reject);
  });
}

function readCsvHeaders(
  file: File
): Promise<{ headers: string[]; rows: string[][] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const rows = lines.slice(1, 6).map((l) =>
        l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
      );
      resolve({ headers, rows });
    };
    reader.onerror = reject;
    reader.readAsText(file.slice(0, 50 * 1024));
  });
}

/* ─── Component ─── */

export default function UploadPage() {
  const [step, setStep] = useState<Step>("select");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [analysisStatus, setAnalysisStatus] =
    useState<AnalysisStatusResponse | null>(null);
  const [resumedFileName, setResumedFileName] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [version, setVersion] = useState<Version | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const elapsedStartRef = useRef<number>(0);

  // Mapping state
  const [matchResult, setMatchResult] = useState<MatchResponse | null>(null);
  const [selectedModule, setSelectedModule] = useState("");
  const [editedMappings, setEditedMappings] = useState<ColumnMapping[]>([]);

  const { data: systems } = useQuery({
    queryKey: ["systems"],
    queryFn: getSystems,
    staleTime: 60_000,
  });
  const hasConnectedSystems = (systems?.length ?? 0) > 0;

  const reset = () => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY);
      } catch {
        /* ignore storage errors */
      }
    }
    setStep("select");
    setFile(null);
    setProgress(0);
    setAnalysisStatus(null);
    setResumedFileName(null);
    setElapsed(0);
    setVersion(null);
    setErrorMsg("");
    setMatchResult(null);
    setSelectedModule("");
    setEditedMappings([]);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.size <= MAX_SIZE) setFile(f);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && f.size <= MAX_SIZE) setFile(f);
  };

  // ── Step 1 → Step 2: Detect & Map ──
  const detectAndMap = async () => {
    if (!file) return;
    setStep("matching");
    try {
      const { headers, rows } = await readFileHeaders(file);
      const result = await matchColumns(headers, rows, file.name);
      setMatchResult(result);
      setSelectedModule(result.detected_module);
      setEditedMappings(result.mappings);
      setStep("review");
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Column detection failed"
      );
      setStep("error");
    }
  };

  // Re-match when module changes
  const onModuleChange = async (newModule: string) => {
    if (!file || !matchResult || newModule === selectedModule) return;
    setSelectedModule(newModule);
    setStep("matching");
    try {
      const { headers, rows } = await readFileHeaders(file);
      const result = await matchColumns(headers, rows, file.name, newModule);
      setMatchResult(result);
      setSelectedModule(result.detected_module);
      setEditedMappings(result.mappings);
      setStep("review");
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Re-matching failed"
      );
      setStep("error");
    }
  };

  // Update a single mapping's target field
  const updateMapping = (index: number, newTarget: string | null) => {
    setEditedMappings((prev) => {
      const next = [...prev];
      const targetFields = matchResult
        ? new Set(
            matchResult.available_modules
              .find((m) => m.value === selectedModule)
              ? Array.from(
                  matchResult.mappings
                    .filter((m) => m.is_required)
                    .map((m) => m.target_field)
                    .filter(Boolean)
                )
              : []
          )
        : new Set<string>();

      next[index] = {
        ...next[index],
        target_field: newTarget,
        confidence: newTarget ? 1.0 : 0.0,
        match_type: newTarget ? "manual" : "unmatched",
        is_required: newTarget ? targetFields.has(newTarget) : false,
      };
      return next;
    });
  };

  const runAnalysisPolling = useCallback(
    async (versionId: string, fileName: string | null, startedAtMs: number) => {
      pollAbortRef.current?.abort();
      const pollAc = new AbortController();
      pollAbortRef.current = pollAc;

      // Persist the active task so a refresh or accidental navigation resumes.
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            ACTIVE_TASK_STORAGE_KEY,
            JSON.stringify({
              version_id: versionId,
              file_name: fileName,
              started_at: startedAtMs,
            }),
          );
        } catch {
          /* ignore storage errors */
        }
      }

      elapsedStartRef.current = startedAtMs;
      setElapsed(Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)));
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setElapsed(
          Math.max(0, Math.round((Date.now() - elapsedStartRef.current) / 1000)),
        );
      }, 1000);

      try {
        // Seed the bar immediately so it does not flash empty.
        try {
          const initial = await getAnalysisStatus(versionId);
          setAnalysisStatus(initial);
        } catch {
          /* first call can fail — polling will recover */
        }

        const final = await pollAnalysisStatus(
          versionId,
          (data) => setAnalysisStatus(data),
          { pollIntervalMs: 2_000, signal: pollAc.signal },
        );

        if (timerRef.current) clearInterval(timerRef.current);

        if (final.status === "completed") {
          try {
            const v = await getVersion(versionId);
            setVersion(v);
          } catch (err) {
            console.warn("Failed to fetch version after completion", err);
          }
          setStep("complete");
          if (typeof window !== "undefined") {
            try {
              window.localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY);
            } catch {
              /* ignore */
            }
          }
        } else {
          setErrorMsg(final.error || "Analysis failed");
          setStep("error");
        }
      } catch (err: unknown) {
        if (timerRef.current) clearInterval(timerRef.current);
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErrorMsg(
          err instanceof Error ? err.message : "Analysis polling failed",
        );
        setStep("error");
      }
    },
    [],
  );

  // ── Step 2 → Upload: Approve & Start ──
  const approveAndStart = async () => {
    if (!file || !selectedModule) return;
    const ac = new AbortController();
    abortRef.current = ac;

    // Build column_mapping: { source_header: TARGET.FIELD }
    const columnMapping: Record<string, string> = {};
    for (const m of editedMappings) {
      if (m.target_field) {
        columnMapping[m.source_column] = m.target_field;
      }
    }

    try {
      setStep("uploading");
      const { version_id } = await uploadFile(
        file,
        selectedModule,
        Object.keys(columnMapping).length > 0 ? columnMapping : null,
        setProgress,
        ac.signal,
      );

      setStep("analysing");
      setAnalysisStatus(null);
      await runAnalysisPolling(version_id, file.name, Date.now());
    } catch (err: unknown) {
      if (timerRef.current) clearInterval(timerRef.current);
      if (err instanceof Error && err.name === "CanceledError") {
        reset();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setStep("error");
    }
  };

  // Resume an active task after a page refresh or navigation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(ACTIVE_TASK_STORAGE_KEY);
    } catch {
      return;
    }
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored) as {
        version_id?: string;
        file_name?: string | null;
        started_at?: number;
      };
      if (!parsed.version_id) {
        window.localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY);
        return;
      }
      setResumedFileName(parsed.file_name ?? null);
      setStep("analysing");
      void runAnalysisPolling(
        parsed.version_id,
        parsed.file_name ?? null,
        parsed.started_at ?? Date.now(),
      );
    } catch {
      try {
        window.localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      pollAbortRef.current?.abort();
    };
  }, []);

  const progressBarData: AnalysisStatusData | null = analysisStatus
    ? {
        task_id: analysisStatus.task_id,
        status: analysisStatus.status,
        progress: analysisStatus.progress,
        result: analysisStatus.result,
        error: analysisStatus.error,
        db_status: analysisStatus.db_status,
      }
    : null;

  // Computed: all expected fields for selected module
  const allTargetFields: string[] = matchResult
    ? Array.from(
        new Set([
          ...matchResult.mappings
            .map((m) => m.target_field)
            .filter((f): f is string => f !== null),
          ...matchResult.unmapped_required,
        ])
      ).sort()
    : [];

  // Computed: unmapped required fields based on current edits
  const currentMappedTargets = new Set(
    editedMappings.map((m) => m.target_field).filter(Boolean)
  );
  const currentUnmappedRequired = matchResult
    ? matchResult.unmapped_required.filter((f) => !currentMappedTargets.has(f))
    : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Import SAP Data</h1>

      {hasConnectedSystems && (
        <Alert className="border-primary/30 bg-primary/10">
          <Info className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm text-foreground">
            Connected SAP systems detected — uploads are for one-off assessments
            only. For continuous data quality monitoring, use{" "}
            <Link href="/sync" className="font-medium text-primary underline">
              Sync Monitor
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      {/* ── Step 1: File Selection ── */}
      {step === "select" && (
        <Card>
          <CardContent className="space-y-6 py-8">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border p-12 transition-colors hover:border-primary"
            >
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drag and drop your file here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Accepts .csv, .xlsx, .xls — Maximum 100 MB
              </p>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                onChange={onFileChange}
                className="hidden"
              />
            </div>

            {file && (
              <div className="flex items-center justify-between rounded-md bg-accent p-3">
                <div className="flex items-center gap-2">
                  <FileUp className="h-4 w-4" />
                  <span className="text-sm">{file.name}</span>
                  <span className="text-xs text-muted-foreground">
                    ({(file.size / 1024 / 1024).toFixed(1)} MB)
                  </span>
                </div>
                <TooltipProvider delay={0}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setFile(null)}
                        />
                      }
                    >
                      <X className="h-4 w-4" />
                    </TooltipTrigger>
                    <TooltipContent>Remove file</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            <Button onClick={detectAndMap} disabled={!file} className="w-full">
              <Sparkles className="mr-2 h-4 w-4" />
              Detect & Map Columns
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Step 1.5: Matching in progress ── */}
      {step === "matching" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">
              Detecting module and mapping columns...
            </p>
            <p className="text-xs text-muted-foreground">
              Deterministic matching first, then AI for remaining columns
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Review Mapping ── */}
      {step === "review" && matchResult && (
        <div className="space-y-4">
          {/* Module detection header */}
          <Card>
            <CardContent className="py-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium whitespace-nowrap">
                    Detected Module
                  </label>
                  <select
                    value={selectedModule}
                    onChange={(e) => onModuleChange(e.target.value)}
                    className="rounded-md border border-border bg-accent px-3 py-1.5 text-sm"
                  >
                    {matchResult.available_modules.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  {confidenceDot(matchResult.module_confidence)}
                  <span className="text-xs text-muted-foreground">
                    {Math.round(matchResult.module_confidence * 100)}% confidence
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Mapping table */}
          <Card>
            <CardContent className="py-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Column Mapping</h3>
                <span className="text-xs text-muted-foreground">
                  {editedMappings.filter((m) => m.target_field).length} of{" "}
                  {editedMappings.length} mapped
                </span>
              </div>
              <div className="max-h-[400px] overflow-y-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-accent">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        Your Column
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        SAP Field
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                        Match
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {editedMappings.map((mapping, idx) => (
                      <tr
                        key={mapping.source_column}
                        className="border-b border-border last:border-0 hover:bg-black/[0.02]"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {mapping.source_column}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={mapping.target_field ?? "__skip__"}
                            onChange={(e) =>
                              updateMapping(
                                idx,
                                e.target.value === "__skip__"
                                  ? null
                                  : e.target.value
                              )
                            }
                            className="w-full rounded border border-border bg-white px-2 py-1 font-mono text-xs"
                          >
                            <option value="__skip__">— Skip —</option>
                            {allTargetFields.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {confidenceBadge(
                            mapping.confidence,
                            mapping.match_type
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Unmapped required fields warning */}
          {currentUnmappedRequired.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <span className="font-medium">
                  Missing required fields ({currentUnmappedRequired.length}):
                </span>{" "}
                <span className="text-xs">
                  {currentUnmappedRequired.join(", ")}
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={reset} className="flex-1">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={approveAndStart} className="flex-1">
              Approve & Start Analysis
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Uploading ── */}
      {step === "uploading" && (
        <Card>
          <CardContent className="space-y-4 py-8">
            <div className="text-center">
              <p className="text-sm font-medium">Uploading {file?.name}...</p>
              <p className="text-xs text-muted-foreground">
                {(file?.size ?? 0) / 1024 / 1024 > 0
                  ? `${((file?.size ?? 0) / 1024 / 1024).toFixed(1)} MB`
                  : ""}
              </p>
            </div>
            <Progress value={progress} className="h-3" />
            <p className="text-center text-sm text-muted-foreground">
              {progress}%
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                abortRef.current?.abort();
                reset();
              }}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Step 4: Analysing ── */}
      {step === "analysing" && (
        <Card>
          <CardContent className="py-6">
            <AnalysisProgressBar
              data={progressBarData}
              elapsedSeconds={elapsed}
              fileName={file?.name ?? resumedFileName ?? undefined}
            />
            <div className="mt-5 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  pollAbortRef.current?.abort();
                  if (timerRef.current) clearInterval(timerRef.current);
                  if (typeof window !== "undefined") {
                    try {
                      window.localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY);
                    } catch {
                      /* ignore */
                    }
                  }
                  reset();
                }}
              >
                Stop watching
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 5: Complete ── */}
      {step === "complete" && version && (
        <Card>
          <CardContent className="space-y-6 py-8 text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
            <h2 className="text-xl font-bold">Analysis Complete</h2>

            {version.dqs_summary && (
              <>
                {Object.entries(version.dqs_summary).map(([mod, s]) => (
                  <div key={mod} className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {formatModuleName(mod)} DQS
                    </p>
                    <p
                      className="text-3xl font-bold"
                      style={{ color: scoreColor(s.composite_score) }}
                    >
                      {s.composite_score}
                    </p>
                    <div className="flex justify-center gap-2">
                      <Badge variant="destructive">
                        Critical {s.critical_count}
                      </Badge>
                      <Badge className="bg-orange-500">
                        High {s.high_count}
                      </Badge>
                      <Badge className="bg-yellow-500 text-black">
                        Medium {s.medium_count}
                      </Badge>
                      <Badge className="bg-green-600">Low {s.low_count}</Badge>
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="flex flex-wrap justify-center gap-3">
              <Link href={`/findings?version_id=${version.id}`}>
                <Button>View Findings</Button>
              </Link>
              <a href={getReportDownloadUrl(version.id)} download>
                <Button variant="outline">Download PDF</Button>
              </a>
              <a href={getReportJsonExportUrl(version.id)} download>
                <Button variant="outline">Download JSON</Button>
              </a>
              <a href={getConfigMatchesExportUrl(version.id)} download>
                <Button variant="outline">Export Config Matches</Button>
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Error state ── */}
      {step === "error" && (
        <Card>
          <CardContent className="space-y-4 py-8">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
            <Button onClick={reset} className="w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
