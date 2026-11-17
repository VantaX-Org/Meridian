"use client";

import { useState } from "react";
import { Button, Card, Code, Confirm, DataTable, EmptyState, Field, Input, Select, SeverityPill, type Column } from "@/ui/kit";
import { Frame, day, useAct, useSectionChat } from "../common";
import { useApiKeys, useRoles } from "@/lib/v2/admin-queries";
import { createApiKey, deleteApiKey, revokeApiKey, type ApiKey } from "@/lib/api/v2/admin";
import { roleText } from "@/lib/v2/labels";
import { t, tx } from "@/lib/v2/i18n";

const SEV = { active: "info", expired: "medium", revoked: "critical", suspended: "high" } as const;

export function ApiKeys() {
  const q = useApiKeys();
  const roles = useRoles();
  const { run, busy } = useAct();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [expires, setExpires] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ key: ApiKey; kind: "revoke" | "delete" } | null>(null);
  const keys = q.data ?? [];
  const active = keys.filter((k) => k.status === "active").length;
  useSectionChat("apikeys", t("API keys"), [t("{n} keys are active.", { n: active }), ...keys.slice(0, 5).map((k) => `${k.name}: ${tx(k.status)}`)], [t("Which keys are active?"), t("Which key was used last?")]);

  const cols: Column<ApiKey>[] = [
    { key: "name", label: t("Name"), sort: (k) => k.name, render: (k) => k.name },
    { key: "prefix", label: t("Key"), render: (k) => <Code code={k.key_prefix} description={t("Key prefix")} /> },
    { key: "status", label: t("Status"), render: (k) => <SeverityPill sev={SEV[k.status]} label={tx(k.status)} /> },
    { key: "roles", label: t("Roles"), render: (k) => k.grants.map((g) => roleText(g.role_key)).join(", ") },
    { key: "used", label: t("Last used"), render: (k) => day(k.last_used_at) },
    { key: "exp", label: t("Expires"), render: (k) => day(k.expires_at) },
    { key: "act", label: "", render: (k) => (
      <span className="mx-links">
        {k.status === "active" && <Button variant="ghost" type="button" onClick={() => setAsk({ key: k, kind: "revoke" })}>{t("Revoke")}</Button>}
        <Button variant="ghost" type="button" onClick={() => setAsk({ key: k, kind: "delete" })}>{t("Delete")}</Button>
      </span>
    ) },
  ];

  const create = async () => {
    const r = await run(() => createApiKey({ name: name.trim(), grants: [{ role_key: role }], expires_at: expires ? new Date(expires).toISOString() : null }), t("API key created."), ["apikeys"]);
    if (r) { setShown(r.key); setName(""); setExpires(""); }
  };

  return (
    <Frame slug="apikeys" title={t("API keys")} lead={t("Keys for scripts and other systems, each with its own roles.")} loading={q.isLoading} error={q.isError}>
      {shown && (
        <Card title={t("Copy this key now")} sub={t("It is shown once and cannot be read again.")}>
          <p><code className="mx-code">{shown}</code></p>
          <Button variant="secondary" type="button" onClick={() => setShown(null)}>{t("I have copied it")}</Button>
        </Card>
      )}
      <Card title={t("New API key")}>
        <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Field label={t("Name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("Role")}>
            <Select value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: "", label: t("Choose a role") }, ...(roles.data ?? []).map((r) => ({ value: r.key, label: tx(r.name) }))]} />
          </Field>
          <Field label={t("Expires on")} hint={t("Leave empty for a key that does not expire.")}><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
          <div><Button variant="primary" type="submit" disabled={busy || !name.trim() || !role}>{t("Create key")}</Button></div>
        </form>
      </Card>
      <Card title={t("Keys")} sub={t("{n} keys", { n: keys.length })}>
        {keys.length === 0 ? <EmptyState heading={t("No API keys yet")} body={t("Create one above to let a script call the API.")} /> : <DataTable columns={cols} rows={keys} rowKey={(k) => k.id} label={t("API keys")} />}
      </Card>
      <Confirm
        open={!!ask}
        danger
        title={ask?.kind === "delete" ? t("Delete this key?") : t("Revoke this key?")}
        confirmLabel={ask?.kind === "delete" ? t("Delete") : t("Revoke")}
        cancelLabel={t("Cancel")}
        onCancel={() => setAsk(null)}
        onConfirm={() => { const a = ask; setAsk(null); if (a) void run(() => (a.kind === "delete" ? deleteApiKey(a.key.id) : revokeApiKey(a.key.id)), a.kind === "delete" ? t("API key deleted.") : t("API key revoked."), ["apikeys"]); }}
      >
        <p>{t("Anything using {name} stops working at once.", { name: ask?.key.name ?? "" })}</p>
      </Confirm>
    </Frame>
  );
}
