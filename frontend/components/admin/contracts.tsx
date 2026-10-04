"use client";

/**
 * Admin → Contracts: data contracts between a producing and a consuming
 * system — schema, quality, freshness and volume terms — with their latest
 * compliance. Drafts are activated here; breaches are flagged first.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, Drawer, EmptyState, Field, Input, KpiRail, Stack, Stat, Text, Textarea, useDrawerParam, type AuroraColumnMeta, type ChipTone,
} from "@/components/aurora";
import { copyToClipboard } from "@/components/meridian/actions";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { activateContract, createContract, getContracts } from "@/lib/api/contracts";
import { relativeTime } from "@/lib/format";
import type { Contract, ContractStatus } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const STATUS_TONE: Record<ContractStatus, ChipTone> = { active: "success", draft: "neutral", pending_approval: "warning", expired: "danger" };
const STATUSES: ("all" | ContractStatus)[] = ["all", "active", "pending_approval", "draft", "expired"];
const label = (s: string) => s.replace(/_/g, " ");
const breached = (c: Contract) => c.status === "active" && c.latest_compliant === false;
const matches = (c: Contract, q: string) => !q || [c.name, c.producer, c.consumer, c.description ?? ""].join(" ").toLowerCase().includes(q.toLowerCase());
const TERMS: [keyof Contract, string][] = [["schema_contract", "Schema"], ["quality_contract", "Quality"], ["freshness_contract", "Freshness"], ["volume_contract", "Volume"]];

export function ContractsSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  // Backend guards (api/routes/contracts.py): create/update need `manage_rules`, activate needs `approve`.
  const canCreate = can("manage_rules");
  const canActivate = can("approve");
  const [status, setStatus] = useUrlState("status", "all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const drawer = useDrawerParam("contract");
  const q = useQuery({ queryKey: ["contracts.list", { status }], queryFn: () => getContracts(status === "all" ? undefined : status) });
  const all = useMemo(() => q.data?.contracts ?? [], [q.data]);
  const visible = all.filter((c) => matches(c, search));
  const selected = drawer.value ? all.find((c) => c.id === drawer.value) ?? null : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["contracts.list"] });
  const counts = { active: all.filter((c) => c.status === "active").length, pending: all.filter((c) => c.status === "pending_approval").length, draft: all.filter((c) => c.status === "draft").length, breached: all.filter(breached).length };
  const firstBreach = all.find(breached);

  const columns = useMemo<ColumnDef<Contract, unknown>[]>(() => [
    { id: "status", header: "Status", meta: meta({ sticky: "start", width: 130 }), cell: ({ row }) => <Chip tone={breached(row.original) ? "danger" : STATUS_TONE[row.original.status]}>{breached(row.original) ? "breached" : label(row.original.status)}</Chip> },
    { id: "name", header: "Contract", cell: ({ row }) => <span><strong>{row.original.name}</strong>{row.original.description ? <Text variant="text-micro" tone="muted" as="div">{row.original.description}</Text> : null}</span> },
    { id: "flow", header: "Producer → consumer", meta: meta({ width: 280 }), cell: ({ row }) => <span className="aurora-number">{row.original.producer} → {row.original.consumer}</span> },
    { id: "compliance", header: "Latest check", meta: meta({ width: 150 }), cell: ({ row }) => (row.original.latest_compliant === true ? "compliant" : row.original.latest_compliant === false ? "not compliant" : "not checked") },
    { id: "checked", header: "Checked", meta: meta({ width: 110 }), cell: ({ row }) => (row.original.last_checked ? relativeTime(row.original.last_checked) : "—") },
  ], []);

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Contracts" value={q.data?.total ?? all.length} />
        <Stat label="Active" value={counts.active} tone={counts.active ? "success" : "neutral"} />
        <Stat label="Breached" value={counts.breached} tone={counts.breached ? "danger" : "neutral"} />
        <Stat label="Pending approval" value={counts.pending} tone={counts.pending ? "warning" : "neutral"} />
        <Stat label="Draft" value={counts.draft} />
      </KpiRail>
      {firstBreach ? (
        <Banner tone="danger" title={`${counts.breached} active contract${counts.breached === 1 ? " is" : "s are"} out of compliance`} action={<Button size="sm" variant="secondary" onClick={() => drawer.open(firstBreach.id)}>Open {firstBreach.name}</Button>}>
          {firstBreach.producer} → {firstBreach.consumer}, last checked {firstBreach.last_checked ? relativeTime(firstBreach.last_checked) : "—"}.
        </Banner>
      ) : null}
      <Stack direction="row" gap={2} wrap align="center">
        {STATUSES.map((s) => <Chip key={s} selected={status === s} onClick={() => setStatus(s)}>{s === "all" ? "All" : label(s)}</Chip>)}
        <span style={{ flex: 1 }} />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter contracts…" aria-label="Filter contracts" style={{ width: 220 }} />
        {canCreate ? <Button onClick={() => setCreating(true)}>New contract</Button> : null}
      </Stack>
      {q.isLoading ? <Text tone="muted">Reading contracts.</Text>
        : q.error ? <Banner tone="danger" title="Contracts could not be read">{(q.error as Error).message}</Banner>
        : visible.length ? <DataTable columns={columns} data={visible} getRowId={(c) => c.id} onRowActivate={(c) => drawer.open(c.id)} ariaLabel="Data contracts" maxHeight="60vh" />
        : <EmptyState title={all.length ? "No contracts match." : "No data contracts yet."} body="A contract states what a consuming system may expect from a producer: schema, quality floor, freshness and volume. Each analysis checks the active ones." />}
      <Drawer open={!!selected} onClose={drawer.close} ariaLabel="Contract details"
        header={selected ? <Stack direction="row" gap={2} align="center"><Chip tone={breached(selected) ? "danger" : STATUS_TONE[selected.status]}>{breached(selected) ? "breached" : label(selected.status)}</Chip><Text variant="text-lead">{selected.name}</Text></Stack> : null}>
        {selected ? <ContractDetail contract={selected} canActivate={canActivate} onChanged={refresh} /> : null}
      </Drawer>
      <Drawer open={creating} onClose={() => setCreating(false)} ariaLabel="New data contract" header={<Text variant="text-lead">New data contract</Text>}>
        {creating ? <NewContractForm onDone={() => { setCreating(false); refresh(); }} /> : null}
      </Drawer>
    </Stack>
  );
}

function ContractDetail({ contract: c, canActivate, onChanged }: { contract: Contract; canActivate: boolean; onChanged: () => void }) {
  const activate = useMutation({ mutationFn: () => activateContract(c.id), onSuccess: () => { toast.success(`${c.name} is active`); onChanged(); }, onError: (e) => toast.error((e as Error).message || "Not activated") });
  const terms = TERMS.filter(([k]) => c[k] && Object.keys(c[k] as object).length);
  return (
    <Stack gap={4}>
      {c.description ? <Text variant="text-small" tone="secondary">{c.description}</Text> : null}
      <table className="aurora-exec__table"><tbody>
        {([["Producer", c.producer], ["Consumer", c.consumer], ["Status", label(c.status)], ["Latest check", c.latest_compliant === true ? "compliant" : c.latest_compliant === false ? "not compliant" : "not checked"],
          ["Checked", c.last_checked ? relativeTime(c.last_checked) : "—"], ["Created", `${relativeTime(c.created_at)}${c.created_by ? ` by ${c.created_by}` : ""}`],
          ["Activated", c.activated_at ? `${relativeTime(c.activated_at)}${c.approved_by ? ` by ${c.approved_by}` : ""}` : "—"], ["Expires", c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "—"]] as [string, string][])
          .map(([k, v]) => <tr key={k}><td>{k}</td><td className="aurora-number">{v}</td></tr>)}
      </tbody></table>
      {terms.length ? terms.map(([k, title]) => (
        <Stack key={k} gap={2}><Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">{title} terms</Text><pre className="aurora-code">{JSON.stringify(c[k], null, 2)}</pre></Stack>
      )) : <Text variant="text-small" tone="muted">No terms stated yet; the contract documents the pair until terms are added.</Text>}
      <Stack direction="row" gap={2} wrap>
        {canActivate && (c.status === "draft" || c.status === "pending_approval") ? <Button onClick={() => activate.mutate()} disabled={activate.isPending}>{activate.isPending ? "Activating…" : "Activate"}</Button> : null}
        <Button variant="ghost" onClick={() => copyToClipboard(c.id, "Contract ID copied")}>Copy ID</Button>
      </Stack>
      {c.status === "draft" || c.status === "pending_approval" ? <Text variant="text-micro" tone="muted">Four eyes: someone other than the author activates a contract.</Text> : null}
    </Stack>
  );
}

function NewContractForm({ onDone }: { onDone: () => void }) {
  const [d, setD] = useState({ name: "", producer: "", consumer: "", description: "" });
  const create = useMutation({
    mutationFn: () => createContract({ name: d.name, producer: d.producer, consumer: d.consumer, description: d.description || undefined }),
    onSuccess: () => { toast.success("Contract created as a draft"); onDone(); }, onError: (e) => toast.error((e as Error).message || "Not created"),
  });
  const valid = d.name.trim() && d.producer.trim() && d.consumer.trim();
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
      <Stack gap={3}>
        <Field label="Contract name" required>{({ controlId }) => <Input id={controlId} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Vendor master to S/4HANA" required />}</Field>
        <Stack direction="row" gap={3} wrap className="aurora-filters">
          <Field label="Producer system" required>{({ controlId }) => <Input id={controlId} value={d.producer} onChange={(e) => setD({ ...d, producer: e.target.value })} placeholder="ECC PRD" required />}</Field>
          <Field label="Consumer system" required>{({ controlId }) => <Input id={controlId} value={d.consumer} onChange={(e) => setD({ ...d, consumer: e.target.value })} placeholder="S/4HANA Cloud" required />}</Field>
        </Stack>
        <Field label="What the contract governs" helper="Optional">{({ controlId }) => <Textarea id={controlId} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} rows={3} />}</Field>
        <Text variant="text-micro" tone="muted">It starts as a draft. Add schema, quality, freshness and volume terms, then activate it.</Text>
        <Stack direction="row" gap={2}><Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? "Creating…" : "Create draft"}</Button></Stack>
      </Stack>
    </form>
  );
}
