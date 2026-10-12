"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Card, DataTable, Drawer, ExplorerPage, Field, Input, Mono, PageHeader, Pill, Select, Stat, Textarea, type PillTone } from "@/design";
import { useRole } from "@/hooks/use-role";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { activateContract, createContract, getContractCompliance, getContracts } from "@/lib/api/contracts";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { relativeTime, formatDate, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { Contract, ContractStatus } from "@/types/api";

type StatusFilter = "all" | "breached" | ContractStatus;
const STATUSES: StatusFilter[] = ["all", "breached", "active", "pending_approval", "draft", "expired"];
const breached = (c: Contract) => c.status === "active" && c.latest_compliant === false;
const TONE: Record<ContractStatus, PillTone> = { active: "go", pending_approval: "at-risk", draft: "neutral", expired: "no-go" };
const TERMS: [keyof Contract, string][] = [["schema_contract", "Schema"], ["quality_contract", "Quality"], ["freshness_contract", "Freshness"], ["volume_contract", "Volume"]];

export default function ContractsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useRole();
  // Backend guards (api/routes/contracts.py): create/update need manage_rules, activate needs approve.
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
  const visible = all.filter((c) => (status === "all" || (status === "breached" ? breached(c) : c.status === status)) && (!term || [c.name, c.producer, c.consumer, c.description ?? ""].join(" ").toLowerCase().includes(term)));
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
          {row.original.description ? <span className="block m-text-meta" style={{ color: "var(--m-ink-3)" }}>{row.original.description}</span> : null}
        </span>
      ),
    },
    { id: "flow", header: "Producer and consumer", cell: ({ row }) => <span>{row.original.producer} to {row.original.consumer}</span> },
    {
      id: "compliance",
      header: "Latest check",
      cell: ({ row }) => (row.original.latest_compliant === true ? "Compliant" : row.original.latest_compliant === false ? "Not compliant" : "Not checked"),
    },
    { id: "checked", header: "Checked", cell: ({ row }) => (row.original.last_checked ? relativeTime(row.original.last_checked) : "—") },
  ], []);

  let state: "loading" | "empty" | "error" | undefined;
  if (q.isLoading) state = "loading";
  else if (isListFailure(q)) state = "error";
  else if (visible.length === 0) state = "empty";

  return (
    <ExplorerPage
      header={<PageHeader title="Data contracts" meta={q.isLoading ? "\u00a0" : `${all.length.toLocaleString()} contracts`} />}
      filterBar={
        <div className="flex items-end justify-between gap-3">
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
          {canCreate ? <Button onClick={() => setCreating(true)}>New contract</Button> : null}
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
            {selected ? <ContractDetail contract={selected} canActivate={canActivate} onChanged={refresh} /> : null}
          </Drawer>
          <Drawer open={creating} onOpenChange={setCreating} title="New data contract">
            {creating ? <NewContractForm onDone={() => { setCreating(false); refresh(); }} /> : null}
          </Drawer>
        </>
      }
    />
  );
}

function ContractDetail({ contract: c, canActivate, onChanged }: { contract: Contract; canActivate: boolean; onChanged: () => void }) {
  const activate = useMutation({
    mutationFn: () => activateContract(c.id),
    onSuccess: () => { toast.success(`${c.name} is active`); onChanged(); },
    onError: (e) => toast.error((e as Error).message || "Not activated"),
  });
  const compliance = useQuery({ queryKey: queryKeys.contractCompliance(c.id), queryFn: () => getContractCompliance(c.id) });
  const terms = TERMS.filter(([k]) => c[k] && Object.keys(c[k] as object).length);
  const history = compliance.data?.compliance_history ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Pill tone={breached(c) ? "no-go" : TONE[c.status]}>{breached(c) ? "Breached" : labelOf(c.status)}</Pill>
      {c.description ? <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>{c.description}</p> : null}
      <dl className="grid grid-cols-[140px_1fr] gap-y-1 m-text-body">
        <dt style={{ color: "var(--m-ink-3)" }}>Producer</dt><dd>{c.producer}</dd>
        <dt style={{ color: "var(--m-ink-3)" }}>Consumer</dt><dd>{c.consumer}</dd>
        <dt style={{ color: "var(--m-ink-3)" }}>Latest check</dt><dd>{c.latest_compliant === true ? "Compliant" : c.latest_compliant === false ? "Not compliant" : "Not checked"}</dd>
        <dt style={{ color: "var(--m-ink-3)" }}>Checked</dt><dd>{c.last_checked ? relativeTime(c.last_checked) : "Never"}</dd>
        <dt style={{ color: "var(--m-ink-3)" }}>Created</dt><dd>{relativeTime(c.created_at)}{c.created_by ? ` by ${c.created_by}` : ""}</dd>
        <dt style={{ color: "var(--m-ink-3)" }}>Activated</dt><dd>{c.activated_at ? `${relativeTime(c.activated_at)}${c.approved_by ? ` by ${c.approved_by}` : ""}` : "Not yet"}</dd>
        <dt style={{ color: "var(--m-ink-3)" }}>Expires</dt><dd>{c.expires_at ? formatDate(c.expires_at) : "Never"}</dd>
      </dl>

      {terms.length ? (
        <div className="flex flex-col gap-3">
          {terms.map(([k, title]) => (
            <div key={k}>
              <Card title={`${title} terms`} padding="sm">
                <dl className="m-text-body grid grid-cols-[140px_1fr] gap-y-1">
                  {Object.entries(c[k] as Record<string, unknown>).map(([key, v]) => (
                    <div key={key} className="contents">
                      <dt style={{ color: "var(--m-ink-3)" }}>{key.replace(/_/g, " ")}</dt>
                      <dd><Mono>{typeof v === "string" ? v : JSON.stringify(v)}</Mono></dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>No terms stated yet; the contract documents the pair until terms are added.</p>
      )}

      <div>
        <h3 className="m-text-body font-semibold mb-2">Compliance history</h3>
        {compliance.isLoading ? (
          <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>Reading compliance history.</p>
        ) : !history.length ? (
          <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No compliance checks recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-2 m-text-body">
                <Pill tone={h.overall_compliant ? "go" : "no-go"}>{h.overall_compliant ? "Compliant" : "Not compliant"}</Pill>
                <span style={{ color: "var(--m-ink-3)" }}>{relativeTime(h.recorded_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        {canActivate && (c.status === "draft" || c.status === "pending_approval") ? (
          <Button onClick={() => activate.mutate()} disabled={activate.isPending}>{activate.isPending ? "Activating…" : "Activate"}</Button>
        ) : null}
        <Mono>{c.id}</Mono>
      </div>
      {c.status === "draft" || c.status === "pending_approval" ? (
        <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>Four eyes: someone other than the author activates a contract.</p>
      ) : null}
    </div>
  );
}

function NewContractForm({ onDone }: { onDone: () => void }) {
  const [d, setD] = useState({ name: "", producer: "", consumer: "", description: "" });
  const create = useMutation({
    mutationFn: () => createContract({ name: d.name, producer: d.producer, consumer: d.consumer, description: d.description || undefined }),
    onSuccess: () => { toast.success("Contract created as a draft"); onDone(); },
    onError: (e) => toast.error((e as Error).message || "Not created"),
  });
  const valid = d.name.trim() && d.producer.trim() && d.consumer.trim();
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }} className="flex flex-col gap-3">
      <Field label="Contract name"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Vendor master to S/4HANA" /></Field>
      <Field label="Producer system"><Input value={d.producer} onChange={(e) => setD({ ...d, producer: e.target.value })} placeholder="ECC PRD" /></Field>
      <Field label="Consumer system"><Input value={d.consumer} onChange={(e) => setD({ ...d, consumer: e.target.value })} placeholder="S/4HANA Cloud" /></Field>
      <Field label="What the contract governs">
        <Textarea rows={3} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </Field>
      <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>It starts as a draft. Add schema, quality, freshness and volume terms, then activate it.</p>
      <div><Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? "Creating…" : "Create draft"}</Button></div>
    </form>
  );
}
