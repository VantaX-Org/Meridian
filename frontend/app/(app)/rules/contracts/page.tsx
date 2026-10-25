"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, DataTable, Drawer, ExplorerPage, Field, Input, PageHeader, Pill, Select, Skeleton, Stat, Status, Textarea, type PillTone } from "@/design";
import { InsightTabs } from "@/app/(app)/insights/_components/InsightViews";
import { InsightActions } from "@/app/(app)/insights/_components/InsightActions";
import { actionColumn, RowButton } from "@/components/mdm/ledger";
import { usePeople } from "@/components/mdm/use-people";
import { ContractTermsEditor, ContractTermsView, hasTerms, type TermsBody } from "./contract-terms";
import { useRole } from "@/hooks/use-role";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { useAuth } from "@/context/auth-context";
import { activateContract, createContract, getContractCompliance, getContracts, updateContract } from "@/lib/api/contracts";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { relativeTime, formatDate, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { length, required, useFormErrors, type Schema } from "@/lib/forms";
import type { Contract, ContractStatus } from "@/types/api";

type StatusFilter = "all" | "breached" | ContractStatus;
const STATUSES: StatusFilter[] = ["all", "breached", "active", "pending_approval", "draft", "expired"];
const breached = (c: Contract) => c.status === "active" && c.latest_compliant === false;
/** A compliance check reads as a verdict: Go when it held, No-go when it broke. */
const Compliance = ({ ok }: { ok: boolean | null | undefined }) =>
  ok == null ? <>Not checked</> : <Status kind="verdict" value={ok ? "go" : "no-go"} />;
const TONE: Record<ContractStatus, PillTone> = { active: "go", pending_approval: "at-risk", draft: "neutral", expired: "no-go" };

export default function ContractsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useRole();
  const { user } = useAuth();
  // Backend guards (api/routes/contracts.py): create/update (incl. submit for approval) need manage_rules;
  // activate needs approve, only from pending_approval, and never by the contract's author.
  const canCreate = can("manage_rules");
  const canActivate = can("approve");
  const [statusRaw, setStatus] = useUrlState("status", "all");
  const status = oneOf<StatusFilter>(statusRaw, STATUSES, "all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const q = useQuery({ queryKey: queryKeys.contracts({}), queryFn: () => getContracts() });
  const all = useMemo(() => q.data?.contracts ?? [], [q.data]);
  const term = search.trim().toLowerCase();
  /** Breached contracts first, then those awaiting approval, then the rest by name. */
const RANK = (c: Contract) => (breached(c) ? 0 : c.status === "pending_approval" ? 1 : 2);
  const visible = all.filter((c) => (status === "all" || (status === "breached" ? breached(c) : c.status === status)) && (!term || [c.name, c.producer, c.consumer, c.description ?? ""].join(" ").toLowerCase().includes(term))).sort((a, b) => RANK(a) - RANK(b) || a.name.localeCompare(b.name));
  const selected = selectedId ? all.find((c) => c.id === selectedId) ?? null : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["contracts"] });

  const counts = {
    active: all.filter((c) => c.status === "active").length,
    pending: all.filter((c) => c.status === "pending_approval").length,
    breached: all.filter(breached).length,
  };

  const columns = useMemo<ColumnDef<Contract>[]>(() => [
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <Pill tone={breached(row.original) ? "no-go" : TONE[row.original.status]}>{breached(row.original) ? "Breached" : labelOf(row.original.status)}</Pill>,
    },
    {
      id: "name",
      header: "Contract",
      cell: ({ row }) => (
        <span>
          <strong>{row.original.name}</strong>
          {row.original.description ? <span className="block m-text-meta m-ink-3">{row.original.description}</span> : null}
        </span>
      ),
    },
    { id: "flow", header: "Producer and consumer", cell: ({ row }) => <span>{row.original.producer} to {row.original.consumer}</span> },
    {
      id: "compliance",
      header: "Latest check",
      cell: ({ row }) => <Compliance ok={row.original.latest_compliant} />,
    },
    { id: "checked", header: "Checked", cell: ({ row }) => (row.original.last_checked ? relativeTime(row.original.last_checked) : "—") },
    actionColumn((c) => <RowButton label={`Open ${c.name}`} onClick={() => setSelectedId(c.id)}>Open</RowButton>),
  ], []);

  let state: "loading" | "empty" | "error" | undefined;
  if (q.isLoading) state = "loading";
  else if (isListFailure(q)) state = "error";
  else if (visible.length === 0) state = "empty";

  return (
    <ExplorerPage
      header={<PageHeader title="Data contracts" meta={`A contract is a promise between the system that produces data and the one that uses it, checked on every analysis.${q.data ? ` ${all.length.toLocaleString()} contracts.` : ""}`} actions={<><InsightActions />{canCreate ? <Button onClick={() => setCreating(true)}>New contract</Button> : null}</>} tabs={<InsightTabs />} />}
      filterBar={
        <div className="flex items-end gap-3">
          <div className="flex items-end gap-3">
            <Field label="Filter contracts">
              <Input aria-label="Filter contracts" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            <Field label="Status">
              <Select
                value={status}
                onValueChange={setStatus}
                options={STATUSES.map((s) => ({ value: s, label: s === "all" ? "All" : labelOf(s) }))}
              />
            </Field>
          </div>
        </div>
      }
      summary={
        <div className="m-stat-grid">
          <Stat label="Breached" value={q.isLoading ? "–" : counts.breached.toLocaleString()} loading={q.isLoading} tone={counts.breached ? "no-go" : undefined} href="/rules/contracts?status=breached" />
          <Stat label="Awaiting approval" value={q.isLoading ? "–" : counts.pending.toLocaleString()} loading={q.isLoading} onClick={() => setStatus("pending_approval")} />
        </div>
      }
      table={<DataTable columns={columns} data={visible} getRowId={(c) => c.id} onRowClick={(c) => setSelectedId(c.id)} />}
      state={state}
      emptyProps={
        all.length
          ? { title: "No contracts match", action: <Button variant="secondary" onClick={() => { setSearch(""); setStatus("all"); }}>Clear filters</Button> }
          : {
              title: "No data contracts yet",
              detail: "A contract turns a rule into a promise with an owner",
              action: canCreate ? <Button onClick={() => setCreating(true)}>New contract</Button> : <Button variant="secondary" onClick={() => router.push("/rules")}>Open rules</Button>,
            }
      }
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
      drawer={
        <>
          <Drawer open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)} title={selected?.name ?? "Contract"}>
            {selected ? <ContractDetail contract={selected} canSubmit={canCreate} canActivate={canActivate} userId={user?.id ?? null} onChanged={refresh} /> : null}
          </Drawer>
          <Drawer open={creating} onOpenChange={setCreating} title="New data contract">
            {creating ? <NewContractForm onDone={(id) => { setCreating(false); refresh(); setSelectedId(id); }} /> : null}
          </Drawer>
        </>
      }
    />
  );
}

function ContractDetail({ contract: c, canSubmit, canActivate, userId, onChanged }: { contract: Contract; canSubmit: boolean; canActivate: boolean; userId: string | null; onChanged: () => void }) {
  const isAuthor = c.created_by != null && c.created_by === userId;
  const { nameOf } = usePeople(userId);
  const by = (id: string | null) => (id ? ` by ${nameOf(id) ?? "a user"}` : "");
  const [editing, setEditing] = useState(false);
  const saveTerms = useMutation({
    mutationFn: (body: TermsBody) => updateContract(c.id, body),
    onSuccess: () => { toast.success(`Terms saved on ${c.name}`); setEditing(false); onChanged(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const termed = hasTerms(c);
  const canEditTerms = canSubmit && c.status === "draft";
  const submit = useMutation({
    mutationFn: () => updateContract(c.id, { status: "pending_approval" }),
    onSuccess: () => { toast.success(`${c.name} is awaiting approval`); onChanged(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const activate = useMutation({
    mutationFn: () => activateContract(c.id),
    onSuccess: () => { toast.success(`${c.name} is active`); onChanged(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const compliance = useQuery({ queryKey: queryKeys.contractCompliance(c.id), queryFn: () => getContractCompliance(c.id) });
  const history = compliance.data?.compliance_history ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Pill tone={breached(c) ? "no-go" : TONE[c.status]}>{breached(c) ? "Breached" : labelOf(c.status)}</Pill>
      {c.description ? <p className="m-text-body m-ink-3">{c.description}</p> : null}
      <dl className="grid grid-cols-[140px_1fr] gap-y-1 m-text-body">
        <dt className="m-ink-3">Producer</dt><dd>{c.producer}</dd>
        <dt className="m-ink-3">Consumer</dt><dd>{c.consumer}</dd>
        <dt className="m-ink-3">Latest check</dt><dd><Compliance ok={c.latest_compliant} /></dd>
        <dt className="m-ink-3">Checked</dt><dd>{c.last_checked ? relativeTime(c.last_checked) : "Never"}</dd>
        <dt className="m-ink-3">Created</dt><dd>{relativeTime(c.created_at)}{by(c.created_by)}</dd>
        <dt className="m-ink-3">Activated</dt><dd>{c.activated_at ? `${relativeTime(c.activated_at)}${by(c.approved_by)}` : "Not yet"}</dd>
        <dt className="m-ink-3">Expires</dt><dd>{c.expires_at ? formatDate(c.expires_at) : "Never"}</dd>
      </dl>

      {editing ? (
        <ContractTermsEditor contract={c} pending={saveTerms.isPending} onSave={(body) => saveTerms.mutate(body)} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <ContractTermsView contract={c} />
          {termed ? null : (
            <p className="m-text-meta m-ink-3">No terms stated yet. A contract promises nothing until it states a quality, freshness, volume or schema term</p>
          )}
          {canEditTerms ? <div><Button variant="secondary" onClick={() => setEditing(true)}>{termed ? "Edit terms" : "Add terms"}</Button></div> : null}
        </>
      )}

      <div>
        <h3 className="m-text-body font-semibold mb-2">Compliance history</h3>
        {compliance.isLoading ? (
          <Skeleton height={48} />
        ) : !history.length ? (
          <p className="m-text-body m-ink-3">{c.status === "active" ? "No check has run yet. The next analysis checks it." : "Checks start once the contract is active."}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-2 m-text-body">
                <Compliance ok={h.overall_compliant} />
                <span className="m-ink-3">{relativeTime(h.recorded_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canSubmit && c.status === "draft" ? (
          <>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending || !termed || editing}>{submit.isPending ? "Submitting…" : "Submit for approval"}</Button>
            {!termed ? <span className="m-text-meta m-ink-3">Add at least one term before submitting it for approval</span> : null}
          </>
        ) : null}
        {canActivate && !isAuthor && c.status === "pending_approval" ? (
          <Button onClick={() => activate.mutate()} disabled={activate.isPending}>{activate.isPending ? "Activating…" : "Activate"}</Button>
        ) : null}
      </div>
      {c.status === "draft" || c.status === "pending_approval" ? (
        <p className="m-text-meta m-ink-3">
          {c.status === "pending_approval" && isAuthor
            ? "You wrote this contract, so someone else with approval rights activates it."
            : "Four eyes: a draft is submitted for approval, then someone other than the author activates it."}
        </p>
      ) : null}
    </div>
  );
}

const CONTRACT_SCHEMA: Schema<{ name: string; producer: string; consumer: string; description: string }> = {
  name: [required("Enter a contract name"), length(1, 200, "Use up to 200 characters")],
  producer: [required("Enter the producer system"), length(1, 200, "Use up to 200 characters")],
  consumer: [required("Enter the consumer system"), length(1, 200, "Use up to 200 characters")],
  description: length(1, 2000, "Use up to 2,000 characters"),
};

function NewContractForm({ onDone }: { onDone: (id: string) => void }) {
  const [d, setD] = useState({ name: "", producer: "", consumer: "", description: "" });
  const create = useMutation({
    mutationFn: () => createContract({ name: d.name, producer: d.producer, consumer: d.consumer, description: d.description || undefined }),
    onSuccess: (r) => { toast.success("Contract created as a draft. Add its terms next"); onDone(r.id); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const form = useFormErrors(CONTRACT_SCHEMA, d);
  const valid = form.valid;
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); form.touchAll(); if (valid) create.mutate(); }} className="flex flex-col gap-3">
      <Field label="Contract name" error={form.error("name")}><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={() => form.blur("name")} placeholder="Vendor master to S/4HANA" /></Field>
      <Field label="Producer system" error={form.error("producer")}><Input value={d.producer} onChange={(e) => setD({ ...d, producer: e.target.value })} onBlur={() => form.blur("producer")} placeholder="ECC PRD" /></Field>
      <Field label="Consumer system" error={form.error("consumer")}><Input value={d.consumer} onChange={(e) => setD({ ...d, consumer: e.target.value })} onBlur={() => form.blur("consumer")} placeholder="S/4HANA Cloud" /></Field>
      <Field label="What the contract governs" error={form.error("description")}>
        <Textarea rows={3} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} onBlur={() => form.blur("description")} />
      </Field>
      <p className="m-text-meta m-ink-3">It starts as a draft. Open it to add its quality, freshness, volume and schema terms, then submit it for approval.</p>
      <div><Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? "Creating…" : "Create draft"}</Button></div>
    </form>
  );
}
