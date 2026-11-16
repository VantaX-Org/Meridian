"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fieldId, type CatalogueField, type CatalogueFieldHit, type CatalogueSystem, type CatalogueTableRow } from "@/lib/api/v2/catalogue";
import { catalogueStatus, sourceText, typeText, useCatalogueFields, useCatalogueTable, useCatalogueTables } from "@/lib/v2/catalogue";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int, pct1 } from "@/lib/v2/score";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, PartBar, Skeleton, StatCard, type Column } from "../../kit";
import { ChartCard, compact } from "../ChartCard";

/**
 * The data catalogue, native: every SAP table and field Meridian knows. The canvas lists tables (`?q=`, `?system=`),
 * one table's fields (`?table=`) or the fields that match a search (`?view=fields`); a field opens in the inspector
 * (`?open=field:TABLE.FIELD`) with its rules, terms, profile, owners and lineage. Read only.
 */

const systemNames = (ids: readonly string[], systems: readonly CatalogueSystem[]) =>
  ids.map((id) => systems.find((s) => s.id === id)?.name).filter((n): n is string => Boolean(n));

function objectsText(objects: readonly string[]): string {
  if (objects.length === 0) return "";
  if (objects.length === 1) return moduleText(objects[0]);
  return t("{first} and {n} more", { first: moduleText(objects[0]), n: int(objects.length - 1) });
}

export function DataCatalogue() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const system = params.get("system") ?? "";
  const table = (params.get("table") ?? "").toUpperCase();
  const view = params.get("view") === "fields" ? "fields" : "tables";
  const [draft, setDraft] = useState({ q, system, view });

  const go = (next: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go({ q: draft.q.trim(), system: draft.system, view: draft.view === "fields" ? "fields" : "", table: "", open: "" });
  };

  const tables = useCatalogueTables(view === "tables" && !table ? q : "", system);
  const systems = tables.data?.systems ?? [];

  return (
    <div className="nx-body" data-testid="catalogue-page">
      <p className="nx-sub">{t("The catalogue only reads. Rules, terms and owners are changed where they live.")}</p>
      <form className="nx-row nx-wrap" onSubmit={submit} aria-label={t("Search the catalogue")} data-testid="catalogue-search">
        <label className="nx-field">
          {t("Search")}
          <input className="nx-input" type="search" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder={t("Table, field or business term")} />
        </label>
        <label className="nx-field">
          {t("Look in")}
          <select className="nx-input" value={draft.view} onChange={(e) => setDraft({ ...draft, view: e.target.value === "fields" ? "fields" : "tables" })}>
            <option value="tables">{t("Tables")}</option>
            <option value="fields">{t("Fields")}</option>
          </select>
        </label>
        <label className="nx-field">
          {t("System")}
          <select className="nx-input" value={draft.system} onChange={(e) => setDraft({ ...draft, system: e.target.value })}>
            <option value="">{t("Every system")}</option>
            {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <Button type="submit" variant="secondary">{t("Search")}</Button>
      </form>
      {table ? (
        <TableView table={table} system={system} onBack={() => go({ table: "", open: "" })} />
      ) : view === "fields" ? (
        <FieldHits q={q} system={system} onTables={() => { setDraft({ ...draft, view: "tables" }); go({ view: "", open: "" }); }} />
      ) : tables.isPending ? (
        <Skeleton />
      ) : tables.isError ? (
        catalogueStatus(tables.error) === 403 ? (
          <EmptyState heading={t("Your role cannot read the data catalogue.")} />
        ) : catalogueStatus(tables.error) === 404 ? (
          <EmptyState heading={t("This system is not connected to this tenant.")} />
        ) : (
          <ErrorState sentence={t("The data catalogue could not be read.")} onRetry={() => void tables.refetch()} />
        )
      ) : (
        <TableList rows={tables.data.tables} total={tables.data.total} systems={systems} q={q} onOpen={(r) => go({ table: r.table, open: "" })} />
      )}
    </div>
  );
}

function TableList({ rows, total, systems, q, onOpen }: { rows: CatalogueTableRow[]; total: number; systems: CatalogueSystem[]; q: string; onOpen: (r: CatalogueTableRow) => void }) {
  const byObject = new Map<string, number>();
  for (const r of rows) for (const o of r.objects) byObject.set(o, (byObject.get(o) ?? 0) + 1);
  const ruled = rows.filter((r) => r.rule_count > 0).length;
  const columns: Column<CatalogueTableRow>[] = [
    { id: "table", label: t("Table"), compare: (a, b) => a.table.localeCompare(b.table), cell: (r) => <Code code={r.table} text={r.description || undefined} /> },
    { id: "fields", label: t("Fields"), align: "end", compare: (a, b) => a.field_count - b.field_count, cell: (r) => int(r.field_count) },
    { id: "rules", label: t("Rules"), align: "end", compare: (a, b) => a.rule_count - b.rule_count, cell: (r) => int(r.rule_count) },
    { id: "objects", label: t("Objects"), cell: (r) => (r.objects.length ? objectsText(r.objects) : <span className="nx-sub">{t("No object's rules read this table")}</span>) },
    { id: "systems", label: t("Systems"), cell: (r) => (r.systems.length ? systemNames(r.systems, systems).join(", ") : <span className="nx-sub">{t("No connected system uses this table yet")}</span>) },
    { id: "source", label: t("Defined by"), hidden: true, cell: (r) => sourceText(r.source) },
  ];
  return (
    <>
      <div className="nx-statgrid">
        <StatCard label={t("Tables")} value={total} />
        <StatCard label={t("Fields")} value={rows.reduce((n, r) => n + r.field_count, 0)} />
        <StatCard label={t("Tables with rules")} value={ruled} />
      </div>
      {byObject.size > 0 ? (
        <div className="nx-chartcards">
          <ChartCard
            title={t("Tables by object")} state="ready" testId="catalogue-objects"
            chart={<PartBar segments={[...byObject].sort((a, b) => b[1] - a[1]).map(([o, n]) => ({ label: moduleText(o), value: n }))} label={t("Tables by object")} format={compact} />}
            figure={int(byObject.size)} line={t("{n} tables", { n: int(rows.length) })} emptyLine={t("No object's rules read this table")}
          />
        </div>
      ) : null}
      <div data-testid="catalogue-tables">
        <DataTable
          rows={rows} columns={columns} rowKey={(r) => r.table} rowLabel={(r) => r.table} caption={t("Tables")} total={total} onOpenRow={onOpen}
          empty={{ heading: q ? t("No table matches this search.") : t("No table is in the catalogue for this system yet. Discovery reads a system's dictionary when it connects.") }}
        />
      </div>
    </>
  );
}

function TableView({ table, system, onBack }: { table: string; system: string; onBack: () => void }) {
  const q = useCatalogueTable(table, system);
  const { openItem } = useOpenItem();
  const back = <Button variant="quiet" onClick={onBack}>{t("All tables")}</Button>;
  if (q.isPending) return <Skeleton />;
  if (q.isError) {
    return (
      <>
        {back}
        {catalogueStatus(q.error) === 404 ? (
          <EmptyState heading={t("This table is not in the catalogue.")} />
        ) : (
          <ErrorState sentence={t("This table could not be read.")} onRetry={() => void q.refetch()} />
        )}
      </>
    );
  }
  const d = q.data;
  const owners = d.owners.filter((o) => o.kind === "object" && (o.owner_name || o.steward_name));
  const fields: Column<CatalogueField>[] = [
    { id: "field", label: t("Field"), compare: (a, b) => a.field.localeCompare(b.field), cell: (f) => <Code code={f.field} text={f.description || undefined} /> },
    { id: "type", label: t("Type"), cell: (f) => (f.type ? <span className="nx-mono">{typeText(f)}</span> : "-") },
    { id: "key", label: t("Key"), cell: (f) => (f.key ? <Chip tone="neutral">{t("Yes")}</Chip> : "") },
    { id: "rules", label: t("Rules"), align: "end", compare: (a, b) => a.rules.length - b.rules.length, cell: (f) => int(f.rules.length) },
    { id: "term", label: t("Business term"), cell: (f) => f.terms[0]?.business_name ?? "" },
    {
      id: "blank", label: t("Blank"), align: "end",
      compare: (a, b) => (a.profile?.stats.blank_pct ?? -1) - (b.profile?.stats.blank_pct ?? -1),
      cell: (f) => (f.profile ? pct1(f.profile.stats.blank_pct / 100) : <span className="nx-sub">{t("No analysed run has profiled this field")}</span>),
    },
    { id: "check", label: t("Check table"), hidden: true, cell: (f) => (f.check_table ? <span className="nx-mono">{f.check_table}</span> : "") },
  ];
  const blanks = d.fields.filter((f) => f.profile).map((f) => ({ label: f.field, value: f.profile?.stats.blank_pct ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 8);
  return (
    <>
      <section aria-label={t("Table {table}", { table: d.table })} data-testid="catalogue-table">
        <div className="nx-row nx-wrap">
          <h2><Code code={d.table} text={d.description || undefined} /></h2>
          {back}
        </div>
        <dl className="nx-statgrid">
          <div><dt className="nx-sub">{t("Key")}</dt><dd>{d.keys.length ? <span className="nx-mono">{d.keys.join(", ")}</span> : t("The dictionary names no key")}</dd></div>
          <div><dt className="nx-sub">{t("Defined by")}</dt><dd>{sourceText(d.source)}</dd></div>
          <div><dt className="nx-sub">{t("Systems")}</dt><dd>{d.systems.length ? d.systems.map((s) => s.name).join(", ") : t("No connected system uses this table yet")}</dd></div>
          <div><dt className="nx-sub">{t("Objects")}</dt><dd>{d.objects.length ? d.objects.map(moduleText).join(", ") : t("No object's rules read this table")}</dd></div>
          <div>
            <dt className="nx-sub">{t("Owners")}</dt>
            <dd>{owners.length ? owners.map((o) => t("{object}: {owner}", { object: moduleText(o.ref), owner: o.owner_name ?? o.steward_name ?? "" })).join("; ") : t("No owner is set for the objects that read this table")}</dd>
          </div>
          {d.obsolete_in ? <div><dt className="nx-sub">{t("In S/4HANA")}</dt><dd>{d.note ? t("Replaced: {note}", { note: d.note }) : t("Replaced")}</dd></div> : null}
        </dl>
      </section>
      {blanks.length ? (
        <div className="nx-chartcards">
          <ChartCard
            title={t("Blank")} state="ready" testId="catalogue-blanks"
            chart={<PartBar segments={blanks} label={t("Blank")} format={(n) => pct1(n / 100)} />}
            figure={int(blanks.length)} line={t("{n} fields", { n: int(d.fields.length) })} emptyLine={t("No analysed run has profiled this field")}
          />
        </div>
      ) : null}
      <div data-testid="catalogue-fields">
        <DataTable
          rows={d.fields} columns={fields} rowKey={(f) => f.field} rowLabel={(f) => f.field} caption={t("Fields of {table}", { table: d.table })}
          onOpenRow={(f) => openItem({ kind: "field", id: fieldId(d.table, f.field) })}
          empty={{ heading: t("The dictionary lists no fields for this table.") }}
        />
      </div>
    </>
  );
}

function FieldHits({ q, system, onTables }: { q: string; system: string; onTables: () => void }) {
  const hits = useCatalogueFields(q, system);
  const { openItem } = useOpenItem();
  if (q.trim().length < 2) return <EmptyState heading={t("Type at least two characters to search the fields.")} />;
  if (hits.isPending) return <Skeleton />;
  if (hits.isError) {
    return catalogueStatus(hits.error) === 404 ? (
      <EmptyState heading={t("This system is not connected to this tenant.")} />
    ) : (
      <ErrorState sentence={t("The fields could not be searched.")} onRetry={() => void hits.refetch()} />
    );
  }
  const columns: Column<CatalogueFieldHit>[] = [
    { id: "field", label: t("Field"), compare: (a, b) => fieldId(a.table, a.field).localeCompare(fieldId(b.table, b.field)), cell: (h) => <Code code={fieldId(h.table, h.field)} text={h.description || undefined} /> },
    { id: "table", label: t("Table"), cell: (h) => <Code code={h.table} text={h.table_description || undefined} /> },
    { id: "type", label: t("Type"), cell: (h) => (h.type ? <span className="nx-mono">{typeText({ type: h.type, length: h.length, decimals: 0 })}</span> : "-") },
    { id: "rules", label: t("Rules"), align: "end", compare: (a, b) => a.rule_count - b.rule_count, cell: (h) => int(h.rule_count) },
    { id: "term", label: t("Business term"), cell: (h) => h.terms[0]?.business_name ?? "" },
  ];
  const { total, fields } = hits.data;
  return (
    <div data-testid="catalogue-field-hits">
      <DataTable
        rows={fields} columns={columns} rowKey={(h) => fieldId(h.table, h.field)} rowLabel={(h) => fieldId(h.table, h.field)} caption={t("Fields that match")} total={total}
        onOpenRow={(h) => openItem({ kind: "field", id: fieldId(h.table, h.field) })}
        empty={{ heading: t("No field matches this search.") }}
      />
      <Button variant="quiet" onClick={onTables}>{t("Search the tables for these words")}</Button>
    </div>
  );
}
