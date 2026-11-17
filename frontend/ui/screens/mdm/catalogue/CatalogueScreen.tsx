"use client";

import { useState } from "react";
import { getCatalogueTable, getCatalogueTables, searchCatalogueFields, type CatalogueField, type CatalogueFieldHit, type CatalogueTableRow } from "@/lib/api/v2/catalogue";
import { t } from "@/lib/v2/i18n";
import { Card, Code, DataTable, DetailPanel, Search, Split, StatTile } from "@/ui/kit";
import { Async, Empty, Head, num, Sev, useRead, useScreenScope } from "./shared";

const TABS = () => [{ id: "fields", label: t("Fields") }, { id: "rules", label: t("Rules") }, { id: "about", label: t("About") }];

function TableDetail({ table, system }: { table: string; system?: string }) {
  const [tab, setTab] = useState("fields");
  const q = useRead(["cat-table", table, system], () => getCatalogueTable(table, system));
  return (
    <Async q={q}>
      {(d) => {
        const rules = d.fields.flatMap((f) => f.rules.map((r) => ({ ...r, field: f.field })));
        return (
          <DetailPanel idBase="cat" label={t("Table detail")} tabsLabel={t("Table sections")} tabs={TABS()} value={tab} onChange={setTab}
            header={<><Code code={d.table} description={d.description} /><span className="mx-muted">{d.category ?? ""}</span></>}>
            {tab === "fields" && (
              <DataTable<CatalogueField> label={t("Fields of the table")} rows={d.fields} rowKey={(f) => f.field} height={380}
                columns={[
                  { key: "field", label: t("Field"), sort: (f) => f.field, render: (f) => <Code code={f.field} description={f.description} /> },
                  { key: "type", label: t("Type"), render: (f) => `${f.type ?? ""} ${f.length || ""}`.trim() },
                  { key: "key", label: t("Key"), render: (f) => (f.key ? t("Key") : "") },
                  { key: "rules", label: t("Rules"), align: "end", sort: (f) => f.rules.length, render: (f) => num(f.rules.length) },
                  { key: "terms", label: t("Glossary"), render: (f) => f.terms.map((x) => x.business_name).join(", ") },
                ]} />
            )}
            {tab === "rules" && (rules.length ? (
              <DataTable label={t("Rules on the table")} rows={rules} rowKey={(r) => `${r.check_id}-${r.field}`} height={380}
                columns={[
                  { key: "id", label: t("Rule"), render: (r) => <Code code={r.check_id} description={r.message} /> },
                  { key: "field", label: t("Field"), render: (r) => <Code code={r.field} /> },
                  { key: "sev", label: t("Severity"), render: (r) => <Sev s={r.severity} /> },
                ]} />
            ) : <Empty heading={t("No rules on this table")} />)}
            {tab === "about" && (
              <dl className="mx-tiles">
                <StatTile label={t("Fields")} value={num(d.fields.length)} />
                <StatTile label={t("Keys")} value={d.keys.join(", ") || t("n/a")} />
                <StatTile label={t("Objects")} value={d.objects.join(", ") || t("n/a")} />
                <StatTile label={t("Source")} value={d.source} note={d.note ?? undefined} />
              </dl>
            )}
          </DetailPanel>
        );
      }}
    </Async>
  );
}

function FieldHits({ term, onPick }: { term: string; onPick: (table: string) => void }) {
  const q = useRead(["cat-fields", term], () => searchCatalogueFields(term), term.length > 1);
  if (term.length < 2) return null;
  return (
    <Async q={q} lines={3}>
      {(d) => (d.fields.length ? (
        <Card title={t("Fields found")} sub={num(d.total)}>
          <DataTable<CatalogueFieldHit> label={t("Fields found")} rows={d.fields} rowKey={(f) => `${f.table}.${f.field}`} height={220} onSelect={(f) => onPick(f.table)}
            columns={[
              { key: "table", label: t("Table"), render: (f) => <Code code={f.table} description={f.table_description} /> },
              { key: "field", label: t("Field"), render: (f) => <Code code={f.field} description={f.description} /> },
              { key: "rules", label: t("Rules"), align: "end", render: (f) => num(f.rule_count) },
            ]} />
        </Card>
      ) : <Empty heading={t("No field matches")} />)}
    </Async>
  );
}

export function CatalogueScreen() {
  const [term, setTerm] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const q = useRead(["cat-tables", term], () => getCatalogueTables({ q: term || undefined }));
  useScreenScope("catalogue", t("Catalogue"), [
    { prompt: t("Which tables carry the most rules?"), answer: () => {
      const top = [...(q.data?.tables ?? [])].sort((a, b) => b.rule_count - a.rule_count).slice(0, 3);
      return { text: top.map((x) => `${x.table} (${x.rule_count})`).join(", ") || t("n/a"), evidence: top.map((x) => x.table) };
    } },
  ]);
  const first = q.data?.tables[0]?.table;
  const table = sel ?? first ?? null;
  return (
    <>
      <Head title={t("Catalogue")} context={q.data ? `${num(q.data.total)} ${t("tables")}` : undefined} />
      <Split leftLabel={t("Tables")} rightLabel={t("Table detail")}
        left={
          <>
            <Search value={term} onChange={setTerm} label={t("Search tables and fields")} clearLabel={t("Clear search")} placeholder={t("Table or field")} />
            <FieldHits term={term} onPick={setSel} />
            <Async q={q}>
              {(d) => (d.tables.length ? (
                <DataTable<CatalogueTableRow> label={t("Tables")} rows={d.tables} rowKey={(r) => r.table} selected={table} onSelect={(r) => setSel(r.table)} height={440}
                  columns={[
                    { key: "table", label: t("Table"), sort: (r) => r.table, render: (r) => <Code code={r.table} description={r.description} /> },
                    { key: "fields", label: t("Fields"), align: "end", sort: (r) => r.field_count, render: (r) => num(r.field_count) },
                    { key: "rules", label: t("Rules"), align: "end", sort: (r) => r.rule_count, render: (r) => num(r.rule_count) },
                  ]} />
              ) : <Empty heading={t("No tables match")} />)}
            </Async>
          </>
        }
        right={table ? <TableDetail table={table} /> : <Empty heading={t("Pick a table")} />} />
    </>
  );
}
