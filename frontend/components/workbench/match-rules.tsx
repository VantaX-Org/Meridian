"use client";

/**
 * Workbench → Match rules: the rules the match & merge engine scores
 * duplicate candidates with, per domain. Edit a rule, switch it off, and
 * simulate the whole set against the domain's current records before it
 * goes live — the simulation reports how many pairs would auto-merge, be
 * dismissed, or land in the steward queue.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Button, Chip, DataTable, Drawer, EmptyState, Field, Input, KpiRail, Select, Stack, Stat, Text, type AuroraColumnMeta,
} from "@/components/aurora";
import { useRole } from "@/hooks/use-role";
import { createMatchRule, deleteMatchRule, getMatchRules, simulateMatchRules, updateMatchRule } from "@/lib/api/match-rules";
import { formatModuleName } from "@/lib/format";
import type { MatchRule, MatchType, SimulationResult } from "@/types/api";

const MATCH_TYPES: { value: MatchType; label: string; hint: string }[] = [
  { value: "exact", label: "Exact", hint: "Values identical after normalisation" },
  { value: "fuzzy", label: "Fuzzy", hint: "Edit-distance similarity on text" },
  { value: "phonetic", label: "Phonetic", hint: "Sounds-alike names (Soundex / Metaphone)" },
  { value: "numeric_range", label: "Numeric range", hint: "Numbers within a tolerance" },
  { value: "semantic", label: "Semantic", hint: "Meaning-level similarity for descriptions" },
];
const DOMAINS = ["business_partner", "material_master", "sd_customer_master", "accounts_payable", "accounts_receivable", "employee_central"];
const meta = (m: AuroraColumnMeta) => m;

type Draft = { domain: string; field: string; match_type: MatchType; weight: number; threshold: number; active: boolean };
const empty = (domain: string): Draft => ({ domain, field: "", match_type: "fuzzy", weight: 1, threshold: 0.85, active: true });

export function MatchRulesSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  const write = can("mdm.write");
  const [domain, setDomain] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<MatchRule | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  const rules = useQuery({ queryKey: ["match-rules", domain], queryFn: () => getMatchRules(domain || undefined) });
  const domains = useMemo(() => Array.from(new Set([...DOMAINS, ...(rules.data?.rules.map((r) => r.domain) ?? [])])).sort(), [rules.data]);
  const list = rules.data?.rules ?? [];
  const active = list.filter((r) => r.active);
  const totalWeight = active.reduce((a, r) => a + r.weight, 0);

  const refresh = () => qc.invalidateQueries({ queryKey: ["match-rules"] });
  const save = useMutation({
    mutationFn: (d: Draft) => (editing ? updateMatchRule(editing.id, d) : createMatchRule(d)),
    onSuccess: () => { refresh(); setDraft(null); setEditing(null); toast.success("Rule saved"); },
    onError: (e) => toast.error((e as Error).message || "Rule not saved"),
  });
  const toggle = useMutation({
    mutationFn: (r: MatchRule) => updateMatchRule(r.id, { active: !r.active }), onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message || "Not saved"),
  });
  const remove = useMutation({
    mutationFn: (r: MatchRule) => deleteMatchRule(r.id), onSuccess: () => { refresh(); toast.success("Rule deleted"); },
    onError: (e) => toast.error((e as Error).message || "Not deleted"),
  });
  const simulate = useMutation({
    mutationFn: (d: string) => simulateMatchRules({ domain: d }), onSuccess: setSimulation,
    onError: (e) => toast.error((e as Error).message || "Simulation failed"),
  });

  const columns = useMemo<ColumnDef<MatchRule, unknown>[]>(() => [
    { id: "domain", header: "Domain", meta: meta({ width: 170 }), cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "field", header: "Field", accessorKey: "field", meta: meta({ width: 180 }),
      cell: ({ row }) => <span className="aurora-number">{row.original.field}</span> },
    { id: "type", header: "Match", meta: meta({ width: 130 }),
      cell: ({ row }) => MATCH_TYPES.find((t) => t.value === row.original.match_type)?.label ?? row.original.match_type },
    { id: "weight", header: "Weight", meta: meta({ width: 90, numeric: true, align: "end" }),
      cell: ({ row }) => row.original.weight.toFixed(2) },
    { id: "threshold", header: "Threshold", meta: meta({ width: 100, numeric: true, align: "end" }),
      cell: ({ row }) => `${Math.round(row.original.threshold * 100)}%` },
    { id: "active", header: "State", meta: meta({ width: 90 }),
      cell: ({ row }) => <Chip tone={row.original.active ? "success" : "neutral"}>{row.original.active ? "active" : "off"}</Chip> },
    { id: "actions", header: "", cell: ({ row }) => write ? (
      <Stack direction="row" gap={2}>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(row.original); setDraft({ ...row.original }); }}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); toggle.mutate(row.original); }}>{row.original.active ? "Switch off" : "Switch on"}</Button>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete the ${row.original.field} rule?`)) remove.mutate(row.original); }}>Delete</Button>
      </Stack>
    ) : null },
  ], [write, toggle, remove]);

  return (
    <Stack gap={6} className="aurora-page">
      <KpiRail>
        <Stat label="Rules" value={list.length} />
        <Stat label="Active" value={active.length} tone={active.length ? "success" : "neutral"} />
        <Stat label="Total weight" value={totalWeight.toFixed(2)} />
        <Stat label="Domains" value={new Set(list.map((r) => r.domain)).size} />
      </KpiRail>

      <Stack direction="row" gap={3} align="center" wrap>
        <Select placeholder="All domains" value={domain} aria-label="Domain"
          options={domains.map((d) => ({ value: d, label: formatModuleName(d) }))} onValueChange={(v) => { setDomain(v); setSimulation(null); }} />
        {write ? <Button onClick={() => { setEditing(null); setDraft(empty(domain || DOMAINS[0])); }}>New rule</Button> : null}
        <Button variant="secondary" disabled={!domain || simulate.isPending} onClick={() => simulate.mutate(domain)}
          title={domain ? "Score every candidate pair in this domain with the active rules" : "Pick a domain to simulate"}>
          {simulate.isPending ? "Simulating…" : "Simulate"}
        </Button>
      </Stack>

      {simulation ? (
        <KpiRail>
          <Stat label="Candidate pairs" value={simulation.total_pairs.toLocaleString()} />
          <Stat label="Would auto-merge" value={simulation.auto_merge_count.toLocaleString()} tone="success" />
          <Stat label="Would dismiss" value={simulation.auto_dismiss_count.toLocaleString()} />
          <Stat label="To steward queue" value={simulation.queue_count.toLocaleString()} tone={simulation.queue_count ? "warning" : "neutral"} />
        </KpiRail>
      ) : null}

      <DataTable<MatchRule>
        ariaLabel="Match rules"
        columns={columns}
        data={list}
        getRowId={(r) => r.id}
        maxHeight={560}
        empty={rules.isLoading ? "Loading…" : domain ? `No rules for ${formatModuleName(domain)} yet.` : "No match rules yet. Add one per field the engine should compare."}
      />

      <Drawer open={!!draft} onClose={() => { setDraft(null); setEditing(null); }} ariaLabel="Match rule"
        header={<Text variant="text-lead">{editing ? `Edit rule · ${editing.field}` : "New match rule"}</Text>}
        footer={draft ? (
          <Stack direction="row" gap={2}>
            <Button onClick={() => save.mutate(draft)} disabled={save.isPending || !draft.field.trim()}>{editing ? "Save" : "Create"}</Button>
            <Button variant="ghost" onClick={() => { setDraft(null); setEditing(null); }}>Discard changes</Button>
          </Stack>
        ) : null}>
        {draft ? (
          <Stack gap={4}>
            <Field label="Domain" required>
              {({ controlId }) => <Select id={controlId} value={draft.domain} options={domains.map((d) => ({ value: d, label: formatModuleName(d) }))}
                onValueChange={(v) => setDraft({ ...draft, domain: v })} />}
            </Field>
            <Field label="Field" helper="SAP field the rule compares, e.g. NAME1, STCD1, STRAS" required>
              {({ controlId }) => <Input id={controlId} value={draft.field} className="aurora-number"
                onChange={(e) => setDraft({ ...draft, field: e.target.value.toUpperCase().trim() })} />}
            </Field>
            <Field label="Match type" helper={MATCH_TYPES.find((t) => t.value === draft.match_type)?.hint}>
              {({ controlId }) => <Select<MatchType> id={controlId} value={draft.match_type} options={MATCH_TYPES}
                onValueChange={(v) => setDraft({ ...draft, match_type: v })} />}
            </Field>
            <Stack direction="row" gap={3}>
              <Field label="Weight" helper="Share of the pair score this field carries">
                {({ controlId }) => <Input id={controlId} type="number" step="0.05" min="0" max="10" value={draft.weight}
                  onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value) })} />}
              </Field>
              <Field label="Threshold" helper="Similarity needed to count as a match (0–1)">
                {({ controlId }) => <Input id={controlId} type="number" step="0.01" min="0" max="1" value={draft.threshold}
                  onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })} />}
              </Field>
            </Stack>
            <Field label="State">
              {({ controlId }) => <Select<"on" | "off"> id={controlId} value={draft.active ? "on" : "off"}
                options={[{ value: "on", label: "Active" }, { value: "off", label: "Off" }]}
                onValueChange={(v) => setDraft({ ...draft, active: v === "on" })} />}
            </Field>
          </Stack>
        ) : null}
      </Drawer>
      {!write ? <EmptyState title="You can view the rules; stewards with MDM write access change them." /> : null}
    </Stack>
  );
}
