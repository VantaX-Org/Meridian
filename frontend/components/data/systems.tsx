"use client";

/**
 * Connect and load: every connected SAP system with health, objects, rows and
 * the last extraction and analysis. A row opens the system; "Add system" opens
 * the connect form in a drawer (?drawer=new-system).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, DataTable, Drawer, Field, Input, Select, Stack, Text, useDrawerParam, type AuroraColumnMeta,
} from "@/components/aurora";
import { EmptyState, PageHeader, StatusBadge, TableSkeleton, Tally, type Status } from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { getSystemModules, getSystems } from "@/lib/api/connectivity";
import { getSystemVersions, type SystemVersion } from "@/lib/api/system-objects";
import { registerSystem, testDraftConnection } from "@/lib/api/systems";
import { relativeTime } from "@/lib/format";
import type { HealthStatus, SAPSystemExtended, SystemModule, SystemType } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;

const RFC_TYPES: SystemType[] = ["ecc", "s4hana_onprem", "ewm"];
// concur/ariba are fixed to OAuth2 in the connector dispatch; only these two offer Basic
const AUTH_SELECTABLE: SystemType[] = ["successfactors", "s4hana_cloud"];
// OAuth here fetches its token from a separate endpoint (BTP: the XSUAA /oauth/token URL)
const TOKEN_URL_TYPES: SystemType[] = ["s4hana_cloud", "btp"];
const TYPE_OPTIONS: { value: SystemType; label: string }[] = [
  { value: "ecc", label: "ECC" }, { value: "s4hana_onprem", label: "S/4HANA On-Prem" }, { value: "ewm", label: "EWM" },
  { value: "s4hana_cloud", label: "S/4HANA Cloud" }, { value: "successfactors", label: "SuccessFactors" },
  { value: "concur", label: "Concur" }, { value: "ariba", label: "Ariba" }, { value: "btp", label: "SAP BTP" },
];
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label])) as Record<SystemType, string>;
const isRfc = (t: SystemType) => RFC_TYPES.includes(t);

export const HEALTH_STATUS: Record<HealthStatus, Status> = {
  healthy: "ok", degraded: "medium", unreachable: "failed", auth_failed: "failed", unknown: "idle",
};
export const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: "Healthy", degraded: "Degraded", unreachable: "Unreachable", auth_failed: "Sign-in refused", unknown: "Not tested",
};
export const HealthBadge = ({ s }: { s: HealthStatus }) => <StatusBadge status={HEALTH_STATUS[s]}>{HEALTH_LABEL[s]}</StatusBadge>;

/** Mean DQS of the objects in the newest analysed run, or null before any analysis. */
export function latestDqs(versions: SystemVersion[]): { dqs: number | null; version: SystemVersion | null } {
  const v = [...versions].filter((x) => x.analysed_at).sort((a, b) => b.run_at.localeCompare(a.run_at))[0] ?? null;
  const vals = Object.values(v?.dqs ?? {}).filter((x): x is number => typeof x === "number");
  return { dqs: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, version: v };
}

type Row = {
  system: SAPSystemExtended; modules: SystemModule[] | undefined; versions: SystemVersion[] | undefined;
  loadedObjects: number; rows: number; lastExtraction: string | null; dqs: number | null;
};

type Draft = {
  name: string; system_type: SystemType; environment: string; description: string;
  host: string; client: string; sysnr: string; username: string; password: string;
  base_url: string; company_id: string; auth: "oauth2_client_credentials" | "basic"; client_id: string; client_secret: string; api_key: string; token_url: string;
};
const EMPTY: Draft = {
  name: "", system_type: "ecc", environment: "DEV", description: "", host: "", client: "", sysnr: "00", username: "", password: "",
  base_url: "", company_id: "", auth: "oauth2_client_credentials", client_id: "", client_secret: "", api_key: "", token_url: "",
};

/** The register / test-connection body, shaped the way the connector dispatch expects. */
function connectBody(d: Draft) {
  const rfc = isRfc(d.system_type);
  const basic = !rfc && AUTH_SELECTABLE.includes(d.system_type) && d.auth === "basic";
  const tokenUrl = !rfc && !basic && TOKEN_URL_TYPES.includes(d.system_type);
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
    auth_type: basic ? ("basic" as const) : undefined, token_url: tokenUrl ? d.token_url : undefined, credentials,
  };
}

export function SystemsSurface() {
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useRole();
  const canManage = can("manage_systems");
  const drawer = useDrawerParam("drawer");
  const adding = drawer.value === "new-system";

  const systemsQ = useQuery({ queryKey: ["systems"], queryFn: getSystems });
  const systems = useMemo(() => systemsQ.data ?? [], [systemsQ.data]);
  const modulesQ = useQueries({ queries: systems.map((s) => ({ queryKey: ["system-modules", s.id], queryFn: () => getSystemModules(s.id) })) });
  const versionsQ = useQueries({ queries: systems.map((s) => ({ queryKey: ["system-versions", s.id], queryFn: () => getSystemVersions(s.id) })) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["systems"] }); };

  const rows: Row[] = systems.map((system, i) => {
    const modules = modulesQ[i]?.data;
    const versions = versionsQ[i]?.data?.versions;
    const last = (modules ?? []).map((m) => m.last_synced_at).filter((x): x is string => !!x).sort().pop() ?? system.last_sync_at;
    return {
      system, modules, versions,
      loadedObjects: (modules ?? []).filter((m) => m.enabled && m.row_count > 0).length,
      rows: (modules ?? []).reduce((a, m) => a + (m.row_count || 0), 0),
      lastExtraction: last, dqs: versions ? latestDqs(versions).dqs : null,
    };
  });

  const modulesLoading = modulesQ.some((q) => q.isLoading);
  const objectsLoaded = rows.reduce((a, r) => a + r.loadedObjects, 0);
  const objectsOffered = rows.reduce((a, r) => a + (r.modules?.length ?? 0), 0);
  const rowsLoaded = rows.reduce((a, r) => a + r.rows, 0);
  const lastAny = rows.map((r) => r.lastExtraction).filter((x): x is string => !!x).sort().pop() ?? null;
  const notHealthy = systems.filter((s) => s.health_status !== "healthy").length;

  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => [
    { id: "alias", header: "Alias", meta: meta({ sticky: "start", width: 220 }),
      cell: ({ row }) => <Link href={`/systems/${row.original.system.id}`} className="ui-link">{row.original.system.name}</Link> },
    { id: "type", header: "Type", meta: meta({ width: 170 }),
      cell: ({ row }) => <span className="ui-cell-stack"><span className="ui-cell-stack__main">{TYPE_LABEL[row.original.system.system_type] ?? row.original.system.system_type}</span>
        <span className="ui-cell-stack__sub">{row.original.system.environment}</span></span> },
    { id: "health", header: "Health", meta: meta({ width: 170 }), cell: ({ row }) => <HealthBadge s={row.original.system.health_status} /> },
    { id: "objects", header: "Objects", meta: meta({ numeric: true, width: 90 }),
      cell: ({ row }) => row.original.modules ? `${row.original.loadedObjects} of ${row.original.modules.length}` : "…" },
    { id: "rows", header: "Rows", meta: meta({ numeric: true, width: 110 }),
      cell: ({ row }) => row.original.modules ? row.original.rows.toLocaleString() : "…" },
    { id: "extraction", header: "Last extraction", meta: meta({ width: 140 }),
      cell: ({ row }) => row.original.lastExtraction ? relativeTime(row.original.lastExtraction) : "Never" },
    { id: "analysis", header: "Last analysis", meta: meta({ width: 140 }),
      cell: ({ row }) => row.original.system.last_analysis_at ? relativeTime(row.original.system.last_analysis_at) : "Never" },
    { id: "dqs", header: "DQS", meta: meta({ numeric: true, width: 80 }),
      cell: ({ row }) => row.original.dqs === null ? "—" : row.original.dqs.toFixed(1) },
  ], []);

  const addButton = canManage ? <Button onClick={() => drawer.open("new-system")}>Add system</Button> : null;

  return (
    <div className="ui-page">
      <PageHeader title="Systems" actions={addButton}
        summary={systemsQ.isLoading ? undefined : "Every connected SAP system, what has been loaded from it and when it was last analysed."} />
      {systemsQ.isLoading ? <TableSkeleton rows={6} label="Loading connected systems" /> : systemsQ.error ? (
        <Banner tone="danger" title="Systems could not be read" action={<Button size="sm" variant="secondary" onClick={() => systemsQ.refetch()}>Retry</Button>}>
          {(systemsQ.error as Error).message}
        </Banner>
      ) : systems.length ? (
        <>
          <Tally level={2} label="Systems at a glance" figures={[
            { label: "Systems", value: systems.length, href: "/systems",
              verdict: notHealthy ? `${notHealthy} of ${systems.length} not healthy.` : "All connected systems are healthy.", tone: notHealthy ? "warning" : undefined },
            { label: "Objects loaded", value: objectsLoaded, href: "/systems", loading: modulesLoading,
              verdict: `${objectsLoaded} of ${objectsOffered} objects have rows.` },
            { label: "Rows loaded", value: rowsLoaded, href: "/sync", loading: modulesLoading,
              verdict: "Rows held across every loaded object." },
            { label: "Last extraction", value: lastAny ? relativeTime(lastAny) : "Never", href: "/sync", loading: modulesLoading,
              verdict: lastAny ? "Most recent extraction on any system." : "Nothing has been extracted yet." },
          ]} />
          <div className="ui-table-stacked">
            <DataTable columns={columns} data={rows} getRowId={(r) => r.system.id}
              onRowActivate={(r) => router.push(`/systems/${r.system.id}`)} ariaLabel="Connected systems" maxHeight="60vh" />
          </div>
        </>
      ) : (
        <EmptyState action={addButton}>No SAP system yet. Add the first one.</EmptyState>
      )}

      <Drawer open={adding} onClose={drawer.close} ariaLabel="Add a system" header={<Text variant="text-lead">Add a system</Text>}>
        {adding ? <ConnectForm onDone={(id) => { drawer.close(); refresh(); router.push(`/systems/${id}`); }} /> : null}
      </Drawer>
    </div>
  );
}

function ConnectForm({ onDone }: { onDone: (id: string) => void }) {
  const [d, setD] = useState<Draft>(EMPTY);
  const [tested, setTested] = useState<{ connected: boolean; message: string } | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((p) => ({ ...p, [k]: v })); setTested(null); };
  const rfc = isRfc(d.system_type);
  const authSelectable = !rfc && AUTH_SELECTABLE.includes(d.system_type);
  const basic = authSelectable && d.auth === "basic";
  const needsTokenUrl = !rfc && !basic && TOKEN_URL_TYPES.includes(d.system_type);
  const valid = d.name.trim() && (rfc ? d.host && d.client && d.sysnr && d.password
    : d.base_url && (basic ? d.username && d.password : d.client_id && d.client_secret && (!needsTokenUrl || d.token_url)));

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
              {needsTokenUrl ? text("token_url", "Token URL", { required: true, type: "url", placeholder: "https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token" }, "OAuth token endpoint") : null}
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
