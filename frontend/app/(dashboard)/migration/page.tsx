"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHead } from "@/components/meridian/atoms";
import {
  getSystems,
  getSystemModules,
  testConnection,
} from "@/lib/api/connectivity";
import {
  startMigration,
  getMigrationRun,
  getMigrationRuns,
  getFieldMap,
  updateFieldMap,
  seedFieldMap,
  downloadMigrationExport,
  type ExportFormat,
} from "@/lib/api/migration";
import { formatModuleName, severityColor, relativeTime } from "@/lib/format";
import type {
  MigrationMode,
  SAPSystemExtended,
  SystemModule,
  TransferFieldMapping,
  TransferVerdict,
} from "@/types/api";

const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "csv", label: "CSV" },
  { id: "lsmw", label: "LSMW" },
  { id: "bapi", label: "BAPI JSON" },
  { id: "idoc", label: "IDoc" },
  { id: "sf_csv", label: "SF CSV" },
  { id: "xlsx", label: "Excel" },
];

// ── verdict presentation ──────────────────────────────────────────────────────

function verdictStyle(v: TransferVerdict): { bg: string; label: string } {
  switch (v) {
    case "go":
      return { bg: "bg-[#256F3A]/10 text-[#256F3A] border border-[#256F3A]/25", label: "GO" };
    case "conditional":
      return { bg: "bg-[#E76500]/10 text-[#E76500] border border-[#E76500]/25", label: "CONDITIONAL" };
    default:
      return { bg: "bg-[#BB0000]/10 text-[#BB0000] border border-[#BB0000]/25", label: "NO-GO" };
  }
}

function healthDot(s: string): string {
  if (s === "healthy") return "bg-[#256F3A]";
  if (s === "degraded") return "bg-[#E76500]";
  return "bg-[#BB0000]";
}

// ── section shell ─────────────────────────────────────────────────────────────

function Step({
  n,
  title,
  active,
  done,
  children,
}: {
  n: number;
  title: string;
  active: boolean;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={`border-black/[0.08] ${active ? "bg-white/[0.80]" : "bg-white/[0.45] opacity-70"}`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
              done
                ? "bg-[#256F3A] text-white"
                : active
                  ? "bg-primary text-white"
                  : "bg-black/[0.06] text-muted-foreground"
            }`}
          >
            {done ? <Check className="h-4 w-4" /> : n}
          </div>
          <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {active && <div className="pl-10">{children}</div>}
      </CardContent>
    </Card>
  );
}

// ── field-map editor ──────────────────────────────────────────────────────────

function FieldMapEditor({
  module,
  destSystemType,
  onConfirmedChange,
}: {
  module: string;
  destSystemType: string;
  onConfirmedChange: (module: string, confirmed: number) => void;
}) {
  const qc = useQueryClient();
  const key = ["migration.fieldmap", module, destSystemType];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getFieldMap(module, destSystemType),
  });

  const seed = useMutation({
    mutationFn: () => seedFieldMap(module, destSystemType),
    onSuccess: (d) => {
      toast.success(`Seeded ${d.seeded} field${d.seeded === 1 ? "" : "s"} from destination dictionary`);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: () => toast.error("Could not seed field map"),
  });

  const save = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof updateFieldMap>[1] }) =>
      updateFieldMap(v.id, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: () => toast.error("Could not save mapping"),
  });

  const rows = data ?? [];
  const confirmed = rows.filter((r) => r.is_confirmed).length;

  // Report confirmed count up to the parent so it can gate analysis.
  useEffect(() => {
    onConfirmedChange(module, confirmed);
  }, [module, confirmed, onConfirmedChange]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-black/[0.12] p-4 text-center">
        <p className="text-xs text-muted-foreground">
          No field map yet for {formatModuleName(module)}.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 gap-2"
          disabled={seed.isPending}
          onClick={() => seed.mutate()}
        >
          {seed.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Seed from destination dictionary
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{confirmed}</span> of {rows.length} field
          {rows.length === 1 ? "" : "s"} confirmed
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-xs"
          disabled={seed.isPending}
          onClick={() => seed.mutate()}
        >
          <RefreshCw className="h-3 w-3" /> Re-seed
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-black/[0.08]">
        <table className="w-full text-xs">
          <thead className="bg-black/[0.02] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Source field</th>
              <th className="px-3 py-2 text-left font-medium">Dest table</th>
              <th className="px-3 py-2 text-left font-medium">Dest field</th>
              <th className="px-3 py-2 text-left font-medium">Transform note</th>
              <th className="px-3 py-2 text-center font-medium">Confirm</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.05]">
            {rows.map((r: TransferFieldMapping) => (
              <FieldMapRow key={r.id} row={r} onSave={(body) => save.mutate({ id: r.id, body })} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FieldMapRow({
  row,
  onSave,
}: {
  row: TransferFieldMapping;
  onSave: (body: Parameters<typeof updateFieldMap>[1]) => void;
}) {
  const [destTable, setDestTable] = useState(row.dest_table ?? "");
  const [destField, setDestField] = useState(row.dest_field ?? "");
  const [note, setNote] = useState(row.transform_note ?? "");

  const cell =
    "w-full rounded border border-black/[0.08] bg-white/[0.70] px-2 py-1 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <tr className={row.is_confirmed ? "bg-[#256F3A]/[0.04]" : undefined}>
      <td className="px-3 py-1.5">
        <span className="font-mono text-foreground">{row.source_field}</span>
        {row.source_data_type && (
          <span className="ml-1.5 text-[10px] text-muted-foreground">{row.source_data_type}</span>
        )}
      </td>
      <td className="px-3 py-1.5">
        <input
          className={cell}
          value={destTable}
          placeholder="—"
          onChange={(e) => setDestTable(e.target.value)}
          onBlur={() => destTable !== (row.dest_table ?? "") && onSave({ dest_table: destTable || null })}
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          className={cell}
          value={destField}
          placeholder="(skip)"
          onChange={(e) => setDestField(e.target.value)}
          onBlur={() => destField !== (row.dest_field ?? "") && onSave({ dest_field: destField || null })}
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          className={cell}
          value={note}
          placeholder="—"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (row.transform_note ?? "") && onSave({ transform_note: note || null })}
        />
      </td>
      <td className="px-3 py-1.5 text-center">
        <input
          type="checkbox"
          checked={row.is_confirmed}
          onChange={(e) => onSave({ is_confirmed: e.target.checked })}
          className="rounded border-black/[0.15] text-primary focus:ring-primary"
        />
      </td>
    </tr>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function MigrationPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<MigrationMode>("source_to_destination");
  const [sourceId, setSourceId] = useState("");
  const [destId, setDestId] = useState("");
  const [modules, setModules] = useState<Set<string>>(new Set());
  const [runId, setRunId] = useState<string | null>(null);
  const [confirmedByModule, setConfirmedByModule] = useState<Record<string, number>>({});

  const { data: systems, isLoading: systemsLoading } = useQuery({
    queryKey: ["systems"],
    queryFn: getSystems,
  });

  const { data: sourceModules, isLoading: modulesLoading } = useQuery({
    queryKey: ["system-modules", sourceId],
    queryFn: () => getSystemModules(sourceId),
    enabled: Boolean(sourceId),
  });

  const dest = systems?.find((s) => s.id === destId);
  const destType = dest?.system_type ?? "";
  const isDestMode = mode === "source_to_destination";

  const { data: recentRuns } = useQuery({
    queryKey: ["migration.runs"],
    queryFn: () => getMigrationRuns(),
  });

  // Poll the active run until it leaves a working state.
  const { data: run } = useQuery({
    queryKey: ["migration.run", runId],
    queryFn: () => getMigrationRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (q) => {
      const s = q.state.data?.run.status;
      return s === "queued" || s === "running" ? 2000 : false;
    },
  });

  const recheck = useMutation({
    mutationFn: () => testConnection(destId),
    onSuccess: () => {
      toast.success("Destination re-checked");
      qc.invalidateQueries({ queryKey: ["systems"] });
    },
    onError: () => toast.error("Health check failed"),
  });

  const analyze = useMutation({
    mutationFn: () =>
      startMigration({
        mode,
        source_system_id: sourceId,
        dest_system_id: isDestMode ? destId : null,
        modules: Array.from(modules),
      }),
    onSuccess: (d) => {
      setRunId(d.run_id);
      qc.invalidateQueries({ queryKey: ["migration.runs"] });
      toast.success(isDestMode ? "Transfer-readiness analysis started" : "Migration run recorded");
    },
    onError: (e) => toast.error((e as Error).message || "Could not start migration"),
  });

  const exporting = useMutation({
    mutationFn: (fmt: ExportFormat) => downloadMigrationExport(runId as string, fmt),
    onError: (e) => toast.error((e as Error).message || "Export blocked"),
  });

  const selectedModules = Array.from(modules);
  const allModulesMapped =
    isDestMode &&
    selectedModules.length > 0 &&
    selectedModules.every((m) => (confirmedByModule[m] ?? 0) > 0);

  const destHealthy = dest?.health_status === "healthy";
  const canAnalyze =
    sourceId &&
    selectedModules.length > 0 &&
    (!isDestMode || (destId && destHealthy && allModulesMapped));

  const toggleModule = (m: string) =>
    setModules((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });

  const reportConfirmed = useCallback(
    (m: string, c: number) =>
      setConfirmedByModule((prev) => (prev[m] === c ? prev : { ...prev, [m]: c })),
    []
  );

  const working = run?.run.status === "queued" || run?.run.status === "running";
  const verdict = run?.run.readiness_verdict;

  return (
    <div className="space-y-6">
      <PageHead
        title="Migration"
        route="/migration"
        sub="Clean master data, then write it back to the same SAP system or transfer it into a new destination — gap-checked against the destination's own rules before any load file is produced."
      />

      {/* Step 1 — mode + systems + modules */}
      <Step n={1} title="Choose transfer mode & scope" active done={Boolean(canAnalyze && (runId || !working))}>
        {/* Mode toggle */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ModeCard
            active={mode === "source_to_source"}
            icon={<RefreshCw className="h-4 w-4" />}
            title="Source → Source"
            desc="Clean and write corrections back to the same system via the 4-eyes BAPI flow."
            onClick={() => {
              setMode("source_to_source");
              setRunId(null);
            }}
          />
          <ModeCard
            active={mode === "source_to_destination"}
            icon={<ArrowLeftRight className="h-4 w-4" />}
            title="Source → New Destination"
            desc="Gap-check cleaned source data against a live destination system, then export SAP-loadable files."
            onClick={() => {
              setMode("source_to_destination");
              setRunId(null);
            }}
          />
        </div>

        {/* System selectors */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SystemSelect
            label="Source system"
            value={sourceId}
            systems={systems}
            loading={systemsLoading}
            onChange={(v) => {
              setSourceId(v);
              setModules(new Set());
              setRunId(null);
            }}
          />
          {isDestMode && (
            <SystemSelect
              label="Destination system"
              value={destId}
              systems={systems?.filter((s) => s.id !== sourceId)}
              loading={systemsLoading}
              onChange={(v) => {
                setDestId(v);
                setRunId(null);
              }}
              renderHint={
                dest ? (
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    <span className={`h-2 w-2 rounded-full ${healthDot(dest.health_status)}`} />
                    <span className="text-muted-foreground">
                      {dest.system_type} · {dest.health_status}
                    </span>
                    {!destHealthy && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 text-xs"
                        disabled={recheck.isPending}
                        onClick={() => recheck.mutate()}
                      >
                        {recheck.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        Re-check
                      </Button>
                    )}
                  </div>
                ) : null
              }
            />
          )}
        </div>

        {isDestMode && destId && !destHealthy && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription className="text-xs">
              The destination is not connected. A live connection is required — every gap is
              confirmed against the destination&apos;s own config, with no baseline fallback. Connect
              and health-check it, then re-check above.
            </AlertDescription>
          </Alert>
        )}

        {/* Module multi-select */}
        {sourceId && (
          <div className="mt-4">
            <span className="text-xs font-medium text-muted-foreground">Modules to transfer</span>
            {modulesLoading ? (
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : sourceModules && sourceModules.length > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {sourceModules.map((mod: SystemModule) => (
                  <label
                    key={mod.module}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/[0.50] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={modules.has(mod.module)}
                      onChange={() => toggleModule(mod.module)}
                      className="rounded border-black/[0.15] text-primary focus:ring-primary"
                    />
                    <span className="text-foreground">{formatModuleName(mod.module)}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {mod.row_count.toLocaleString()}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No extracted modules on this system.</p>
            )}
          </div>
        )}
      </Step>

      {/* Step 2 — field map (destination mode only) */}
      {isDestMode && (
        <Step
          n={2}
          title="Map source fields to destination"
          active={Boolean(sourceId && destId && destHealthy && selectedModules.length > 0)}
          done={allModulesMapped}
        >
          <p className="mb-3 text-xs text-muted-foreground">
            Seed a starting map from the destination dictionary, adjust the target table/field, and
            confirm each module. Analysis is blocked until every selected module has at least one
            confirmed field.
          </p>
          <div className="space-y-5">
            {selectedModules.map((m) => (
              <div key={m}>
                <div className="mb-2 flex items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground">{formatModuleName(m)}</span>
                  {(confirmedByModule[m] ?? 0) > 0 && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#256F3A]" />
                  )}
                </div>
                <FieldMapEditor module={m} destSystemType={destType} onConfirmedChange={reportConfirmed} />
              </div>
            ))}
          </div>
        </Step>
      )}

      {/* Step 3 — analyze / launch */}
      <Step
        n={isDestMode ? 3 : 2}
        title={isDestMode ? "Run transfer-readiness analysis" : "Launch writeback"}
        active={Boolean(canAnalyze)}
        done={Boolean(run && !working)}
      >
        {mode === "source_to_source" ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Source-to-source corrections are applied through the existing 4-eyes writeback approval
              flow. This records the run; approve and apply each change on the Cleaning workbench.
            </p>
            <div className="flex gap-2">
              <Button
                className="gap-2 bg-primary text-white hover:bg-primary/80"
                disabled={!canAnalyze || analyze.isPending}
                onClick={() => analyze.mutate()}
              >
                {analyze.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Record run
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  window.location.href = "/cleaning";
                }}
              >
                Go to Cleaning <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Button
              className="gap-2 bg-primary text-white hover:bg-primary/80"
              disabled={!canAnalyze || analyze.isPending || working}
              onClick={() => analyze.mutate()}
            >
              {analyze.isPending || working ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {working ? "Analysing…" : "Analyse transfer readiness"}
            </Button>
            {!canAnalyze && (
              <p className="text-xs text-muted-foreground">
                Select a healthy destination, pick modules, and confirm the field map to enable
                analysis.
              </p>
            )}
          </div>
        )}
      </Step>

      {/* Verdict + findings (destination mode, analysed) */}
      {isDestMode && run && run.run.mode === "source_to_destination" && (
        <Card className="border-black/[0.08] bg-white/[0.80]">
          <CardContent className="p-5 space-y-4">
            {working ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Gap-analysing against destination…
              </div>
            ) : run.run.status === "failed" ? (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  Analysis failed: {run.run.error_detail ?? "unknown error"}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  {verdict && (
                    <span
                      className={`rounded-md px-3 py-1 text-sm font-semibold ${verdictStyle(verdict).bg}`}
                    >
                      {verdictStyle(verdict).label}
                    </span>
                  )}
                  <div className="text-sm">
                    <span className="font-display text-2xl font-semibold text-foreground">
                      {run.run.readiness_score?.toFixed(1) ?? "—"}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">readiness</span>
                  </div>
                  {run.run.critical_count > 0 && (
                    <Badge className="bg-[#BB0000]/10 text-[#BB0000] border border-[#BB0000]/20">
                      {run.run.critical_count} critical
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {run.findings_total} gap{run.findings_total === 1 ? "" : "s"} found
                  </span>
                </div>

                {/* Blockers / conditions rollup */}
                {run.run.gap_summary?.blockers?.length ? (
                  <div className="rounded-md bg-[#BB0000]/[0.04] p-3">
                    <p className="text-xs font-semibold text-[#BB0000]">Blocking</p>
                    <ul className="mt-1 list-disc pl-4 text-xs text-foreground/80">
                      {run.run.gap_summary.blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Findings table */}
                {run.findings.length > 0 && (
                  <div className="overflow-hidden rounded-md border border-black/[0.08]">
                    <table className="w-full text-xs">
                      <thead className="bg-black/[0.02] text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Severity</th>
                          <th className="px-3 py-2 text-left font-medium">Module</th>
                          <th className="px-3 py-2 text-left font-medium">Target</th>
                          <th className="px-3 py-2 text-left font-medium">Gap</th>
                          <th className="px-3 py-2 text-left font-medium">Detail</th>
                          <th className="px-3 py-2 text-left font-medium">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/[0.05]">
                        {run.findings.map((f, i) => (
                          <tr key={i}>
                            <td className="px-3 py-1.5">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${severityColor(f.severity)}`}>
                                {f.severity}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-foreground">{formatModuleName(f.module)}</td>
                            <td className="px-3 py-1.5 font-mono text-foreground">
                              {f.dest_table && f.field ? `${f.dest_table}.${f.field}` : f.field ?? "—"}
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground">{f.gap_type.replace(/_/g, " ")}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{f.detail ?? "—"}</td>
                            <td className="px-3 py-1.5 text-[10px] text-muted-foreground">
                              {f.domain_provenance ?? f.status_source ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {run.findings_total > run.findings.length && (
                      <p className="bg-black/[0.02] px-3 py-1.5 text-[10px] text-muted-foreground">
                        Showing {run.findings.length} of {run.findings_total} — remediate to reduce.
                      </p>
                    )}
                  </div>
                )}

                {/* Step 4 — export gate */}
                <div className="border-t border-black/[0.06] pt-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Download className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">Export load files</span>
                  </div>
                  {verdict === "go" ? (
                    <>
                      <p className="mb-2 text-xs text-muted-foreground">
                        Transfer certified ready. Download SAP-loadable files for your own load tooling
                        — no live write to the destination.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {EXPORT_FORMATS.map((f) => (
                          <Button
                            key={f.id}
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={exporting.isPending}
                            onClick={() => exporting.mutate(f.id)}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {f.label}
                          </Button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Alert>
                      <AlertDescription className="text-xs">
                        Export is locked until the verdict is <span className="font-semibold">GO</span>.
                        Resolve the blocking gaps above and re-analyse — only fully ready data produces
                        a load file.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent runs */}
      {recentRuns && recentRuns.length > 0 && (
        <Card className="border-black/[0.08] bg-white/[0.60]">
          <CardContent className="p-5">
            <h3 className="mb-3 font-display text-sm font-semibold text-foreground">Recent runs</h3>
            <div className="divide-y divide-black/[0.05]">
              {recentRuns.slice(0, 8).map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRunId(r.id)}
                  className="flex w-full items-center gap-3 py-2 text-left text-xs hover:bg-white/[0.50]"
                >
                  <span className="text-muted-foreground">
                    {r.mode === "source_to_source" ? "→ source" : "→ destination"}
                  </span>
                  <span className="text-foreground">{r.modules.map(formatModuleName).join(", ")}</span>
                  {r.readiness_verdict && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${verdictStyle(r.readiness_verdict).bg}`}>
                      {verdictStyle(r.readiness_verdict).label}
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground">{r.status}</span>
                  <span className="text-muted-foreground">{relativeTime(r.created_at)}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── small building blocks ─────────────────────────────────────────────────────

function ModeCard({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-4 text-left transition ${
        active
          ? "border-primary/40 bg-primary/[0.04] ring-1 ring-primary/20"
          : "border-black/[0.08] bg-white/[0.50] hover:bg-white/[0.70]"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {active && <Check className="ml-auto h-4 w-4 text-primary" />}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}

function SystemSelect({
  label,
  value,
  systems,
  loading,
  onChange,
  renderHint,
}: {
  label: string;
  value: string;
  systems?: SAPSystemExtended[];
  loading: boolean;
  onChange: (v: string) => void;
  renderHint?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        disabled={loading}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="">Select a system…</option>
        {systems?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.environment})
          </option>
        ))}
      </select>
      {renderHint}
    </label>
  );
}
