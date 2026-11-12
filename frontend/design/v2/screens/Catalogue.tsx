"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fieldId, type CatalogueFieldHit, type CatalogueSystem, type CatalogueTable, type CatalogueTableRow, type CatalogueField } from "@/lib/api/v2/catalogue";
import { catalogueStatus, sourceText, typeText, useCatalogueFields, useCatalogueTable, useCatalogueTables } from "@/lib/v2/catalogue";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int, pct1 } from "@/lib/v2/score";
import { Grid, type GridColumn } from "../Grid";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { CcPage } from "./cc-parts";
import { Guide } from "./Guide";
import { Panel } from "./Mining";

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
    <CcPage title={t("Data catalogue")}>
      <Guide
        shows={t("Every SAP table and field Meridian knows, from the SAP dictionary and each system's own, with the rules that check it, its business terms, its latest profile and where its values go.")}
        next={{ href: "/rules", label: t("Open the rules library") }}
        why={t("The catalogue only reads. Rules, terms and owners are changed where they live.")}
        means={[
          [t("Rules"), t("Shipped and tenant rules that read the field, on or off for this tenant.")],
          [t("Systems"), t("Connected systems with an object that reads the table, a run that profiled it or a dictionary that holds it.")],
          [t("Blank"), t("Share of records with no value in the newest analysed run that profiled the field.")],
        ]}
      />
      <form className="m2-rfilters" onSubmit={submit} aria-label={t("Search the catalogue")} data-testid="catalogue-search">
        <label>
          {t("Search")}
          <input className="m2-inp" type="search" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder={t("Table, field or business term")} />
        </label>
        <label>
          {t("Look in")}
          <select className="m2-sel" value={draft.view} onChange={(e) => setDraft({ ...draft, view: e.target.value === "fields" ? "fields" : "tables" })}>
            <option value="tables">{t("Tables")}</option>
            <option value="fields">{t("Fields")}</option>
          </select>
        </label>
        <label>
          {t("System")}
          <select className="m2-sel" value={draft.system} onChange={(e) => setDraft({ ...draft, system: e.target.value })}>
            <option value="">{t("Every system")}</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="m2-btn">{t("Search")}</button>
      </form>
      {table ? (
        <TableView table={table} system={system} onBack={() => go({ table: "", open: "" })} />
      ) : view === "fields" ? (
        <FieldHits q={q} system={system} />
      ) : tables.isPending ? (
        <Skeleton width="100%" height={320} />
      ) : tables.isError ? (
        catalogueStatus(tables.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the data catalogue.")}</EmptyFrame>
        ) : catalogueStatus(tables.error) === 404 ? (
          <EmptyFrame>{t("This system is not connected to this tenant.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void tables.refetch()}>{t("The data catalogue could not be read.")}</ErrorFrame>
        )
      ) : (
        <TableList rows={tables.data.tables} total={tables.data.total} systems={systems} q={q} onOpen={(r) => go({ table: r.table, open: "" })} />
      )}
    </CcPage>
  );
}

function TableList({ rows, total, systems, q, onOpen }: { rows: CatalogueTableRow[]; total: number; systems: CatalogueSystem[]; q: string; onOpen: (r: CatalogueTableRow) => void }) {
  const columns: GridColumn<CatalogueTableRow>[] = [
    { id: "table", header: t("Table"), width: 150, pin: true, locked: true, cell: (r) => <Mono>{r.table}</Mono> },
    { id: "description", header: t("Description"), width: 320, cell: (r) => r.description || <Dash why={t("The dictionary gives no description")} /> },
    { id: "fields", header: t("Fields"), width: 80, numeric: true, cell: (r) => int(r.field_count) },
    { id: "rules", header: t("Rules"), width: 80, numeric: true, cell: (r) => int(r.rule_count) },
    { id: "objects", header: t("Objects"), width: 220, cell: (r) => (r.objects.length ? objectsText(r.objects) : <Dash why={t("No object's rules read this table")} />) },
    { id: "systems", header: t("Systems"), width: 220, cell: (r) => (r.systems.length ? systemNames(r.systems, systems).join(", ") : <Dash why={t("No connected system uses this table yet")} />) },
    { id: "source", header: t("Defined by"), width: 220, defaultHidden: true, cell: (r) => sourceText(r.source) },
  ];
  return (
    <Panel title={t("Tables")} meta={total > rows.length ? t("The first {n} of {total}", { n: int(rows.length), total: int(total) }) : t("{n} tables", { n: int(total) })} testId="catalogue-tables">
      <Grid
        id="catalogue-tables"
        ariaLabel={t("Tables")}
        columns={columns}
        rows={rows}
        rowId={(r) => r.table}
        onOpen={onOpen}
        emptyFrame={<EmptyFrame>{q ? t("No table matches this search.") : t("No table is in the catalogue for this system yet. Discovery reads a system's dictionary when it connects.")}</EmptyFrame>}
      />
    </Panel>
  );
}

function TableView({ table, system, onBack }: { table: string; system: string; onBack: () => void }) {
  const q = useCatalogueTable(table, system);
  const { open, openItem } = useOpenItem();
  const back = (
    <button type="button" className="m2-btn m2-ghost" onClick={onBack}>
      {t("All tables")}
    </button>
  );
  if (q.isPending) return <Skeleton width="100%" height={320} />;
  if (q.isError) {
    return (
      <>
        {back}
        {catalogueStatus(q.error) === 404 ? (
          <EmptyFrame>{t("This table is not in the catalogue.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void q.refetch()}>{t("This table could not be read.")}</ErrorFrame>
        )}
      </>
    );
  }
  const d = q.data;
  return (
    <>
      <TableHead d={d} back={back} />
      <Panel title={t("Fields")} meta={t("{n} fields", { n: int(d.fields.length) })} testId="catalogue-fields">
        <Grid
          id="catalogue-fields"
          ariaLabel={t("Fields of {table}", { table: d.table })}
          columns={fieldColumns()}
          rows={d.fields}
          rowId={(f) => f.field}
          onOpen={(f) => openItem({ kind: "field", id: fieldId(d.table, f.field) })}
          openRowId={open?.kind === "field" && open.id.startsWith(`${d.table}.`) ? open.id.slice(d.table.length + 1) : null}
          emptyFrame={<EmptyFrame>{t("The dictionary lists no fields for this table.")}</EmptyFrame>}
        />
      </Panel>
    </>
  );
}

function TableHead({ d, back }: { d: CatalogueTable; back: ReactNode }) {
  const owners = d.owners.filter((o) => o.kind === "object" && (o.owner_name || o.steward_name));
  return (
    <section className="m2-ck-panel" aria-label={t("Table {table}", { table: d.table })} data-testid="catalogue-table">
      <header className="m2-ck-head">
        <h2 className="m2-h2">
          <Mono>{d.table}</Mono> {d.description}
        </h2>
        {back}
      </header>
      <dl className="m2-facts">
        <div className="m2-fact">
          <dt>{t("Key")}</dt>
          <dd>{d.keys.length ? <Mono>{d.keys.join(", ")}</Mono> : <Dash why={t("The dictionary names no key")} />}</dd>
        </div>
        <div className="m2-fact">
          <dt>{t("Defined by")}</dt>
          <dd>{sourceText(d.source)}</dd>
        </div>
        <div className="m2-fact">
          <dt>{t("Systems")}</dt>
          <dd>{d.systems.length ? d.systems.map((s) => s.name).join(", ") : <Dash why={t("No connected system uses this table yet")} />}</dd>
        </div>
        <div className="m2-fact">
          <dt>{t("Objects")}</dt>
          <dd>{d.objects.length ? d.objects.map(moduleText).join(", ") : <Dash why={t("No object's rules read this table")} />}</dd>
        </div>
        <div className="m2-fact">
          <dt>{t("Owners")}</dt>
          <dd>
            {owners.length ? (
              owners.map((o) => t("{object}: {owner}", { object: moduleText(o.ref), owner: o.owner_name ?? o.steward_name ?? "" })).join("; ")
            ) : (
              <Dash why={t("No owner is set for the objects that read this table")} />
            )}
          </dd>
        </div>
        {d.obsolete_in ? (
          <div className="m2-fact">
            <dt>{t("In S/4HANA")}</dt>
            <dd>{d.note ? t("Replaced: {note}", { note: d.note }) : t("Replaced")}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function fieldColumns(): GridColumn<CatalogueField>[] {
  return [
    { id: "field", header: t("Field"), width: 150, pin: true, locked: true, cell: (f) => <Mono>{f.field}</Mono> },
    { id: "description", header: t("Description"), width: 300, cell: (f) => f.description || <Dash why={t("The dictionary gives no description")} /> },
    { id: "type", header: t("Type"), width: 100, cell: (f) => (f.type ? <Mono>{typeText(f)}</Mono> : <Dash />) },
    { id: "key", header: t("Key"), width: 60, cell: (f) => (f.key ? t("Yes") : "") },
    { id: "rules", header: t("Rules"), width: 80, numeric: true, cell: (f) => int(f.rules.length) },
    { id: "term", header: t("Business term"), width: 200, cell: (f) => f.terms[0]?.business_name ?? "" },
    {
      id: "blank",
      header: t("Blank"),
      width: 90,
      numeric: true,
      cell: (f) => (f.profile ? pct1(f.profile.stats.blank_pct / 100) : <Dash why={t("No analysed run has profiled this field")} />),
    },
    { id: "check", header: t("Check table"), width: 120, defaultHidden: true, cell: (f) => (f.check_table ? <Mono>{f.check_table}</Mono> : "") },
  ];
}

function FieldHits({ q, system }: { q: string; system: string }) {
  const hits = useCatalogueFields(q, system);
  const { open, openItem } = useOpenItem();
  if (q.trim().length < 2) return <EmptyFrame>{t("Type at least two characters to search the fields.")}</EmptyFrame>;
  if (hits.isPending) return <Skeleton width="100%" height={320} />;
  if (hits.isError) {
    return catalogueStatus(hits.error) === 404 ? (
      <EmptyFrame>{t("This system is not connected to this tenant.")}</EmptyFrame>
    ) : (
      <ErrorFrame onRetry={() => void hits.refetch()}>{t("The fields could not be searched.")}</ErrorFrame>
    );
  }
  const columns: GridColumn<CatalogueFieldHit>[] = [
    { id: "field", header: t("Field"), width: 200, pin: true, locked: true, cell: (h) => <Mono>{fieldId(h.table, h.field)}</Mono> },
    { id: "description", header: t("Description"), width: 280, cell: (h) => h.description || <Dash why={t("The dictionary gives no description")} /> },
    { id: "table", header: t("Table"), width: 240, cell: (h) => h.table_description || <Mono>{h.table}</Mono> },
    { id: "type", header: t("Type"), width: 100, cell: (h) => (h.type ? <Mono>{typeText({ type: h.type, length: h.length, decimals: 0 })}</Mono> : <Dash />) },
    { id: "rules", header: t("Rules"), width: 80, numeric: true, cell: (h) => int(h.rule_count) },
    { id: "term", header: t("Business term"), width: 200, cell: (h) => h.terms[0]?.business_name ?? "" },
  ];
  const { total, fields } = hits.data;
  return (
    <Panel title={t("Fields")} meta={total > fields.length ? t("The first {n} of {total}", { n: int(fields.length), total: int(total) }) : t("{n} fields", { n: int(total) })} testId="catalogue-field-hits">
      <Grid
        id="catalogue-field-hits"
        ariaLabel={t("Fields that match")}
        columns={columns}
        rows={fields}
        rowId={(h) => fieldId(h.table, h.field)}
        onOpen={(h) => openItem({ kind: "field", id: fieldId(h.table, h.field) })}
        openRowId={open?.kind === "field" ? open.id : null}
        emptyFrame={<EmptyFrame>{t("No field matches this search.")}</EmptyFrame>}
      />
      <p className="m2-meta">
        <V2Link href={`/catalogue?q=${encodeURIComponent(q)}`}>{t("Search the tables for these words")}</V2Link>
      </p>
    </Panel>
  );
}
