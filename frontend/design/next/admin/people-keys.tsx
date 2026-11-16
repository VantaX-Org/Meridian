"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiKey, ApiKeyStatus } from "@/lib/api/api-keys";
import type { Role } from "@/lib/api/roles";
import * as api from "@/lib/api/v2/admin";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { refreshAdmin, useApiKeys, useRoles } from "@/lib/v2/admin-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { labelText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, ErrorState, Sheet, Skeleton, useToast, type Column } from "../kit";
import { Denied } from "../more/states";
import { CopyButton, Field, Notes, Page, Since, TONE } from "./people-kit";

const STATUS: Record<ApiKeyStatus, keyof typeof TONE> = { active: "go", expired: "at-risk", revoked: "no-go", suspended: "neutral" };

/** The roles a key acts with, in one line. */
export const keyRoles = (k: ApiKey): string =>
  k.grants.length === 0
    ? t("No roles")
    : k.grants.map((g) => `${g.role_name}${g.system_name ? `, ${g.system_name}` : ""}${g.module ? `, ${g.module}` : ""}`).join("; ");

interface Scope { role: string; system: string; module: string }

/** Role, system and object pickers for one grant of a key. */
function ScopeFields({ scope, onChange, roles }: { scope: Scope; onChange: (s: Scope) => void; roles: Role[] }) {
  const systems = useSystemsExtended();
  const landscape = useLandscape(null);
  return (
    <div className="nx-ppl-form">
      <Field label={t("Role")}>
        <select value={scope.role} onChange={(e) => onChange({ ...scope, role: e.target.value })}>
          <option value="">{t("Choose a role")}</option>
          {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
      </Field>
      <Field label={t("System")}>
        <select value={scope.system} onChange={(e) => onChange({ ...scope, system: e.target.value })}>
          <option value="">{t("All systems")}</option>
          {(systems.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label={t("Object")}>
        <select value={scope.module} onChange={(e) => onChange({ ...scope, module: e.target.value })}>
          <option value="">{t("All objects")}</option>
          {(landscape.data?.objects ?? []).map((o) => <option key={o.module} value={o.module}>{o.label}</option>)}
        </select>
      </Field>
    </div>
  );
}

function GrantList({ grants, onChange, roles }: { grants: Scope[]; onChange: (g: Scope[]) => void; roles: Role[] }) {
  return (
    <>
      <h3 className="nx-ppl-h3">{t("Roles the key acts with")}</h3>
      {grants.map((g, i) => (
        <div key={i} className="nx-ppl">
          <ScopeFields scope={g} onChange={(s) => onChange(grants.map((x, j) => (j === i ? s : x)))} roles={roles} />
          {grants.length > 1 ? <Button size={32} variant="quiet" onClick={() => onChange(grants.filter((_, j) => j !== i))}>{t("Remove this role")}</Button> : null}
        </div>
      ))}
      <div className="nx-ppl-acts">
        <Button size={32} onClick={() => onChange([...grants, { role: "", system: "", module: "" }])}>{t("Add another role")}</Button>
      </div>
    </>
  );
}

const keyGrants = (gs: Scope[]) => gs.map((g) => ({ role_key: g.role, system_id: g.system || null, module: g.module || null }));

function useRun() {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const run = async (which: string, job: () => Promise<string>) => {
    if (pending) return;
    setPending(which);
    try {
      toast({ text: await job(), tone: "good" });
    } catch (e) {
      toast({ text: apiErrorMessage(e), tone: "bad" });
    } finally {
      setPending(null);
    }
  };
  return { pending, run };
}

function NewKey({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const roles = useRoles();
  const { pending, run } = useRun();
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [grants, setGrants] = useState<Scope[]>([{ role: "viewer", system: "", module: "" }]);
  // The secret lives only in this state; it is never logged and is gone when the sheet closes.
  const [made, setMade] = useState<{ id: string; key: string } | null>(null);
  const create = () =>
    void run("create", async () => {
      const k = await api.createApiKey({ name: name.trim(), grants: keyGrants(grants), expires_at: expires ? `${expires}T23:59:59Z` : null });
      await refreshAdmin(qc, "apikeys");
      setMade({ id: k.id, key: k.key });
      return `${t("Key {name} created", { name: k.name })} ${t("Copy it now: it cannot be shown again.")}`;
    });
  return (
    <Sheet
      open
      onClose={onClose}
      title={t("Create an API key")}
      meta={t("New key")}
      size="medium"
      primary={<Button variant="primary" loading={pending === "create"} loadingLabel={t("Creating…")} disabled={!name.trim() || grants.some((g) => !g.role) || pending !== null || made !== null} onClick={create}>{t("Create the key")}</Button>}
    >
      <div className="nx-ppl">
        <div className="nx-ppl-form">
          <Field label={t("Name")}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("BI export job")} />
          </Field>
          <Field label={t("Expires (optional)")}>
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
        <GrantList grants={grants} onChange={setGrants} roles={roles.data ?? []} />
        {made ? (
          <div role="status" className="nx-ppl">
            <h3 className="nx-ppl-h3">{t("Your key. It is shown once.")}</h3>
            <pre className="nx-ppl-secret" data-testid="new-key">{made.key}</pre>
            <div className="nx-ppl-acts">
              <CopyButton text={made.key} label={t("Copy the key")} />
              <Button size={32} onClick={() => onOpen(made.id)}>{t("Open the key")}</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Changes a key's name, expiry and roles. Only the fields that changed are sent; the secret stays as it is. */
function EditKey({ k, onDone }: { k: ApiKey; onDone: () => void }) {
  const qc = useQueryClient();
  const roles = useRoles();
  const first: Scope[] = k.grants.map((g) => ({ role: g.role_key, system: g.system_id ?? "", module: g.module ?? "" }));
  const firstExpiry = k.expires_at ? k.expires_at.slice(0, 10) : "";
  const [name, setName] = useState(k.name);
  const [expires, setExpires] = useState(firstExpiry);
  const [grants, setGrants] = useState<Scope[]>(first.length ? first : [{ role: "viewer", system: "", module: "" }]);
  const { pending, run } = useRun();
  const grantsChanged = JSON.stringify(grants) !== JSON.stringify(first);
  const changed = name.trim() !== k.name || expires !== firstExpiry || grantsChanged;
  const save = () =>
    void run("edit", async () => {
      await api.updateApiKey(k.id, {
        ...(name.trim() !== k.name ? { name: name.trim() } : {}),
        ...(expires !== firstExpiry ? { expires_at: expires ? `${expires}T23:59:59Z` : null } : {}),
        ...(grantsChanged ? { scopes: keyGrants(grants) } : {}),
      });
      await refreshAdmin(qc, "apikeys");
      onDone();
      return t("Key updated");
    });
  return (
    <section className="nx-ppl" aria-label={t("Edit the key")}>
      <div className="nx-ppl-form">
        <Field label={t("Name")}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("Expires (optional)")}>
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <GrantList grants={grants} onChange={setGrants} roles={roles.data ?? []} />
      <div className="nx-ppl-acts">
        <Button variant="primary" loading={pending === "edit"} loadingLabel={t("Saving…")} disabled={!changed || !name.trim() || grants.some((g) => !g.role) || pending !== null} onClick={save}>{t("Save the changes")}</Button>
        <Button disabled={pending !== null} onClick={onDone}>{t("Cancel")}</Button>
      </div>
    </section>
  );
}

function KeyBody({ k, onClose }: { k: ApiKey; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useV2Session();
  const { pending, run } = useRun();
  const [ask, setAsk] = useState<"revoke" | "delete" | null>(null);
  const [editing, setEditing] = useState(false);
  const edit = can("manage_users");
  if (editing) return <EditKey k={k} onDone={() => setEditing(false)} />;
  const revoke = () =>
    void run("revoke", async () => {
      setAsk(null);
      await api.revokeApiKey(k.id);
      await refreshAdmin(qc, "apikeys");
      return t("Key revoked");
    });
  const remove = () =>
    void run("delete", async () => {
      setAsk(null);
      await api.deleteApiKey(k.id);
      await refreshAdmin(qc, "apikeys");
      onClose();
      return t("Key deleted");
    });
  return (
    <div className="nx-ppl">
      <Notes
        rows={[
          [t("Key"), <Code key="k" code={`${k.key_prefix}…`} />],
          [t("Status"), labelText(k.status)],
          [t("Roles"), keyRoles(k)],
          [t("Created"), `${formatDate(k.created_at)}${k.created_by_name ? t(" by {created_by_name}", { created_by_name: k.created_by_name }) : ""}`],
          [t("Last used"), <Since key="u" at={k.last_used_at} never={t("Never used")} />],
          [t("Expires"), k.expires_at ? formatDate(k.expires_at) : t("Never")],
          ...(k.revoked_at ? ([[t("Revoked"), formatDate(k.revoked_at, "datetime")]] as [string, string][]) : []),
        ]}
      />
      <div className="nx-ppl-acts">
        {k.status === "active" ? <Button disabled={!edit || pending !== null} onClick={() => setEditing(true)}>{t("Edit the key")}</Button> : null}
        {k.status === "active" ? <Button variant="danger" loading={pending === "revoke"} disabled={!edit || pending !== null} onClick={() => setAsk("revoke")}>{t("Revoke the key")}</Button> : null}
        <Button loading={pending === "delete"} disabled={!edit || pending !== null} onClick={() => setAsk("delete")}>{t("Delete the key")}</Button>
      </div>
      <p className="nx-sub">{t("A revoked key stops working at once and cannot be restored. Its name stays in the audit log.")}</p>
      <Confirm open={ask === "revoke"} title={t("Revoke {name}", { name: k.name })} consequence={t("Anything using this key stops working at once. This cannot be undone: create a new key instead.")} confirmLabel={t("Revoke the key")} danger onCancel={() => setAsk(null)} onConfirm={revoke} />
      <Confirm open={ask === "delete"} title={t("Delete {name}", { name: k.name })} consequence={t("The key and its service account are removed. Its entries in the audit log stay.")} confirmLabel={t("Delete the key")} danger onCancel={() => setAsk(null)} onConfirm={remove} />
    </div>
  );
}

function KeySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useApiKeys();
  const k = q.data?.find((x) => x.id === id);
  return (
    <Sheet open={id !== null} onClose={onClose} title={k?.name ?? t("API key")} meta={k ? t("{labelText} key", { labelText: labelText(k.status) }) : undefined} size="medium">
      {k ? (
        <KeyBody key={k.id} k={k} onClose={onClose} />
      ) : q.isError ? (
        <ErrorState sentence={t("The key could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Skeleton lines={5} label={t("API key")} />
      ) : (
        <EmptyState heading={t("This key does not exist. It may have been deleted.")} />
      )}
    </Sheet>
  );
}

const keyColumns = (): Column<ApiKey>[] => [
  { id: "name", label: t("Name"), cell: (k) => k.name, compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "prefix", label: t("Key"), cell: (k) => <Code code={`${k.key_prefix}…`} /> },
  { id: "roles", label: t("Roles"), cell: (k) => keyRoles(k) },
  { id: "status", label: t("Status"), cell: (k) => <Chip tone={TONE[STATUS[k.status]]}>{labelText(k.status)}</Chip> },
  { id: "used", label: t("Last used"), cell: (k) => <Since at={k.last_used_at} never={t("Never used")} /> },
  { id: "expires", label: t("Expires"), cell: (k) => (k.expires_at ? formatDate(k.expires_at) : t("Never")) },
  { id: "by", label: t("Created by"), hidden: true, cell: (k) => k.created_by_name ?? "—" },
];

/** API keys for scripts, each with its own service account and roles; the secret is shown once, on creation. */
export function ApiKeysSection() {
  const { can } = useV2Session();
  const allowed = can("manage_users");
  const q = useApiKeys(allowed);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (!allowed) return <Denied what={t("Managing API keys")} />;
  const rows = q.data ?? [];
  const active = rows.filter((k) => k.status === "active").length;
  return (
    <Page
      lead={t("{active} active {active, plural, one {key} other {keys}}. A key acts as its own service account with only the roles you give it, and shows in the audit log under its name. The key itself is shown once, when you create it.", { active })}
      actions={<Button variant="primary" onClick={() => setCreating(true)}>{t("Create a key")}</Button>}
    >
      <DataTable
        rows={rows}
        columns={keyColumns()}
        rowKey={(k) => k.id}
        rowLabel={(k) => k.name}
        caption={t("API keys")}
        loading={q.isPending}
        error={q.isError ? { sentence: t("The keys could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(q.error) }), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("No API keys yet. Create one for a script or a BI tool, with only the roles it needs.") }}
        onOpenRow={(k) => setOpen(k.id)}
      />
      {creating ? <NewKey onClose={() => setCreating(false)} onOpen={(id) => (setCreating(false), setOpen(id))} /> : null}
      <KeySheet id={open} onClose={() => setOpen(null)} />
    </Page>
  );
}
