"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Drawer, Input, Pager, Pill, Select, type PillTone } from "@/design";
import {
  getConfigDeviation,
  getDesignConfig,
  getDesignCoverage,
  getDesignDiff,
  getDesignSnapshots,
  getDesignTable,
  getDesignTables,
} from "@/lib/api/source-design";
import { labelOf, relativeTime, formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { clsx } from "clsx";

const PAGE = 100;
const STATUS_TONE: Record<string, PillTone> = {
  live: "go", complete: "go", synced: "go", healthy: "go",
  partial: "at-risk", degraded: "at-risk", not_found: "neutral", running: "neutral", queued: "neutral",
  failed: "no-go", unreachable: "no-go",
};
const tone = (s: string | null | undefined): PillTone => STATUS_TONE[s ?? ""] ?? "neutral";
const th = "px-3 py-2 text-left font-medium";
const td = "px-3 py-1.5 border-t";
const muted = "m-text-body";

export function TablesTab({ id }: { id: string }) {
  const [search, setSearch] = useState("");
  const [customerOnly, setCustomerOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: queryKeys.designTables(id, { search, customerOnly, offset }),
    queryFn: () => getDesignTables(id, { search: search || undefined, customer_only: customerOnly, limit: PAGE, offset }),
  });
  const total = data?.total ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input className="w-full" placeholder="Search table or description, then Enter" aria-label="Search tables"
          onKeyDown={(e) => { if (e.key === "Enter") { setSearch(e.currentTarget.value); setOffset(0); } }} />
        <Button variant={customerOnly ? "primary" : "secondary"} onClick={() => { setCustomerOnly(!customerOnly); setOffset(0); }}>
          Customer extensions only
        </Button>
      </div>
      <table className="w-full m-text-body">
        <thead><tr>
          <th className={clsx(th, "m-ink-3")}>Table</th><th className={clsx(th, "m-ink-3")}>Description</th>
          <th className={clsx(th, "m-ink-3")}>Delivery class</th>
          <th className={`${th} text-right m-ink-3`}>Fields</th>
          <th className={`${th} text-right m-ink-3`}>Customer fields</th>
        </tr></thead>
        <tbody>
          {(data?.items ?? []).map((t) => (
            <tr key={t.table} className="cursor-pointer" onClick={() => setOpen(t.table)}>
              <td className={`${td} font-mono [border-color:var(--m-line)]`}>
                {t.table} {t.customer_table && <Pill>customer</Pill>}
              </td>
              <td className={clsx(td, "[border-color:var(--m-line)]")}>{t.description ?? "—"}</td>
              <td className={clsx(td, "[border-color:var(--m-line)]")}>{t.delivery_class ?? "—"}</td>
              <td className={`${td} text-right tabular-nums [border-color:var(--m-line)]`}>{t.field_count}</td>
              <td className={`${td} text-right tabular-nums [border-color:var(--m-line)]`}>{t.customer_fields || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={Math.floor(offset / PAGE) + 1} pageCount={Math.max(1, Math.ceil(total / PAGE))} pageSize={PAGE} total={total}
        onPageChange={(p) => setOffset((p - 1) * PAGE)} />
      <TableDrawer id={id} table={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function TableDrawer({ id, table, onClose }: { id: string; table: string | null; onClose: () => void }) {
  const { data, error } = useQuery({
    queryKey: queryKeys.designTable(id, table),
    queryFn: () => getDesignTable(id, table as string),
    enabled: Boolean(table),
  });
  const deviations = data?.fields.filter((f) => f.deviation).length ?? 0;
  return (
    <Drawer open={Boolean(table)} onOpenChange={(next) => { if (!next) onClose(); }} title={table ?? ""}>
      {error ? <p className={clsx(muted, "m-ink-critical")}>{(error as Error).message}</p>
        : !data ? <p className={clsx(muted, "m-ink-2")}>Reading the table definition…</p> : (
        <div className="flex flex-col gap-3">
          <p className={clsx(muted, "m-ink-2")}>{data.description}</p>
          <div className="flex flex-wrap gap-2">
            <Pill>{data.in_sap_standard ? "SAP standard table" : "not in SAP standard"}</Pill>
            <Pill tone={deviations ? "at-risk" : "go"}>{deviations} field deviation{deviations === 1 ? "" : "s"} from standard</Pill>
            {data.standard_fields_missing.length > 0 && (
              <Pill tone="at-risk">{data.standard_fields_missing.length} standard fields absent</Pill>
            )}
          </div>
          <table className="w-full m-text-body">
            <thead><tr>
              <th className={clsx(th, "m-ink-3")}>Field</th><th className={clsx(th, "m-ink-3")}>This system</th>
              <th className={clsx(th, "m-ink-3")}>SAP standard</th><th className={clsx(th, "m-ink-3")}>Check table</th>
              <th className={clsx(th, "m-ink-3")}>Deviation</th>
            </tr></thead>
            <tbody>
              {data.fields.map((f) => (
                <tr key={f.name}>
                  <td className={`${td} font-mono [border-color:var(--m-line)]`}>{f.key ? <strong>{f.name}</strong> : f.name}
                    <div className="m-text-label m-ink-3">{f.description}</div></td>
                  <td className={`${td} font-mono [border-color:var(--m-line)]`}>{f.type}({f.length}{f.decimals ? `,${f.decimals}` : ""}) {f.domain ?? ""}</td>
                  <td className={`${td} font-mono [border-color:var(--m-line)]`}>{f.standard ? `${f.standard.type}(${f.standard.length}) ${f.standard.domain ?? ""}` : "—"}</td>
                  <td className={`${td} font-mono [border-color:var(--m-line)]`}>{f.check_table ?? ""}</td>
                  <td className={clsx(td, "[border-color:var(--m-line)]")}>{f.deviation && <Pill tone={f.deviation === "customer_field" ? "neutral" : "at-risk"}>{f.deviation}</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.standard_fields_missing.length > 0 && (
            <p className={clsx(muted, "m-ink-2")}>
              In SAP standard but not in this system: <span className="font-mono">{data.standard_fields_missing.join(", ")}</span>
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function ConfigTab({ id, tables }: { id: string; tables: { table: string; scope: string; rows: number; source: string; synced_at: string | null }[] }) {
  const wanted = useSearchParams().get("table");
  const [open, setOpen] = useState(tables.find((t) => t.table === wanted)?.table ?? tables[0]?.table ?? "");
  const { data } = useQuery({ queryKey: queryKeys.designConfig(id, open), queryFn: () => getDesignConfig(id, open), enabled: Boolean(open) });
  const cols = data?.rows[0] ? Object.keys(data.rows[0]) : [];
  if (!tables.length) return <p className={clsx(muted, "m-ink-2")}>No configuration read yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      <DeviationPanel id={id} />
      <Select
        label="Configuration table"
        value={open} onValueChange={setOpen}
        options={tables.map((t) => ({ value: t.table, label: `${t.table}, ${t.rows} rows, ${t.source}` }))} />
      {data && (
        <>
          <p className={clsx(muted, "m-ink-2")}>
            {data.total} value{data.total === 1 ? "" : "s"} read {data.source === "live" ? "live from the system" : `(${data.source})`}
            {data.synced_at ? `, ${relativeTime(data.synced_at)}` : ""}. Checks validate against these values, so customer-configured codes count as valid.
          </p>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full m-text-body">
              <thead className="sticky top-0 [background:var(--m-sheet-raised)]">
                <tr>{cols.map((c) => <th key={c} className={clsx(th, "m-ink-3")}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i}>{cols.map((c) => <td key={c} className={`${td} font-mono [border-color:var(--m-line)]`}>{String(r[c] ?? "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Live check-table values against the SAP-standard lists the rules fall back to. */
function DeviationPanel({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: queryKeys.designConfigDeviation(id), queryFn: () => getConfigDeviation(id) });
  if (!data?.tables.length) return null;
  const list = (vals: string[]) => (vals.length ? vals.slice(0, 12).join(", ") + (vals.length > 12 ? ` +${vals.length - 12}` : "") : "—");
  return (
    <Card title="Deviation from SAP standard">
      <table className="w-full m-text-body">
        <thead><tr>
          <th className={clsx(th, "m-ink-3")}>Check table</th>
          <th className={clsx(th, "m-ink-3")}>Custom (not in SAP standard)</th>
          <th className={clsx(th, "m-ink-3")}>SAP standard, not configured</th>
        </tr></thead>
        <tbody>
          {data.tables.map((t) => (
            <tr key={t.reference}>
              <td className={`${td} font-mono [border-color:var(--m-line)]`}>{t.reference}</td>
              <td className={`${td} font-mono [border-color:var(--m-line)]`}>{list(t.custom)}</td>
              <td className={`${td} font-mono [border-color:var(--m-line)]`}>{list(t.missing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function CoverageTab({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: queryKeys.designCoverage(id), queryFn: () => getDesignCoverage(id) });
  const parts = Object.entries(data?.coverage ?? {});
  return (
    <div className="flex flex-col gap-4">
      <p className={clsx(muted, "m-ink-2")}>
        Every object Meridian tried to read, and the outcome. &ldquo;not_found&rdquo; means the object does not exist in
        this release; &ldquo;failed&rdquo; usually means a missing RFC authorisation (S_TABU_DIS / S_TABU_NAM).
      </p>
      {parts.map(([part, items]) => (
        <Card key={part} title={part}>
          <div className="flex flex-wrap gap-2">
            {items.map((c) => (
              <span key={c.table} title={c.detail}><Pill tone={tone(c.status)}>
                <span className="font-mono">{c.table}</span>{c.rows != null ? `, ${c.rows}` : ""}, {labelOf(c.status)}
              </Pill></span>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function SnapshotsTab({ id }: { id: string }) {
  const { data: snaps = [] } = useQuery({ queryKey: queryKeys.designSnapshots(id), queryFn: () => getDesignSnapshots(id) });
  const done = snaps.filter((s) => s.status !== "failed" && s.status !== "running");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const a = from || done[1]?.id || "";
  const b = to || done[0]?.id || "";
  const { data: diff } = useQuery({ queryKey: queryKeys.designDiff(id, a, b), queryFn: () => getDesignDiff(id, a, b), enabled: Boolean(a && b && a !== b) });
  const opts = done.map((s) => ({ value: s.id, label: `${s.started_at ? formatDate(s.started_at, "datetime") : s.id}, ${s.tables} tables` }));
  return (
    <div className="flex flex-col gap-4">
      <table className="w-full m-text-body">
        <thead><tr>
          <th className={clsx(th, "m-ink-3")}>Started</th><th className={clsx(th, "m-ink-3")}>Status</th>
          <th className={`${th} text-right m-ink-3`}>Tables</th>
          <th className={`${th} text-right m-ink-3`}>Customer tables</th>
          <th className={`${th} text-right m-ink-3`}>Customer fields</th>
        </tr></thead>
        <tbody>
          {snaps.map((s) => (
            <tr key={s.id}>
              <td className={clsx(td, "[border-color:var(--m-line)]")}>{s.started_at ? formatDate(s.started_at, "datetime") : "—"}</td>
              <td className={clsx(td, "[border-color:var(--m-line)]")}><span title={s.error ?? undefined}><Pill tone={tone(s.status)}>{labelOf(s.status)}</Pill></span></td>
              <td className={`${td} text-right tabular-nums [border-color:var(--m-line)]`}>{s.tables}</td>
              <td className={`${td} text-right tabular-nums [border-color:var(--m-line)]`}>{s.customer_tables}</td>
              <td className={`${td} text-right tabular-nums [border-color:var(--m-line)]`}>{s.customer_fields}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {done.length > 1 ? (
        <Card title="Design drift">
          <div className="flex gap-2">
            <Select label="Compare from" value={a} options={opts} onValueChange={setFrom} />
            <Select label="Compare to" value={b} options={opts} onValueChange={setTo} />
          </div>
          {diff && (diff.changes.length === 0 ? <p className={clsx(muted, "m-ink-2")}>No dictionary changes between these snapshots.</p> : (
            <table className="w-full m-text-body">
              <thead><tr>
                <th className={clsx(th, "m-ink-3")}>Table</th><th className={clsx(th, "m-ink-3")}>Field</th>
                <th className={clsx(th, "m-ink-3")}>Change</th><th className={clsx(th, "m-ink-3")}>Detail</th>
              </tr></thead>
              <tbody>
                {diff.changes.map((c, i) => (
                  <tr key={i}>
                    <td className={`${td} font-mono [border-color:var(--m-line)]`}>{c.table}</td>
                    <td className={`${td} font-mono [border-color:var(--m-line)]`}>{c.field ?? ""}</td>
                    <td className={clsx(td, "[border-color:var(--m-line)]")}>
                      <Pill tone={c.change.endsWith("removed") ? "no-go" : c.change.endsWith("added") ? "neutral" : "at-risk"}>{c.change.replace("_", " ")}</Pill>
                    </td>
                    <td className={`${td} font-mono [border-color:var(--m-line)]`}>{c.diff ? Object.entries(c.diff).map(([k, [x, y]]) => `${k}: ${String(x)} to ${String(y)}`).join("; ") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </Card>
      ) : <p className={clsx(muted, "m-ink-2")}>Drift appears once the system has been discovered twice.</p>}
    </div>
  );
}
