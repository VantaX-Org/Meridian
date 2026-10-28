"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Choice, Drawer, EmptyState, ErrorState, Input, Mono, Pager, Pill, Select, Skeleton, type PillTone } from "@/design";
import { apiErrorState } from "@/lib/error";
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
const muted = "m-text-body";

/** Loading and failure for one panel's query: a skeleton in the table's place, or the server's reason with Retry. */
function QueryGate({ q, height = 200 }: { q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }; height?: number }) {
  if (q.isLoading) return <Skeleton height={height} />;
  if (q.isError) return <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} />;
  return null;
}

export function TablesTab({ id }: { id: string }) {
  const [search, setSearch] = useState("");
  const [customerOnly, setCustomerOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const tablesQ = useQuery({
    queryKey: queryKeys.designTables(id, { search, customerOnly, offset }),
    queryFn: () => getDesignTables(id, { search: search || undefined, customer_only: customerOnly, limit: PAGE, offset }),
  });
  const { data } = tablesQ;
  const total = data?.total ?? 0;
  const filtered = Boolean(search) || customerOnly;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input key={search} defaultValue={search} className="w-full" placeholder="Search table or description, then Enter" aria-label="Search tables"
          onKeyDown={(e) => { if (e.key === "Enter") { setSearch(e.currentTarget.value); setOffset(0); } }} />
        <Choice pressed={customerOnly} className="shrink-0" onClick={() => { setCustomerOnly(!customerOnly); setOffset(0); }}>
          Customer extensions only
        </Choice>
      </div>
      <p className={clsx(muted, "m-ink-2")}>The tables Meridian found in this system. Open one to compare its fields with SAP standard.</p>
      <QueryGate q={tablesQ} />
      {data && data.items.length === 0 ? (
        <EmptyState
          title={filtered ? "No tables match" : "No tables read yet"}
          detail={filtered ? "Clear the search or show every table." : "Run design discovery from the Connection card above to read this system's tables."}
          action={filtered ? <Button variant="secondary" onClick={() => { setSearch(""); setCustomerOnly(false); setOffset(0); }}>Show all tables</Button> : undefined}
        />
      ) : null}
      {data && data.items.length > 0 ? <table className="m-table">
        <thead><tr>
          <th>Table</th><th>Description</th>
          <th>Delivery class</th>
          <th className="text-right">Fields</th>
          <th className="text-right">Customer fields</th>
        </tr></thead>
        <tbody>
          {(data?.items ?? []).map((t) => (
            <tr key={t.table} className="cursor-pointer" onClick={() => setOpen(t.table)}>
              <td className="font-mono">
                {/* The keyboard path into the drawer; the row click stays for the mouse. */}
                <button type="button" className="font-mono text-left m-ink-accent hover:underline underline-offset-2"
                  onClick={(e) => { e.stopPropagation(); setOpen(t.table); }}>{t.table}</button>
                {" "}{t.customer_table && <Pill>customer</Pill>}
              </td>
              <td>{t.description ?? "—"}</td>
              <td>{t.delivery_class ?? "—"}</td>
              <td className="text-right">{t.field_count}</td>
              <td className="text-right">{t.customer_fields || ""}</td>
            </tr>
          ))}
        </tbody>
      </table> : null}
      <Pager page={Math.floor(offset / PAGE) + 1} pageCount={Math.max(1, Math.ceil(total / PAGE))} pageSize={PAGE} total={total}
        onPageChange={(p) => setOffset((p - 1) * PAGE)} />
      <TableDrawer id={id} table={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function TableDrawer({ id, table, onClose }: { id: string; table: string | null; onClose: () => void }) {
  const { data, error, refetch } = useQuery({
    queryKey: queryKeys.designTable(id, table),
    queryFn: () => getDesignTable(id, table as string),
    enabled: Boolean(table),
  });
  const deviations = data?.fields.filter((f) => f.deviation).length ?? 0;
  return (
    <Drawer open={Boolean(table)} onOpenChange={(next) => { if (!next) onClose(); }} title={table ?? ""}>
      {error ? <ErrorState {...apiErrorState(error)} onRetry={() => void refetch()} />
        : !data ? <Skeleton height={160} /> : (
        <div className="flex flex-col gap-3">
          <p className={clsx(muted, "m-ink-2")}>{data.description}</p>
          <div className="flex flex-wrap gap-2">
            <Pill>{data.in_sap_standard ? "SAP standard table" : "not in SAP standard"}</Pill>
            <Pill tone={deviations ? "at-risk" : "go"}>{deviations} field deviation{deviations === 1 ? "" : "s"} from standard</Pill>
            {data.standard_fields_missing.length > 0 && (
              <Pill tone="at-risk">{data.standard_fields_missing.length} standard fields absent</Pill>
            )}
          </div>
          <table className="m-table">
            <thead><tr>
              <th>Field</th><th>This system</th>
              <th>SAP standard</th><th>Check table</th>
              <th>Deviation</th>
            </tr></thead>
            <tbody>
              {data.fields.map((f) => (
                <tr key={f.name}>
                  <td className="font-mono">{f.key ? <strong>{f.name}</strong> : f.name}
                    <div className="m-text-label m-ink-3">{f.description}</div></td>
                  <td className="font-mono">{f.type}({f.length}{f.decimals ? `,${f.decimals}` : ""}) {f.domain ?? ""}</td>
                  <td className="font-mono">{f.standard ? `${f.standard.type}(${f.standard.length}) ${f.standard.domain ?? ""}` : "—"}</td>
                  <td className="font-mono">{f.check_table ?? ""}</td>
                  <td>{f.deviation && <Pill tone={f.deviation === "customer_field" ? "neutral" : "at-risk"}>{labelOf(f.deviation)}</Pill>}</td>
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

/** Where a configuration table's values came from (`config_snapshots.source`), in words. */
const SOURCE_SHORT: Record<string, string> = { live: "live", reference: "SAP reference", baseline: "baseline" };
const SOURCE_WORDS: Record<string, string> = { live: "live from the system", reference: "from the SAP reference values", baseline: "from the baseline values" };
export const sourceShort = (source: string): string => SOURCE_SHORT[source] ?? labelOf(source).toLowerCase();
export const sourceWords = (source: string): string => SOURCE_WORDS[source] ?? `from ${labelOf(source).toLowerCase()}`;

/** A discovery coverage part (`ddic`, `config`, `metadata`) as a card title. */
const COVERAGE_PART: Record<string, string> = { ddic: "Data dictionary", config: "Configuration tables", metadata: "Metadata" };
export const coveragePartLabel = (part: string): string => COVERAGE_PART[part] ?? labelOf(part);

export function ConfigTab({ id, tables }: { id: string; tables: { table: string; scope: string; rows: number; source: string; synced_at: string | null }[] }) {
  const wanted = useSearchParams().get("table");
  const [open, setOpen] = useState(tables.find((t) => t.table === wanted)?.table ?? tables[0]?.table ?? "");
  const configQ = useQuery({ queryKey: queryKeys.designConfig(id, open), queryFn: () => getDesignConfig(id, open), enabled: Boolean(open) });
  const { data } = configQ;
  const cols = data?.rows[0] ? Object.keys(data.rows[0]) : [];
  if (!tables.length) {
    return <EmptyState title="No configuration read yet" detail="Discovery reads configuration tables along with the data dictionary. Run it again from the Connection card above." />;
  }
  return (
    <div className="flex flex-col gap-3">
      <DeviationPanel id={id} />
      <Select
        label="Configuration table"
        value={open} onValueChange={setOpen}
        options={tables.map((t) => ({ value: t.table, label: `${t.table}, ${t.rows} rows, ${sourceShort(t.source)}` }))} />
      <QueryGate q={configQ} />
      {data && (
        <>
          <p className={clsx(muted, "m-ink-2")}>
            {data.total} value{data.total === 1 ? "" : "s"} read {sourceWords(data.source)}
            {data.synced_at ? `, ${relativeTime(data.synced_at)}` : ""}. Checks validate against these values, so customer-configured codes count as valid.
          </p>
          <div className="max-h-[480px] overflow-auto">
            <table className="m-table">
              <thead className="sticky top-0">
                <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i}>{cols.map((c) => <td key={c} className="font-mono">{String(r[c] ?? "")}</td>)}</tr>
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
export function DeviationPanel({ id }: { id: string }) {
  const q = useQuery({ queryKey: queryKeys.designConfigDeviation(id), queryFn: () => getConfigDeviation(id) });
  const list = (vals: string[]) => (vals.length ? vals.slice(0, 12).join(", ") + (vals.length > 12 ? ` +${vals.length - 12}` : "") : "—");
  return (
    <Card title="Deviation from SAP standard">
      <QueryGate q={q} height={96} />
      {q.data && q.data.tables.length === 0 ? (
        <EmptyState variant="inline" title="No deviation to compare" detail="Configuration tables read live from the system are compared with SAP standard values here. Run discovery again to read them." />
      ) : null}
      {q.data && q.data.tables.length > 0 ? (
        <table className="m-table">
          <thead><tr>
            <th>Check table</th>
            <th className="text-right">In this system</th>
            <th className="text-right">SAP standard</th>
            <th>Custom (not in SAP standard)</th>
            <th>SAP standard, not configured</th>
          </tr></thead>
          <tbody>
            {q.data.tables.map((t) => (
              <tr key={t.reference}>
                <td className="font-mono">{t.reference}</td>
                <td className="text-right">{t.live_count.toLocaleString()}</td>
                <td className="text-right">{t.standard_count.toLocaleString()}</td>
                <td className="font-mono">{list(t.custom)}</td>
                <td className="font-mono">{list(t.missing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
  );
}

/** "142 tables read, 6 not found, 2 failed": the coverage in one sentence. */
export function coverageSummary(items: { status: string }[]): string {
  const count = (pred: (s: string) => boolean) => items.filter((i) => pred(i.status)).length;
  const notFound = count((s) => s === "not_found");
  const failed = count((s) => s === "failed" || s === "unreachable");
  const read = items.length - notFound - failed;
  const parts = [`${read.toLocaleString()} ${read === 1 ? "table" : "tables"} read`];
  if (notFound) parts.push(`${notFound.toLocaleString()} not found`);
  if (failed) parts.push(`${failed.toLocaleString()} failed`);
  return parts.join(", ");
}

export function CoverageTab({ id }: { id: string }) {
  const coverageQ = useQuery({ queryKey: queryKeys.designCoverage(id), queryFn: () => getDesignCoverage(id) });
  const { data } = coverageQ;
  const parts = Object.entries(data?.coverage ?? {});
  return (
    <div className="flex flex-col gap-4">
      <p className={clsx(muted, "m-ink-2")}>
        Every table Meridian tried to read, and what happened. &ldquo;Not found&rdquo; means the table does not exist in
        this SAP release; &ldquo;Failed&rdquo; usually means the connection user lacks table read access
        (<Mono>S_TABU_DIS</Mono> or <Mono>S_TABU_NAM</Mono>). Ask your SAP Basis team to grant it.
      </p>
      <QueryGate q={coverageQ} />
      {data && parts.length === 0 ? <EmptyState title="Nothing read yet" detail="Coverage fills in after design discovery runs." /> : null}
      {parts.length > 0 ? <p className={clsx(muted, "m-ink-2")} data-testid="coverage-summary">{coverageSummary(parts.flatMap(([, items]) => items))}</p> : null}
      {parts.map(([part, items]) => (
        <Card key={part} title={coveragePartLabel(part)}>
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
  const snapsQ = useQuery({ queryKey: queryKeys.designSnapshots(id), queryFn: () => getDesignSnapshots(id) });
  const snaps = snapsQ.data ?? [];
  const done = snaps.filter((s) => s.status !== "failed" && s.status !== "running");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const a = from || done[1]?.id || "";
  const b = to || done[0]?.id || "";
  const diffQ = useQuery({ queryKey: queryKeys.designDiff(id, a, b), queryFn: () => getDesignDiff(id, a, b), enabled: Boolean(a && b && a !== b) });
  const diff = diffQ.data;
  const opts = done.map((s) => ({ value: s.id, label: `${s.started_at ? formatDate(s.started_at, "datetime") : s.id}, ${s.tables} tables` }));
  if (snapsQ.isLoading || snapsQ.isError) return <QueryGate q={snapsQ} />;
  return (
    <div className="flex flex-col gap-4">
      <p className={clsx(muted, "m-ink-2")}>Each time Meridian read this system&apos;s design. Compare two to see which tables and fields changed.</p>
      {snaps.length === 0 ? <EmptyState title="No snapshot yet" detail="Run design discovery from the Connection card above to take the first one." /> : null}
      {snaps.length > 0 ? <table className="m-table">
        <thead><tr>
          <th>Started</th><th>Status</th>
          <th className="text-right">Tables</th>
          <th className="text-right">Customer tables</th>
          <th className="text-right">Customer fields</th>
        </tr></thead>
        <tbody>
          {snaps.map((s) => (
            <tr key={s.id}>
              <td>{s.started_at ? formatDate(s.started_at, "datetime") : "—"}</td>
              <td><span title={s.error ?? undefined}><Pill tone={tone(s.status)}>{labelOf(s.status)}</Pill></span></td>
              <td className="text-right">{s.tables}</td>
              <td className="text-right">{s.customer_tables}</td>
              <td className="text-right">{s.customer_fields}</td>
            </tr>
          ))}
        </tbody>
      </table> : null}
      {done.length > 1 ? (
        <Card title="Design drift">
          <div className="flex gap-2">
            <Select label="Compare from" value={a} options={opts} onValueChange={setFrom} />
            <Select label="Compare to" value={b} options={opts} onValueChange={setTo} />
          </div>
          {a === b ? <p className={clsx(muted, "m-ink-2")}>Choose two different snapshots to compare.</p> : null}
          {a !== b ? <QueryGate q={diffQ} height={96} /> : null}
          {diff && (diff.changes.length === 0 ? <p className={clsx(muted, "m-ink-2")}>No dictionary changes between these snapshots.</p> : (
            <table className="m-table">
              <thead><tr>
                <th>Table</th><th>Field</th>
                <th>Change</th><th>Detail</th>
              </tr></thead>
              <tbody>
                {diff.changes.map((c, i) => (
                  <tr key={i}>
                    <td className="font-mono">{c.table}</td>
                    <td className="font-mono">{c.field ?? ""}</td>
                    <td>
                      <Pill tone={c.change.endsWith("removed") ? "no-go" : c.change.endsWith("added") ? "neutral" : "at-risk"}>{c.change.replace("_", " ")}</Pill>
                    </td>
                    <td className="font-mono">{c.diff ? Object.entries(c.diff).map(([k, [x, y]]) => `${k}: ${String(x)} to ${String(y)}`).join("; ") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </Card>
      ) : snaps.length > 0 ? <p className={clsx(muted, "m-ink-2")}>Drift appears once the system has been discovered twice.</p> : null}
    </div>
  );
}
