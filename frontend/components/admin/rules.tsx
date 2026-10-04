"use client";

/**
 * Admin → Rules: the check library — shipped YAML rules and the tenant's
 * custom ones — by category, module and severity. A tenant can enable or
 * disable a rule here; everything else about a rule changes through HQ sync
 * or the YAML it came from.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Banner, Button, Chip, DataTable, Drawer, EmptyState, Input, KpiRail, Stack, Stat, Text, useDrawerParam, type AuroraColumnMeta } from "@/components/aurora";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { getRules, getRulesSummary, updateRule, type Rule } from "@/lib/api/rules";
import { formatModuleName } from "@/lib/format";

const meta = (m: AuroraColumnMeta) => m;
const CATEGORIES = [["all", "All"], ["ecc", "ECC"], ["successfactors", "SuccessFactors"], ["warehouse", "Warehouse"]] as const;
const CATEGORY_LABEL: Record<string, string> = { ecc: "ECC", successfactors: "SuccessFactors", warehouse: "Warehouse" };
const sev = (s: string) => (s === "critical" || s === "high" || s === "low" ? s : "medium");
const matches = (r: Rule, q: string) => !q || [r.id, r.name, r.description ?? "", r.module, r.severity, ...(r.tags ?? [])].join(" ").toLowerCase().includes(q.toLowerCase());

export function RulesSurface() {
  const qc = useQueryClient();
  const canManage = useRole().can("manage_rules");
  const [category, setCategory] = useUrlState("category", "all");
  const [search, setSearch] = useState("");
  const drawer = useDrawerParam("rule");
  const summary = useQuery({ queryKey: ["rules.summary"], queryFn: getRulesSummary });
  const rulesQ = useQuery({ queryKey: ["rules.list", { category }], queryFn: () => getRules({ category: category === "all" ? undefined : category, limit: 200 }) });
  const rules = useMemo(() => rulesQ.data?.rules ?? [], [rulesQ.data]);
  const total = rulesQ.data?.total ?? rules.length;
  const visible = rules.filter((r) => matches(r, search));
  const selected = drawer.value ? rules.find((r) => r.id === drawer.value) ?? null : null;
  const totals = useMemo(() => {
    const t = { yaml: 0, hq: 0, enabled: 0, disabled: 0 };
    for (const row of summary.data?.summary ?? []) { if (row.source === "yaml") t.yaml += row.count; else t.hq += row.count; if (row.enabled) t.enabled += row.count; else t.disabled += row.count; }
    return t;
  }, [summary.data]);
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateRule(id, { enabled }),
    onSuccess: (_d, v) => { toast.success(v.enabled ? "Rule enabled" : "Rule disabled"); qc.invalidateQueries({ queryKey: ["rules.list"] }); qc.invalidateQueries({ queryKey: ["rules.summary"] }); },
    onError: (e) => toast.error((e as Error).message || "Rule not updated"),
  });

  const columns = useMemo<ColumnDef<Rule, unknown>[]>(() => [
    { id: "state", header: "State", meta: meta({ sticky: "start", width: 110 }), cell: ({ row }) => (
      <Chip tone={row.original.enabled ? "success" : "neutral"} selected={row.original.enabled}
        onClick={canManage ? () => toggle.mutate({ id: row.original.id, enabled: !row.original.enabled }) : undefined}
        aria-label={`${row.original.enabled ? "Disable" : "Enable"} ${row.original.name}`}>{row.original.enabled ? "enabled" : "disabled"}</Chip>) },
    { id: "rule", header: "Rule", cell: ({ row }) => (
      <span><strong>{row.original.name}</strong>
        <Text variant="text-micro" tone="muted" as="div" className="aurora-number">{row.original.id}{row.original.description ? ` · ${row.original.description.length > 90 ? `${row.original.description.slice(0, 90)}…` : row.original.description}` : ""}</Text></span>) },
    { id: "module", header: "Object", meta: meta({ width: 170 }), cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "category", header: "System", meta: meta({ width: 120 }), cell: ({ row }) => CATEGORY_LABEL[row.original.category] ?? row.original.category },
    { id: "severity", header: "Severity", meta: meta({ width: 100 }), cell: ({ row }) => <span className="aurora-workbench__severity" data-severity={sev(row.original.severity)}>{row.original.severity}</span> },
    { id: "source", header: "Source", meta: meta({ width: 90 }), cell: ({ row }) => (row.original.source === "yaml" ? "built-in" : "custom") },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canManage, toggle.isPending]);

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Rules" value={totals.yaml + totals.hq || total} />
        <Stat label="Built-in" value={totals.yaml} />
        <Stat label="Custom" value={totals.hq} tone={totals.hq ? "info" : "neutral"} />
        <Stat label="Enabled" value={totals.enabled} tone="success" />
        <Stat label="Disabled" value={totals.disabled} tone={totals.disabled ? "warning" : "neutral"} />
      </KpiRail>
      <Stack direction="row" gap={2} wrap align="center">
        {CATEGORIES.map(([k, l]) => <Chip key={k} selected={category === k} onClick={() => setCategory(k)}>{l}</Chip>)}
        <span style={{ flex: 1 }} />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter rules…" aria-label="Filter rules" style={{ width: 240 }} />
      </Stack>
      {!canManage ? <Text variant="text-small" tone="muted">Enabling or disabling a rule needs the manage-rules permission; the library is read-only for you.</Text> : null}
      {rulesQ.isLoading ? <Text tone="muted">Reading the rule library.</Text>
        : rulesQ.error ? <Banner tone="danger" title="Rules could not be read">{(rulesQ.error as Error).message}</Banner>
        : visible.length ? <DataTable columns={columns} data={visible} getRowId={(r) => r.id} onRowActivate={(r) => drawer.open(r.id)} ariaLabel="Rules" maxHeight="60vh" />
        : <EmptyState title="No rules match." body="Loosen the filter or clear the search. Built-in rules ship with Meridian; custom rules arrive through HQ sync." />}
      <Drawer open={!!selected} onClose={drawer.close} ariaLabel="Rule details"
        header={selected ? <Stack direction="row" gap={2} align="center"><span className="aurora-workbench__severity" data-severity={sev(selected.severity)}>{selected.severity}</span><Text variant="text-lead">{selected.name}</Text></Stack> : null}>
        {selected ? (
          <Stack gap={4}>
            {selected.description ? <Text variant="text-small" tone="secondary">{selected.description}</Text> : null}
            <table className="aurora-exec__table"><tbody>
              {([["Rule ID", selected.id], ["Object", formatModuleName(selected.module)], ["System", CATEGORY_LABEL[selected.category] ?? selected.category], ["Source", selected.source === "yaml" ? `built-in${selected.source_yaml ? ` · ${selected.source_yaml}` : ""}` : "custom (HQ)"],
                ["State", selected.enabled ? "enabled" : "disabled"], ["Updated", new Date(selected.updated_at).toLocaleString()]] as [string, string][])
                .map(([k, v]) => <tr key={k}><td>{k}</td><td className="aurora-number">{v}</td></tr>)}
            </tbody></table>
            {selected.tags?.length ? <Stack direction="row" gap={1} wrap>{selected.tags.map((t) => <Chip key={t}>{t}</Chip>)}</Stack> : null}
            {selected.conditions?.length ? (
              <Stack gap={2}><Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Conditions</Text>
                <pre className="aurora-code">{JSON.stringify(selected.conditions, null, 2)}</pre></Stack>
            ) : null}
            {selected.thresholds ? (
              <Stack gap={2}><Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Thresholds</Text>
                <pre className="aurora-code">{JSON.stringify(selected.thresholds, null, 2)}</pre></Stack>
            ) : null}
            {canManage ? (
              <Stack direction="row" gap={2}>
                <Button variant={selected.enabled ? "danger" : "primary"} onClick={() => toggle.mutate({ id: selected.id, enabled: !selected.enabled })} disabled={toggle.isPending}>
                  {selected.enabled ? "Disable rule" : "Enable rule"}
                </Button>
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </Drawer>
    </Stack>
  );
}
