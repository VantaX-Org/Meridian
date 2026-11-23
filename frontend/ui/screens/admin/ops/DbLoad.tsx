"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type DbLoaded, type DbPreview, type DbSource, loadDb, previewDb } from "@/lib/api/v2/external-db";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { getTriggerModules } from "@/lib/api/v2/syncTrigger";
import { refreshDbConnections, useDbTables } from "@/lib/v2/external-db-queries";
import { t } from "@/lib/v2/i18n";
import { useCan } from "@/ui/screens/orphans/useCan";
import { Button, Card, Confirm, DataTable, EmptyState, ErrorState, Field, Select, Skeleton, StatTile, Stepper, Textarea } from "@/ui/kit";
import { Row } from "./shared";

/**
 * Read a table or one SELECT from an external database, check the first rows, map columns to object fields, then load.
 * The load goes through the file-upload path: it creates a new version and starts the checks. Nothing is written to SAP.
 */
export function DbLoad({ connId, connName, maxRows }: { connId: string; connName: string; maxRows: number }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const can = useCan()("manage_systems");
  const tables = useDbTables(connId);
  const mods = useQuery({ queryKey: ["ui", "dbload", fx, "modules"], queryFn: getTriggerModules, staleTime: 60_000 });
  const [mode, setMode] = useState<"table" | "query">("table");
  const [tbl, setTbl] = useState("");
  const [query, setQuery] = useState("");
  const [mdl, setMdl] = useState("");
  const [map, setMap] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState(false);
  const [done, setDone] = useState<DbLoaded | null>(null);

  const src = (): DbSource | null => {
    if (mode === "query") return query.trim() ? { query: query.trim() } : null;
    const [schema, name] = tbl.split("\u0000");
    return schema && name ? { table: { schema, name } } : null;
  };
  const preview = useMutation<DbPreview, Error>({ mutationFn: () => previewDb(connId, src() as DbSource), onMutate: () => { setMap({}); setDone(null); } });
  const load = useMutation<DbLoaded, Error>({
    mutationFn: () => {
      const m = Object.fromEntries(Object.entries(map).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
      return loadDb(connId, { ...(src() as DbSource), module: mdl, column_mapping: m });
    },
    onSuccess: (r) => { setDone(r); setAsk(false); void refreshDbConnections(qc); },
  });

  const moduleList = mods.data ?? [];
  const moduleId = mdl || "";
  const pv = preview.data;
  const step = done ? 3 : pv ? 1 : 0;
  const blocked = !can ? t("Loading from a database needs the manage systems permission.") : null;
  const mapped = Object.values(map).filter((v) => v.trim()).length;
  const label = moduleList.find((m) => m.module_id === moduleId)?.label ?? moduleId;

  if (mods.isLoading || tables.isLoading) return <Card title={t("Load from this database")}><Skeleton lines={3} label={t("Loading")} /></Card>;
  if (mods.isError) return <Card title={t("Load from this database")}><ErrorState heading={t("Objects could not be read.")} retryLabel={t("Try again")} onRetry={() => void mods.refetch()} /></Card>;

  return (
    <Card title={t("Load from this database")} sub={t("Up to {rows} rows are read. The load makes a new version and starts the checks. Nothing is written to SAP.", { rows: maxRows })}>
      <Stepper label={t("Load steps")} current={step} steps={[{ id: "source", label: t("Choose the source") }, { id: "map", label: t("Check and map") }, { id: "confirm", label: t("Confirm") }, { id: "done", label: t("Loaded") }]} />
      {blocked && <p className="mx-muted">{blocked}</p>}
      <Row>
        <Field label={t("Source")}>
          <Select value={mode} onChange={(e) => setMode(e.target.value as "table" | "query")} options={[{ value: "table", label: t("A table") }, { value: "query", label: t("One SELECT query") }]} />
        </Field>
        {mode === "table" ? (
          <Field label={t("Table")}>
            {tables.isError ? <p className="mx-muted">{t("Tables could not be read.")}</p> : (
              <Select value={tbl} onChange={(e) => setTbl(e.target.value)}
                options={[{ value: "", label: t("Choose a table") }, ...(tables.data?.tables ?? []).map((x) => ({ value: `${x.schema}\u0000${x.name}`, label: `${x.schema}.${x.name}` }))]} />
            )}
          </Field>
        ) : (
          <Field label={t("Query")}><Textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={3} placeholder={t("SELECT * FROM table_name")} /></Field>
        )}
        <Button variant="secondary" disabled={!src() || !can || preview.isPending} onClick={() => preview.mutate()}>{preview.isPending ? t("Reading") : t("Preview the first rows")}</Button>
      </Row>
      {preview.isError && <ErrorState heading={t("The preview failed.")} body={errorSentence(preview.error, t("The database refused the request."))} retryLabel={t("Try again")} onRetry={() => preview.mutate()} />}
      {pv && pv.rows.length === 0 && <EmptyState heading={t("The source returned no rows.")} body={t("Choose another table or change the query.")} />}
      {pv && pv.rows.length > 0 && (
        <>
          <DataTable label={t("First rows of the source")} height={220} rowKey={(r) => String(r.i)}
            rows={pv.rows.map((cells, i) => ({ i, cells }))}
            columns={pv.columns.map((c, n) => ({ key: c, label: c, render: (r: { cells: unknown[] }) => String(r.cells[n] ?? "") }))} />
          <Field label={t("Object to load into")}>
            <Select value={moduleId} onChange={(e) => setMdl(e.target.value)} options={[{ value: "", label: t("Choose an object") }, ...moduleList.map((m) => ({ value: m.module_id, label: m.label }))]} />
          </Field>
          <DataTable label={t("Column mapping")} height={260} rowKey={(c) => c} rows={pv.columns}
            columns={[
              { key: "c", label: t("Source column"), render: (c) => c },
              { key: "m", label: t("Field name in the object"), render: (c) => (
                <input className="mx-input" aria-label={t("Field for {c}", { c })} value={map[c] ?? ""} placeholder={t("Keep the name")} onChange={(e) => setMap((p) => ({ ...p, [c]: e.target.value }))} />
              ) },
            ]} />
          <Row>
            <Button variant="primary" disabled={!moduleId || !can || load.isPending} onClick={() => setAsk(true)}>{t("Review the load")}</Button>
            {!moduleId && <span className="mx-muted">{t("Choose an object first.")}</span>}
          </Row>
        </>
      )}
      {done && (
        <dl className="mx-tiles">
          <StatTile label={t("Rows loaded")} value={String(done.rows)} />
          <StatTile label={t("Version")} value={done.version_id} />
          <StatTile label={t("Checks")} value={done.status} />
          <StatTile label={t("Row cap reached")} value={done.truncated ? t("Yes") : t("No")} />
        </dl>
      )}
      <Confirm open={ask} title={t("Load this data?")} confirmLabel={t("Load")} cancelLabel={t("Cancel")}
        onCancel={() => setAsk(false)} onConfirm={() => load.mutate()}>
        <p>{mode === "table" ? t("Read {src} from {conn}", { src: tbl.replace("\u0000", "."), conn: connName }) : t("Run your SELECT query on {conn}", { conn: connName })}</p>
        <p>{t("Up to {rows} rows go into a new version of {obj}, with {n, plural, one {# column renamed} other {# columns renamed}}. The checks start at once.", { rows: maxRows, obj: label, n: mapped })}</p>
        {load.isError && <p role="alert">{errorSentence(load.error, t("The load failed."))}</p>}
      </Confirm>
    </Card>
  );
}
