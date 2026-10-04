"use client";

/**
 * Workbench → Exception rules: custom conditions that raise an exception on
 * matching records. Anyone can read them; creating, editing and switching a
 * rule on or off needs manage_rules (api/routes/exceptions.py). New rules
 * start inactive.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Drawer, Field, Input, Select, Stack, Text, Textarea } from "@/components/aurora";
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
  const name = (id: string | null) => (!id ? "—" : users.data?.find((u) => u.id === id)?.name ?? id);
  const rules = useQuery({ queryKey: ["exceptions.rules"], queryFn: getExceptionRules });
  const [editing, setEditing] = useState<ExceptionRule | "new" | null>(null);
  const toggle = useMutation({
    mutationFn: (r: ExceptionRule) => updateExceptionRule(r.id, { is_active: !r.is_active }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["exceptions.rules"] }); toast.success(r.is_active ? "Rule activated" : "Rule deactivated"); },
    onError: (e) => toast.error(errText(e, "Rule not changed")),
  });
  const rows = rules.data?.rules ?? [];

  return (
    <Stack gap={4} className="aurora-page">
      {!write ? <Banner tone="info" title="Read only">Changing exception rules needs the manage rules permission.</Banner> : null}
      <Stack direction="row" gap={3} align="center">
        <Text variant="text-small" tone="secondary">Each active rule raises an exception when records match its condition.</Text>
        <span style={{ flex: 1 }} />
        {write ? <Button size="sm" onClick={() => setEditing("new")}>New rule</Button> : null}
      </Stack>
      {rules.isLoading ? <Text tone="muted">Reading rules.</Text>
        : rules.error ? <Banner tone="danger" title="Rules could not be read">{errText(rules.error, "")}</Banner>
        : rows.length ? (
          <table className="aurora-exec__table">
            <thead><tr><th>Name</th><th>Type</th><th>Object</th><th>Condition</th><th>Severity</th><th>Assigns to</th><th>Active</th>{write ? <th /> : null}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td title={r.description}>{r.name}</td>
                <td>{typeLabel(r.rule_type)}</td>
                <td>{r.object_type}</td>
                <td><code>{r.condition}</code></td>
                <td><span className="aurora-workbench__severity" data-severity={r.severity}>{r.severity}</span></td>
                <td>{name(r.auto_assign_to)}</td>
                <td><input type="checkbox" aria-label={`Activate ${r.name}`} checked={r.is_active} disabled={!write || toggle.isPending} onChange={() => toggle.mutate(r)} /></td>
                {write ? <td><Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button></td> : null}
              </tr>
            ))}</tbody>
          </table>
        ) : <Text tone="muted">No exception rules yet.</Text>}
      <Drawer open={!!editing} onClose={() => setEditing(null)} ariaLabel="Exception rule" header={<Text variant="text-lead">{editing === "new" ? "New exception rule" : "Edit exception rule"}</Text>}>
        {editing ? <RuleForm rule={editing === "new" ? null : editing} users={users.data ?? []} onDone={() => setEditing(null)} /> : null}
      </Drawer>
    </Stack>
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
    <Stack gap={3}>
      <Field label="Name" required>{({ controlId }) => <Input id={controlId} value={f.name} onChange={(e) => set("name")(e.target.value)} />}</Field>
      <Field label="Description" required>{({ controlId }) => <Textarea id={controlId} value={f.description} onChange={(e) => set("description")(e.target.value)} />}</Field>
      <Field label="Type">{({ controlId }) => <Select id={controlId} options={RULE_TYPES} value={f.rule_type} onValueChange={set("rule_type")} />}</Field>
      <Field label="Object type" required helper="The record type the rule runs on, e.g. business_partner.">
        {({ controlId }) => <Input id={controlId} value={f.object_type} onChange={(e) => set("object_type")(e.target.value)} />}
      </Field>
      <Field label="Condition" required helper={RULE_TYPES.find((r) => r.value === f.rule_type)?.hint}>
        {({ controlId }) => <Input id={controlId} value={f.condition} onChange={(e) => set("condition")(e.target.value)} />}
      </Field>
      <Field label="Severity">{({ controlId }) => <Select id={controlId} options={SEVERITIES} value={f.severity} onValueChange={set("severity")} />}</Field>
      <Field label="Assign to" helper={users.length ? undefined : "The user list needs the assign permission."}>
        {({ controlId }) => <Select id={controlId} options={assignees} value={f.auto_assign_to} onValueChange={set("auto_assign_to")} />}
      </Field>
      <Stack direction="row" gap={2}>
        <Button disabled={save.isPending || !ready} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save rule"}</Button>
        <Button variant="ghost" onClick={onDone}>Close without saving</Button>
      </Stack>
    </Stack>
  );
}
