"use client";

import "../step9.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createDbConnection, deleteDbConnection, loadDb, previewDb, testDbConnection, type DbConnection, type DbPreview, type DbSource, type SslMode } from "@/lib/api/v2/external-db";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useFirewallSummary } from "@/lib/v2/admin-queries";
import { refreshDbConnections, useDbConnections, useDbTables } from "@/lib/v2/external-db-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { type GridColumn } from "../Grid";
import { ToolGrid } from "../GridTools";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { Coded, EmptyFrame, ErrorFrame, Mono } from "../parts";
import { AdminPage, Block, Confirm, Fld, Kv, NeedsPermission, Note, StatusWord, useCan } from "./kit";

const ENGINES = (): Record<string, string> => ({ postgres: t("PostgreSQL") });
const SSL = (): Record<SslMode, string> => ({
  disable: t("No encryption"),
  require: t("Encrypted, certificate not checked"),
  "verify-ca": t("Encrypted, certificate authority checked"),
  "verify-full": t("Encrypted, certificate and host name checked"),
});

const columns = (): GridColumn<DbConnection>[] => [
  { id: "name", header: t("Name"), width: 200, pin: true, locked: true, cell: (c) => c.name },
  { id: "engine", header: t("Database"), width: 140, cell: (c) => <Coded code={c.engine} text={ENGINES()[c.engine]} /> },
  { id: "where", header: t("Host and database"), width: 300, cell: (c) => <Mono>{`${c.host}:${c.port}/${c.database}`}</Mono> },
  { id: "ssl", header: t("Encryption"), width: 280, cell: (c) => <Coded code={c.ssl_mode} text={SSL()[c.ssl_mode]} /> },
  {
    id: "test",
    header: t("Last test"),
    width: 150,
    cell: (c) => (c.last_test_ok == null ? "—" : <StatusWord tone={c.last_test_ok ? "go" : "no-go"}>{c.last_test_ok ? t("Passed") : t("Failed")}</StatusWord>),
  },
  { id: "loaded", header: t("Last load"), width: 130, cell: (c) => formatDate(c.last_loaded_at, "date") },
];

function AddForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", host: "", port: "5432", database: "", username: "", password: "" });
  const [ssl, setSsl] = useState<SslMode>("require");
  const { outcome, pending, run } = useOutcome();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const port = Number(f.port);
  const ok = f.name.trim() && f.host.trim() && f.database.trim() && f.username.trim() && f.password && Number.isInteger(port) && port > 0 && port < 65536;
  return (
    <Block title={t("Add a connection")} hint={t("Use a database user that can only read. The password is stored encrypted and is never shown again.")}>
      <div className="m2-fgrid">
        <Fld label={t("Name")}><input type="text" value={f.name} onChange={set("name")} /></Fld>
        <Fld label={t("Host")}><input type="text" value={f.host} onChange={set("host")} autoComplete="off" /></Fld>
        <Fld label={t("Port")} error={f.port && !(Number.isInteger(port) && port > 0 && port < 65536) ? t("A port from 1 to 65535.") : null}>
          <input type="number" value={f.port} onChange={set("port")} />
        </Fld>
        <Fld label={t("Database")}><input type="text" value={f.database} onChange={set("database")} /></Fld>
        <Fld label={t("User")}><input type="text" value={f.username} onChange={set("username")} autoComplete="off" /></Fld>
        <Fld label={t("Password")}><input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" /></Fld>
        <Fld label={t("Encryption")}>
          <select value={ssl} onChange={(e) => setSsl(e.target.value as SslMode)}>
            {(Object.entries(SSL()) as [SslMode, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Fld>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-adm-acts">
        <button type="button" className="m2-btn" onClick={onDone}>{t("Cancel")}</button>
        <button
          type="button"
          className="m2-btn m2-strong"
          disabled={!ok || pending !== null}
          onClick={() =>
            void run("add", async () => {
              await createDbConnection({ name: f.name.trim(), host: f.host.trim(), port, database: f.database.trim(), username: f.username.trim(), password: f.password, ssl_mode: ssl });
              await refreshDbConnections(qc);
              onDone();
              return { tone: "ok", title: t("Connection added") };
            }).catch(() => undefined)
          }
        >
          {pending === "add" ? t("Saving…") : t("Add the connection")}
        </button>
      </div>
    </Block>
  );
}

/** One connection: test it, pick a table or write a SELECT, map the columns and load the rows. */
function Source({ c, max, onGone }: { c: DbConnection; max: number; onGone: () => void }) {
  const qc = useQueryClient();
  const tables = useDbTables(c.id);
  const modules = useFirewallSummary().data?.modules ?? ["material_master"];
  const systems = useSystemsExtended().data ?? [];
  const [mode, setMode] = useState<"table" | "query">("table");
  const [pick, setPick] = useState("");
  const [sql, setSql] = useState("");
  const [module, setModule] = useState(modules[0] ?? "material_master");
  const [systemId, setSystemId] = useState("");
  const [preview, setPreview] = useState<DbPreview | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const { outcome, pending, run } = useOutcome();
  const source = (): DbSource | null => {
    if (mode === "query") return sql.trim() ? { query: sql.trim() } : null;
    const [schema, name] = pick.split("\u0000");
    return schema && name ? { table: { schema, name } } : null;
  };
  const src = source();
  const mapping = Object.fromEntries(Object.entries(map).filter(([k, v]) => v.trim() && v.trim() !== k).map(([k, v]) => [k, v.trim()]));
  return (
    <>
      <Block title={c.name} hint={t("Read only. Rows are checked with the rules of the object you choose, as if the table were an uploaded file.")}>
        <Kv
          rows={[
            [t("Database"), <Coded key="e" code={c.engine} text={ENGINES()[c.engine]} />],
            [t("Host and database"), <Mono key="h">{`${c.host}:${c.port}/${c.database}`}</Mono>],
            [t("User"), <Mono key="u">{c.username}</Mono>],
            [t("Encryption"), <Coded key="s" code={c.ssl_mode} text={SSL()[c.ssl_mode]} />],
            [t("Limits"), t("At most {rows} rows, {s} seconds for a statement.", { rows: max.toLocaleString("en"), s: 60 })],
          ]}
        />
        <div className="m2-adm-acts">
          <button
            type="button"
            className="m2-btn"
            disabled={pending !== null}
            onClick={() =>
              void run("test", async () => {
                const r = await testDbConnection(c.id);
                await refreshDbConnections(qc);
                return r.ok ? { tone: "ok", title: t("Connection works") } : { tone: "fail", title: t("Connection failed"), detail: r.error ?? undefined };
              })
            }
          >
            {pending === "test" ? t("Testing…") : t("Test the connection")}
          </button>
          <button type="button" className="m2-btn m2-crit" onClick={() => setConfirm(true)}>{t("Delete the connection")}</button>
        </div>
      </Block>
      <Block title={t("What to read")}>
        <div className="m2-fgrid">
          <Fld label={t("Source")}>
            <select value={mode} onChange={(e) => { setMode(e.target.value as "table" | "query"); setPreview(null); }}>
              <option value="table">{t("A table or view")}</option>
              <option value="query">{t("One SELECT statement")}</option>
            </select>
          </Fld>
          {mode === "table" ? (
            <Fld label={t("Table")} error={tables.isError ? t("The tables could not be read. {detail}", { detail: apiErrorMessage(tables.error) }) : null}>
              <select value={pick} onChange={(e) => { setPick(e.target.value); setPreview(null); }}>
                <option value="">{t("Choose a table")}</option>
                {(tables.data?.tables ?? []).map((x) => (
                  <option key={`${x.schema}.${x.name}`} value={`${x.schema}\u0000${x.name}`}>{`${x.schema}.${x.name} (${x.kind === "view" ? t("view") : t("table")})`}</option>
                ))}
              </select>
            </Fld>
          ) : (
            <Fld label={t("SELECT statement")} hint={t("One statement, no semicolon in the middle. Comments are allowed.")} wide mono>
              <textarea rows={5} value={sql} onChange={(e) => { setSql(e.target.value); setPreview(null); }} spellCheck={false} />
            </Fld>
          )}
        </div>
        <div className="m2-adm-acts">
          <button
            type="button"
            className="m2-btn"
            disabled={!src || pending !== null}
            onClick={() =>
              src &&
              void run("preview", async () => {
                const p = await previewDb(c.id, src);
                setPreview(p);
                setMap({});
                return { tone: "info", title: t("{n} sample {n, plural, one {row} other {rows}} read", { n: p.rows.length }) };
              })
            }
          >
            {pending === "preview" ? t("Reading…") : t("Preview the rows")}
          </button>
        </div>
        {outcome ? <ResultFrame outcome={outcome} /> : null}
      </Block>
      {preview ? (
        <Block title={t("Map the columns")} hint={t("Name the standard field each column becomes. Leave a box empty to keep the column name.")}>
          <div className="m2-frame" tabIndex={0}>
            <table className="m2-tbl" aria-label={t("Columns of the source")}>
              <thead>
                <tr>
                  <th scope="col">{t("Column in the database")}</th>
                  <th scope="col">{t("First value")}</th>
                  <th scope="col">{t("Becomes field")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.columns.map((col, i) => (
                  <tr key={col}>
                    <th scope="row"><Mono>{col}</Mono></th>
                    <td>{String(preview.rows[0]?.[i] ?? "—")}</td>
                    <td>
                      <input type="text" aria-label={t("Field for {column}", { column: col })} value={map[col] ?? ""} placeholder={col} onChange={(e) => setMap({ ...map, [col]: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="m2-fgrid">
            <Fld label={t("Check against")}>
              <select value={module} onChange={(e) => setModule(e.target.value)}>
                {modules.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Fld>
            <Fld label={t("Attach to system")} hint={t("Optional. The run is shown under this system.")}>
              <select value={systemId} onChange={(e) => setSystemId(e.target.value)}>
                <option value="">{t("No system")}</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Fld>
          </div>
          <div className="m2-adm-acts">
            <button
              type="button"
              className="m2-btn m2-strong"
              disabled={!src || pending !== null}
              onClick={() =>
                src &&
                void run("load", async () => {
                  const r = await loadDb(c.id, { ...src, module, column_mapping: mapping, system_id: systemId || null });
                  await refreshDbConnections(qc);
                  return {
                    tone: "ok",
                    title: t("{n} {n, plural, one {row} other {rows}} loaded and queued for checks", { n: r.rows }),
                    detail: r.truncated ? t("The source has more rows than the limit; only the first ones were read.") : undefined,
                    job: r.job_id,
                  };
                })
              }
            >
              {pending === "load" ? t("Loading…") : t("Load and check")}
            </button>
          </div>
        </Block>
      ) : null}
      {confirm ? (
        <Confirm
          title={t("Delete this connection?")}
          body={t("The stored password is removed. Runs already loaded stay.")}
          confirm={t("Delete")}
          danger
          pending={pending === "delete"}
          onCancel={() => setConfirm(false)}
          onConfirm={() =>
            void run("delete", async () => {
              await deleteDbConnection(c.id);
              await refreshDbConnections(qc);
              setConfirm(false);
              onGone();
              return { tone: "ok", title: t("Connection deleted") };
            }).catch(() => setConfirm(false))
          }
        />
      ) : null}
    </>
  );
}

/** Admin > Database sources: read-only connections to non-SAP databases, loaded like a file upload. */
export function ExternalDbSection() {
  const allowed = useCan()("manage_systems");
  const q = useDbConnections(allowed);
  const { open } = useOpenItem();
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!allowed) {
    return (
      <AdminPage title={t("Database sources")}>
        <NeedsPermission what={t("Managing database sources")} permission="manage_systems" />
      </AdminPage>
    );
  }
  const rows = q.data?.connections ?? [];
  const chosen = rows.find((r) => r.id === sel) ?? null;
  return (
    <AdminPage
      title={t("Database sources")}
      lead={t("Score data that lives outside SAP. Meridian reads one table or one SELECT, read only, then checks the rows with the same rules as a file upload. PostgreSQL is supported. SQL Server, Snowflake, Databricks and BigQuery are not.")}
      actions={
        <button type="button" className="m2-btn m2-next" onClick={() => setAdding(true)}>
          {t("Add a connection")}
        </button>
      }
    >
      <Note>{t("Give the connection a database user that can only read. A read-only session does not stop a function that writes on the server.")}</Note>
      {adding ? <AddForm onDone={() => setAdding(false)} /> : null}
      <Block>
        <ToolGrid<DbConnection>
          toolsTitle={t("Database sources")}
          id="admin-external-db"
          ariaLabel={t("Database sources")}
          columns={columns()}
          rows={rows}
          rowId={(c) => c.id}
          loading={q.isPending}
          error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The connections could not be read. {detail}", { detail: apiErrorMessage(q.error) })}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>{t("No connection yet. Add one with the host, database and a read-only user.")}</EmptyFrame>}
          onOpen={(c) => setSel(c.id)}
          openRowId={open ? null : sel}
        />
      </Block>
      {chosen ? <Source key={chosen.id} c={chosen} max={q.data?.max_rows ?? 0} onGone={() => setSel(null)} /> : null}
      {q.data && !chosen && rows.length ? <p className="m2-prov">{t("Open a connection to read from it.")}</p> : null}
    </AdminPage>
  );
}
