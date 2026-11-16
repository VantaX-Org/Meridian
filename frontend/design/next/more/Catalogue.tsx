"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fieldId, type CatalogueFieldHit, type CatalogueSystem, type CatalogueTable, type CatalogueTableRow, type CatalogueField } from "@/lib/api/v2/catalogue";
import { catalogueStatus, sourceText, typeText, useCatalogueFields, useCatalogueTable, useCatalogueTables } from "@/lib/v2/catalogue";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int, pct1 } from "@/lib/v2/score";
import { V2Link } from "@/design/v2/parts";
import { Button, Code, DataTable, EmptyState, ErrorState, Skeleton, type Column } from "../kit";
import { About, Panel } from "./cfg-parts";
import { Dash } from "./entry-parts";

/**
 * The data catalogue: every SAP table and field Meridian knows, searched and browsed in one place. The canvas lists
 * tables (`?q=`, `?system=`), one table's fields (`?table=`) or the fields that match a search (`?view=fields`); a
 * field opens in the inspector (`?open=field:TABLE.FIELD`) with its rules, terms, profile, owners and lineage.
 */

type View = "tables" | "fields";

const systemNames = (ids: readonly string[], systems: readonly CatalogueSystem[]) =>
  ids.map((id) => systems.find((s) => s.id === id)?.name).filter((n): n is string => Boolean(n));

function objectsText(objects: readonly string[]): string {
  if (objects.length === 0) return "";
  if (objects.length === 1) return moduleText(objects[0]);
  return t("{first} and {n} more", { first: moduleText(objects[0]), n: int(objects.length - 1) });
}

export function Catalogue() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const system = params.get("system") ?? "";
  const table = (params.get("table") ?? "").toUpperCase();
  const view: View = params.get("view") === "fields" ? "fields" : "tables";
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
    <div className="nx-body">
      <form className="nx-form nx-row" onSubmit={submit} aria-label={t("Search the catalogue")} data-testid="catalogue-search">
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
        <Button type="submit" size={32}>{t("Search")}</Button>
      </form>
      {table ? (
        <TableView table={table} system={system} onBack={() => go({ table: "", open: "" })} />
      ) : view === "fields" ? (
        <FieldHits q={q} system={system} />
      ) : tables.isPending ? (
        <Skeleton lines={8} label={t("Data catalogue")} />
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
      <About
        shows={t("Every SAP table and field Meridian knows, from the SAP dictionary and each system's own, with the rules that check it, its business terms, its latest profile and where its values go.")}
        next={{ href: "/rules", label: t("Open the rules library") }}
        why={t("The catalogue only reads. Rules, terms and owners are changed where they live.")}
        means={[
          [t("Rules"), t("Shipped and tenant rules that read the field, on or off for this tenant.")],
          [t("Systems"), t("Connected systems with an object that reads the table, a run that profiled it or a dictionary that holds it.")],
          [t("Blank"), t("Share of records with no value in the newest analysed run that profiled the field.")],
        ]}
      />
    </div>
  );
}

function TableList({ rows, total, systems, q, onOpen }: { rows: CatalogueTableRow[]; total: number; systems: CatalogueSystem[]; q: string; onOpen: (r: CatalogueTableRow) => void }) {
  const columns: Column<CatalogueTableRow>[] = [
    { id: "table", label: t("Table"), cell: (r) => <span data-testid={`cat-table-${r.table}`}><Code code={r.table} text={r.description || undefined} /></span> },
    { id: "description", label: t("Description"), cell: (r) => r.description || <Dash why={t("The dictionary gives no description")} /> },
    { id: "fields", label: t("Fields"), align: "end", cell: (r) => int(r.field_count), compare: (a, b) => a.field_count - b.field_count },
    { id: "rules", label: t("Rules"), align: "end", cell: (r) => int(r.rule_count), compare: (a, b) => a.rule_count - b.rule_count },
    { id: "objects", label: t("Objects"), cell: (r) => (r.objects.length ? objectsText(r.objects) : <Dash why={t("No object's rules read this table")} />) },
    { id: "systems", label: t("Systems"), cell: (r) => (r.systems.length ? systemNames(r.systems, systems).join(", ") : <Dash why={t("No connected system uses this table yet")} />) },
    { id: "source", label: t("Defined by"), hidden: true, cell: (r) => sourceText(r.source) },
  ];
  return (
    <Panel title={t("Tables")} meta={total > rows.length ? t("The first {n} of {total}", { n: int(rows.length), total: int(total) }) : t("{n} tables", { n: int(total) })} testId="catalogue-tables">
      <DataTable
        caption={t("Tables")}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.table}
        rowLabel={(r) => r.table}
        onOpenRow={onOpen}
        empty={{ heading: q ? t("No table matches this search.") : t("No table is in the catalogue for this system yet. Discovery reads a system's dictionary when it connects.") }}
      />
    </Panel>
  );
}

function TableView({ table, system, onBack }: { table: string; system: string; onBack: () => void }) {
  const q = useCatalogueTable(table, system);
  const { openItem } = useOpenItem();
  const back = <Button variant="quiet" size={32} onClick={onBack}>{t("All tables")}</Button>;
  if (q.isPending) return <Skeleton lines={8} label={t("Fields")} />;
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
  return (
    <>
      {back}
      <TableHead d={d} />
      <Panel title={t("Fields")} meta={t("{n} fields", { n: int(d.fields.length) })} testId="catalogue-fields">
        <DataTable
          caption={t("Fields of {table}", { table: d.table })}
          rows={d.fields}
          columns={fieldColumns()}
          rowKey={(f) => f.field}
          rowLabel={(f) => f.field}
          onOpenRow={(f) => openItem({ kind: "field", id: fieldId(d.table, f.field) })}
          empty={{ heading: t("The dictionary lists no fields for this table.") }}
        />
      </Panel>
    </>
  );
}

function TableHead({ d }: { d: CatalogueTable }) {
  const owners = d.owners.filter((o) => o.kind === "object" && (o.owner_name || o.steward_name));
  return (
    <Panel title={t("Table {table}", { table: d.table })} meta={d.description} testId="catalogue-table">
      <dl className="nx-notes">
        <div className="nx-note"><dt>{t("Key")}</dt><dd>{d.keys.length ? d.keys.map((k) => <Code key={k} code={k} />) : <Dash why={t("The dictionary names no key")} />}</dd></div>
        <div className="nx-note"><dt>{t("Defined by")}</dt><dd>{sourceText(d.source)}</dd></div>
        <div className="nx-note"><dt>{t("Systems")}</dt><dd>{d.systems.length ? d.systems.map((s) => s.name).join(", ") : <Dash why={t("No connected system uses this table yet")} />}</dd></div>
        <div className="nx-note"><dt>{t("Objects")}</dt><dd>{d.objects.length ? d.objects.map(moduleText).join(", ") : <Dash why={t("No object's rules read this table")} />}</dd></div>
        <div className="nx-note">
          <dt>{t("Owners")}</dt>
          <dd>
            {owners.length
              ? owners.map((o) => t("{object}: {owner}", { object: moduleText(o.ref), owner: o.owner_name ?? o.steward_name ?? "" })).join("; ")
              : <Dash why={t("No owner is set for the objects that read this table")} />}
          </dd>
        </div>
        {d.obsolete_in ? (
          <div className="nx-note"><dt>{t("In S/4HANA")}</dt><dd>{d.note ? t("Replaced: {note}", { note: d.note }) : t("Replaced")}</dd></div>
        ) : null}
      </dl>
    </Panel>
  );
}

function fieldColumns(): Column<CatalogueField>[] {
  return [
    { id: "field", label: t("Field"), cell: (f) => <span data-testid={`cat-field-${f.field}`}><Code code={f.field} text={f.description || undefined} /></span> },
    { id: "description", label: t("Description"), cell: (f) => f.description || <Dash why={t("The dictionary gives no description")} /> },
    { id: "type", label: t("Type"), cell: (f) => (f.type ? <Code code={typeText(f)} /> : <Dash />) },
    { id: "key", label: t("Key"), cell: (f) => (f.key ? t("Yes") : "") },
    { id: "rules", label: t("Rules"), align: "end", cell: (f) => int(f.rules.length) },
    { id: "term", label: t("Business term"), cell: (f) => f.terms[0]?.business_name ?? "" },
    { id: "blank", label: t("Blank"), align: "end", cell: (f) => (f.profile ? pct1(f.profile.stats.blank_pct / 100) : <Dash why={t("No analysed run has profiled this field")} />) },
    { id: "check", label: t("Check table"), hidden: true, cell: (f) => (f.check_table ? <Code code={f.check_table} /> : "") },
  ];
}

function FieldHits({ q, system }: { q: string; system: string }) {
  const hits = useCatalogueFields(q, system);
  const { openItem } = useOpenItem();
  if (q.trim().length < 2) return <EmptyState heading={t("Type at least two characters to search the fields.")} />;
  if (hits.isPending) return <Skeleton lines={8} label={t("Fields")} />;
  if (hits.isError) {
    return catalogueStatus(hits.error) === 404
      ? <EmptyState heading={t("This system is not connected to this tenant.")} />
      : <ErrorState sentence={t("The fields could not be searched.")} onRetry={() => void hits.refetch()} />;
  }
  const columns: Column<CatalogueFieldHit>[] = [
    { id: "field", label: t("Field"), cell: (h) => <span data-testid={`cat-hit-${fieldId(h.table, h.field)}`}><Code code={fieldId(h.table, h.field)} text={h.description || undefined} /></span> },
    { id: "description", label: t("Description"), cell: (h) => h.description || <Dash why={t("The dictionary gives no description")} /> },
    { id: "table", label: t("Table"), cell: (h) => <Code code={h.table} text={h.table_description || undefined} /> },
    { id: "type", label: t("Type"), cell: (h) => (h.type ? <Code code={typeText({ type: h.type, length: h.length, decimals: 0 })} /> : <Dash />) },
    { id: "rules", label: t("Rules"), align: "end", cell: (h) => int(h.rule_count) },
    { id: "term", label: t("Business term"), cell: (h) => h.terms[0]?.business_name ?? "" },
  ];
  const { total, fields } = hits.data;
  return (
    <Panel title={t("Fields")} meta={total > fields.length ? t("The first {n} of {total}", { n: int(fields.length), total: int(total) }) : t("{n} fields", { n: int(total) })} testId="catalogue-field-hits">
      <DataTable
        caption={t("Fields that match")}
        rows={fields}
        columns={columns}
        rowKey={(h) => fieldId(h.table, h.field)}
        rowLabel={(h) => fieldId(h.table, h.field)}
        onOpenRow={(h) => openItem({ kind: "field", id: fieldId(h.table, h.field) })}
        empty={{ heading: t("No field matches this search.") }}
      />
      <p className="nx-sub">
        <V2Link href={`/catalogue?q=${encodeURIComponent(q)}`}>{t("Search the tables for these words")}</V2Link>
      </p>
    </Panel>
  );
}
