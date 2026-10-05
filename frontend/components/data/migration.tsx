"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowRight, Download, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import {
  Banner,
  Button,
  Chip,
  DataTable,
  Input,
  Pager,
  Select,
  Stack,
  Tabs,
  Text,
  type AuroraColumnMeta,
  type ChipTone,
} from "@/components/aurora";
import { SectionCard, Tally } from "@/components/ui-core";
import { getSystems, getSystemModules } from "@/lib/api/connectivity";
import {
  createFieldMap,
  deleteFieldMap,
  deleteValueMap,
  downloadMigrationExport,
  downloadMigrationGaps,
  getFieldMap,
  getMigrationFindings,
  getMigrationRun,
  getMigrationRuns,
  getValueCandidates,
  getValueMap,
  saveValueMap,
  seedFieldMap,
  startMigration,
  updateFieldMap,
  type ExportFormat,
  type GapFilter,
} from "@/lib/api/migration";
import { formatModuleName, relativeTime } from "@/lib/format";
import { useRole } from "@/hooks/use-role";
import type {
  DdicFieldDef,
  MigrationGapFinding,
  MigrationMode,
  MigrationRunDetail,
  TransferFieldMapping,
  TransferVerdict,
} from "@/types/api";

/** Target value when no target system is connected yet: SAP S/4HANA standard dictionary. */
const STANDARD_TARGET = "__s4hana_standard__";
const PAGE = 100;
const MIGRATION_HREF = "/data?tab=migration";

const VERDICT: Record<TransferVerdict, { tone: ChipTone; label: string }> = {
  go: { tone: "success", label: "Go" },
  conditional: { tone: "warning", label: "Conditional" },
  "no-go": { tone: "danger", label: "No-go" },
};

const SEVERITY_TONE: Record<string, ChipTone> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
};

const GAP_LABEL: Record<string, string> = {
  unmapped_field: "Source field not mapped",
  target_field_missing: "Target field does not exist",
  obsolete_target: "Target table obsolete",
  target_config_unverified: "Target config not verifiable",
  length_truncation: "Value longer than target",
  precision_loss: "Decimal precision lost",
  type_conversion: "Type does not convert",
  case_change: "Case not allowed in target",
  domain_value: "Not a target fixed value",
  check_table_value: "Not in target check table",
  value_unmapped: "Needs value mapping",
  target_mandatory: "Target mandatory field empty",
  key_missing: "Key field empty",
  key_collision: "Key collides after conversion",
  target_key_exists: "Key already exists in target",
};

function defLabel(d: DdicFieldDef | null): string {
  if (!d) return "not in dictionary";
  const len = d.decimals ? `${d.length},${d.decimals}` : `${d.length}`;
  return `${d.type ?? "?"}(${len})${d.check_table ? `, check table ${d.check_table}` : ""}`;
}

// ── field map ─────────────────────────────────────────────────────────────────

function FieldMapEditor({
  module,
  targetType,
  sourceSystemId,
  sourceType,
  canEdit,
}: {
  module: string;
  targetType: string;
  sourceSystemId: string;
  sourceType: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const key = ["migration.fieldmap", module, targetType];
  const { data: rows = [], isLoading } = useQuery({
    queryKey: [...key, sourceType],
    queryFn: () => getFieldMap(module, targetType, sourceType),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const onError = (e: unknown) => toast.error((e as Error).message || "Could not save the mapping");

  const seed = useMutation({
    mutationFn: () => seedFieldMap({ module, dest_system_type: targetType, source_system_id: sourceSystemId }),
    onSuccess: (d) => {
      toast.success(`Seeded ${d.seeded} mapping${d.seeded === 1 ? "" : "s"} from the source data`);
      refresh();
    },
    onError,
  });
  const save = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof updateFieldMap>[1] }) => updateFieldMap(v.id, v.body),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({ mutationFn: deleteFieldMap, onSuccess: refresh, onError });
  const add = useMutation({ mutationFn: createFieldMap, onSuccess: refresh, onError });
  const [draft, setDraft] = useState({ source: "", target: "" });

  if (isLoading) return <Text tone="muted">Loading field map…</Text>;

  const confirmed = rows.filter((r) => r.is_confirmed).length;
  return (
    <Stack gap={3}>
      <Stack direction="row" justify="between" align="center">
        <Text variant="text-small" tone="secondary">
          {rows.length === 0
            ? "No mappings yet. Analysis seeds identity and SAP-standard conversions (CVI, SD status) automatically."
            : `${confirmed} of ${rows.length} mappings confirmed by a steward`}
        </Text>
        {canEdit && (
          <Button size="sm" variant="secondary" leadingIcon={seed.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Wand2 size={14} />}
            disabled={seed.isPending} onClick={() => seed.mutate()}>
            Seed from source data
          </Button>
        )}
      </Stack>
      {rows.length > 0 && (
        <div className="max-h-[420px] overflow-auto rounded-md border border-[var(--aurora-canvas-line)]">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-[var(--aurora-elev-2-bg)] text-left text-[var(--aurora-fg-tertiary)]">
              <tr>
                <th className="px-3 py-2 font-medium">Source field</th>
                <th className="px-3 py-2 font-medium">Target table.field</th>
                <th className="px-3 py-2 font-medium">Origin</th>
                <th className="px-3 py-2 text-center font-medium">Value map</th>
                <th className="px-3 py-2 text-center font-medium">Confirmed</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <FieldMapRow key={r.id} row={r} canEdit={canEdit}
                  onSave={(body) => save.mutate({ id: r.id, body })} onDelete={() => remove.mutate(r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <Stack direction="row" gap={2} align="center">
          <Input placeholder="LFA1.KTOKK" value={draft.source} aria-label="Source field"
            onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
          <ArrowRight size={14} />
          <Input placeholder="BUT000.BU_GROUP (empty = not migrated)" value={draft.target} aria-label="Target field"
            onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
          <Button size="sm" variant="secondary" leadingIcon={<Plus size={14} />}
            disabled={!draft.source.includes(".") || add.isPending}
            onClick={() => {
              const [dt, df] = draft.target.split(".");
              add.mutate({ module, dest_system_type: targetType, source_field: draft.source,
                dest_table: dt || null, dest_field: df || null });
              setDraft({ source: "", target: "" });
            }}>
            Add
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

function FieldMapRow({
  row,
  canEdit,
  onSave,
  onDelete,
}: {
  row: TransferFieldMapping;
  canEdit: boolean;
  onSave: (body: Parameters<typeof updateFieldMap>[1]) => void;
  onDelete: () => void;
}) {
  const current = row.dest_table && row.dest_field ? `${row.dest_table}.${row.dest_field}` : "";
  const [target, setTarget] = useState(current);
  return (
    <tr className="border-t border-[var(--aurora-canvas-line)]">
      <td className="px-3 py-1.5">
        <div className="font-mono">{row.source_field}</div>
        <Text variant="text-micro" tone="muted">{defLabel(row.source_def)}</Text>
      </td>
      <td className="px-3 py-1.5">
        <Input value={target} placeholder="(not migrated)" disabled={!canEdit} aria-label={`Target for ${row.source_field}`}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={() => {
            if (target === current) return;
            const [dt, df] = target.split(".");
            onSave({ dest_table: dt || null, dest_field: df || null });
          }} />
        {current && <Text variant="text-micro" tone={row.target_def ? "muted" : "danger"}>{defLabel(row.target_def)}</Text>}
      </td>
      <td className="px-3 py-1.5">
        <Text variant="text-small" tone="secondary" title={row.transform_note ?? undefined}>{row.origin}</Text>
      </td>
      <td className="px-3 py-1.5 text-center">
        <input type="checkbox" checked={row.value_map} disabled={!canEdit} aria-label="Needs value mapping"
          onChange={(e) => onSave({ value_map: e.target.checked })} />
      </td>
      <td className="px-3 py-1.5 text-center">
        <input type="checkbox" checked={row.is_confirmed} disabled={!canEdit} aria-label="Confirmed"
          onChange={(e) => onSave({ is_confirmed: e.target.checked })} />
      </td>
      <td className="px-3 py-1.5 text-right">
        {canEdit && (
          <Button size="sm" variant="ghost" aria-label="Delete mapping" onClick={onDelete}>
            <Trash2 size={14} />
          </Button>
        )}
      </td>
    </tr>
  );
}

// ── value map ─────────────────────────────────────────────────────────────────

function ValueMapEditor({ runId, module, targetField, canEdit }: {
  runId: string; module: string; targetField: string; canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { data: candidates = [] } = useQuery({
    queryKey: ["migration.valuecand", runId, targetField],
    queryFn: () => getValueCandidates(runId, targetField),
  });
  const entriesKey = ["migration.valuemap", module, targetField];
  const { data: entries = [] } = useQuery({ queryKey: entriesKey, queryFn: () => getValueMap(module, targetField) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: entriesKey });
  const save = useMutation({
    mutationFn: () => saveValueMap({
      module, target_field: targetField,
      entries: Object.entries(draft).filter(([, v]) => v.trim()).map(([source_value, target_value]) => ({
        source_value, target_value: target_value.trim() })),
    }),
    onSuccess: (d) => {
      toast.success(`Saved ${d.saved} value mapping${d.saved === 1 ? "" : "s"}. Re-analyse to apply.`);
      setDraft({});
      refresh();
    },
    onError: (e) => toast.error((e as Error).message || "Could not save value mappings"),
  });
  const remove = useMutation({ mutationFn: deleteValueMap, onSuccess: refresh });
  const mapped = new Set(entries.map((e) => e.source_value));
  const open = candidates.filter((c) => !mapped.has(c.source_value));

  return (
    <Stack gap={3}>
      <Text variant="text-small" tone="secondary">
        {open.length} source value{open.length === 1 ? "" : "s"} still need a target value for{" "}
        <span className="font-mono">{targetField}</span>.
      </Text>
      <table className="w-full text-[13px]">
        <thead className="text-left text-[var(--aurora-fg-tertiary)]">
          <tr>
            <th className="py-1 font-medium">Source value</th>
            <th className="py-1 text-right font-medium">Records</th>
            <th className="py-1 pl-4 font-medium">Target value</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {open.map((c) => (
            <tr key={c.source_value} className="border-t border-[var(--aurora-canvas-line)]">
              <td className="py-1 font-mono">{c.source_value}</td>
              <td className="py-1 text-right aurora-number">{c.records.toLocaleString()}</td>
              <td className="py-1 pl-4">
                <Input value={draft[c.source_value] ?? ""} disabled={!canEdit} aria-label={`Target value for ${c.source_value}`}
                  onChange={(e) => setDraft({ ...draft, [c.source_value]: e.target.value })} />
              </td>
              <td />
            </tr>
          ))}
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-[var(--aurora-canvas-line)]">
              <td className="py-1 font-mono">{e.source_value}</td>
              <td className="py-1 text-right"><Chip tone="success">mapped</Chip></td>
              <td className="py-1 pl-4 font-mono">{e.target_value}</td>
              <td className="py-1 text-right">
                {canEdit && (
                  <Button size="sm" variant="ghost" aria-label="Remove value mapping" onClick={() => remove.mutate(e.id)}>
                    <Trash2 size={14} />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && open.length > 0 && (
        <div>
          <Button size="sm" disabled={save.isPending || !Object.values(draft).some((v) => v.trim())} onClick={() => save.mutate()}>
            Save value mappings
          </Button>
        </div>
      )}
    </Stack>
  );
}

// ── gap explorer ──────────────────────────────────────────────────────────────

const gapColumns: ColumnDef<MigrationGapFinding, unknown>[] = [
  {
    id: "severity",
    header: "Severity",
    cell: ({ row }) => <Chip tone={SEVERITY_TONE[row.original.severity] ?? "neutral"}>{row.original.severity}</Chip>,
    meta: { width: 96 } satisfies AuroraColumnMeta,
  },
  {
    id: "record",
    header: "Record",
    cell: ({ row }) => <span className="font-mono">{row.original.record_key ?? "all records"}</span>,
    meta: { width: 220, sticky: "start" } satisfies AuroraColumnMeta,
  },
  {
    id: "gap",
    header: "Gap",
    cell: ({ row }) => GAP_LABEL[row.original.gap_type] ?? row.original.gap_type,
    meta: { width: 200 } satisfies AuroraColumnMeta,
  },
  {
    id: "source",
    header: "Source",
    cell: ({ row }) => (
      <span className="font-mono">
        {row.original.source_field ?? "—"}
        {row.original.source_value != null && ` = ${row.original.source_value}`}
      </span>
    ),
    meta: { width: 220 } satisfies AuroraColumnMeta,
  },
  {
    id: "target",
    header: "Target",
    cell: ({ row }) => (
      <span className="font-mono">
        {row.original.dest_table && row.original.target_field
          ? `${row.original.dest_table}.${row.original.target_field}`
          : row.original.target_field ?? "—"}
        {row.original.target_value != null && ` (target ${row.original.target_value})`}
      </span>
    ),
    meta: { width: 220 } satisfies AuroraColumnMeta,
  },
  { id: "detail", header: "Detail", cell: ({ row }) => row.original.detail ?? "—", meta: { width: 320 } satisfies AuroraColumnMeta },
  {
    id: "basis",
    header: "Basis",
    cell: ({ row }) => (
      <span title={row.original.provenance ?? undefined}>{row.original.grounded ? "confirmed" : "SAP standard"}</span>
    ),
    meta: { width: 110 } satisfies AuroraColumnMeta,
  },
];

function GapExplorer({ run, canExport }: { run: MigrationRunDetail; canExport: boolean }) {
  const [filter, setFilter] = useState<GapFilter>({});
  const [offset, setOffset] = useState(0);
  const runId = run.run.id;
  const { data, isFetching } = useQuery({
    queryKey: ["migration.findings", runId, filter, offset],
    queryFn: () => getMigrationFindings(runId, { ...filter, limit: PAGE, offset }),
  });
  const gapTypes = Array.from(new Set(run.gap_breakdown.map((b) => b.gap_type)));
  const set = (patch: GapFilter) => {
    setFilter({ ...filter, ...patch });
    setOffset(0);
  };
  const exportGaps = useMutation({
    mutationFn: (fmt: ExportFormat) => downloadMigrationGaps(runId, fmt, filter),
    onError: (e) => toast.error((e as Error).message || "Export failed"),
  });
  const total = data?.total ?? 0;

  return (
    <Stack gap={3}>
      <Stack direction="row" gap={2} wrap align="center">
        <Select placeholder="All modules" value={filter.module ?? ""} aria-label="Module"
          options={run.run.modules.map((m) => ({ value: m, label: formatModuleName(m) }))}
          onValueChange={(v) => set({ module: v || undefined })} />
        <Select placeholder="All gap types" value={filter.gap_type ?? ""} aria-label="Gap type"
          options={gapTypes.map((g) => ({ value: g, label: GAP_LABEL[g] ?? g }))}
          onValueChange={(v) => set({ gap_type: v || undefined })} />
        <Select placeholder="All severities" value={filter.severity ?? ""} aria-label="Severity"
          options={["critical", "high", "medium", "low"].map((s) => ({ value: s, label: s }))}
          onValueChange={(v) => set({ severity: v || undefined })} />
        <Input placeholder="Search record, field or value" aria-label="Search" defaultValue={filter.search}
          onKeyDown={(e) => e.key === "Enter" && set({ search: e.currentTarget.value || undefined })} />
        {canExport && (
          <Stack direction="row" gap={2} className="ml-auto">
            {(["xlsx", "csv"] as const).map((f) => (
              <Button key={f} size="sm" variant="secondary" leadingIcon={<Download size={14} />}
                disabled={exportGaps.isPending} onClick={() => exportGaps.mutate(f)}>
                Gaps {f.toUpperCase()}
              </Button>
            ))}
          </Stack>
        )}
      </Stack>
      <DataTable
        columns={gapColumns}
        data={data?.items ?? []}
        getRowId={(r, i) => `${offset + i}`}
        maxHeight={480}
        ariaLabel="Migration gaps"
        empty={<Text tone="muted">{isFetching ? "Fetching gaps…" : "No gaps match these filters."}</Text>}
      />
      <Pager offset={offset} total={total} pageSize={PAGE} onChange={setOffset} noun="gaps" />
    </Stack>
  );
}

// ── run result ────────────────────────────────────────────────────────────────

type ResultTab = "modules" | "gaps" | "values" | "load";

function RunResult({ run, targetType, canEdit, canExport }: {
  run: MigrationRunDetail; targetType: string; canEdit: boolean; canExport: boolean;
}) {
  const [tab, setTab] = useState<ResultTab>("modules");
  const r = run.run;
  const summary = r.gap_summary ?? {};
  const structural = run.structural_critical;
  const valueGaps = run.gap_breakdown.filter((b) => b.gap_type === "value_unmapped").reduce((n, b) => n + b.n, 0);
  const exporting = useMutation({
    mutationFn: (fmt: ExportFormat) => downloadMigrationExport(r.id, fmt),
    onError: (e) => toast.error((e as Error).message || "Export blocked"),
  });

  if (r.status === "failed") {
    return <Banner tone="danger" title="Analysis failed">{r.error_detail ?? "Unknown error"}</Banner>;
  }
  const ready = r.records_total - r.records_blocked;
  return (
    <Stack gap={4}>
      {!r.target_connected && (
        <Banner tone="info" title={`Analysed against the SAP ${r.target_release === "ecc6" ? "ECC 6.0" : "S/4HANA"} standard dictionary`}>
          No target system is connected, so field structure, lengths, types and fixed values are checked
          against SAP standard; values that depend on target configuration (check tables) are reported as
          unverified, never assumed. Connect the target and re-analyse to confirm them.
        </Banner>
      )}
      <Tally level={2} label="Transfer readiness" figures={[
        { label: "Verdict", value: r.readiness_verdict ? VERDICT[r.readiness_verdict].label : "None",
          tone: r.readiness_verdict === "no-go" ? "danger" : r.readiness_verdict === "conditional" ? "warning" : r.readiness_verdict === "go" ? "success" : undefined,
          verdict: "Overall call for this run.", href: MIGRATION_HREF },
        { label: "Records transfer-ready", value: ready, verdict: `Of ${r.records_total.toLocaleString()} analysed.`, href: MIGRATION_HREF },
        { label: "Readiness", value: r.readiness_score != null ? Math.round(r.readiness_score * 10) / 10 : null, unit: "%",
          verdict: "Share of records with no blocking gap.", href: MIGRATION_HREF },
        { label: "Critical gaps", value: r.critical_count, tone: r.critical_count ? "danger" : undefined,
          verdict: r.critical_count ? "These records cannot load." : "Nothing blocks the load.", href: MIGRATION_HREF },
      ]} />
      <Tabs<ResultTab>
        ariaLabel="Run result"
        value={tab}
        onValueChange={setTab}
        items={[
          { id: "modules", label: "Modules", count: r.modules.length },
          { id: "gaps", label: "Gaps", count: run.gap_breakdown.reduce((n, b) => n + b.n, 0) },
          { id: "values", label: "Value mapping", count: valueGaps },
          { id: "load", label: "Load files" },
        ]}
      />
      {tab === "modules" && (
        <table className="w-full text-[13px]">
          <thead className="text-left text-[var(--aurora-fg-tertiary)]">
            <tr>
              <th className="py-1 font-medium">Module</th>
              <th className="py-1 font-medium">Source tables</th>
              <th className="py-1 text-right font-medium">Records</th>
              <th className="py-1 text-right font-medium">Blocked</th>
              <th className="py-1 text-right font-medium">Score</th>
              <th className="py-1 pl-4 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(summary).map(([m, s]) => (
              <tr key={m} className="border-t border-[var(--aurora-canvas-line)]">
                <td className="py-1.5">{formatModuleName(m)}</td>
                <td className="py-1.5 font-mono">{s.source_tables.join(", ") || "—"}</td>
                <td className="py-1.5 text-right aurora-number">{s.records.toLocaleString()}</td>
                <td className="py-1.5 text-right aurora-number">{s.blocked_records.toLocaleString()}</td>
                <td className="py-1.5 text-right aurora-number">{s.score.toFixed(1)}</td>
                <td className="py-1.5 pl-4"><Chip tone={VERDICT[s.verdict].tone}>{VERDICT[s.verdict].label}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === "gaps" && <GapExplorer run={run} canExport={canExport} />}
      {tab === "values" && <ValueMapTab run={run} targetType={targetType} canEdit={canEdit} />}
      {tab === "load" && (
        <Stack gap={3}>
          <Text variant="text-small" tone="secondary">
            One sheet (xlsx) or CSV (zip) per target table, columns named as the target fields, values after
            your value mappings, plus SOURCE_RECORD for traceability. Only the {ready.toLocaleString()} records
            without a critical or high gap are included. Meridian never writes to the target system.
          </Text>
          {structural > 0 ? (
            <Banner tone="danger" title="Export blocked">
              {structural} structural critical gap{structural === 1 ? "" : "s"} (target field missing or obsolete).
              Fix the field map and re-analyse.
            </Banner>
          ) : canExport ? (
            <Stack direction="row" gap={2}>
              {(["xlsx", "csv"] as const).map((f) => (
                <Button key={f} variant="secondary" leadingIcon={<Download size={14} />} disabled={exporting.isPending || ready === 0}
                  onClick={() => exporting.mutate(f)}>
                  {f === "xlsx" ? "Excel workbook" : "CSV (zip)"}
                </Button>
              ))}
            </Stack>
          ) : (
            <Text tone="muted">Your role cannot export load files.</Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function ValueMapTab({ run, targetType, canEdit }: { run: MigrationRunDetail; targetType: string; canEdit: boolean }) {
  const modules = run.run.modules;
  const [module, setModule] = useState(modules[0] ?? "");
  const { data: maps = [] } = useQuery({
    queryKey: ["migration.fieldmap", module, targetType],
    queryFn: () => getFieldMap(module, targetType),
    enabled: Boolean(module),
  });
  const fields = maps.filter((m) => m.value_map && m.dest_table && m.dest_field).map((m) => `${m.dest_table}.${m.dest_field}`);
  const [field, setField] = useState("");
  const active = fields.includes(field) ? field : fields[0] ?? "";

  return (
    <Stack gap={3}>
      <Stack direction="row" gap={2}>
        <Select value={module} aria-label="Module" options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))}
          onValueChange={setModule} />
        {fields.length > 0 && (
          <Select value={active} aria-label="Target field" options={fields.map((f) => ({ value: f, label: f }))}
            onValueChange={setField} />
        )}
      </Stack>
      {active ? (
        <ValueMapEditor key={`${module}:${active}`} runId={run.run.id} module={module} targetField={active} canEdit={canEdit} />
      ) : (
        <Text tone="muted">No mapping in this module is marked &ldquo;value map&rdquo;. Tick it on a field map row whose source codes differ from the target (e.g. vendor account group to BP grouping).</Text>
      )}
    </Stack>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export function MigrationSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  const canEdit = can("analyse");
  const canExport = can("export");
  const mode: MigrationMode = "source_to_destination"; // in-place write-back mode stays off
  const [sourceId, setSourceId] = useState("");
  const [target, setTarget] = useState(STANDARD_TARGET);
  const [modules, setModules] = useState<Set<string>>(new Set());
  const [runId, setRunId] = useState<string | null>(null);

  const { data: systems = [] } = useQuery({ queryKey: ["systems"], queryFn: getSystems });
  const { data: sourceModules = [] } = useQuery({
    queryKey: ["system-modules", sourceId],
    queryFn: () => getSystemModules(sourceId),
    enabled: Boolean(sourceId),
  });
  const { data: recentRuns = [] } = useQuery({ queryKey: ["migration.runs"], queryFn: () => getMigrationRuns() });
  const { data: run } = useQuery({
    queryKey: ["migration.run", runId],
    queryFn: () => getMigrationRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (q) => {
      const s = q.state.data?.run.status;
      return s === "queued" || s === "running" ? 2000 : false;
    },
  });

    const destSystem = systems.find((s) => s.id === target);
  const targetType = destSystem?.system_type ?? "s4hana";
  const selected = Array.from(modules);
  const working = run?.run.status === "queued" || run?.run.status === "running";
  const runTargetType = run
    ? run.run.target_release ?? systems.find((s) => s.id === run.run.dest_system_id)?.system_type ?? targetType
    : targetType;

  const analyze = useMutation({
    mutationFn: () =>
      startMigration({
        mode,
        source_system_id: sourceId,
        dest_system_id: destSystem ? destSystem.id : null,
        target_release: "s4hana",
        modules: selected,
      }),
    onSuccess: (d) => {
      setRunId(d.run_id);
      qc.invalidateQueries({ queryKey: ["migration.runs"] });
      toast.success("Transfer-readiness analysis started");
    },
    onError: (e) => toast.error((e as Error).message || "Could not start the analysis"),
  });

  const toggle = (m: string) =>
    setModules((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

  return (
    <div className="ui-page">
      <p className="ui-note">
        Analyse the source system&apos;s data record by record against the target: a connected S/4HANA system&apos;s own dictionary and configuration, or the SAP S/4HANA standard before it exists. Then export load files for the records that are ready.
      </p>

      <SectionCard title="Scope">
        <Stack gap={4}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select placeholder="Source system…" value={sourceId} aria-label="Source system"
              options={systems.map((s) => ({ value: s.id, label: `${s.name}, ${s.system_type} (${s.environment})` }))}
              onValueChange={(v) => { setSourceId(v); setModules(new Set()); setRunId(null); }} />
            <Select value={target} aria-label="Target"
              options={[
                { value: STANDARD_TARGET, label: "SAP S/4HANA standard (target not built yet)" },
                ...systems.filter((s) => s.id !== sourceId).map((s) => ({
                  value: s.id, label: `${s.name}, ${s.system_type} (${s.environment}), live dictionary and config` })),
              ]}
              onValueChange={(v) => { setTarget(v); setRunId(null); }} />
          </div>
          {sourceId && (
            <Stack gap={2}>
              <Text variant="text-small" tone="secondary">Modules</Text>
              <Stack direction="row" gap={2} wrap>
                {sourceModules.length === 0 && <Text tone="muted">Nothing extracted from this system yet. Run an extraction first.</Text>}
                {sourceModules.map((m) => (
                  <Chip key={m.module} selected={modules.has(m.module)} onClick={() => toggle(m.module)}>
                    {formatModuleName(m.module)} <span className="aurora-number opacity-70">{m.row_count.toLocaleString()}</span>
                  </Chip>
                ))}
              </Stack>
            </Stack>
          )}
        </Stack>
      </SectionCard>

      {sourceId && selected.length > 0 && (
        <SectionCard title="Field map">
          <Stack gap={6}>
            {selected.map((m) => (
              <Stack key={m} gap={2}>
                <Text variant="text-body" className="font-semibold">{formatModuleName(m)}</Text>
                <FieldMapEditor module={m} targetType={targetType} sourceSystemId={sourceId}
                  sourceType={systems.find((s) => s.id === sourceId)?.system_type ?? "ecc"} canEdit={canEdit} />
              </Stack>
            ))}
          </Stack>
        </SectionCard>
      )}

      <SectionCard title="Analyse">
        <Stack direction="row" gap={3} align="center">
          <Button leadingIcon={working ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
            disabled={!canEdit || !sourceId || selected.length === 0 || analyze.isPending || working}
            onClick={() => analyze.mutate()}>
            {working ? "Analysing…" : "Analyse transfer readiness"}
          </Button>
          {!canEdit && <Text tone="muted">Your role can view results but not start an analysis.</Text>}
        </Stack>
      </SectionCard>

      {run && run.run.mode === "source_to_destination" && (
        <SectionCard title="Result">
          {working ? (
            <Text tone="secondary">Gap-analysing {run.run.modules.map(formatModuleName).join(", ")}…</Text>
          ) : (
            <RunResult run={run} targetType={runTargetType} canEdit={canEdit} canExport={canExport} />
          )}
        </SectionCard>
      )}

      {recentRuns.length > 0 && (
        <SectionCard title="Recent runs">
          <Stack gap={1}>
            {recentRuns.slice(0, 10).map((r) => (
              <button key={r.id} onClick={() => setRunId(r.id)}
                className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-[13px] hover:bg-[var(--aurora-elev-2-bg)]">
                <span>{r.modules.map(formatModuleName).join(", ")}</span>
                <span className="text-[var(--aurora-fg-tertiary)]">
                  {r.mode === "source_to_source" ? "in place" : r.target_connected ? "connected target" : "SAP standard"}
                </span>
                {r.readiness_verdict && <Chip tone={VERDICT[r.readiness_verdict].tone}>{VERDICT[r.readiness_verdict].label}</Chip>}
                <span className="ml-auto aurora-number text-[var(--aurora-fg-tertiary)]">
                  {r.records_total ? `${(r.records_total - r.records_blocked).toLocaleString()}/${r.records_total.toLocaleString()} ready` : r.status}
                </span>
                <span className="text-[var(--aurora-fg-tertiary)]">{relativeTime(r.created_at)}</span>
              </button>
            ))}
          </Stack>
        </SectionCard>
      )}
    </div>
  );
}
