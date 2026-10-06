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
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, Field, FilterBar, Input, KeyValue, PageHeader, TableSkeleton, Tally, Textarea,
  useDrawerParam, type AuroraColumnMeta, type ChipTone,
} from "@/components/ui-core";
import { copyToClipboard } from "@/lib/actions";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { activateContract, createContract, getContracts } from "@/lib/api/contracts";
import { relativeTime, formatDate, labelOf } from "@/lib/format";
import type { Contract, ContractStatus } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const STATUS_TONE: Record<ContractStatus, ChipTone> = { active: "success", draft: "neutral", pending_approval: "warning", expired: "danger" };
const STATUSES: ("all" | ContractStatus)[] = ["all", "active", "pending_approval", "draft", "expired"];
const label = labelOf;
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
    { id: "name", header: "Contract", cell: ({ row }) => <span><strong>{row.original.name}</strong>{row.original.description ? <span className="ui-micro" style={{ display: "block" }}>{row.original.description}</span> : null}</span> },
    { id: "flow", header: "Producer and consumer", meta: meta({ width: 280 }), cell: ({ row }) => <span className="ui-cell-stack"><span className="ui-cell-stack__main">{row.original.producer}</span><span className="ui-cell-stack__sub">to {row.original.consumer}</span></span> },
    { id: "compliance", header: "Latest check", meta: meta({ width: 150 }), cell: ({ row }) => (row.original.latest_compliant === true ? "compliant" : row.original.latest_compliant === false ? "not compliant" : "not checked") },
    { id: "checked", header: "Checked", meta: meta({ width: 110 }), cell: ({ row }) => (row.original.last_checked ? relativeTime(row.original.last_checked) : "—") },
  ], []);

  return (
    <div className="ui-page">
      <PageHeader title="Contracts" summary="What each consuming system may expect from a producer, checked on every analysis."
        actions={canCreate ? <Button onClick={() => setCreating(true)}>New contract</Button> : null} />
      <Tally level={4} label="Data contracts" figures={[
        { label: "Contracts", value: q.isLoading ? null : q.data?.total ?? all.length, loading: q.isLoading, verdict: all.length ? "Across every status." : "None written yet.", href: "/admin?tab=contracts" },
        { label: "Active", value: q.isLoading ? null : counts.active, loading: q.isLoading, tone: counts.active ? "success" : undefined, verdict: counts.active ? "Checked on each analysis." : "No contract is being checked.", href: "/admin?tab=contracts&status=active" },
        { label: "Breached", value: q.isLoading ? null : counts.breached, loading: q.isLoading, tone: counts.breached ? "danger" : undefined, verdict: counts.breached ? "Out of compliance now." : "Every active contract holds.", href: "/admin?tab=contracts" },
        { label: "Awaiting approval", value: q.isLoading ? null : counts.pending, loading: q.isLoading, tone: counts.pending ? "warning" : undefined, verdict: counts.pending ? "Needs a second person." : "Nothing waiting on approval.", href: "/admin?tab=contracts&status=pending_approval" },
      ]} />
      {firstBreach ? (
        <Banner tone="danger" title={`${counts.breached} active contract${counts.breached === 1 ? " is" : "s are"} out of compliance`} action={<Button size="sm" variant="secondary" onClick={() => drawer.open(firstBreach.id)}>Open {firstBreach.name}</Button>}>
          {firstBreach.producer} to {firstBreach.consumer}, last checked {firstBreach.last_checked ? relativeTime(firstBreach.last_checked) : "never"}.
        </Banner>
      ) : null}
      <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Filter contracts" }}>
        {STATUSES.map((s) => <Chip key={s} selected={status === s} onClick={() => setStatus(s)}>{s === "all" ? "All" : label(s)}</Chip>)}
      </FilterBar>
      {q.isLoading ? <TableSkeleton rows={6} label="Reading contracts" />
        : q.error ? <Banner tone="danger" title="Contracts could not be read">{(q.error as Error).message}</Banner>
        : visible.length ? <DataTable columns={columns} data={visible} getRowId={(c) => c.id} onRowActivate={(c) => drawer.open(c.id)} ariaLabel="Data contracts" maxHeight="60vh" />
        : <EmptyState>{all.length ? "No contracts match." : "No data contracts yet. A contract states what a consuming system may expect from a producer: schema, quality floor, freshness and volume. Each analysis checks the active ones."}</EmptyState>}
      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Contract details"
        header={selected ? <div className="ui-drawer-head"><Chip tone={breached(selected) ? "danger" : STATUS_TONE[selected.status]}>{breached(selected) ? "breached" : label(selected.status)}</Chip><h2 className="ui-drawer-head__title">{selected.name}</h2></div> : null}>
        {selected ? <ContractDetail contract={selected} canActivate={canActivate} onChanged={refresh} /> : null}
      </DetailDrawer>
      <DetailDrawer open={creating} onClose={() => setCreating(false)} ariaLabel="New data contract" header={<h2 className="ui-drawer-head__title">New data contract</h2>}>
        {creating ? <NewContractForm onDone={() => { setCreating(false); refresh(); }} /> : null}
      </DetailDrawer>
    </div>
  );
}

function ContractDetail({ contract: c, canActivate, onChanged }: { contract: Contract; canActivate: boolean; onChanged: () => void }) {
  const activate = useMutation({ mutationFn: () => activateContract(c.id), onSuccess: () => { toast.success(`${c.name} is active`); onChanged(); }, onError: (e) => toast.error((e as Error).message || "Not activated") });
  const terms = TERMS.filter(([k]) => c[k] && Object.keys(c[k] as object).length);
  return (
    <div className="ui-detail">
      {c.description ? <p className="ui-note">{c.description}</p> : null}
      <KeyValue rows={[
        { k: "Producer", v: c.producer }, { k: "Consumer", v: c.consumer }, { k: "Status", v: label(c.status) },
        { k: "Latest check", v: c.latest_compliant === true ? "compliant" : c.latest_compliant === false ? "not compliant" : "not checked" },
        { k: "Checked", v: c.last_checked ? relativeTime(c.last_checked) : "Never" },
        { k: "Created", v: `${relativeTime(c.created_at)}${c.created_by ? ` by ${c.created_by}` : ""}` },
        { k: "Activated", v: c.activated_at ? `${relativeTime(c.activated_at)}${c.approved_by ? ` by ${c.approved_by}` : ""}` : "Not yet" },
        { k: "Expires", v: c.expires_at ? formatDate(c.expires_at) : "Never" },
      ]} />
      {terms.length ? terms.map(([k, title]) => (
        <div key={k} className="ui-detail-part"><h3 className="ui-detail-part__title">{title} terms</h3><pre className="ui-code">{JSON.stringify(c[k], null, 2)}</pre></div>
      )) : <p className="ui-micro">No terms stated yet; the contract documents the pair until terms are added.</p>}
      <div className="ui-form__actions">
        {canActivate && (c.status === "draft" || c.status === "pending_approval") ? <Button onClick={() => activate.mutate()} disabled={activate.isPending}>{activate.isPending ? "Activating" : "Activate"}</Button> : null}
        <Button variant="ghost" onClick={() => copyToClipboard(c.id, "Contract ID copied")}>Copy ID</Button>
      </div>
      {c.status === "draft" || c.status === "pending_approval" ? <p className="ui-micro">Four eyes: someone other than the author activates a contract.</p> : null}
    </div>
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
      <div className="ui-form">
        <Field label="Contract name" required>{({ controlId }) => <Input id={controlId} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Vendor master to S/4HANA" required />}</Field>
        <div className="ui-fields">
          <Field label="Producer system" required>{({ controlId }) => <Input id={controlId} value={d.producer} onChange={(e) => setD({ ...d, producer: e.target.value })} placeholder="ECC PRD" required />}</Field>
          <Field label="Consumer system" required>{({ controlId }) => <Input id={controlId} value={d.consumer} onChange={(e) => setD({ ...d, consumer: e.target.value })} placeholder="S/4HANA Cloud" required />}</Field>
        </div>
        <Field label="What the contract governs" helper="Optional">{({ controlId }) => <Textarea id={controlId} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} rows={3} />}</Field>
        <p className="ui-micro">It starts as a draft. Add schema, quality, freshness and volume terms, then activate it.</p>
        <div className="ui-form__actions"><Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? "Creating" : "Create draft"}</Button></div>
      </div>
    </form>
  );
}
