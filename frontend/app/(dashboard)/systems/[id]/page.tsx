"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, ScanSearch } from "lucide-react";
import {
  Banner,
  Button,
  Chip,
  Drawer,
  Input,
  KpiRail,
  Pager,
  Panel,
  Select,
  Stack,
  Stat,
  Tabs,
  Text,
  type ChipTone,
} from "@/components/aurora";
import { PageHead } from "@/components/meridian/atoms";
import { getSystems, testConnection } from "@/lib/api/connectivity";
import { ObjectsPanel, TrendsTab, VersionsTab } from "./versions";
import {
  discoverSystem,
  getDesign,
  getDesignConfig,
  getDesignCoverage,
  getDesignDiff,
  getDesignSnapshots,
  getDesignTable,
  getDesignTables,
} from "@/lib/api/source-design";
import { relativeTime } from "@/lib/format";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";

type Tab = "versions" | "trends" | "tables" | "config" | "coverage" | "snapshots";
const TABS: readonly Tab[] = ["versions", "trends", "tables", "config", "coverage", "snapshots"];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);
const PAGE = 100;

const STATUS_TONE: Record<string, ChipTone> = {
  live: "success", complete: "success", synced: "success", healthy: "success",
  partial: "warning", degraded: "warning", not_found: "neutral", running: "info", queued: "info",
  failed: "danger", unreachable: "danger",
};

const tone = (s: string | null | undefined): ChipTone => STATUS_TONE[s ?? ""] ?? "neutral";

const th = "px-3 py-2 text-left font-medium text-[var(--aurora-fg-tertiary)]";
const td = "px-3 py-1.5 border-t border-[var(--aurora-canvas-line)]";

export default function SystemDesignPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useRole();
  // The tab lives in the URL (?tab=trends) so Versions and Trends can be linked to.
  const [tabParam, setTabParam] = useUrlState("tab", "versions");
  const tab: Tab = isTab(tabParam) ? tabParam : "versions";
  const setTab = (t: Tab) => setTabParam(t);

  const { data: systems = [] } = useQuery({ queryKey: ["systems"], queryFn: getSystems });
  const system = systems.find((s) => s.id === id);
  const { data: design, error } = useQuery({
    queryKey: ["design", id],
    queryFn: () => getDesign(id),
    refetchInterval: (q) => (["queued", "running"].includes(q.state.data?.discovery_status ?? "") ? 3000 : false),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["design", id] });
    qc.invalidateQueries({ queryKey: ["systems"] });
  };
  const test = useMutation({
    mutationFn: () => testConnection(id),
    onSuccess: (r) => { toast.success(`Connection ${r.status} (${r.latency_ms} ms)`); refresh(); },
    onError: (e) => toast.error((e as Error).message || "Connection test failed"),
  });
  const discover = useMutation({
    mutationFn: () => discoverSystem(id),
    onSuccess: () => { toast.success("Discovery started — reading the system's dictionary and configuration"); refresh(); },
    onError: (e) => toast.error((e as Error).message || "Could not start discovery"),
  });
  const snap = design?.snapshot;
  const running = ["queued", "running"].includes(design?.discovery_status ?? "");
  const cov = snap?.coverage_summary ?? {};

  return (
    <div data-theme="light" className="space-y-6">
      <Link href="/systems" className="inline-flex items-center gap-1 text-[13px] text-[var(--aurora-fg-secondary)] hover:underline">
        <ArrowLeft size={14} /> Systems
      </Link>
      <PageHead
        title={system?.name ?? "System"}
        sub={system ? `${system.system_type} · ${system.environment} — what Meridian learned about this system's design: its data dictionary, customer extensions and live configuration, compared with the SAP standard.` : undefined}
        actions={
          <Stack direction="row" gap={2}>
            {can("trigger_sync") && (
              <>
                <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={14} className={test.isPending ? "animate-spin" : ""} />}
                  disabled={test.isPending} onClick={() => test.mutate()}>
                  Test connection
                </Button>
                <Button size="sm" leadingIcon={<ScanSearch size={14} />} disabled={discover.isPending || running}
                  onClick={() => discover.mutate()}>
                  {running ? "Discovering…" : snap ? "Re-discover" : "Discover design"}
                </Button>
              </>
            )}
          </Stack>
        }
      />

      {error ? <Banner tone="danger" title="Could not load the system design">{(error as Error).message}</Banner> : null}
      {design && !snap && !running && (
        <Banner tone="info" title="Not discovered yet">
          Discovery reads the system&apos;s own data dictionary (DD02L/DD03L/DD04L/DD01L/DD05S/DD07L, TADIR for customer
          tables) and check-table configuration, so every later check uses this system&apos;s real field definitions and
          configured values instead of assumptions.
        </Banner>
      )}
      {snap?.error && <Banner tone="warning" title={`Discovery ${snap.status}`}>{snap.error}</Banner>}

      <KpiRail>
        <Stat label="Release" value={design?.sap_release ?? "—"} unit={design?.sap_product ?? undefined} />
        <Stat label="Tables read" value={snap?.tables?.toLocaleString() ?? "—"}
          tone={cov.failed ? "warning" : "neutral"} />
        <Stat label="Customer tables" value={snap?.customer_tables?.toLocaleString() ?? "—"} />
        <Stat label="Customer fields (ZZ/YY)" value={snap?.customer_fields?.toLocaleString() ?? "—"} />
        <Stat label="Config tables" value={design?.configuration.length.toLocaleString() ?? "—"}
          tone={design?.config_sync_status === "partial" ? "warning" : "neutral"} />
      </KpiRail>
      {design && (
        <Stack direction="row" gap={2} wrap>
          <Chip tone={tone(design.discovery_status)}>discovery {design.discovery_status ?? "never"}</Chip>
          {design.discovered_at && <Chip>{relativeTime(design.discovered_at)}</Chip>}
          {Object.entries(cov).map(([s, n]) => <Chip key={s} tone={tone(s)}>{n} {s}</Chip>)}
        </Stack>
      )}

      {can("trigger_sync") && <ObjectsPanel id={id} onDownloaded={() => setTab("versions")} />}

      <Panel>
        <Tabs<Tab> ariaLabel="System" value={tab} onValueChange={setTab}
          items={[
            { id: "versions", label: "Versions" },
            { id: "trends", label: "Trends" },
            { id: "tables", label: "Data dictionary", count: snap?.tables, disabled: !snap },
            { id: "config", label: "Configuration", count: design?.configuration.length, disabled: !snap },
            { id: "coverage", label: "Coverage", disabled: !snap },
            { id: "snapshots", label: "History", disabled: !snap },
          ]} />
        <div className="mt-[var(--aurora-space-4)]">
          {tab === "versions" && <VersionsTab id={id} canAnalyse={can("analyse")} />}
          {tab === "trends" && <TrendsTab id={id} />}
          {tab === "tables" && snap && <TablesTab id={id} />}
          {tab === "config" && snap && design && <ConfigTab id={id} tables={design.configuration} />}
          {tab === "coverage" && snap && <CoverageTab id={id} />}
          {tab === "snapshots" && snap && <SnapshotsTab id={id} />}
        </div>
      </Panel>
    </div>
  );
}

function TablesTab({ id }: { id: string }) {
  const [search, setSearch] = useState("");
  const [customerOnly, setCustomerOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["design-tables", id, search, customerOnly, offset],
    queryFn: () => getDesignTables(id, { search: search || undefined, customer_only: customerOnly, limit: PAGE, offset }),
  });
  const total = data?.total ?? 0;
  return (
    <Stack gap={3}>
      <Stack direction="row" gap={2} align="center">
        <Input placeholder="Search table or description (Enter)" aria-label="Search tables"
          onKeyDown={(e) => { if (e.key === "Enter") { setSearch(e.currentTarget.value); setOffset(0); } }} />
        <Chip selected={customerOnly} onClick={() => { setCustomerOnly(!customerOnly); setOffset(0); }}>
          Customer extensions only
        </Chip>
      </Stack>
      <table className="w-full text-[13px]">
        <thead><tr>
          <th className={th}>Table</th><th className={th}>Description</th><th className={th}>Delivery class</th>
          <th className={`${th} text-right`}>Fields</th><th className={`${th} text-right`}>Customer fields</th>
        </tr></thead>
        <tbody>
          {(data?.items ?? []).map((t) => (
            <tr key={t.table} className="cursor-pointer hover:bg-[var(--aurora-elev-2-bg)]" onClick={() => setOpen(t.table)}>
              <td className={`${td} font-mono`}>
                {t.table} {t.customer_table && <Chip tone="info">customer</Chip>}
              </td>
              <td className={td}>{t.description ?? "—"}</td>
              <td className={td}>{t.delivery_class ?? "—"}</td>
              <td className={`${td} text-right aurora-number`}>{t.field_count}</td>
              <td className={`${td} text-right aurora-number`}>{t.customer_fields || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager offset={offset} total={total} pageSize={PAGE} onChange={setOffset} noun="tables" />
      <TableDrawer id={id} table={open} onClose={() => setOpen(null)} />
    </Stack>
  );
}

function TableDrawer({ id, table, onClose }: { id: string; table: string | null; onClose: () => void }) {
  const { data, error } = useQuery({
    queryKey: ["design-table", id, table],
    queryFn: () => getDesignTable(id, table as string),
    enabled: Boolean(table),
  });
  const deviations = data?.fields.filter((f) => f.deviation).length ?? 0;
  return (
    <Drawer open={Boolean(table)} onClose={onClose} ariaLabel={`Table ${table ?? ""}`}
      header={<Stack gap={1}>
        <Text variant="display-sm" className="font-mono">{table}</Text>
        {data && <Text variant="text-small" tone="secondary">{data.description}</Text>}
      </Stack>}>
      {error ? <Banner tone="danger">{(error as Error).message}</Banner> : !data ? <Text tone="muted">Reading the table definition…</Text> : (
        <Stack gap={3}>
          <Stack direction="row" gap={2} wrap>
            <Chip tone={data.in_sap_standard ? "neutral" : "info"}>{data.in_sap_standard ? "SAP standard table" : "not in SAP standard"}</Chip>
            <Chip tone={deviations ? "warning" : "success"}>{deviations} field deviation{deviations === 1 ? "" : "s"} from standard</Chip>
            {data.standard_fields_missing.length > 0 && (
              <Chip tone="warning">{data.standard_fields_missing.length} standard fields absent</Chip>
            )}
          </Stack>
          <table className="w-full text-[13px]">
            <thead><tr>
              <th className={th}>Field</th><th className={th}>This system</th><th className={th}>SAP standard</th>
              <th className={th}>Check table</th><th className={th}>Deviation</th>
            </tr></thead>
            <tbody>
              {data.fields.map((f) => (
                <tr key={f.name}>
                  <td className={`${td} font-mono`}>{f.key ? <strong>{f.name}</strong> : f.name}
                    <div className="text-[11px] text-[var(--aurora-fg-muted)]">{f.description}</div></td>
                  <td className={`${td} font-mono`}>{f.type}({f.length}{f.decimals ? `,${f.decimals}` : ""}) {f.domain ?? ""}</td>
                  <td className={`${td} font-mono`}>{f.standard ? `${f.standard.type}(${f.standard.length}) ${f.standard.domain ?? ""}` : "—"}</td>
                  <td className={`${td} font-mono`}>{f.check_table ?? ""}</td>
                  <td className={td}>{f.deviation && <Chip tone={f.deviation === "customer_field" ? "info" : "warning"}>{f.deviation}</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.standard_fields_missing.length > 0 && (
            <Text variant="text-small" tone="secondary">
              In SAP standard but not in this system: <span className="font-mono">{data.standard_fields_missing.join(", ")}</span>
            </Text>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

function ConfigTab({ id, tables }: { id: string; tables: { table: string; scope: string; rows: number; source: string; synced_at: string | null }[] }) {
  const [open, setOpen] = useState(tables[0]?.table ?? "");
  const { data } = useQuery({ queryKey: ["design-config", id, open], queryFn: () => getDesignConfig(id, open), enabled: Boolean(open) });
  const cols = data?.rows[0] ? Object.keys(data.rows[0]) : [];
  if (!tables.length) return <Text tone="muted">No configuration read yet.</Text>;
  return (
    <Stack gap={3}>
      <Select value={open} aria-label="Configuration table" onValueChange={setOpen}
        options={tables.map((t) => ({ value: t.table, label: `${t.table} · ${t.rows} rows · ${t.source}` }))} />
      {data && (
        <>
          <Text variant="text-small" tone="secondary">
            {data.total} value{data.total === 1 ? "" : "s"} read {data.source === "live" ? "live from the system" : `(${data.source})`}
            {data.synced_at ? `, ${relativeTime(data.synced_at)}` : ""}. Checks validate against these values, so customer-configured codes count as valid.
          </Text>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-[var(--aurora-elev-1-bg)]"><tr>{cols.map((c) => <th key={c} className={th}>{c}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i}>{cols.map((c) => <td key={c} className={`${td} font-mono`}>{String(r[c] ?? "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Stack>
  );
}

function CoverageTab({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ["design-coverage", id], queryFn: () => getDesignCoverage(id) });
  const parts = Object.entries(data?.coverage ?? {});
  return (
    <Stack gap={4}>
      <Text variant="text-small" tone="secondary">
        Every object Meridian tried to read, and the outcome. &ldquo;not_found&rdquo; means the object does not exist in
        this release; &ldquo;failed&rdquo; usually means a missing RFC authorisation (S_TABU_DIS / S_TABU_NAM).
      </Text>
      {parts.map(([part, items]) => (
        <Stack key={part} gap={2}>
          <Text className="font-semibold">{part}</Text>
          <Stack direction="row" gap={2} wrap>
            {items.map((c) => (
              <span key={c.table} title={c.detail}><Chip tone={tone(c.status)}>
                <span className="font-mono">{c.table}</span>{c.rows != null ? ` · ${c.rows}` : ""} · {c.status}
              </Chip></span>
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

function SnapshotsTab({ id }: { id: string }) {
  const { data: snaps = [] } = useQuery({ queryKey: ["design-snapshots", id], queryFn: () => getDesignSnapshots(id) });
  const done = snaps.filter((s) => s.status !== "failed" && s.status !== "running");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const a = from || done[1]?.id || "";
  const b = to || done[0]?.id || "";
  const { data: diff } = useQuery({ queryKey: ["design-diff", id, a, b], queryFn: () => getDesignDiff(id, a, b), enabled: Boolean(a && b && a !== b) });
  const opts = done.map((s) => ({ value: s.id, label: `${s.started_at ? new Date(s.started_at).toLocaleString() : s.id} · ${s.tables} tables` }));
  return (
    <Stack gap={4}>
      <table className="w-full text-[13px]">
        <thead><tr><th className={th}>Started</th><th className={th}>Status</th><th className={`${th} text-right`}>Tables</th>
          <th className={`${th} text-right`}>Customer tables</th><th className={`${th} text-right`}>Customer fields</th></tr></thead>
        <tbody>
          {snaps.map((s) => (
            <tr key={s.id}>
              <td className={td}>{s.started_at ? new Date(s.started_at).toLocaleString() : "—"}</td>
              <td className={td}><span title={s.error ?? undefined}><Chip tone={tone(s.status)}>{s.status}</Chip></span></td>
              <td className={`${td} text-right aurora-number`}>{s.tables}</td>
              <td className={`${td} text-right aurora-number`}>{s.customer_tables}</td>
              <td className={`${td} text-right aurora-number`}>{s.customer_fields}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {done.length > 1 ? (
        <Stack gap={2}>
          <Text className="font-semibold">Design drift</Text>
          <Stack direction="row" gap={2}>
            <Select value={a} aria-label="From snapshot" options={opts} onValueChange={setFrom} />
            <Select value={b} aria-label="To snapshot" options={opts} onValueChange={setTo} />
          </Stack>
          {diff && (diff.changes.length === 0 ? <Text tone="muted">No dictionary changes between these snapshots.</Text> : (
            <table className="w-full text-[13px]">
              <thead><tr><th className={th}>Table</th><th className={th}>Field</th><th className={th}>Change</th><th className={th}>Detail</th></tr></thead>
              <tbody>
                {diff.changes.map((c, i) => (
                  <tr key={i}>
                    <td className={`${td} font-mono`}>{c.table}</td>
                    <td className={`${td} font-mono`}>{c.field ?? ""}</td>
                    <td className={td}><Chip tone={c.change.endsWith("removed") ? "danger" : c.change.endsWith("added") ? "info" : "warning"}>{c.change.replace("_", " ")}</Chip></td>
                    <td className={`${td} font-mono`}>{c.diff ? Object.entries(c.diff).map(([k, [x, y]]) => `${k}: ${String(x)} → ${String(y)}`).join("; ") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </Stack>
      ) : <Text tone="muted">Drift appears once the system has been discovered twice.</Text>}
    </Stack>
  );
}
