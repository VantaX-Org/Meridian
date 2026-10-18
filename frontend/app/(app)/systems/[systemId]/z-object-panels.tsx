"use client";

/** Systems/[id] › Custom objects: editing the registry, Z rules, the standard-field mapping and the governance report. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, Card, DataTable, Dialog, Drawer, EmptyState, ErrorState, Field, Input, Mono, Pill, Select, Skeleton, Stat, type PillTone } from "@/design";
import { downloadCsv } from "@/lib/actions";
import {
  createZRule, getZMapping, getZReport, getZRegistry, getZRules, updateZRegistryEntry,
  type ZCustomRule, type ZMapping, type ZRegistryEntry, type ZRegistryStatus, type ZRuleTemplate,
} from "@/lib/api/z-objects";
import { apiErrorMessage, isNotFound, apiErrorState } from "@/lib/error";
import { formatModuleName, labelOf } from "@/lib/format";

const SEVERITY_TONE: Record<string, PillTone> = { critical: "no-go", high: "no-go", medium: "at-risk", low: "neutral" };
const STATUS_OPTIONS: { value: ZRegistryStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "dormant", label: "Dormant" },
  { value: "deprecated", label: "Deprecated" },
  { value: "under_review", label: "Under review" },
];
const SEVERITY_OPTIONS = ["critical", "high", "medium", "low"].map((value) => ({ value, label: labelOf(value) }));
const dash = (v: string | null | undefined) => v ?? "—";
const n = (v: number) => v.toLocaleString();

/** The editable part of a registry entry: owner, purpose, standard equivalent, status and notes. */
export function RegistryEditor({ entry, canEdit }: { entry: ZRegistryEntry; canEdit: boolean }) {
  const qc = useQueryClient();
  const [owner, setOwner] = useState(entry.owner ?? "");
  const [purpose, setPurpose] = useState(entry.description ?? "");
  const [standard, setStandard] = useState(entry.standard_equivalent ?? "");
  const [status, setStatus] = useState<string>(entry.status);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const save = useMutation({
    mutationFn: () => updateZRegistryEntry(entry.id, {
      owner, description: purpose, standard_equivalent: standard, status: status as ZRegistryStatus, notes,
    }),
    onSuccess: () => { toast.success(`${entry.object_name} saved`); void qc.invalidateQueries({ queryKey: ["z-objects"] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-3" data-testid="registry-editor">
      <p className="font-medium m-text-body">Registry entry</p>
      <Field label="Owner"><Input value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!canEdit} /></Field>
      <Field label="Purpose"><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={!canEdit} /></Field>
      <Field label="Standard equivalent"><Input value={standard} onChange={(e) => setStandard(e.target.value)} disabled={!canEdit} /></Field>
      <Field label="Status"><Select value={status} onValueChange={setStatus} options={STATUS_OPTIONS} /></Field>
      <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} /></Field>
      {canEdit ? <div className="flex justify-end"><Button onClick={() => save.mutate()} pending={save.isPending}>Save changes</Button></div> : null}
    </div>
  );
}

function NewRuleDrawer({ open, onOpenChange, entries }: { open: boolean; onOpenChange: (o: boolean) => void; entries: ZRegistryEntry[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [objectId, setObjectId] = useState("any");
  const [showErrors, setShowErrors] = useState(false);
  const create = useMutation({
    mutationFn: () => createZRule({
      rule_name: name.trim(), custom_condition: condition.trim(), severity: severity as "critical" | "high" | "medium" | "low",
      ...(objectId !== "any" ? { z_object_id: objectId } : {}),
    }),
    onSuccess: () => {
      toast.success("Z rule created");
      setName(""); setCondition(""); setObjectId("any"); setShowErrors(false);
      void qc.invalidateQueries({ queryKey: ["z-objects", "rules"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const objectOptions = [{ value: "any", label: "Any custom object" }, ...entries.map((e) => ({ value: e.id, label: e.object_name }))];
  const submit = () => {
    if (!name.trim() || !condition.trim()) { setShowErrors(true); return; }
    create.mutate();
  };
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="New Z rule"
      footer={<Button onClick={submit} pending={create.isPending}>Create rule</Button>}
    >
      <div className="flex flex-col gap-3">
        <Field label="Rule name" error={showErrors && !name.trim() ? "Enter a rule name" : undefined}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Condition" error={showErrors && !condition.trim() ? "Enter the condition" : undefined}><Input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="ZZFIELD is not blank" /></Field>
        <Field label="Severity"><Select value={severity} onValueChange={setSeverity} options={SEVERITY_OPTIONS} /></Field>
        <Field label="Applies to"><Select value={objectId} onValueChange={setObjectId} options={objectOptions} /></Field>
      </div>
    </Drawer>
  );
}

export function RulesSection({ canCreate }: { canCreate: boolean }) {
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["z-objects", "rules"], queryFn: getZRules, retry: false });
  const registry = useQuery({ queryKey: ["z-objects", "registry"], queryFn: getZRegistry, retry: false });
  const entries = useMemo(() => registry.data?.entries ?? [], [registry.data]);
  const nameOf = useMemo(() => new Map(entries.map((e) => [e.id, e.object_name])), [entries]);
  const ruleCols = useMemo<ColumnDef<ZCustomRule>[]>(() => [
    { id: "name", header: "Rule", cell: ({ row }) => row.original.rule_name },
    { id: "cond", header: "Condition", cell: ({ row }) => <Mono>{dash(row.original.custom_condition)}</Mono> },
    { id: "object", header: "Applies to", cell: ({ row }) => (row.original.z_object_id ? nameOf.get(row.original.z_object_id) ?? "—" : "Any custom object") },
    { id: "severity", header: "Severity", cell: ({ row }) => <Pill tone={SEVERITY_TONE[row.original.severity] ?? "neutral"}>{labelOf(row.original.severity)}</Pill> },
    { id: "active", header: "State", cell: ({ row }) => <Pill tone={row.original.is_active ? "go" : "neutral"}>{row.original.is_active ? "Active" : "Inactive"}</Pill> },
  ], [nameOf]);
  const templateCols = useMemo<ColumnDef<ZRuleTemplate>[]>(() => [
    { id: "name", header: "Template", cell: ({ row }) => row.original.name },
    { id: "desc", header: "What it checks", cell: ({ row }) => row.original.description },
    { id: "severity", header: "Default severity", cell: ({ row }) => <Pill tone={SEVERITY_TONE[row.original.default_severity] ?? "neutral"}>{labelOf(row.original.default_severity)}</Pill> },
  ], []);
  if (q.isLoading) return <Skeleton height={200} />;
  if (q.error) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  const custom = q.data?.custom_rules ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Custom Z rules"
        actions={canCreate ? <Button onClick={() => setCreating(true)}>New Z rule</Button> : undefined}
      >
        {custom.length === 0 ? (
          <EmptyState variant="inline" title="No custom Z rules yet" detail="Templates below cover the common checks" />
        ) : (
          <DataTable columns={ruleCols} data={custom} getRowId={(r) => r.id} hideToolbar dense height="auto" tableId="z-custom-rules" />
        )}
      </Card>
      <Card title="Rule templates">
        <DataTable columns={templateCols} data={q.data?.templates ?? []} getRowId={(t) => t.template_id} hideToolbar dense height="auto" tableId="z-rule-templates" />
      </Card>
      <NewRuleDrawer open={creating} onOpenChange={setCreating} entries={entries} />
    </div>
  );
}

export function MappingSection() {
  const q = useQuery({ queryKey: ["z-objects", "mapping"], queryFn: getZMapping, retry: false });
  const cols = useMemo<ColumnDef<ZMapping>[]>(() => [
    { id: "name", header: "Custom field", cell: ({ row }) => <Mono>{row.original.object_name}</Mono> },
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "std", header: "Standard field", cell: ({ row }) => (row.original.standard_equivalent ? <Mono>{row.original.standard_equivalent}</Mono> : "Not mapped") },
    { id: "conf", header: "Confidence", cell: ({ row }) => `${Math.round(row.original.confidence * 100)}%` },
    { id: "source", header: "Source", cell: ({ row }) => labelOf(row.original.mapping_source) },
  ], []);
  if (q.isLoading) return <Skeleton height={200} />;
  if (q.error && isNotFound(q.error)) return <EmptyState title="No custom object analysis yet" detail="Detect custom objects to see their standard mapping" />;
  if (q.error) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  const mappings = q.data?.mappings ?? [];
  if (mappings.length === 0) return <EmptyState title="No mappings yet" detail="Mappings appear once custom objects are detected" />;
  return <DataTable columns={cols} data={mappings} getRowId={(m) => `${m.module}/${m.object_name}`} height={380} exportName="z-object-mapping" />;
}

/** The governance report as a dialog with a CSV download of its counts. */
export function ReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({ queryKey: ["z-objects", "report"], queryFn: getZReport, retry: false, enabled: open });
  const r = q.data;
  const rows = r ? [
    { measure: "Custom objects", value: r.total_z_objects },
    { measure: "Active anomalies", value: r.active_anomalies },
    { measure: "Ghost objects", value: r.ghost_objects },
    { measure: "Dormant objects", value: r.dormant_objects },
    { measure: "Mapped to standard", value: r.mapped_to_standard },
    { measure: "Unmapped", value: r.unmapped },
    ...Object.entries(r.by_status).map(([k, v]) => ({ measure: `Status: ${labelOf(k)}`, value: v })),
    ...Object.entries(r.by_module).map(([k, v]) => ({ measure: `Module: ${formatModuleName(k)}`, value: v })),
    ...Object.entries(r.by_category).map(([k, v]) => ({ measure: `Category: ${labelOf(k)}`, value: v })),
  ] : [];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Custom object report"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => downloadCsv("custom-object-report.csv", rows)} disabled={!r}>Download CSV</Button>
        </>
      }
    >
      {q.isLoading ? <Skeleton height={120} /> : q.error ? (
        <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />
      ) : r ? (
        <div className="m-stat-grid" data-testid="z-report">
          <Stat label="Custom objects" value={n(r.total_z_objects)} />
          <Stat label="Active anomalies" value={n(r.active_anomalies)} />
          <Stat label="Ghost objects" value={n(r.ghost_objects)} />
          <Stat label="Dormant objects" value={n(r.dormant_objects)} />
          <Stat label="Mapped to standard" value={n(r.mapped_to_standard)} />
          <Stat label="Unmapped" value={n(r.unmapped)} />
        </div>
      ) : null}
    </Dialog>
  );
}
