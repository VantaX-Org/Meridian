"use client";

import { useDeferredValue, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { discoverDesign, getConfigDeviation, getDesign, getDesignDiff, getDesignSnapshots, getDesignTable, getDesignTables, type DesignChange, type DesignField } from "@/lib/api/v2/design";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t as tr } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { Fact, Facts } from "../../Inspector";
import { Field, Gate } from "../../forms";
import { ResultFrame, useOutcome } from "../../inspector/shared";
import { ScrollFrame } from "../object/ScrollFrame";
import { Coded, Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link, SapCode } from "../../parts";

/**
 * Source design: what discovery read from this system's data dictionary, each table and field against the SAP
 * standard, the live check-table entries against the standard lists the rules fall back to, and what changed in the
 * dictionary between two discoveries (api/routes/source_design.py). Everything shown is what discovery stored.
 */

const PARTS = [
  { key: "tables", get label() { return tr("Tables and fields"); } },
  { key: "config", get label() { return tr("Configuration against standard"); } },
  { key: "drift", get label() { return tr("Drift between discoveries"); } },
] as const;
type Part = (typeof PARTS)[number]["key"];

const when = (v: string | null | undefined) => (v ? formatDate(v, "date") : <Dash />);
const num = (v: number | null | undefined) => (v == null ? <Dash /> : int(v));

interface Q {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/** One list's loading, "not discovered yet" (404) and error states, then its body. */
function Feed({ q, empty, children }: { q: Q; empty: string; children: ReactNode }) {
  if (q.isLoading) return <Skeleton width="100%" height={140} />;
  const status = (q.error as { response?: { status?: number } } | null)?.response?.status;
  if (q.isError && status === 404) return <EmptyFrame>{empty}</EmptyFrame>;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{tr("This list could not be read.")}</ErrorFrame>;
  return <>{children}</>;
}

const defn = (type?: string | null, length?: number | null) => (type ? `${type} ${length ?? ""}`.trim() : null);

/** The field's deviation from the SAP standard in words, from the stored definitions, never the raw code. */
function deviationText(fl: DesignField): string | null {
  if (!fl.deviation) return null;
  if (fl.deviation === "customer_field") return tr("Customer field, not in the standard");
  if (fl.deviation === "not_in_standard") return tr("Not in the standard table");
  return tr("Standard is {std}, here {live}", { std: defn(fl.standard?.type, fl.standard?.length) ?? "", live: defn(fl.type, fl.length) ?? "" });
}

function TableDetail({ id, table }: { id: string; table: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["design", id, "table", table, fixture], queryFn: () => getDesignTable(id, table), staleTime: 60_000 });
  const d = q.data;
  const changed = d ? d.fields.filter((fl) => fl.deviation) : [];
  return (
    <section style={{ marginTop: "var(--m2-s4)" }} data-testid="sd-table" aria-label={tr("Table {table}", { table })}>
      <Feed q={q} empty={tr("This table is not in the latest discovery.")}>
        {d ? (
          <>
            <h3 className="m2-h3"><Coded code={d.table} text={d.description} first /></h3>
            <Facts>
              <Fact label={tr("In the SAP standard")}>{d.in_sap_standard ? tr("Yes") : tr("No, a customer table")}</Fact>
              <Fact label={tr("Fields")}>{int(d.fields.length)}</Fact>
              <Fact label={tr("Fields that differ")}>{int(changed.length)}</Fact>
              <Fact label={tr("Standard fields not here")}>{d.standard_fields_missing.length ? d.standard_fields_missing.map((n) => <Mono key={n}>{n} </Mono>) : int(0)}</Fact>
            </Facts>
            <ScrollFrame label={tr("Fields of {table}, scrollable", { table: d.table })}>
              <table className="m2-tbl">
                <thead>
                  <tr>
                    <th scope="col">{tr("Field")}</th>
                    <th scope="col">{tr("Here")}</th>
                    <th scope="col">{tr("SAP standard")}</th>
                    <th scope="col">{tr("Check table")}</th>
                    <th scope="col">{tr("Against the standard")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.fields].sort((a, b) => Number(!!b.deviation) - Number(!!a.deviation)).map((fl) => (
                    <tr key={fl.name}>
                      <th scope="row"><Coded code={fl.name} text={fl.description} first />{fl.key ? <span className="m2-meta"> {tr("key")}</span> : null}</th>
                      <td data-label={tr("Here")}>{defn(fl.type, fl.length) ?? <Dash />}</td>
                      <td data-label={tr("SAP standard")}>{defn(fl.standard?.type, fl.standard?.length) ?? <Dash />}</td>
                      <td data-label={tr("Check table")}>{fl.check_table ? <Mono>{fl.check_table}</Mono> : <Dash />}</td>
                      <td data-label={tr("Against the standard")}>{deviationText(fl) ?? tr("Matches")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollFrame>
          </>
        ) : null}
      </Feed>
    </section>
  );
}

function Tables({ id, href }: { id: string; href: (p: Record<string, string | null>) => string }) {
  const params = useSearchParams();
  const fixture = useFixture();
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState(false);
  const s = useDeferredValue(search.trim());
  const q = useQuery({ queryKey: ["design", id, "tables", s, customer, fixture], queryFn: () => getDesignTables(id, s, customer), staleTime: 60_000 });
  const picked = params.get("table");
  const items = [...(q.data?.items ?? [])].sort((a, b) => Number(b.customer_table) - Number(a.customer_table) || b.customer_fields - a.customer_fields || a.table.localeCompare(b.table));
  return (
    <>
      <div className="m2-acts">
        <Field label={tr("Find a table")}>{(p) => <input {...p} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Name or description")} />}</Field>
        <label className="m2-chk">
          <input type="checkbox" checked={customer} onChange={(e) => setCustomer(e.target.checked)} />
          {tr("Only tables with customer fields")}
        </label>
      </div>
      <Feed q={q} empty={tr("This system has not been discovered yet. Discover again reads its dictionary.")}>
        {items.length === 0 ? (
          <EmptyFrame>{tr("No table matches.")}</EmptyFrame>
        ) : (
          <ScrollFrame label={tr("Discovered tables, scrollable")}>
            <table className="m2-tbl" data-testid="sd-tables">
              <caption className="m2-meta">{tr("{shown} of {total} tables", { shown: int(items.length), total: int(q.data?.total ?? items.length) })}</caption>
              <thead>
                <tr>
                  <th scope="col">{tr("Table")}</th>
                  <th scope="col">{tr("Kind")}</th>
                  <th scope="col">{tr("Delivery class")}</th>
                  <th scope="col">{tr("Fields")}</th>
                  <th scope="col">{tr("Customer fields")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.table} aria-current={r.table === picked ? "true" : undefined}>
                    <th scope="row">
                      <V2Link href={href({ table: r.table })}><Coded code={r.table} text={r.description} first /></V2Link>
                    </th>
                    <td data-label={tr("Kind")}>{r.customer_table ? tr("Customer table") : tr("SAP standard")}</td>
                    <td data-label={tr("Delivery class")}>{r.delivery_class ? <Mono>{r.delivery_class}</Mono> : <Dash />}</td>
                    <td data-label={tr("Fields")} className="m2-num">{num(r.field_count)}</td>
                    <td data-label={tr("Customer fields")} className="m2-num">{int(r.customer_fields)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Feed>
      {picked ? <TableDetail id={id} table={picked} /> : null}
    </>
  );
}

function ConfigDeviation({ id }: { id: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["design", id, "deviation", fixture], queryFn: () => getConfigDeviation(id), staleTime: 60_000 });
  const rows = [...(q.data?.tables ?? [])].sort((a, b) => b.custom.length + b.missing.length - (a.custom.length + a.missing.length));
  return (
    <Feed q={q} empty={tr("No live configuration has been read from this system yet.")}>
      <p className="m2-note">{tr("Each check table as configured here, against the SAP standard list the rules fall back to. Customer entries are values only this system has; missing entries are standard values not configured.")}</p>
      {rows.length === 0 ? (
        <EmptyFrame>{tr("No live configuration has been read from this system yet.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={tr("Configuration against standard, scrollable")}>
          <table className="m2-tbl" data-testid="sd-deviation">
            <thead>
              <tr>
                <th scope="col">{tr("Check table and field")}</th>
                <th scope="col">{tr("Entries here")}</th>
                <th scope="col">{tr("In the standard")}</th>
                <th scope="col">{tr("Customer entries")}</th>
                <th scope="col">{tr("Standard entries missing")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.reference}>
                  <th scope="row"><Mono>{r.reference}</Mono></th>
                  <td data-label={tr("Entries here")} className="m2-num">{int(r.live_count)}</td>
                  <td data-label={tr("In the standard")} className="m2-num">{int(r.standard_count)}</td>
                  <td data-label={tr("Customer entries")}>{r.custom.length ? r.custom.map((c) => <Mono key={c}>{c} </Mono>) : tr("None")}</td>
                  <td data-label={tr("Standard entries missing")}>{r.missing.length ? r.missing.map((c) => <Mono key={c}>{c} </Mono>) : tr("None")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Feed>
  );
}

const CHANGE: Record<DesignChange["change"], () => string> = {
  table_added: () => tr("Table added"),
  table_removed: () => tr("Table removed"),
  field_added: () => tr("Field added"),
  field_removed: () => tr("Field removed"),
  field_changed: () => tr("Field changed"),
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
    return s ? `${formatDate(s.completed_at ?? s.started_at ?? "", "date")}, ${tr("{n} tables", { n: int(s.tables ?? 0) })}` : sid;
  };
  return (
    <Feed q={snaps} empty={tr("This system has not been discovered yet.")}>
      {done.length < 2 ? (
        <EmptyFrame>{tr("Drift needs two finished discoveries. Discover again after the next transport to compare.")}</EmptyFrame>
      ) : (
        <>
          <div className="m2-acts">
            <Field label={tr("From")}>{(p) => <select {...p} value={from} onChange={(e) => setPair({ from: e.target.value, to })}>{done.map((s) => <option key={s.id} value={s.id}>{label(s.id)}</option>)}</select>}</Field>
            <Field label={tr("To")}>{(p) => <select {...p} value={to} onChange={(e) => setPair({ from, to: e.target.value })}>{done.map((s) => <option key={s.id} value={s.id}>{label(s.id)}</option>)}</select>}</Field>
          </div>
          {from === to ? (
            <EmptyFrame>{tr("Pick two different discoveries.")}</EmptyFrame>
          ) : (
            <Feed q={diff} empty={tr("One of the discoveries is no longer stored.")}>
              {(diff.data?.changes ?? []).length === 0 ? (
                <EmptyFrame>{tr("The dictionary did not change between these discoveries.")}</EmptyFrame>
              ) : (
                <ScrollFrame label={tr("Dictionary changes, scrollable")}>
                  <table className="m2-tbl" data-testid="sd-drift">
                    <thead>
                      <tr>
                        <th scope="col">{tr("Table")}</th>
                        <th scope="col">{tr("Field")}</th>
                        <th scope="col">{tr("Change")}</th>
                        <th scope="col">{tr("What changed")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(diff.data?.changes ?? []).map((c) => (
                        <tr key={`${c.table}:${c.field ?? ""}:${c.change}`}>
                          <th scope="row"><SapCode table={c.table} /></th>
                          <td data-label={tr("Field")}>{c.field ? <SapCode field={c.field.includes(".") || c.field.includes("-") ? c.field : `${c.table}-${c.field}`} /> : <Dash />}</td>
                          <td data-label={tr("Change")}>{CHANGE[c.change]?.() ?? c.change}</td>
                          <td data-label={tr("What changed")}>
                            {c.diff ? Object.entries(c.diff).map(([k, [a, b]]) => <span key={k} className="m2-meta">{tr("{what} from {a} to {b}", { what: k, a: String(a ?? ""), b: String(b ?? "") })} </span>) : <Dash />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollFrame>
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
  const part: Part = PARTS.find((p) => p.key === params.get("part"))?.key ?? "tables";
  const fixture = useFixture();
  const qc = useQueryClient();
  const { can } = useV2Session();
  const { outcome, pending, run } = useOutcome();
  const q = useQuery({ queryKey: ["design", id, "summary", fixture], queryFn: () => getDesign(id), staleTime: 60_000 });
  const href = (set: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "design");
    next.delete("open");
    for (const [k, v] of Object.entries(set)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    return `/s/${id}?${next.toString()}`;
  };
  const discover = () =>
    void run("discover", async () => {
      await discoverDesign(id);
      void qc.invalidateQueries({ queryKey: ["design", id] });
      return { tone: "ok", title: tr("Discovery started"), detail: tr("It reads the dictionary, the customer objects and the configuration of this system again.") };
    });
  const d = q.data;
  const snap = d?.snapshot;
  return (
    <>
      <p className="m2-note">{tr("The data dictionary as this system has it, against the SAP standard. Customer tables, customer fields and changed lengths show where rules must follow this system and not the standard.")}</p>
      <Feed q={q} empty={tr("This system has not been discovered yet.")}>
        {d ? (
          <Facts>
            <Fact label={tr("SAP product and release")}>{d.sap_product || d.sap_release ? `${d.sap_product ?? ""} ${d.sap_release ?? ""}`.trim() : <Dash />}</Fact>
            <Fact label={tr("Last discovery")}>{when(d.discovered_at)}</Fact>
            <Fact label={tr("Tables")}>{num(snap?.tables)}</Fact>
            <Fact label={tr("Customer tables")}>{num(snap?.customer_tables)}</Fact>
            <Fact label={tr("Customer fields")}>{num(snap?.customer_fields)}</Fact>
            <Fact label={tr("Configuration read")}>{when(d.config_synced_at)}</Fact>
          </Facts>
        ) : null}
      </Feed>
      {snap?.error ? <ErrorFrame>{tr("The last discovery stopped: {error}", { error: snap.error })}</ErrorFrame> : null}
      <div className="m2-acts" style={{ marginTop: "var(--m2-s3)" }}>
        <button type="button" className="m2-btn" disabled={!can("trigger_sync") || pending !== null} onClick={discover}>
          {pending === "discover" ? tr("Starting…") : tr("Discover again")}
        </button>
      </div>
      {!can("trigger_sync") ? <Gate>{tr("Discovering the source design needs the trigger sync permission.")}</Gate> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <nav className="m2-subtabs" aria-label={tr("Source design views")}>
        {PARTS.map((p) => (
          <V2Link key={p.key} href={href({ part: p.key === "tables" ? null : p.key, table: null })} className="m2-seg" aria-current={p.key === part ? "page" : undefined}>
            {p.label}
          </V2Link>
        ))}
      </nav>
      {part === "tables" ? <Tables id={id} href={href} /> : part === "config" ? <ConfigDeviation id={id} /> : <Drift id={id} />}
    </>
  );
}
