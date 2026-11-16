"use client";
/* Admin notify: Database sources. Native port of design/v2/admin/externaldb.tsx. The password is sent only to createDbConnection, as v2 does. */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createDbConnection, deleteDbConnection, loadDb, previewDb, testDbConnection, type DbConnection, type DbPreview, type DbSource, type SslMode } from "@/lib/api/v2/external-db";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useFirewallSummary } from "@/lib/v2/admin-queries";
import { refreshDbConnections, useDbConnections, useDbTables } from "@/lib/v2/external-db-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, Code, Confirm, DataTable, type Column } from "../kit";
import { Denied } from "../more/states";
import { Bad, Kv, NotifyBlock, NotifyPage } from "./notify-kit";

const ENGINES = (): Record<string, string> => ({ postgres: t("PostgreSQL") });
const SSL = (): Record<SslMode, string> => ({
  disable: t("No encryption"),
  require: t("Encrypted, certificate not checked"),
  "verify-ca": t("Encrypted, certificate authority checked"),
  "verify-full": t("Encrypted, certificate and host name checked"),
});

type Outcome = { bad: boolean; title: string; detail?: string; job?: string | null } | null;
function useRun() {
  const [pending, setPending] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const run = async (k: string, fn: () => Promise<Outcome>): Promise<boolean> => {
    setPending(k);
    setOutcome(null);
    try {
      setOutcome(await fn());
      return true;
    } catch (e) {
      setOutcome({ bad: true, title: apiErrorMessage(e) });
      return false;
    } finally {
      setPending(null);
    }
  };
  return { pending, outcome, run };
}
function OutcomeNote({ o }: { o: Outcome }) {
  const { hrefFor } = useOpenItem();
  if (!o) return null;
  const text = o.detail ? `${o.title}. ${o.detail}` : o.title;
  if (o.bad) return <Bad>{text}</Bad>;
  return (
    <p className="nx-note" role="status">
      {text}
      {o.job ? <> <V2Link href={hrefFor({ kind: "job", id: o.job })}>{t("Open the job")}</V2Link></> : null}
    </p>
  );
}
function Field({ label, hint, error, wide, children }: { label: string; hint?: string; error?: string | null; wide?: boolean; children: ReactNode }) {
  return (
    <label className={wide ? "nx-field nx-notify-wide" : "nx-field"}>
      <span>{label}</span>
      {children}
      {error ? <span className="nx-notify-bad" role="alert">{error}</span> : hint ? <span className="nx-sub">{hint}</span> : null}
    </label>
  );
}

const COLUMNS = (): Column<DbConnection>[] => [
  { id: "name", label: t("Name"), cell: (c) => c.name, compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "engine", label: t("Database"), cell: (c) => <Code code={c.engine} text={ENGINES()[c.engine]} /> },
  { id: "where", label: t("Host and database"), cell: (c) => <span className="nx-mono">{`${c.host}:${c.port}/${c.database}`}</span> },
  { id: "ssl", label: t("Encryption"), cell: (c) => <Code code={c.ssl_mode} text={SSL()[c.ssl_mode]} /> },
  { id: "test", label: t("Last test"), cell: (c) => (c.last_test_ok == null ? "—" : <Chip tone={c.last_test_ok ? "good" : "bad"}>{c.last_test_ok ? t("Passed") : t("Failed")}</Chip>) },
  { id: "loaded", label: t("Last load"), cell: (c) => formatDate(c.last_loaded_at, "date") },
];

const validPort = (p: number) => Number.isInteger(p) && p > 0 && p < 65536;

function AddForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", host: "", port: "5432", database: "", username: "", password: "" });
  const [ssl, setSsl] = useState<SslMode>("require");
  const { outcome, pending, run } = useRun();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const port = Number(f.port);
  const ok = f.name.trim() && f.host.trim() && f.database.trim() && f.username.trim() && f.password && validPort(port);
  return (
    <NotifyBlock title={t("Add a connection")} hint={t("Use a database user that can only read. The password is stored encrypted and is never shown again.")}>
      <div className="nx-notify-form">
        <Field label={t("Name")}><input className="nx-input" type="text" value={f.name} onChange={set("name")} /></Field>
        <Field label={t("Host")}><input className="nx-input" type="text" value={f.host} onChange={set("host")} autoComplete="off" /></Field>
        <Field label={t("Port")} error={f.port && !validPort(port) ? t("A port from 1 to 65535.") : null}>
          <input className="nx-input" type="number" value={f.port} onChange={set("port")} />
        </Field>
        <Field label={t("Database")}><input className="nx-input" type="text" value={f.database} onChange={set("database")} /></Field>
        <Field label={t("User")}><input className="nx-input" type="text" value={f.username} onChange={set("username")} autoComplete="off" /></Field>
        <Field label={t("Password")}><input className="nx-input" type="password" value={f.password} onChange={set("password")} autoComplete="new-password" /></Field>
        <Field label={t("Encryption")}>
          <select className="nx-input" value={ssl} onChange={(e) => setSsl(e.target.value as SslMode)}>
            {(Object.entries(SSL()) as [SslMode, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
      </div>
      <OutcomeNote o={outcome} />
      <div className="nx-notify-actions">
        <Button variant="quiet" onClick={onDone}>{t("Cancel")}</Button>
        <Button
          variant="primary"
          disabled={!ok || pending !== null}
          loading={pending === "add"}
          loadingLabel={t("Saving…")}
          onClick={() =>
            void run("add", async () => {
              await createDbConnection({ name: f.name.trim(), host: f.host.trim(), port, database: f.database.trim(), username: f.username.trim(), password: f.password, ssl_mode: ssl });
              await refreshDbConnections(qc);
              onDone();
              return { bad: false, title: t("Connection added") };
            })
          }
        >
          {t("Add the connection")}
        </Button>
      </div>
    </NotifyBlock>
  );
}

type PreviewRow = { col: string; i: number };

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
  const { outcome, pending, run } = useRun();
  const source = (): DbSource | null => {
    if (mode === "query") return sql.trim() ? { query: sql.trim() } : null;
    const [schema, name] = pick.split("\u0000");
    return schema && name ? { table: { schema, name } } : null;
  };
  const src = source();
  const mapping = Object.fromEntries(Object.entries(map).filter(([k, v]) => v.trim() && v.trim() !== k).map(([k, v]) => [k, v.trim()]));
  const previewColumns = (p: DbPreview): Column<PreviewRow>[] => [
    { id: "col", label: t("Column in the database"), cell: (r) => <span className="nx-mono">{r.col}</span> },
    { id: "first", label: t("First value"), cell: (r) => String(p.rows[0]?.[r.i] ?? "—") },
    {
      id: "to",
      label: t("Becomes field"),
      cell: (r) => <input className="nx-input" type="text" aria-label={t("Field for {column}", { column: r.col })} value={map[r.col] ?? ""} placeholder={r.col} onChange={(e) => setMap({ ...map, [r.col]: e.target.value })} />,
    },
  ];
  return (
    <>
      <NotifyBlock title={c.name} hint={t("Read only. Rows are checked with the rules of the object you choose, as if the table were an uploaded file.")}>
        <Kv
          rows={[
            [t("Database"), <Code key="e" code={c.engine} text={ENGINES()[c.engine]} />],
            [t("Host and database"), <span key="h" className="nx-mono">{`${c.host}:${c.port}/${c.database}`}</span>],
            [t("User"), <span key="u" className="nx-mono">{c.username}</span>],
            [t("Encryption"), <Code key="s" code={c.ssl_mode} text={SSL()[c.ssl_mode]} />],
            [t("Limits"), t("At most {rows} rows, {s} seconds for a statement.", { rows: max.toLocaleString("en"), s: 60 })],
          ]}
        />
        <div className="nx-notify-actions">
          <Button
            variant="secondary"
            disabled={pending !== null}
            loading={pending === "test"}
            loadingLabel={t("Testing…")}
            onClick={() =>
              void run("test", async () => {
                const r = await testDbConnection(c.id);
                await refreshDbConnections(qc);
                return r.ok ? { bad: false, title: t("Connection works") } : { bad: true, title: t("Connection failed"), detail: r.error ?? undefined };
              })
            }
          >
            {t("Test the connection")}
          </Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>{t("Delete the connection")}</Button>
        </div>
      </NotifyBlock>
      <NotifyBlock title={t("What to read")}>
        <div className="nx-notify-form">
          <Field label={t("Source")}>
            <select className="nx-input" value={mode} onChange={(e) => { setMode(e.target.value as "table" | "query"); setPreview(null); }}>
              <option value="table">{t("A table or view")}</option>
              <option value="query">{t("One SELECT statement")}</option>
            </select>
          </Field>
          {mode === "table" ? (
            <Field label={t("Table")} error={tables.isError ? t("The tables could not be read. {detail}", { detail: apiErrorMessage(tables.error) }) : null}>
              <select className="nx-input" value={pick} onChange={(e) => { setPick(e.target.value); setPreview(null); }}>
                <option value="">{t("Choose a table")}</option>
                {(tables.data?.tables ?? []).map((x) => (
                  <option key={`${x.schema}.${x.name}`} value={`${x.schema}\u0000${x.name}`}>{`${x.schema}.${x.name} (${x.kind === "view" ? t("view") : t("table")})`}</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label={t("SELECT statement")} hint={t("One statement, no semicolon in the middle. Comments are allowed.")} wide>
              <textarea className="nx-input nx-mono" rows={5} value={sql} onChange={(e) => { setSql(e.target.value); setPreview(null); }} spellCheck={false} />
            </Field>
          )}
        </div>
        <div className="nx-notify-actions">
          <Button
            variant="secondary"
            disabled={!src || pending !== null}
            loading={pending === "preview"}
            loadingLabel={t("Reading…")}
            onClick={() =>
              src &&
              void run("preview", async () => {
                const p = await previewDb(c.id, src);
                setPreview(p);
                setMap({});
                return { bad: false, title: t("{n} sample {n, plural, one {row} other {rows}} read", { n: p.rows.length }) };
              })
            }
          >
            {t("Preview the rows")}
          </Button>
        </div>
        <OutcomeNote o={outcome} />
      </NotifyBlock>
      {preview ? (
        <NotifyBlock title={t("Map the columns")} hint={t("Name the standard field each column becomes. Leave a box empty to keep the column name.")}>
          <DataTable caption={t("Columns of the source")} rows={preview.columns.map((col, i) => ({ col, i }))} rowKey={(r) => r.col} rowLabel={(r) => r.col} columns={previewColumns(preview)} />
          <div className="nx-notify-form">
            <Field label={t("Check against")}>
              <select className="nx-input" value={module} onChange={(e) => setModule(e.target.value)}>
                {modules.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label={t("Attach to system")} hint={t("Optional. The run is shown under this system.")}>
              <select className="nx-input" value={systemId} onChange={(e) => setSystemId(e.target.value)}>
                <option value="">{t("No system")}</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="nx-notify-actions">
            <Button
              variant="primary"
              disabled={!src || pending !== null}
              loading={pending === "load"}
              loadingLabel={t("Loading…")}
              onClick={() =>
                src &&
                void run("load", async () => {
                  const r = await loadDb(c.id, { ...src, module, column_mapping: mapping, system_id: systemId || null });
                  await refreshDbConnections(qc);
                  return {
                    bad: false,
                    title: t("{n} {n, plural, one {row} other {rows}} loaded and queued for checks", { n: r.rows }),
                    detail: r.truncated ? t("The source has more rows than the limit; only the first ones were read.") : undefined,
                    job: r.job_id,
                  };
                })
              }
            >
              {t("Load and check")}
            </Button>
          </div>
        </NotifyBlock>
      ) : null}
      <Confirm
        open={confirm}
        title={t("Delete this connection?")}
        consequence={t("The stored password is removed. Runs already loaded stay.")}
        confirmLabel={t("Delete")}
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          void run("delete", async () => {
            await deleteDbConnection(c.id);
            await refreshDbConnections(qc);
            onGone();
            return { bad: false, title: t("Connection deleted") };
          }).then(() => setConfirm(false))
        }
      />
    </>
  );
}

/** Admin, Database sources: read-only connections to non-SAP databases, loaded like a file upload. */
export function ExternalDbSection() {
  const allowed = useV2Session().can("manage_systems");
  const q = useDbConnections(allowed);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!allowed) return <Denied what={t("Managing database sources")} />;
  const rows = q.data?.connections ?? [];
  const chosen = rows.find((r) => r.id === sel) ?? null;
  return (
    <NotifyPage
      lead={t("Score data that lives outside SAP. Meridian reads one table or one SELECT, read only, then checks the rows with the same rules as a file upload. PostgreSQL is supported. SQL Server, Snowflake, Databricks and BigQuery are not.")}
      actions={<Button variant="primary" onClick={() => setAdding(true)}>{t("Add a connection")}</Button>}
    >
      <p className="nx-note" role="note">{t("Give the connection a database user that can only read. A read-only session does not stop a function that writes on the server.")}</p>
      {adding ? <AddForm onDone={() => setAdding(false)} /> : null}
      <DataTable
        caption={t("Database sources")}
        rows={rows}
        rowKey={(c) => c.id}
        rowLabel={(c) => c.name}
        columns={COLUMNS()}
        loading={q.isPending}
        error={q.isError ? { sentence: t("The connections could not be read. {detail}", { detail: apiErrorMessage(q.error) }), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("No connection yet. Add one with the host, database and a read-only user.") }}
        onOpenRow={(c) => setSel(c.id)}
      />
      {chosen ? <Source key={chosen.id} c={chosen} max={q.data?.max_rows ?? 0} onGone={() => setSel(null)} /> : null}
      {q.data && !chosen && rows.length ? <p className="nx-sub">{t("Open a connection to read from it.")}</p> : null}
    </NotifyPage>
  );
}
