"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getDesignConfig, getDesignDiff, getDesignTable, type DesignChange, type DesignField, type DesignSnapshot, type DesignSummary } from "@/lib/api/v2/design";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { labelText } from "@/lib/v2/labels";
import { Card, DataTable, EmptyState, FieldChip, Select, Sheet, StatTile } from "@/ui/kit";
import { Gate, when } from "./shared";

const CHANGE: Record<DesignChange["change"], () => string> = {
  table_added: () => t("Table added"), table_removed: () => t("Table removed"),
  field_added: () => t("Field added"), field_removed: () => t("Field removed"), field_changed: () => t("Field changed"),
};

/** "customer_field", "not_in_standard" or "differs_from_standard (...)": the route's own words, shown plainly. */
const deviationText = (d: string | null): string => {
  if (!d) return t("Matches the standard");
  if (d === "customer_field") return t("Customer field");
  if (d === "not_in_standard") return t("Not in the standard");
  return d.startsWith("differs_from_standard") ? `${t("Differs from the standard")} ${d.slice("differs_from_standard".length).trim()}`.trim() : d;
};

/** One table as discovery read it: each field against the SAP standard, and the standard fields it lacks. */
export function TableSheet({ id, table, onClose }: { id: string; table: string | null; onClose: () => void }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["v2", "design-table", fx, id, table] as const, queryFn: () => getDesignTable(id, table ?? ""), enabled: !!table, retry: false });
  return (
    <Sheet open={!!table} onClose={onClose} label={t("Table design")} closeLabel={t("Close")}>
      <Gate q={q}>
        {(d) => (
          <div className="mx-col">
            <h2 className="mx-card-t"><FieldChip code={d.table} description={d.description ?? undefined} /></h2>
            <dl className="mx-tiles">
              <StatTile label={t("Category")} value={d.category ?? "-"} />
              <StatTile label={t("Delivery class")} value={d.delivery_class ?? "-"} />
              <StatTile label={t("In the SAP standard")} value={d.in_sap_standard ? t("Yes") : t("No")} />
              <StatTile label={t("Standard fields missing")} value={whole(d.standard_fields_missing.length)} note={d.standard_fields_missing.join(", ") || undefined} />
            </dl>
            {d.fields.length === 0 ? <EmptyState heading={t("No fields read")} body={t("Read the source design again to list this table's fields.")} /> : (
              <DataTable<DesignField> label={t("Table fields")} rows={d.fields} rowKey={(r) => r.name} height={320} columns={[
                { key: "name", label: t("Field"), render: (r) => <FieldChip code={r.name} description={r.description ?? (r.customer_field ? t("Customer field") : undefined)} /> },
                { key: "type", label: t("Type"), render: (r) => `${r.type ?? "-"} ${r.length ?? ""}`.trim() },
                { key: "std", label: t("Standard"), render: (r) => (r.standard ? `${r.standard.type ?? "-"} ${r.standard.length ?? ""}`.trim() : "-") },
                { key: "check", label: t("Check table"), render: (r) => (r.check_table ? <FieldChip code={r.check_table} /> : "-") },
                { key: "dev", label: t("Against the standard"), render: (r) => deviationText(r.deviation) },
              ]} />
            )}
          </div>
        )}
      </Gate>
    </Sheet>
  );
}

/** The stored check-table rows of one configuration table, columns taken from the rows as the system returned them. */
export function ConfigSheet({ id, table, onClose }: { id: string; table: string | null; onClose: () => void }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["v2", "design-config", fx, id, table] as const, queryFn: () => getDesignConfig(id, table ?? ""), enabled: !!table, retry: false });
  return (
    <Sheet open={!!table} onClose={onClose} label={t("Configuration table")} closeLabel={t("Close")}>
      <Gate q={q}>
        {(d) => {
          const keys = [...new Set(d.rows.flatMap((r) => Object.keys(r)))];
          return (
            <div className="mx-col">
              <h2 className="mx-card-t"><FieldChip code={d.table} description={d.scope ? labelText(d.scope) : undefined} /></h2>
              <p className="mx-muted">{t("{n} of {total} rows, read {when}", { n: whole(d.rows.length), total: whole(d.total ?? d.rows.length), when: when(d.synced_at) })}</p>
              {d.rows.length === 0 ? <EmptyState heading={t("No rows stored")} /> : (
                <DataTable<Record<string, unknown>> label={t("Configuration rows")} rows={d.rows} rowKey={(r) => JSON.stringify(r)} height={320}
                  columns={keys.map((k) => ({ key: k, label: k, render: (r) => String(r[k] ?? "") }))} />
              )}
            </div>
          );
        }}
      </Gate>
    </Sheet>
  );
}

/** Configuration tables read from the system; one opens its stored rows. */
export function ConfigList({ id, rows }: { id: string; rows: DesignSummary["configuration"] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title={t("Configuration tables read")} sub={t("Select a table to see the rows stored for it.")}>
      {rows.length === 0 ? <EmptyState heading={t("No configuration read yet")} /> : (
        <DataTable label={t("Configuration tables")} rows={rows} rowKey={(r) => r.table} height={200} onSelect={(r) => setOpen(r.table)} columns={[
          { key: "table", label: t("Table"), render: (r) => <FieldChip code={r.table} description={r.scope ? labelText(r.scope) : undefined} /> },
          { key: "rows", label: t("Rows"), align: "end", render: (r) => whole(r.rows ?? 0) },
          { key: "source", label: t("Source"), render: (r) => r.source ?? "-" },
          { key: "synced_at", label: t("Read"), render: (r) => when(r.synced_at) },
        ]} />
      )}
      <ConfigSheet id={id} table={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

/** What changed in the source design between two snapshots; the latest two are picked first. */
export function DiffCard({ id, snaps }: { id: string; snaps: DesignSnapshot[] }) {
  const fx = useFixture();
  const done = snaps.filter((s) => s.status === "completed");
  const [pick, setPick] = useState<{ from?: string; to?: string }>({});
  const to = pick.to ?? done[0]?.id ?? "";
  const from = pick.from ?? done[1]?.id ?? "";
  const q = useQuery({ queryKey: ["v2", "design-diff", fx, id, from, to] as const, queryFn: () => getDesignDiff(id, from, to), enabled: !!from && !!to && from !== to, retry: false });
  const opts = done.map((s) => ({ value: s.id, label: when(s.completed_at ?? s.started_at) }));
  return (
    <Card title={t("Changes between snapshots")} sub={t("Tables and fields added, removed or changed since the earlier read.")}
      action={done.length > 1 ? (
        <span className="mx-head-actions">
          <Select aria-label={t("Compare from")} value={from} onChange={(e) => setPick({ ...pick, from: e.target.value })} options={opts} />
          <Select aria-label={t("Compare to")} value={to} onChange={(e) => setPick({ ...pick, to: e.target.value })} options={opts} />
        </span>
      ) : undefined}>
      {done.length < 2 || from === to ? <EmptyState heading={t("Nothing to compare")} body={t("Two completed reads of the source design are needed.")} /> : (
        <Gate q={q}>
          {(d) => d.changes.length === 0 ? <EmptyState heading={t("No changes between these reads")} /> : (
            <DataTable<DesignChange> label={t("Design changes")} rows={d.changes} rowKey={(r) => `${r.table}/${r.field ?? ""}/${r.change}`} height={240} columns={[
              { key: "table", label: t("Table"), render: (r) => <FieldChip code={r.table} /> },
              { key: "field", label: t("Field"), render: (r) => (r.field ? <FieldChip code={r.field} /> : "-") },
              { key: "change", label: t("Change"), render: (r) => CHANGE[r.change]() },
              { key: "diff", label: t("Detail"), render: (r) => Object.entries(r.diff ?? {}).map(([k, [a, b]]) => `${k}: ${String(a)} ${t("to")} ${String(b)}`).join(", ") || "-" },
            ]} />
          )}
        </Gate>
      )}
    </Card>
  );
}
