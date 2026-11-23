"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { discoverDesign, getConfigDeviation, getDesign, getDesignCoverage, getDesignSnapshots, getDesignTables, type DesignTable } from "@/lib/api/v2/design";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { Button, Card, Chip, DataTable, FieldChip, Search, StatTile, useToast, type Column, EmptyState } from "@/ui/kit";
import { errMsg, Gate, when } from "./shared";

export function DesignTab({ id }: { id: string }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useV2Session();
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const summary = useQuery({ queryKey: ["v2", "design", fx, id] as const, queryFn: () => getDesign(id), retry: false });
  const tables = useQuery({ queryKey: ["v2", "design-tables", fx, id, search, custom] as const, queryFn: () => getDesignTables(id, search, custom), retry: false });
  const cover = useQuery({ queryKey: ["v2", "design-coverage", fx, id] as const, queryFn: () => getDesignCoverage(id), retry: false });
  const dev = useQuery({ queryKey: ["v2", "design-deviation", fx, id] as const, queryFn: () => getConfigDeviation(id), retry: false });
  const snaps = useQuery({ queryKey: ["v2", "design-snapshots", fx, id] as const, queryFn: () => getDesignSnapshots(id), retry: false });

  const discover = async () => {
    setBusy(true);
    try { await discoverDesign(id); toast(t("Source design read queued."), "good"); await qc.invalidateQueries({ queryKey: ["v2"] }); } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(false); }
  };
  const cols: Column<DesignTable>[] = [
    { key: "table", label: t("Table"), render: (r) => <FieldChip code={r.table} description={r.description ?? undefined} /> },
    { key: "category", label: t("Category"), render: (r) => r.category },
    { key: "delivery_class", label: t("Delivery class"), render: (r) => r.delivery_class },
    { key: "field_count", label: t("Fields"), align: "end", render: (r) => whole(r.field_count ?? 0) },
    { key: "customer_fields", label: t("Customer fields"), align: "end", render: (r) => whole(r.customer_fields) },
  ];
  return (
    <div className="mx-col">
      <Card title={t("Source design")} sub={t("What this system holds beyond the SAP standard.")} action={me.can("trigger_sync") ? <Button variant="secondary" onClick={() => void discover()} disabled={busy}>{t("Read source design")}</Button> : undefined}>
        <Gate q={summary} empty={{ heading: t("No source design yet"), body: t("Read the source design to list tables, customer fields and configuration.") }}>
          {(d) => (
            <dl className="mx-tiles">
              <StatTile label={t("Discovery")} value={d.discovery_status ?? t("Never")} note={when(d.discovered_at)} />
              <StatTile label={t("Release")} value={d.sap_release ?? "-"} note={d.sap_product ?? undefined} />
              <StatTile label={t("Configuration sync")} value={d.config_sync_status ?? t("Never")} note={when(d.config_synced_at)} />
              <StatTile label={t("Configuration tables")} value={whole(d.configuration?.length ?? 0)} />
            </dl>
          )}
        </Gate>
      </Card>
      <Card title={t("Tables")} action={<Chip selected={custom} onClick={() => setCustom(!custom)}>{t("Customer tables only")}</Chip>}>
        <Search value={search} onChange={setSearch} label={t("Search tables")} clearLabel={t("Clear search")} />
        <Gate q={tables} empty={{ heading: t("No tables read yet") }}>
          {(d) => d.items.length === 0 ? <EmptyState heading={t("No tables match.")} body={t("Clear the search to see every table.")} /> : <DataTable columns={cols} rows={d.items} rowKey={(r) => r.table} label={t("Source tables")} />}
        </Gate>
      </Card>
      <Card title={t("Configuration against the standard")}>
        <Gate q={dev} empty={{ heading: t("Nothing to compare yet") }}>
          {(d) => d.tables.length === 0 ? <p className="mx-muted">{t("Nothing to compare yet.")}</p> : (
            <DataTable columns={[
              { key: "reference", label: t("Reference table"), render: (r) => <FieldChip code={r.reference} /> },
              { key: "live_count", label: t("Live"), align: "end" as const, render: (r) => whole(r.live_count) },
              { key: "standard_count", label: t("Standard"), align: "end" as const, render: (r) => whole(r.standard_count) },
              { key: "custom", label: t("Custom"), align: "end" as const, render: (r) => whole(r.custom.length) },
              { key: "missing", label: t("Missing"), align: "end" as const, render: (r) => whole(r.missing.length) },
            ]} rows={d.tables} rowKey={(r) => r.reference} label={t("Configuration deviation")} height={240} />
          )}
        </Gate>
      </Card>
      <Card title={t("Coverage")}>
        <Gate q={cover} empty={{ heading: t("No coverage yet") }}>
          {(d) => {
            const rows = Object.entries(d.coverage).flatMap(([area, es]) => es.map((e, i) => ({ k: `${area}-${i}`, area, ...e })));
            return rows.length === 0 ? <EmptyState heading={t("No coverage yet.")} body={t("Run an extraction to see which tables are covered.")} /> : (
              <DataTable columns={[
                { key: "area", label: t("Area"), render: (r) => r.area },
                { key: "table", label: t("Table"), render: (r) => (r.table ? <FieldChip code={r.table} description={r.purpose} /> : "-") },
                { key: "status", label: t("Status"), render: (r) => r.status },
                { key: "rows", label: t("Rows"), align: "end" as const, render: (r) => whole(r.rows ?? 0) },
              ]} rows={rows} rowKey={(r) => r.k} label={t("Design coverage")} height={240} />
            );
          }}
        </Gate>
      </Card>
      <Card title={t("Snapshots")}>
        <Gate q={snaps} empty={{ heading: t("No snapshots yet") }}>
          {(d) => d.length === 0 ? <EmptyState heading={t("No snapshots yet.")} body={t("A snapshot appears here after the first extraction.")} /> : (
            <DataTable columns={[
              { key: "completed_at", label: t("Read"), render: (r) => when(r.completed_at ?? r.started_at) },
              { key: "status", label: t("Status"), render: (r) => r.status },
              { key: "tables", label: t("Tables"), align: "end" as const, render: (r) => whole(r.tables ?? 0) },
              { key: "customer_fields", label: t("Customer fields"), align: "end" as const, render: (r) => whole(r.customer_fields ?? 0) },
            ]} rows={d} rowKey={(r) => r.id} label={t("Design snapshots")} height={200} />
          )}
        </Gate>
      </Card>
    </div>
  );
}
