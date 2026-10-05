"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, Chip, Drawer, Input, Pager, Panel, Select, Stack, Text, type ChipTone } from "@/components/aurora";
import {
  getConfigDeviation,
  getDesignConfig,
  getDesignCoverage,
  getDesignDiff,
  getDesignSnapshots,
  getDesignTable,
  getDesignTables,
} from "@/lib/api/source-design";
import { relativeTime } from "@/lib/format";

const PAGE = 100;
const STATUS_TONE: Record<string, ChipTone> = {
  live: "success", complete: "success", synced: "success", healthy: "success",
  partial: "warning", degraded: "warning", not_found: "neutral", running: "info", queued: "info",
  failed: "danger", unreachable: "danger",
};
export const tone = (s: string | null | undefined): ChipTone => STATUS_TONE[s ?? ""] ?? "neutral";
const th = "px-3 py-2 text-left font-medium text-[var(--aurora-fg-tertiary)]";
const td = "px-3 py-1.5 border-t border-[var(--aurora-canvas-line)]";

export function TablesTab({ id }: { id: string }) {
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
        <Input placeholder="Search table or description, then Enter" aria-label="Search tables"
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

export function ConfigTab({ id, tables }: { id: string; tables: { table: string; scope: string; rows: number; source: string; synced_at: string | null }[] }) {
  const [open, setOpen] = useState(tables[0]?.table ?? "");
  const { data } = useQuery({ queryKey: ["design-config", id, open], queryFn: () => getDesignConfig(id, open), enabled: Boolean(open) });
  const cols = data?.rows[0] ? Object.keys(data.rows[0]) : [];
  if (!tables.length) return <Text tone="muted">No configuration read yet.</Text>;
  return (
    <Stack gap={3}>
      <DeviationPanel id={id} />
      <Select value={open} aria-label="Configuration table" onValueChange={setOpen}
        options={tables.map((t) => ({ value: t.table, label: `${t.table}, ${t.rows} rows, ${t.source}` }))} />
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

/** Live check-table values against the SAP-standard lists the rules fall back to. */
function DeviationPanel({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ["design-config-deviation", id], queryFn: () => getConfigDeviation(id) });
  if (!data?.tables.length) return null;
  const list = (vals: string[]) => (vals.length ? vals.slice(0, 12).join(", ") + (vals.length > 12 ? ` +${vals.length - 12}` : "") : "—");
  return (
    <Panel title="Deviation from SAP standard">
      <table className="w-full text-[13px]">
        <thead><tr><th className={th}>Check table</th><th className={th}>Custom (not in SAP standard)</th><th className={th}>SAP standard, not configured</th></tr></thead>
        <tbody>
          {data.tables.map((t) => (
            <tr key={t.reference}>
              <td className={`${td} font-mono`}>{t.reference}</td>
              <td className={`${td} font-mono`}>{list(t.custom)}</td>
              <td className={`${td} font-mono`}>{list(t.missing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function CoverageTab({ id }: { id: string }) {
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
                <span className="font-mono">{c.table}</span>{c.rows != null ? `, ${c.rows}` : ""}, {c.status}
              </Chip></span>
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

export function SnapshotsTab({ id }: { id: string }) {
  const { data: snaps = [] } = useQuery({ queryKey: ["design-snapshots", id], queryFn: () => getDesignSnapshots(id) });
  const done = snaps.filter((s) => s.status !== "failed" && s.status !== "running");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const a = from || done[1]?.id || "";
  const b = to || done[0]?.id || "";
  const { data: diff } = useQuery({ queryKey: ["design-diff", id, a, b], queryFn: () => getDesignDiff(id, a, b), enabled: Boolean(a && b && a !== b) });
  const opts = done.map((s) => ({ value: s.id, label: `${s.started_at ? new Date(s.started_at).toLocaleString() : s.id}, ${s.tables} tables` }));
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
                    <td className={`${td} font-mono`}>{c.diff ? Object.entries(c.diff).map(([k, [x, y]]) => `${k}: ${String(x)} to ${String(y)}`).join("; ") : ""}</td>
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
