"use client";

import { useDeferredValue, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { discoverDesign, getConfigDeviation, getDesign, getDesignConfig, getDesignCoverage, getDesignDiff, getDesignSnapshots, getDesignTable, getDesignTables, type ConfigDeviation as Deviation, type DesignChange, type DesignField } from "@/lib/api/v2/design";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { describeField, describeTable } from "@/lib/v2/sap-fields";
import { DASH, int } from "@/lib/v2/score";
import { useOutcome } from "@/design/v2/inspector/shared";
import { COVERAGE_STATUS } from "@/design/v2/screens/system/SourceDesign";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, SegmentedControl, Skeleton, type Column } from "../../kit";
import { ExportTable } from "../ExportTable";
import { Figs, Panel } from "../cfg-parts";
import { Result } from "./Result";

/**
 * Source design: what discovery read from this system's data dictionary, each table and field against the SAP
 * standard, the live check-table entries against the standard lists the rules fall back to, and what changed in the
 * dictionary between two discoveries (api/routes/source_design.py). Everything shown is what discovery stored.
 */

type Part = "tables" | "config" | "coverage" | "drift";
const PARTS: Part[] = ["tables", "config", "coverage", "drift"];

const when = (v: string | null | undefined) => (v ? formatDate(v, "date") : DASH);
const num = (v: number | null | undefined) => (v == null ? DASH : int(v));
const tbl = (name: string, text?: string | null) => <Code code={name} text={text || describeTable(name) || undefined} />;
const fld = (name: string, text?: string | null) => <Code code={name} text={text || describeField(name) || undefined} />;
const codes = (list: string[]) => (list.length ? <span className="nx-wrap">{list.map((c) => <Code key={c} code={c} />)}</span> : t("None"));

interface Q {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** One list's loading, "not discovered yet" (404) and error states, then its body. */
function Feed({ q, empty, children }: { q: Q; empty: string; children: ReactNode }) {
  if (q.isLoading) return <Skeleton lines={4} label={t("Source design")} />;
  const status = (q.error as { response?: { status?: number } } | null)?.response?.status;
  if (q.isError && status === 404) return <EmptyState heading={empty} />;
  if (q.isError) return <ErrorState sentence={t("This list could not be read.")} onRetry={() => void q.refetch()} />;
  return <>{children}</>;
}

function List<R>({ testId, caption, rows, columns, rowKey, rowLabel }: { testId?: string; caption: string; rows: R[]; columns: Column<R>[]; rowKey: (r: R) => string; rowLabel: (r: R) => string }) {
  return (
    <ExportTable>
      <div data-testid={testId}>
        <DataTable rows={rows} columns={columns} rowKey={rowKey} rowLabel={rowLabel} caption={caption} />
      </div>
    </ExportTable>
  );
}

const defn = (type?: string | null, length?: number | null) => (type ? `${type} ${length ?? ""}`.trim() : null);

/** The field's deviation from the SAP standard in words, from the stored definitions, never the raw code. */
function deviationText(fl: DesignField): string | null {
  if (!fl.deviation) return null;
  if (fl.deviation === "customer_field") return t("Customer field, not in the standard");
  if (fl.deviation === "not_in_standard") return t("Not in the standard table");
  return t("Standard is {std}, here {live}", { std: defn(fl.standard?.type, fl.standard?.length) ?? "", live: defn(fl.type, fl.length) ?? "" });
}

function TableDetail({ id, table }: { id: string; table: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["design", id, "table", table, fixture], queryFn: () => getDesignTable(id, table), staleTime: 60_000 });
  const d = q.data;
  const changed = d ? d.fields.filter((fl) => fl.deviation) : [];
  const columns: Column<DesignField>[] = [
    { id: "field", label: t("Field"), cell: (fl) => <><Code code={fl.name} text={fl.description || describeField(`${table}-${fl.name}`) || undefined} />{fl.key ? <span className="nx-sub"> {t("key")}</span> : null}</> },
    { id: "here", label: t("Here"), cell: (fl) => defn(fl.type, fl.length) ?? DASH },
    { id: "std", label: t("SAP standard"), cell: (fl) => defn(fl.standard?.type, fl.standard?.length) ?? DASH },
    { id: "check", label: t("Check table"), cell: (fl) => (fl.check_table ? tbl(fl.check_table) : DASH) },
    { id: "against", label: t("Against the standard"), cell: (fl) => deviationText(fl) ?? t("Matches") },
  ];
  return (
    <section data-testid="sd-table" aria-label={t("Table {table}", { table })}>
      <Feed q={q} empty={t("This table is not in the latest discovery.")}>
        {d ? (
          <>
            <h3>{tbl(d.table, d.description)}</h3>
            <Figs label={t("Table {table}", { table: d.table })} figs={[
              { label: t("In the SAP standard"), value: d.in_sap_standard ? t("Yes") : t("No, a customer table") },
              { label: t("Fields"), value: int(d.fields.length) },
              { label: t("Fields that differ"), value: int(changed.length) },
              { label: t("Standard fields not here"), value: d.standard_fields_missing.length ? d.standard_fields_missing.join(" ") : int(0) },
            ]} />
            <List
              caption={t("Fields of {table}, scrollable", { table: d.table })}
              rows={[...d.fields].sort((a, b) => Number(!!b.deviation) - Number(!!a.deviation))}
              columns={columns}
              rowKey={(fl) => fl.name}
              rowLabel={(fl) => fl.name}
            />
          </>
        ) : null}
      </Feed>
    </section>
  );
}

function Tables({ id, picked, pick }: { id: string; picked: string | null; pick: (table: string) => void }) {
  const fixture = useFixture();
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState(false);
  const s = useDeferredValue(search.trim());
  const q = useQuery({ queryKey: ["design", id, "tables", s, customer, fixture], queryFn: () => getDesignTables(id, s, customer), staleTime: 60_000 });
  type R = NonNullable<typeof q.data>["items"][number];
  const items = [...(q.data?.items ?? [])].sort((a, b) => Number(b.customer_table) - Number(a.customer_table) || b.customer_fields - a.customer_fields || a.table.localeCompare(b.table));
  const columns: Column<R>[] = [
    { id: "table", label: t("Table"), cell: (r) => <button type="button" className="nx-link" aria-current={r.table === picked ? "true" : undefined} onClick={() => pick(r.table)}>{tbl(r.table, r.description)}</button> },
    { id: "kind", label: t("Kind"), cell: (r) => (r.customer_table ? t("Customer table") : t("SAP standard")) },
    { id: "class", label: t("Delivery class"), cell: (r) => (r.delivery_class ? <Code code={r.delivery_class} /> : DASH) },
    { id: "fields", label: t("Fields"), align: "end", cell: (r) => num(r.field_count) },
    { id: "customer", label: t("Customer fields"), align: "end", cell: (r) => int(r.customer_fields) },
  ];
  return (
    <>
      <div className="nx-row nx-wrap">
        <label className="nx-field">
          {t("Find a table")}
          <input className="nx-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Name or description")} />
        </label>
        <label className="nx-field"><span><input type="checkbox" checked={customer} onChange={(e) => setCustomer(e.target.checked)} /> {t("Only tables with customer fields")}</span></label>
      </div>
      <Feed q={q} empty={t("This system has not been discovered yet. Discover again reads its dictionary.")}>
        {items.length === 0 ? (
          <EmptyState heading={t("No table matches.")} />
        ) : (
          <List
            testId="sd-tables"
            caption={t("{shown} of {total} tables", { shown: int(items.length), total: int(q.data?.total ?? items.length) })}
            rows={items}
            columns={columns}
            rowKey={(r) => r.table}
            rowLabel={(r) => r.table}
          />
        )}
      </Feed>
      {picked ? <TableDetail id={id} table={picked} /> : null}
    </>
  );
}

/** The stored entries of one configuration table, columns exactly as the system returned them. */
function ConfigTableDetail({ id, table }: { id: string; table: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["design", id, "config", table, fixture], queryFn: () => getDesignConfig(id, table), staleTime: 60_000 });
  const d = q.data;
  const cols = d ? [...new Set(d.rows.flatMap((r) => Object.keys(r)))] : [];
  type R = { i: number; v: Record<string, unknown> };
  const columns: Column<R>[] = cols.map((c) => ({
    id: c,
    label: describeField(`${table}-${c}`) ? `${describeField(`${table}-${c}`)} (${c})` : c,
    cell: (r: R) => (r.v[c] == null || r.v[c] === "" ? DASH : <Code code={String(r.v[c])} />),
  }));
  return (
    <section data-testid="sd-config-table" aria-label={t("Configuration table {table}", { table })}>
      <Feed q={q} empty={t("No configuration was read for this table.")}>
        {d ? (
          <>
            <h3>{tbl(d.table)}</h3>
            <Figs label={t("Configuration table {table}", { table: d.table })} figs={[
              { label: t("Scope"), value: d.scope ? labelText(d.scope) : DASH },
              { label: t("Entries"), value: num(d.total) },
              { label: t("Shown"), value: int(d.rows.length) },
              { label: t("Read"), value: when(d.synced_at) },
            ]} />
            {d.rows.length === 0 ? (
              <EmptyState heading={t("The table has no stored entries.")} />
            ) : (
              <List caption={t("Entries of {table}, scrollable", { table: d.table })} rows={d.rows.map((v, i) => ({ i, v }))} columns={columns} rowKey={(r) => String(r.i)} rowLabel={(r) => cols.map((c) => String(r.v[c] ?? "")).join(" ")} />
            )}
          </>
        ) : null}
      </Feed>
    </section>
  );
}

/** Which tables the last discovery read, which it could not, and why. */
function Coverage({ id }: { id: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["design", id, "coverage", fixture], queryFn: () => getDesignCoverage(id), staleTime: 60_000 });
  const parts = Object.entries(q.data?.coverage ?? {}).filter(([, list]) => Array.isArray(list) && list.length > 0);
  type C = (typeof parts)[number][1][number] & { i: number };
  const columns: Column<C>[] = [
    { id: "table", label: t("Table"), cell: (c) => (c.table ? tbl(c.table) : DASH) },
    {
      id: "outcome",
      label: t("Outcome"),
      cell: (c) => {
        const s = COVERAGE_STATUS[c.status];
        return <Chip tone={s?.tone === "pass" ? "good" : s?.tone === "warn" ? "warn" : "neutral"}>{s?.label() ?? labelText(c.status)}</Chip>;
      },
    },
    { id: "rows", label: t("Rows"), align: "end", cell: (c) => num(c.rows) },
    { id: "detail", label: t("Detail"), cell: (c) => (c.detail || COVERAGE_STATUS[c.status]?.next ? <>{c.detail} {COVERAGE_STATUS[c.status]?.next?.()}</> : DASH) },
  ];
  return (
    <Feed q={q} empty={t("This system has not been discovered yet.")}>
      <p className="nx-note">{t("Every table the last discovery tried to read, grouped by what it was read for, with the outcome and the system's reason when it failed.")}</p>
      {Object.entries(q.data?.waiting_for_data ?? {}).filter(([, n]) => n > 0).map(([m, n]) => (
        <p key={m} className="nx-note" data-testid={`sd-waiting-${m}`}>
          {t("{module}: {count} {count, plural, one {rule waits} other {rules wait}} for data and {count, plural, one {is} other {are}} left out of the score.", { module: labelText(m), count: n })}
        </p>
      ))}
      {parts.length === 0 ? (
        <EmptyState heading={t("The last discovery stored no coverage.")} />
      ) : (
        parts.map(([part, list]) => (
          <List key={part} testId={`sd-coverage-${part}`} caption={labelText(part)} rows={list.map((c, i) => ({ ...c, i }))} columns={columns} rowKey={(c) => `${c.table ?? ""}:${c.i}`} rowLabel={(c) => c.table ?? c.status} />
        ))
      )}
    </Feed>
  );
}

function ConfigDeviation({ id, picked, pick }: { id: string; picked: string | null; pick: (table: string) => void }) {
  const fixture = useFixture();
  const summary = useQuery({ queryKey: ["design", id, "summary", fixture], queryFn: () => getDesign(id), staleTime: 60_000 });
  const read = summary.data?.configuration ?? [];
  type Read = (typeof read)[number];
  const q = useQuery({ queryKey: ["design", id, "deviation", fixture], queryFn: () => getConfigDeviation(id), staleTime: 60_000 });
  const rows = [...(q.data?.tables ?? [])].sort((a, b) => b.custom.length + b.missing.length - (a.custom.length + a.missing.length));
  const columns: Column<Deviation>[] = [
    { id: "ref", label: t("Check table and field"), cell: (r) => fld(r.reference) },
    { id: "here", label: t("Entries here"), align: "end", cell: (r) => int(r.live_count) },
    { id: "std", label: t("In the standard"), align: "end", cell: (r) => int(r.standard_count) },
    { id: "custom", label: t("Customer entries"), cell: (r) => codes(r.custom) },
    { id: "missing", label: t("Standard entries missing"), cell: (r) => codes(r.missing) },
  ];
  const readColumns: Column<Read>[] = [
    { id: "table", label: t("Table"), cell: (r) => <button type="button" className="nx-link" aria-current={r.table === picked ? "true" : undefined} onClick={() => pick(r.table)}>{tbl(r.table)}</button> },
    { id: "scope", label: t("Scope"), cell: (r) => (r.scope ? labelText(r.scope) : DASH) },
    { id: "rows", label: t("Entries"), align: "end", cell: (r) => num(r.rows) },
    { id: "read", label: t("Read"), cell: (r) => when(r.synced_at) },
  ];
  return (
    <Feed q={q} empty={t("No live configuration has been read from this system yet.")}>
      <p className="nx-note">{t("Each check table as configured here, against the SAP standard list the rules fall back to. Customer entries are values only this system has; missing entries are standard values not configured.")}</p>
      {rows.length === 0 ? (
        <EmptyState heading={t("No live configuration has been read from this system yet.")} />
      ) : (
        <List testId="sd-deviation" caption={t("Configuration against standard, scrollable")} rows={rows} columns={columns} rowKey={(r) => r.reference} rowLabel={(r) => r.reference} />
      )}
      {read.length > 0 ? (
        <List testId="sd-config-read" caption={t("Configuration tables read")} rows={read} columns={readColumns} rowKey={(r) => r.table} rowLabel={(r) => r.table} />
      ) : null}
      {picked ? <ConfigTableDetail id={id} table={picked} /> : null}
    </Feed>
  );
}

const CHANGE: Record<DesignChange["change"], () => string> = {
  table_added: () => t("Table added"),
  table_removed: () => t("Table removed"),
  field_added: () => t("Field added"),
  field_removed: () => t("Field removed"),
  field_changed: () => t("Field changed"),
};

function Drift({ id }: { id: string }) {
  const fixture = useFixture();
  const snaps = useQuery({ queryKey: ["design", id, "snapshots", fixture], queryFn: () => getDesignSnapshots(id), staleTime: 60_000 });
  const done = (snaps.data ?? []).filter((s) => s.status === "completed");
  const [pair, setPair] = useState<{ from?: string; to?: string }>({});
  const to = pair.to ?? done[0]?.id;
  const from = pair.from ?? done[1]?.id;
  const diff = useQuery({
    queryKey: ["design", id, "diff", from, to, fixture],
    queryFn: () => getDesignDiff(id, from as string, to as string),
    enabled: !!from && !!to && from !== to,
    staleTime: 60_000,
  });
  const label = (sid: string) => {
    const s = done.find((x) => x.id === sid);
    return s ? `${formatDate(s.completed_at ?? s.started_at ?? "", "date")}, ${t("{n} tables", { n: int(s.tables ?? 0) })}` : sid;
  };
  const columns: Column<DesignChange>[] = [
    { id: "table", label: t("Table"), cell: (c) => tbl(c.table) },
    { id: "field", label: t("Field"), cell: (c) => (c.field ? fld(c.field.includes(".") || c.field.includes("-") ? c.field : `${c.table}-${c.field}`) : DASH) },
    { id: "change", label: t("Change"), cell: (c) => CHANGE[c.change]?.() ?? c.change },
    {
      id: "what",
      label: t("What changed"),
      cell: (c) => (c.diff ? Object.entries(c.diff).map(([k, [a, b]]) => <span key={k} className="nx-sub">{t("{what} from {a} to {b}", { what: k, a: String(a ?? ""), b: String(b ?? "") })} </span>) : DASH),
    },
  ];
  return (
    <Feed q={snaps} empty={t("This system has not been discovered yet.")}>
      {done.length < 2 ? (
        <EmptyState heading={t("Drift needs two finished discoveries. Discover again after the next transport to compare.")} />
      ) : (
        <>
          <div className="nx-row nx-wrap">
            <label className="nx-field">
              {t("From")}
              <select className="nx-input" value={from} onChange={(e) => setPair({ from: e.target.value, to })}>{done.map((s) => <option key={s.id} value={s.id}>{label(s.id)}</option>)}</select>
            </label>
            <label className="nx-field">
              {t("To")}
              <select className="nx-input" value={to} onChange={(e) => setPair({ from, to: e.target.value })}>{done.map((s) => <option key={s.id} value={s.id}>{label(s.id)}</option>)}</select>
            </label>
          </div>
          {from === to ? (
            <EmptyState heading={t("Pick two different discoveries.")} />
          ) : (
            <Feed q={diff} empty={t("One of the discoveries is no longer stored.")}>
              {(diff.data?.changes ?? []).length === 0 ? (
                <EmptyState heading={t("The dictionary did not change between these discoveries.")} />
              ) : (
                <List testId="sd-drift" caption={t("Dictionary changes, scrollable")} rows={diff.data?.changes ?? []} columns={columns} rowKey={(c) => `${c.table}:${c.field ?? ""}:${c.change}`} rowLabel={(c) => `${c.table} ${c.field ?? ""}`.trim()} />
              )}
            </Feed>
          )}
        </>
      )}
    </Feed>
  );
}

export function SourceDesign({ id }: { id: string }) {
  const params = useSearchParams();
  const [part, setPart] = useState<Part>(() => PARTS.find((p) => p === params.get("part")) ?? "tables");
  const [table, setTable] = useState<string | null>(() => params.get("table"));
  const [cfg, setCfg] = useState<string | null>(() => params.get("cfg"));
  const fixture = useFixture();
  const qc = useQueryClient();
  const { can } = useV2Session();
  const { outcome, pending, run } = useOutcome();
  const q = useQuery({ queryKey: ["design", id, "summary", fixture], queryFn: () => getDesign(id), staleTime: 60_000 });
  const discover = () =>
    void run("discover", async () => {
      await discoverDesign(id);
      void qc.invalidateQueries({ queryKey: ["design", id] });
      return { tone: "ok", title: t("Discovery started"), detail: t("It reads the dictionary, the customer objects and the configuration of this system again.") };
    });
  const choose = (p: Part) => {
    setPart(p);
    setTable(null);
    setCfg(null);
  };
  const d = q.data;
  const snap = d?.snapshot;
  return (
    <Panel title={t("Source design")} testId="n-source-design">
      <p className="nx-note">{t("The data dictionary as this system has it, against the SAP standard. Customer tables, customer fields and changed lengths show where rules must follow this system and not the standard.")}</p>
      <Feed q={q} empty={t("This system has not been discovered yet.")}>
        {d ? (
          <Figs label={t("Source design")} figs={[
            { label: t("SAP product and release"), value: d.sap_product || d.sap_release ? `${d.sap_product ?? ""} ${d.sap_release ?? ""}`.trim() : DASH },
            { label: t("Last discovery"), value: when(d.discovered_at) },
            { label: t("Tables"), value: num(snap?.tables) },
            { label: t("Customer tables"), value: num(snap?.customer_tables) },
            { label: t("Customer fields"), value: num(snap?.customer_fields) },
            { label: t("Configuration read"), value: when(d.config_synced_at) },
          ]} />
        ) : null}
      </Feed>
      {snap?.error ? <p className="nx-error-line" role="alert">{t("The last discovery stopped: {error}", { error: snap.error })}</p> : null}
      <div className="nx-row">
        <Button size={32} variant="secondary" disabled={!can("trigger_sync") || pending !== null} loading={pending === "discover"} onClick={discover}>
          {pending === "discover" ? t("Starting…") : t("Discover again")}
        </Button>
      </div>
      {!can("trigger_sync") ? <p className="nx-sub">{t("Discovering the source design needs the trigger sync permission.")}</p> : null}
      {outcome ? <Result outcome={outcome} /> : null}
      <SegmentedControl label={t("Source design views")} value={part} onChange={choose} items={[
        { value: "tables", label: t("Tables and fields") },
        { value: "config", label: t("Configuration against standard") },
        { value: "coverage", label: t("What discovery read") },
        { value: "drift", label: t("Drift between discoveries") },
      ]} />
      {part === "tables" ? <Tables id={id} picked={table} pick={setTable} />
        : part === "config" ? <ConfigDeviation id={id} picked={cfg} pick={setCfg} />
        : part === "coverage" ? <Coverage id={id} />
        : <Drift id={id} />}
    </Panel>
  );
}
