"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type SslMode, createDbConnection, deleteDbConnection, testDbConnection } from "@/lib/api/v2/external-db";
import { refreshDbConnections, useDbConnections, useDbTables } from "@/lib/v2/external-db-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, Field, Input, Select, useToast, EmptyState } from "@/ui/kit";
import { Row, Sec, errText, when } from "./shared";

const BLANK = { name: "", host: "", port: "5432", database: "", username: "", password: "", ssl_mode: "require" as SslMode };

export function ExternalDb() {
  const q = useDbConnections();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(BLANK);
  const [open, setOpen] = useState<string | null>(null);
  const tables = useDbTables(open);
  const rows = q.data?.connections ?? [];
  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); toast(done, "good"); await refreshDbConnections(qc); } catch (e) { toast(errText(e), "bad"); }
  };
  return (
    <Sec title={t("External databases")} scope="external-db" q={[q]} context={t("{n} connections", { n: rows.length })}
      facts={[t("{n} database connections are set up.", { n: rows.length })]}>
      <Card title={t("Connections")} sub={t("Up to {rows} rows per load, {s} seconds per query.", { rows: q.data?.max_rows ?? 0, s: q.data?.timeout_s ?? 0 })}>
        {rows.length === 0 ? <EmptyState heading={t("No database connections yet.")} body={t("Add a connection to read tables from an external database.")} /> : (
          <DataTable label={t("Database connections")} rows={rows} rowKey={(r) => r.id} height={260} selected={open} onSelect={(r) => setOpen(r.id)}
            columns={[
              { key: "name", label: t("Name"), render: (r) => <Code code={r.name} description={r.engine} /> },
              { key: "host", label: t("Host"), render: (r) => `${r.host}:${r.port} / ${r.database}` },
              { key: "tested", label: t("Last test"), render: (r) => r.last_tested_at ? `${when(r.last_tested_at)} (${r.last_test_ok ? t("passed") : t("failed")})` : t("Not tested") },
              { key: "act", label: t("Actions"), render: (r) => (
                <Row>
                  <Button variant="secondary" onClick={() => act(async () => { const x = await testDbConnection(r.id); if (!x.ok) throw new Error(x.error ?? t("The test failed.")); }, t("Connection works."))}>{t("Test")}</Button>
                  <Button variant="ghost" onClick={() => act(() => deleteDbConnection(r.id), t("Connection removed."))}>{t("Remove")}</Button>
                </Row>
              ) },
            ]} />
        )}
      </Card>
      {open && (
        <Card title={t("Tables")}>
          {tables.isLoading ? <p className="mx-muted">{t("Loading tables")}</p> : tables.isError ? <p className="mx-muted">{t("Tables could not be read.")}</p>
            : (tables.data?.tables ?? []).length === 0 ? <EmptyState heading={t("No tables found.")} body={t("Check the connection and its schema, then try again.")} /> : (
              <DataTable label={t("Tables")} rows={tables.data?.tables ?? []} rowKey={(r) => `${r.schema}.${r.name}`} height={260}
                columns={[
                  { key: "name", label: t("Table"), render: (r) => <Code code={`${r.schema}.${r.name}`} /> },
                  { key: "kind", label: t("Kind"), render: (r) => r.kind },
                ]} />
            )}
        </Card>
      )}
      <Card title={t("Add a connection")} sub={t("The password is sent once and is never shown again.")}>
        <Row>
          <Field label={t("Name")}><Input value={form.name} onChange={set("name")} /></Field>
          <Field label={t("Host")}><Input value={form.host} onChange={set("host")} /></Field>
          <Field label={t("Port")}><Input value={form.port} onChange={set("port")} inputMode="numeric" /></Field>
          <Field label={t("Database")}><Input value={form.database} onChange={set("database")} /></Field>
          <Field label={t("User")}><Input value={form.username} onChange={set("username")} /></Field>
          <Field label={t("Password")}><Input type="password" value={form.password} onChange={set("password")} autoComplete="new-password" /></Field>
          <Field label={t("Encryption")}>
            <Select value={form.ssl_mode} onChange={set("ssl_mode")} options={[{ value: "require", label: t("Required") }, { value: "verify-full", label: t("Verify certificate") }, { value: "verify-ca", label: t("Verify authority") }, { value: "disable", label: t("Off") }]} />
          </Field>
          <Button variant="primary" disabled={!form.name || !form.host || !form.database || !form.username || !form.password}
            onClick={() => act(async () => { await createDbConnection({ ...form, port: Number(form.port) || 5432 }); setForm(BLANK); }, t("Connection added."))}>{t("Add")}</Button>
        </Row>
      </Card>
    </Sec>
  );
}
