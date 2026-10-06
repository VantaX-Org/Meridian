"use client";

/**
 * Workbench, Exception rules: custom conditions that raise an exception on
 * matching records. Anyone can read them; creating, editing and switching a
 * rule on or off needs manage_rules (api/routes/exceptions.py). New rules
 * start inactive.
 */

import { useMemo, useState } from "react";
import { useUrlState } from "@/hooks/use-url-state";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, Field, FilterBar, Input, Mono, PageHeader, Select,
  TableSkeleton, Tally, Textarea, type AuroraColumnMeta, type ChipTone,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { createExceptionRule, getExceptionRules, updateExceptionRule } from "@/lib/api/exceptions";
import { getAssignableUsers } from "@/lib/api/users";
import type { ExceptionRule } from "@/types/api";

/** Rule types the evaluator understands, with the condition syntax each parses. */
const RULE_TYPES = [
  { value: "field_condition", label: "Field condition", hint: "FIELD == VALUE, FIELD != VALUE or FIELD IS NULL" },
  { value: "threshold", label: "Threshold", hint: "FIELD > VALUE or FIELD > AVG(FIELD) * N" },
  { value: "temporal", label: "Temporal", hint: "DATE_FIELD < TODAY + N (or -, >, <=, >=)" },
  { value: "relationship", label: "Relationship", hint: "NOT EXISTS FIELD" },
];
const SEVERITIES = ["low", "medium", "high", "critical"].map((v) => ({ value: v, label: v }));
const SEVERITY_TONE: Record<string, ChipTone> = { low: "neutral", medium: "info", high: "warning", critical: "danger" };
const HREF = "/admin?tab=exception-rules";
const meta = (m: AuroraColumnMeta) => m;
const typeLabel = (t: string) => RULE_TYPES.find((r) => r.value === t)?.label ?? t;
const errText = (e: unknown, fallback: string) => {
  const detail = (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
  return typeof detail === "string" ? detail : (e as Error).message || fallback;
};

export function ExceptionRulesSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  const write = can("manage_rules");
  const users = useQuery({ queryKey: ["users.assignable"], queryFn: getAssignableUsers, enabled: can("assign") });
  const rules = useQuery({ queryKey: ["exceptions.rules"], queryFn: getExceptionRules });
  const [editing, setEditing] = useState<ExceptionRule | "new" | null>(null);
  const [severity, setSeverity] = useUrlState("severity");
  const rows = useMemo(() => rules.data?.rules ?? [], [rules.data]);
  const shown = severity ? rows.filter((r) => r.severity === severity) : rows;
  const nActive = rows.filter((r) => r.is_active).length;
  const nCritical = rows.filter((r) => r.is_active && r.severity === "critical").length;
  const name = (id: string | null) => (!id ? "None" : users.data?.find((u) => u.id === id)?.name ?? id);

  const toggle = useMutation({
    mutationFn: (r: ExceptionRule) => updateExceptionRule(r.id, { is_active: !r.is_active }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["exceptions.rules"] }); toast.success(r.is_active ? "Rule activated" : "Rule deactivated"); },
    onError: (e) => toast.error(errText(e, "Rule not changed")),
  });

  const columns = useMemo<ColumnDef<ExceptionRule, unknown>[]>(() => [
    { id: "name", header: "Name", meta: meta({ sticky: "start", width: 220 }), cell: ({ row }) => <span title={row.original.description}>{row.original.name}</span> },
    { id: "type", header: "Type", meta: meta({ width: 140 }), cell: ({ row }) => typeLabel(row.original.rule_type) },
    { id: "object", header: "Object", meta: meta({ width: 150 }), cell: ({ row }) => row.original.object_type },
    { id: "condition", header: "Condition", meta: meta({ width: 260 }), cell: ({ row }) => <Mono>{row.original.condition}</Mono> },
    { id: "severity", header: "Severity", meta: meta({ width: 110 }), cell: ({ row }) => <Chip tone={SEVERITY_TONE[row.original.severity] ?? "neutral"}>{row.original.severity}</Chip> },
    { id: "assign", header: "Assigns to", meta: meta({ width: 150 }), cell: ({ row }) => name(row.original.auto_assign_to) },
    { id: "active", header: "Active", meta: meta({ width: 80, align: "end" }), cell: ({ row }) => (
      <input type="checkbox" aria-label={`Activate ${row.original.name}`} checked={row.original.is_active}
        disabled={!write || toggle.isPending} onClick={(e) => e.stopPropagation()} onChange={() => toggle.mutate(row.original)} />) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [write, toggle.isPending, users.data]);

  return (
    <div className="ui-page">
      <PageHeader title="Exception rules" summary="Each active rule raises an exception when records match its condition." />
      <Tally level={4} label="Rules" figures={[
        { label: "Rules", value: rules.isLoading ? null : rows.length || "None", loading: rules.isLoading, verdict: rows.length ? "Defined for this tenant." : "No rule is defined yet.", href: HREF },
        { label: "Active", value: rules.isLoading ? null : nActive || "None", loading: rules.isLoading, verdict: nActive ? "Raising exceptions now." : "No rule is switched on.", href: HREF },
        { label: "Critical", value: rules.isLoading ? null : nCritical || "None", loading: rules.isLoading, tone: nCritical ? "danger" : undefined, verdict: nCritical ? "Active at critical severity." : "No critical rule is active.", href: HREF },
      ]} />
      {!write ? <Banner tone="info" title="Read only">Changing exception rules needs the manage rules permission.</Banner> : null}
      <FilterBar onClear={severity ? () => setSeverity("") : undefined}
        actions={write ? <Button onClick={() => setEditing("new")}>New rule</Button> : undefined}>
        <Select placeholder="All severities" value={severity} aria-label="Severity" options={SEVERITIES} onValueChange={setSeverity} />
      </FilterBar>
      {rules.isLoading ? <TableSkeleton rows={6} label="Loading exception rules" />
        : rules.error ? <Banner tone="danger" title="Rules could not be read">{errText(rules.error, "")}</Banner>
        : shown.length ? <DataTable<ExceptionRule> ariaLabel="Exception rules. Press Enter to open a rule." columns={columns} data={shown} getRowId={(r) => r.id} maxHeight="62vh"
            onRowActivate={write ? (r) => setEditing(r) : undefined} />
        : <EmptyState>{severity ? "No rule at this severity." : "No exception rules yet."}</EmptyState>}

      <DetailDrawer open={!!editing} onClose={() => setEditing(null)} ariaLabel="Exception rule"
        header={<h2 className="ui-drawer-head__title">{editing === "new" ? "New exception rule" : "Edit exception rule"}</h2>}>
        {editing ? <RuleForm rule={editing === "new" ? null : editing} users={users.data ?? []} onDone={() => setEditing(null)} /> : null}
      </DetailDrawer>
    </div>
  );
}

function RuleForm({ rule, users, onDone }: { rule: ExceptionRule | null; users: { id: string; name: string }[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<"name" | "description" | "rule_type" | "object_type" | "condition" | "severity" | "auto_assign_to", string>>({
    name: rule?.name ?? "", description: rule?.description ?? "", rule_type: rule?.rule_type ?? "field_condition",
    object_type: rule?.object_type ?? "", condition: rule?.condition ?? "", severity: rule?.severity ?? "medium",
    auto_assign_to: rule?.auto_assign_to ?? "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      // PUT only changes fields it is sent (null is ignored), so an assignee can be changed but not removed.
      const body = { ...f, auto_assign_to: f.auto_assign_to || undefined };
      return rule ? updateExceptionRule(rule.id, body) : createExceptionRule(body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["exceptions.rules"] }); toast.success("Rule saved"); onDone(); },
    onError: (e) => toast.error(errText(e, "Rule not saved")),
  });
  const ready = f.name.trim() && f.description.trim() && f.object_type.trim() && f.condition.trim();
  const current = rule?.auto_assign_to;
  const assignees = [
    { value: "", label: current ? "Unchanged" : "Nobody" },
    ...users.map((u) => ({ value: u.id, label: u.name })),
    ...(current && !users.some((u) => u.id === current) ? [{ value: current, label: current }] : []),
  ];
  return (
    <div className="ui-form">
      <Field label="Name" required>{({ controlId }) => <Input id={controlId} value={f.name} onChange={(e) => set("name")(e.target.value)} />}</Field>
      <Field label="Description" required>{({ controlId }) => <Textarea id={controlId} value={f.description} onChange={(e) => set("description")(e.target.value)} />}</Field>
      <Field label="Type">{({ controlId }) => <Select id={controlId} options={RULE_TYPES} value={f.rule_type} onValueChange={set("rule_type")} />}</Field>
      <Field label="Object type" required helper="The record type the rule runs on, such as business_partner.">
        {({ controlId }) => <Input id={controlId} value={f.object_type} onChange={(e) => set("object_type")(e.target.value)} />}
      </Field>
      <Field label="Condition" required helper={RULE_TYPES.find((r) => r.value === f.rule_type)?.hint}>
        {({ controlId }) => <Input id={controlId} value={f.condition} onChange={(e) => set("condition")(e.target.value)} />}
      </Field>
      <Field label="Severity">{({ controlId }) => <Select id={controlId} options={SEVERITIES} value={f.severity} onValueChange={set("severity")} />}</Field>
      <Field label="Assign to" helper={users.length ? undefined : "The user list needs the assign permission."}>
        {({ controlId }) => <Select id={controlId} options={assignees} value={f.auto_assign_to} onValueChange={set("auto_assign_to")} />}
      </Field>
      <div className="ui-form__actions">
        <Button disabled={save.isPending || !ready} onClick={() => save.mutate()}>{save.isPending ? "Saving" : "Save rule"}</Button>
        <Button variant="ghost" onClick={onDone}>Close without saving</Button>
      </div>
    </div>
  );
}
