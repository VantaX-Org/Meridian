"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI, SectionHeader } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { getSystems, getSystemModules } from "@/lib/api/connectivity";
import {
  startMigration,
  getMigrationRun,
  getFieldMap,
  updateFieldMap,
  seedFieldMap,
  downloadMigrationExport,
  type MigrationMode,
  type ExportFormat,
} from "@/lib/api/migration";
import type {
  SAPSystemExtended,
  ReadinessVerdict,
  TransferFieldMapping,
} from "@/types/api";

const EXPORT_FORMATS: ExportFormat[] = ["csv", "lsmw", "bapi", "idoc", "sf_csv", "xlsx"];

const VERDICT_TONE: Record<ReadinessVerdict, { fg: string; bg: string; label: string }> = {
  go: { fg: "var(--mn-pos)", bg: "var(--mn-pos-bg)", label: "GO" },
  conditional: { fg: "var(--mn-warn)", bg: "var(--mn-warn-bg)", label: "CONDITIONAL" },
  "no-go": { fg: "var(--mn-neg)", bg: "var(--mn-neg-bg)", label: "NO-GO" },
};

const SEV_TONE: Record<string, string> = {
  critical: "var(--mn-neg)",
  high: "var(--mn-warn)",
  medium: "var(--mn-primary-700)",
  low: "var(--mn-muted)",
};

export default function MigrationPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<MigrationMode>("source_to_destination");
  const [sourceId, setSourceId] = useState("");
  const [destId, setDestId] = useState("");
  const [modules, setModules] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [mapModule, setMapModule] = useState<string>("");

  const { data: systems, isLoading: sysLoading } = useQuery({
    queryKey: ["systems"],
    queryFn: getSystems,
  });

  const destSystem = useMemo(
    () => systems?.find((s) => s.id === destId),
    [systems, destId]
  );

  const { data: sourceModules } = useQuery({
    queryKey: ["system-modules", sourceId],
    queryFn: () => getSystemModules(sourceId),
    enabled: !!sourceId,
  });

  // Field map for the currently-edited module (source_to_destination only).
  const { data: fieldMap } = useQuery({
    queryKey: ["field-map", mapModule, destSystem?.system_type],
    queryFn: () => getFieldMap(mapModule, destSystem!.system_type),
    enabled: !!mapModule && !!destSystem,
  });

  const { data: run } = useQuery({
    queryKey: ["migration-run", runId],
    queryFn: () => getMigrationRun(runId!),
    enabled: !!runId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "queued" || s === "running" ? 2000 : false;
    },
  });

  const seedMut = useMutation({
    mutationFn: () => seedFieldMap(mapModule, destSystem!.system_type),
    onSuccess: (r) => {
      toast.success(`Seeded ${r.seeded} field mappings`);
      qc.invalidateQueries({ queryKey: ["field-map", mapModule, destSystem?.system_type] });
    },
    onError: () => toast.error("Seed failed — no known destination tables for this module"),
  });

  const mapMut = useMutation({
    mutationFn: (v: { id: string; body: Partial<TransferFieldMapping> }) =>
      updateFieldMap(v.id, v.body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["field-map", mapModule, destSystem?.system_type] }),
  });

  const analyzeMut = useMutation({
    mutationFn: () =>
      startMigration({
        mode,
        source_system_id: sourceId,
        dest_system_id: mode === "source_to_destination" ? destId : undefined,
        modules,
      }),
    onSuccess: (r) => {
      setRunId(r.run_id);
      toast.success("Analysis queued");
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Analysis failed to start";
      toast.error(msg);
    },
  });

  const canAnalyze =
    !!sourceId &&
    modules.length > 0 &&
    (mode === "source_to_source" || (!!destId && destId !== sourceId));

  function toggleModule(m: string) {
    setModules((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  if (sysLoading) {
    return (
      <div className="vx-page">
        <PageHead title="Migration" route="Steward · /migration" sub="Loading…" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const verdict = run?.readiness_verdict;
  const canExport = run?.status === "analysed" && verdict === "go";

  return (
    <div className="vx-page space-y-6">
      <PageHead
        title="Migration"
        route="Steward · /migration"
        sub="Clean source master data and check it is loadable into a target SAP system."
      />

      {/* ── Setup ── */}
      <div className="vx-card p-5 space-y-4">
        <SectionHeader title="1 · Configure" caption="Pick mode, systems and modules" />

        <div className="flex gap-2">
          {(["source_to_destination", "source_to_source"] as MigrationMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-3 py-2 rounded-md text-small"
              style={{
                background: mode === m ? "var(--mn-primary-700)" : "var(--mn-surface-2)",
                color: mode === m ? "#fff" : "var(--mn-text)",
              }}
            >
              {m === "source_to_destination" ? "Source → New Destination" : "Source → Source"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SystemSelect
            label="Source system"
            systems={systems ?? []}
            value={sourceId}
            onChange={setSourceId}
          />
          {mode === "source_to_destination" && (
            <SystemSelect
              label="Destination system"
              systems={(systems ?? []).filter((s) => s.id !== sourceId)}
              value={destId}
              onChange={setDestId}
              warnUnhealthy
            />
          )}
          <div>
            <label className="text-micro block mb-1">Modules</label>
            <div className="flex flex-wrap gap-1 max-h-28 overflow-auto">
              {(sourceModules ?? []).map((sm) => (
                <button
                  key={sm.module}
                  onClick={() => toggleModule(sm.module)}
                  className="px-2 py-1 rounded text-micro"
                  style={{
                    background: modules.includes(sm.module)
                      ? "var(--mn-primary-50)"
                      : "var(--mn-surface-2)",
                    color: modules.includes(sm.module)
                      ? "var(--mn-primary-700)"
                      : "var(--mn-text)",
                  }}
                >
                  {sm.module}
                </button>
              ))}
              {!sourceId && <span className="text-micro text-muted">Pick a source first</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Field map editor (source_to_destination) ── */}
      {mode === "source_to_destination" && destSystem && modules.length > 0 && (
        <div className="vx-card p-5 space-y-4">
          <SectionHeader
            title="2 · Map fields"
            caption={`Map source fields to ${destSystem.system_type} target fields`}
          />
          <div className="flex gap-2 items-center">
            <select
              value={mapModule}
              onChange={(e) => setMapModule(e.target.value)}
              className="vx-input"
            >
              <option value="">Select a module to map…</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {mapModule && (
              <button
                onClick={() => seedMut.mutate()}
                disabled={seedMut.isPending}
                className="px-3 py-2 rounded-md text-small"
                style={{ background: "var(--mn-surface-2)" }}
              >
                Auto-seed by name
              </button>
            )}
          </div>

          {mapModule && fieldMap && (
            <table className="w-full text-small">
              <thead>
                <tr className="text-micro text-muted text-left">
                  <th className="py-1">Source field</th>
                  <th>Dest table</th>
                  <th>Dest field</th>
                  <th>Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {fieldMap.map((row) => (
                  <tr key={row.id} className="border-t" style={{ borderColor: "var(--mn-border)" }}>
                    <td className="py-1 font-mono">{row.source_field}</td>
                    <td>
                      <input
                        defaultValue={row.dest_table ?? ""}
                        onBlur={(e) =>
                          mapMut.mutate({ id: row.id, body: { dest_table: e.target.value } })
                        }
                        className="vx-input vx-input-sm w-28"
                      />
                    </td>
                    <td>
                      <input
                        defaultValue={row.dest_field ?? ""}
                        onBlur={(e) =>
                          mapMut.mutate({ id: row.id, body: { dest_field: e.target.value } })
                        }
                        className="vx-input vx-input-sm w-28"
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        defaultChecked={row.is_confirmed}
                        onChange={(e) =>
                          mapMut.mutate({ id: row.id, body: { is_confirmed: e.target.checked } })
                        }
                      />
                    </td>
                  </tr>
                ))}
                {fieldMap.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-micro text-muted">
                      No mappings yet — click “Auto-seed by name” to start.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Analyze ── */}
      <div className="vx-card p-5 flex items-center justify-between">
        <SectionHeader
          title={mode === "source_to_destination" ? "3 · Analyze" : "Analyze"}
          caption={
            mode === "source_to_source"
              ? "Routes into the writeback 4-eyes approval flow"
              : "Gap-analyse the cleaned source against the live destination"
          }
        />
        <button
          onClick={() => analyzeMut.mutate()}
          disabled={!canAnalyze || analyzeMut.isPending}
          className="px-4 py-2 rounded-md text-small"
          style={{
            background: canAnalyze ? "var(--mn-primary-700)" : "var(--mn-surface-2)",
            color: canAnalyze ? "#fff" : "var(--mn-muted)",
          }}
        >
          {analyzeMut.isPending ? "Queuing…" : "Run analysis"}
        </button>
      </div>

      {/* ── Run detail ── */}
      {run && (
        <div className="vx-card p-5 space-y-4">
          <SectionHeader
            title="Transfer readiness"
            caption={`Run ${run.id.slice(0, 8)} · ${run.status}`}
          />

          {run.mode === "source_to_source" ? (
            <p className="text-small">
              Source→source uses the steward writeback approval flow.{" "}
              <Link href="/workbench" className="underline" style={{ color: "var(--mn-primary-700)" }}>
                Open Workbench →
              </Link>
            </p>
          ) : run.status === "queued" || run.status === "running" ? (
            <p className="text-small text-muted">Analysing… this refreshes automatically.</p>
          ) : run.status === "failed" ? (
            <p className="text-small" style={{ color: "var(--mn-neg)" }}>
              Analysis failed: {run.error_detail}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {verdict && (
                  <div
                    className="rounded-md px-3 py-2"
                    style={{ background: VERDICT_TONE[verdict].bg, color: VERDICT_TONE[verdict].fg }}
                  >
                    <div className="text-micro">Verdict</div>
                    <div className="display-sm aurora-number">{VERDICT_TONE[verdict].label}</div>
                  </div>
                )}
                <KPI label="Score" value={run.readiness_score ?? 0} />
                <KPI
                  label="Critical gaps"
                  value={run.critical_count}
                  tone={run.critical_count > 0 ? "neg" : "pos"}
                />
                <KPI label="Transfer-ready" value={run.transfer_ready_count} tone="pos" />
              </div>

              {/* Export bar — gated on verdict==go */}
              <div>
                <div className="text-micro text-muted mb-1">
                  Export load files {canExport ? "" : "(blocked until verdict is GO)"}
                </div>
                <div className="flex flex-wrap gap-2">
                  {EXPORT_FORMATS.map((f) => (
                    <button
                      key={f}
                      disabled={!canExport}
                      onClick={() =>
                        downloadMigrationExport(run.id, f).catch(() =>
                          toast.error("Export blocked or no transfer-ready records")
                        )
                      }
                      className="px-3 py-1 rounded text-micro uppercase"
                      style={{
                        background: canExport ? "var(--mn-primary-50)" : "var(--mn-surface-2)",
                        color: canExport ? "var(--mn-primary-700)" : "var(--mn-muted)",
                        cursor: canExport ? "pointer" : "not-allowed",
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Findings */}
              <div>
                <SectionHeader
                  title="Gap findings"
                  caption={`${run.findings_total} total — showing ${run.findings.length}`}
                />
                <table className="w-full text-small">
                  <thead>
                    <tr className="text-micro text-muted text-left">
                      <th className="py-1">Sev</th>
                      <th>Module</th>
                      <th>Field</th>
                      <th>Type</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.findings.map((f, i) => (
                      <tr
                        key={i}
                        className="border-t"
                        style={{ borderColor: "var(--mn-border)" }}
                      >
                        <td className="py-1">
                          <span style={{ color: SEV_TONE[f.severity] ?? "var(--mn-muted)" }}>
                            ● {f.severity}
                          </span>
                        </td>
                        <td>{f.module}</td>
                        <td className="font-mono text-micro">
                          {f.field}
                          {f.dest_table ? ` → ${f.dest_table}` : ""}
                        </td>
                        <td className="text-micro">{f.gap_type}</td>
                        <td className="text-micro text-muted">{f.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SystemSelect({
  label,
  systems,
  value,
  onChange,
  warnUnhealthy,
}: {
  label: string;
  systems: SAPSystemExtended[];
  value: string;
  onChange: (v: string) => void;
  warnUnhealthy?: boolean;
}) {
  const sel = systems.find((s) => s.id === value);
  return (
    <div>
      <label className="text-micro block mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="vx-input w-full">
        <option value="">Select…</option>
        {systems.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.system_type})
          </option>
        ))}
      </select>
      {warnUnhealthy && sel && sel.health_status !== "healthy" && (
        <p className="text-micro mt-1" style={{ color: "var(--mn-warn)" }}>
          Destination is {sel.health_status} — connect it (must be healthy) before analysis.
        </p>
      )}
    </div>
  );
}
