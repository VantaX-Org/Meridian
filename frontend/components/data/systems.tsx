"use client";

/**
 * Data → Systems: every connected SAP system with its connection health and
 * last sync, a drawer per system (test, sync, delete, open), and the connect
 * form for a new one. Reads systems; manage_systems connects/tests/deletes;
 * trigger_sync syncs.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, Drawer, Field, Input, Select, Stack, Text, useDrawerParam, type AuroraColumnMeta,
} from "@/components/aurora";
import { EmptyState, Metric, MetricStrip, Mono, PageHeader, StatusBadge, TableSkeleton, type Status } from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { deleteSystem, getSystems, registerSystem, testConnection, testDraftConnection, triggerSync } from "@/lib/api/systems";
import { relativeTime } from "@/lib/format";
import type { SAPSystem, SystemType } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;

const RFC_TYPES: SystemType[] = ["ecc", "s4hana_onprem", "ewm"];
// concur/ariba are fixed to OAuth2 in the connector dispatch; only these two offer Basic
const AUTH_SELECTABLE: SystemType[] = ["successfactors", "s4hana_cloud"];
const TYPE_OPTIONS: { value: SystemType; label: string }[] = [
  { value: "ecc", label: "ECC" }, { value: "s4hana_onprem", label: "S/4HANA On-Prem" }, { value: "ewm", label: "EWM" },
  { value: "s4hana_cloud", label: "S/4HANA Cloud" }, { value: "successfactors", label: "SuccessFactors" },
  { value: "concur", label: "Concur" }, { value: "ariba", label: "Ariba" },
];
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label])) as Record<SystemType, string>;
const isRfc = (t: SystemType) => RFC_TYPES.includes(t);

type Health = "healthy" | "down" | "awaiting";
const HEALTH_STATUS: Record<Health, Status> = { healthy: "ok", down: "failed", awaiting: "idle" };
const HEALTH_LABEL: Record<Health, string> = { healthy: "Healthy", down: "Last sync failed", awaiting: "Awaiting first sync" };
const HealthBadge = ({ s }: { s: SAPSystem }) => <StatusBadge status={HEALTH_STATUS[health(s)]}>{HEALTH_LABEL[health(s)]}</StatusBadge>;
function health(s: SAPSystem): Health {
  const st = s.last_sync_status;
  if (!st) return "awaiting";
  if (st === "failed") return "down";
  if (st === "running" || st === "completed" || st === "complete") return "healthy";
  return "awaiting";
}

type Draft = {
  name: string; system_type: SystemType; environment: string; description: string;
  host: string; client: string; sysnr: string; username: string; password: string;
  base_url: string; company_id: string; auth: "oauth2_client_credentials" | "basic"; client_id: string; client_secret: string; api_key: string;
};
const EMPTY: Draft = {
  name: "", system_type: "ecc", environment: "DEV", description: "", host: "", client: "", sysnr: "00", username: "", password: "",
  base_url: "", company_id: "", auth: "oauth2_client_credentials", client_id: "", client_secret: "", api_key: "",
};

/** The register / test-connection body, shaped the way the connector dispatch expects. */
function connectBody(d: Draft) {
  const rfc = isRfc(d.system_type);
  const basic = !rfc && AUTH_SELECTABLE.includes(d.system_type) && d.auth === "basic";
  const credentials: Record<string, string> = {};
  if (rfc || basic) credentials.password = d.password;
  else {
    if (d.client_id) credentials.client_id = d.client_id;
    if (d.client_secret) credentials.client_secret = d.client_secret;
    if (d.api_key) credentials.api_key = d.api_key;
  }
  return {
    name: d.name, system_type: d.system_type, environment: d.environment, description: d.description || undefined,
    host: rfc ? d.host : undefined, client: rfc ? d.client : undefined, sysnr: rfc ? d.sysnr : undefined,
    username: rfc || basic ? d.username || undefined : undefined,
    base_url: rfc ? undefined : d.base_url, company_id: rfc ? undefined : d.company_id,
    auth_type: basic ? ("basic" as const) : undefined, credentials,
  };
}

export function SystemsSurface() {
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useRole();
  const canManage = can("manage_systems");
  const canSync = can("trigger_sync");
  const drawer = useDrawerParam("system");
  const [connectOpen, setConnectOpen] = useState(false);

  const systemsQ = useQuery({ queryKey: ["systems.list"], queryFn: getSystems });
  const systems = useMemo(() => systemsQ.data ?? [], [systemsQ.data]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["systems.list"] }); qc.invalidateQueries({ queryKey: ["systems"] }); };
  const counts = systems.reduce((a, s) => ({ ...a, [health(s)]: a[health(s)] + 1 }), { healthy: 0, down: 0, awaiting: 0 } as Record<Health, number>);
  const selected = drawer.value ? systems.find((s) => s.id === drawer.value) ?? null : null;

  const syncAll = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(systems.map((s) => triggerSync(s.id)));
      return results.filter((r) => r.status === "fulfilled").length;
    },
    onSuccess: (ok) => { toast.success(`Triggered ${ok} of ${systems.length} syncs`); refresh(); },
    onError: (e) => toast.error((e as Error).message || "Sync not triggered"),
  });

  const columns = useMemo<ColumnDef<SAPSystem, unknown>[]>(() => [
    { id: "name", header: "System", meta: meta({ sticky: "start", width: 220 }),
      cell: ({ row }) => <span className="ui-cell-stack"><span className="ui-cell-stack__main">{row.original.name}</span><span className="ui-cell-stack__sub">{TYPE_LABEL[row.original.system_type] ?? row.original.system_type}</span></span> },
    { id: "env", header: "Env", meta: meta({ width: 80 }), cell: ({ row }) => <Mono>{row.original.environment}</Mono> },
    { id: "endpoint", header: "Endpoint", cell: ({ row }) => {
      const r = row.original;
      return <span className="ui-cell-stack"><Mono>{r.host ?? r.base_url ?? "Not set"}</Mono>
        {isRfc(r.system_type) && r.client ? <span className="ui-cell-stack__sub">{`Client ${r.client}, system number ${r.sysnr ?? "00"}`}</span> : null}</span>;
    } },
    { id: "sync", header: "Last sync", meta: meta({ width: 130 }), cell: ({ row }) => row.original.last_sync_at ? relativeTime(row.original.last_sync_at) : "Never" },
    { id: "health", header: "Health", meta: meta({ width: 180 }), cell: ({ row }) => <HealthBadge s={row.original} /> },
    { id: "active", header: "State", meta: meta({ width: 90 }), cell: ({ row }) => (row.original.is_active ? "Active" : "Inactive") },
  ], []);

  return (
    <div className="ui-page">
      <PageHeader
        title="Systems"
        summary={systemsQ.isLoading ? undefined : <>{systems.length} connected SAP system{systems.length === 1 ? "" : "s"}. Health is from the last sync; probe connections on <Link href="/connectivity" className="ui-link">Connectivity</Link>.</>}
        actions={<>
          {canSync ? <Button variant="secondary" onClick={() => syncAll.mutate()} disabled={syncAll.isPending || !systems.length}>Sync all</Button> : null}
          {canManage ? <Button onClick={() => setConnectOpen(true)}>Connect system</Button> : null}
        </>}
      />
      {systemsQ.isLoading ? <TableSkeleton rows={6} label="Loading connected systems" /> : systemsQ.error ? (
        <Banner tone="danger" title="Systems could not be read">{(systemsQ.error as Error).message}</Banner>
      ) : systems.length ? (
        <>
          <MetricStrip label="System health">
            <Metric label="Systems" value={systems.length} />
            <Metric label="Healthy" value={counts.healthy} />
            <Metric label="Last sync failed" value={counts.down} tone={counts.down ? "danger" : "default"} />
            <Metric label="Awaiting first sync" value={counts.awaiting} />
          </MetricStrip>
          <div className="ui-table-stacked"><DataTable columns={columns} data={systems} getRowId={(s) => s.id} onRowActivate={(s) => drawer.open(s.id)} ariaLabel="Connected systems" maxHeight="60vh" /></div>
        </>
      ) : (
        <EmptyState action={canManage ? <Button onClick={() => setConnectOpen(true)}>Connect system</Button> : undefined}>
          {canManage ? "No systems connected. Connect an SAP system to discover its design, download objects and analyse them." : "No systems connected. An administrator connects SAP systems here."}
        </EmptyState>
      )}

      <Drawer open={!!selected} onClose={drawer.close} ariaLabel="System details"
              header={selected ? <Text variant="text-lead">{selected.name}</Text> : null}>
        {selected ? <SystemDetail system={selected} canManage={canManage} canSync={canSync} onChanged={refresh} onDeleted={() => { drawer.close(); refresh(); }} /> : null}
      </Drawer>

      <Drawer open={connectOpen} onClose={() => setConnectOpen(false)} ariaLabel="Connect a system" header={<Text variant="text-lead">Connect a system</Text>}>
        {connectOpen ? <ConnectForm onDone={(id) => { setConnectOpen(false); refresh(); router.push(`/systems/${id}`); }} /> : null}
      </Drawer>
    </div>
  );
}

function SystemDetail({ system, canManage, canSync, onChanged, onDeleted }: {
  system: SAPSystem; canManage: boolean; canSync: boolean; onChanged: () => void; onDeleted: () => void;
}) {
  const [result, setResult] = useState<{ connected: boolean; message: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const test = useMutation({ mutationFn: () => testConnection(system.id), onSuccess: setResult, onError: (e) => toast.error((e as Error).message || "Test failed") });
  const sync = useMutation({ mutationFn: () => triggerSync(system.id), onSuccess: (r) => { toast.success(`Sync queued (${r.job_ids.length} jobs)`); onChanged(); },
    onError: (e) => toast.error((e as Error).message || "Sync not triggered") });
  const del = useMutation({ mutationFn: () => deleteSystem(system.id), onSuccess: () => { toast.success(`${system.name} removed`); onDeleted(); },
    onError: (e) => toast.error((e as Error).message || "Not removed") });
  const rfc = isRfc(system.system_type);
  const rows: [string, string][] = rfc
    ? [["Host", system.host ?? "—"], ["Client", system.client ?? "—"], ["System number", system.sysnr ?? "—"], ["RFC user", system.username ?? "default"]]
    : [["Base URL", system.base_url ?? "—"], ["Company", system.company_id ?? "—"], ["Auth", system.auth_type ?? "oauth2"]];
  return (
    <Stack gap={4}>
      <Stack direction="row" gap={2} wrap>
        <HealthBadge s={system} />
        <Chip>{TYPE_LABEL[system.system_type] ?? system.system_type}</Chip>
        <Chip>{system.environment}</Chip>
        <Chip>{system.is_active ? "Active" : "Inactive"}</Chip>
      </Stack>
      <table className="aurora-exec__table"><tbody>
        {rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="aurora-number">{v}</td></tr>)}
        <tr><td>Last sync</td><td>{system.last_sync_at ? `${relativeTime(system.last_sync_at)}, ${system.last_sync_status}` : "never"}</td></tr>
        <tr><td>Registered</td><td>{relativeTime(system.created_at)}</td></tr>
        {system.description ? <tr><td>Description</td><td>{system.description}</td></tr> : null}
      </tbody></table>
      {result ? <Banner tone={result.connected ? "success" : "danger"} title={result.connected ? "Connection succeeded" : "Connection failed"}>{result.message}</Banner> : null}
      <Stack direction="row" gap={2} wrap>
        <Link href={`/systems/${system.id}`} className="ui-link">Open system design, objects and versions</Link>
      </Stack>
      <Stack direction="row" gap={2} wrap>
        {canManage ? <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending ? "Testing…" : "Test connection"}</Button> : null}
        {canSync ? <Button onClick={() => sync.mutate()} disabled={sync.isPending}>Trigger sync</Button> : null}
        {canManage && !confirming ? <Button variant="danger" onClick={() => setConfirming(true)}>Delete</Button> : null}
      </Stack>
      {confirming ? (
        <Banner tone="danger" title={`Remove ${system.name}?`} action={
          <Stack direction="row" gap={2}>
            <Button variant="danger" size="sm" onClick={() => del.mutate()} disabled={del.isPending}>Remove</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep</Button>
          </Stack>}>
          Its credentials and sync profiles go with it. Downloaded versions and findings stay.
        </Banner>
      ) : null}
    </Stack>
  );
}

function ConnectForm({ onDone }: { onDone: (id: string) => void }) {
  const [d, setD] = useState<Draft>(EMPTY);
  const [tested, setTested] = useState<{ connected: boolean; message: string } | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((p) => ({ ...p, [k]: v })); setTested(null); };
  const rfc = isRfc(d.system_type);
  const authSelectable = !rfc && AUTH_SELECTABLE.includes(d.system_type);
  const basic = authSelectable && d.auth === "basic";
  const valid = d.name.trim() && (rfc ? d.host && d.client && d.sysnr && d.password : d.base_url && (basic ? d.username && d.password : d.client_id && d.client_secret));

  const test = useMutation({ mutationFn: () => testDraftConnection(connectBody(d)), onSuccess: setTested, onError: (e) => toast.error((e as Error).message || "Test failed") });
  const create = useMutation({ mutationFn: () => registerSystem(connectBody(d)),
    onSuccess: (s) => { toast.success(`${s.name} connected`); onDone(s.id); }, onError: (e) => toast.error((e as Error).message || "Not connected") });

  const text = (k: keyof Draft, label: string, props: Partial<React.ComponentProps<typeof Input>> = {}, helper?: string) => (
    <Field label={label} helper={helper} required={!!props.required}>
      {({ controlId }) => <Input id={controlId} value={String(d[k])} onChange={(e) => set(k, e.target.value as never)} {...props} />}
    </Field>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
      <Stack gap={4}>
        <Stack direction="row" gap={3} wrap className="aurora-filters">
          {text("name", "Name", { required: true, placeholder: "ECC Production" })}
          <Field label="System type" required>{({ controlId }) => <Select id={controlId} options={TYPE_OPTIONS} value={d.system_type}
            onValueChange={(v) => { set("system_type", v as SystemType); set("auth", "oauth2_client_credentials"); }} />}</Field>
          <Field label="Environment">{({ controlId }) => <Select id={controlId} options={[{ value: "DEV", label: "DEV" }, { value: "QAS", label: "QAS" }, { value: "PRD", label: "PRD" }]}
            value={d.environment} onValueChange={(v) => set("environment", v)} />}</Field>
        </Stack>
        {rfc ? (
          <Stack direction="row" gap={3} wrap className="aurora-filters">
            {text("host", "Host", { required: true, placeholder: "sap-ecc.company.local", className: "aurora-number" })}
            {text("client", "Client", { required: true, placeholder: "100", className: "aurora-number" })}
            {text("sysnr", "System number", { required: true, className: "aurora-number" })}
            {text("username", "RFC user", { placeholder: "falls back to SAP_RFC_USER" })}
            {text("password", "Password", { required: true, type: "password", autoComplete: "new-password" })}
          </Stack>
        ) : (
          <Stack direction="row" gap={3} wrap className="aurora-filters">
            {text("base_url", "Base URL", { required: true, type: "url", placeholder: "https://api…" })}
            {text("company_id", "Company ID", {}, "Optional")}
            {authSelectable ? <Field label="Authentication">{({ controlId }) => <Select id={controlId}
              options={[{ value: "oauth2_client_credentials", label: "OAuth 2.0 client credentials" }, { value: "basic", label: "Basic (user + password)" }]}
              value={d.auth} onValueChange={(v) => set("auth", v as Draft["auth"])} />}</Field> : null}
            {basic ? <>{text("username", "User", { required: true })}{text("password", "Password", { required: true, type: "password", autoComplete: "new-password" })}</> : <>
              {text("client_id", "Client ID", { required: true })}
              {text("client_secret", "Client secret", { required: true, type: "password", autoComplete: "new-password" })}
              {d.system_type === "ariba" ? text("api_key", "API key", { type: "password" }, "Ariba application key") : null}
            </>}
          </Stack>
        )}
        {text("description", "Description", { placeholder: "What this system is for" }, "Optional")}
        <Text variant="text-micro" tone="muted">Credentials are encrypted at rest in this deployment and never leave it.</Text>
        {tested ? <Banner tone={tested.connected ? "success" : "danger"} title={tested.connected ? "Connection succeeded" : "Connection failed"}>{tested.message}</Banner> : null}
        <Stack direction="row" gap={2}>
          <Button type="button" variant="secondary" onClick={() => test.mutate()} disabled={!valid || test.isPending}>{test.isPending ? "Testing…" : "Test connection"}</Button>
          <Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? "Connecting…" : "Connect"}</Button>
        </Stack>
      </Stack>
    </form>
  );
}
