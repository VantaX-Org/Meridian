"use client";

/** The API key inspector: create a key (secret shown once), edit name, expiry and roles, revoke, delete. */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiKey } from "@/lib/api/api-keys";
import type { Role } from "@/lib/api/roles";
import * as api from "@/lib/api/v2/admin";
import { formatDate } from "@/lib/format";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { refreshAdmin, useApiKeys, useRoles } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Button, Code, Confirm, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Note, OutcomeView, ScopeFields, Sec, copyText, keyRoles, since, useOutcome, type Scope } from "./people-shared";

/** The roles an API key acts with, one scope per row. */
function GrantList({ grants, onChange, roles }: { grants: Scope[]; onChange: (g: Scope[]) => void; roles: Role[] }) {
  return (
    <Sec title={t("Roles the key acts with")}>
      {grants.map((g, i) => (
        <div key={i} className="nx-pp-scope">
          <ScopeFields scope={g} onChange={(s) => onChange(grants.map((x, j) => (j === i ? s : x)))} roles={roles} />
          {grants.length > 1 ? (
            <Button variant="quiet" size={32} onClick={() => onChange(grants.filter((_, j) => j !== i))}>
              {t("Remove this role")}
            </Button>
          ) : null}
        </div>
      ))}
      <Button size={32} onClick={() => onChange([...grants, { role: "", system: "", module: "" }])}>
        {t("Add another role")}
      </Button>
    </Sec>
  );
}

const keyGrants = (gs: Scope[]) => gs.map((g) => ({ role_key: g.role, system_id: g.system || null, module: g.module || null }));

/** Changes a key's name, expiry and roles. Only the fields that changed are sent; the secret stays as it is. */
function EditKey({ k, onDone }: { k: ApiKey; onDone: () => void }) {
  const qc = useQueryClient();
  const roles = useRoles();
  const first: Scope[] = k.grants.map((g) => ({ role: g.role_key, system: g.system_id ?? "", module: g.module ?? "" }));
  const firstExpiry = k.expires_at ? k.expires_at.slice(0, 10) : "";
  const [name, setName] = useState(k.name);
  const [expires, setExpires] = useState(firstExpiry);
  const [grants, setGrants] = useState<Scope[]>(first.length ? first : [{ role: "viewer", system: "", module: "" }]);
  const { outcome, pending, run } = useOutcome();
  const grantsChanged = JSON.stringify(grants) !== JSON.stringify(first);
  const changed = name.trim() !== k.name || expires !== firstExpiry || grantsChanged;
  return (
    <section aria-label={t("Edit the key")}>
      <div className="nx-pp-form">
        <label className="nx-field">
          {t("Name")}
          <input className="nx-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="nx-field">
          {t("Expires (optional)")}
          <input className="nx-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
      </div>
      <GrantList grants={grants} onChange={setGrants} roles={roles.data ?? []} />
      {outcome ? <OutcomeView outcome={outcome} /> : null}
      <Actions>
        <Button
          variant="primary"
          disabled={!changed || !name.trim() || grants.some((g) => !g.role) || pending !== null}
          loading={pending === "edit"}
          loadingLabel={t("Saving…")}
          onClick={() =>
            void run("edit", async () => {
              await api.updateApiKey(k.id, {
                ...(name.trim() !== k.name ? { name: name.trim() } : {}),
                ...(expires !== firstExpiry ? { expires_at: expires ? `${expires}T23:59:59Z` : null } : {}),
                ...(grantsChanged ? { scopes: keyGrants(grants) } : {}),
              });
              await refreshAdmin(qc, "apikeys");
              onDone();
              return { tone: "ok", title: t("Key updated") };
            })
          }
        >
          {t("Save the changes")}
        </Button>
        <Button disabled={pending !== null} onClick={onDone}>
          {t("Cancel")}
        </Button>
      </Actions>
    </section>
  );
}

function NewKey({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const roles = useRoles();
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [grants, setGrants] = useState<Scope[]>([{ role: "viewer", system: "", module: "" }]);
  const { outcome, pending, run } = useOutcome();
  const [made, setMade] = useState<{ id: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <InspectorFrame title={t("Create an API key")} status={t("New key")} onClose={onClose}>
      <div className="nx-pp-form">
        <label className="nx-field">
          {t("Name")}
          <input className="nx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("BI export job")} />
        </label>
        <label className="nx-field">
          {t("Expires (optional)")}
          <input className="nx-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
      </div>
      {roles.isError ? <ErrorState error={roles.error} onRetry={() => void roles.refetch()} /> : null}
      <GrantList grants={grants} onChange={setGrants} roles={roles.data ?? []} />
      {outcome ? <OutcomeView outcome={outcome} /> : null}
      {made ? (
        <div role="status">
          <h3>{t("Your key. It is shown once.")}</h3>
          <p className="nx-pp-secret" data-testid="new-key">
            {made.key}
          </p>
          <div className="nx-ib-acts nx-pp-acts">
            <Button variant="primary" onClick={() => void copyText(made.key).then((ok) => setCopied(ok))}>
              {copied ? t("Copied") : t("Copy the key")}
            </Button>
            <Button onClick={() => openItem({ kind: "apikey", id: made.id })}>{t("Open the key")}</Button>
          </div>
        </div>
      ) : null}
      <Actions>
        <Button
          variant="primary"
          disabled={!name.trim() || grants.some((g) => !g.role) || pending !== null || made !== null}
          loading={pending === "create"}
          loadingLabel={t("Creating…")}
          onClick={() =>
            void run("create", async () => {
              const k = await api.createApiKey({ name: name.trim(), grants: keyGrants(grants), expires_at: expires ? `${expires}T23:59:59Z` : null });
              await refreshAdmin(qc, "apikeys");
              setMade({ id: k.id, key: k.key });
              return { tone: "ok", title: t("Key {name} created", { name: k.name }), detail: t("Copy it now: it cannot be shown again.") };
            })
          }
        >
          {t("Create the key")}
        </Button>
      </Actions>
    </InspectorFrame>
  );
}

function KeyBody({ k }: { k: ApiKey }) {
  const qc = useQueryClient();
  const { close } = useOpenItem();
  const { can } = useV2Session();
  const { outcome, pending, run } = useOutcome();
  const [ask, setAsk] = useState<"revoke" | "delete" | null>(null);
  const [editing, setEditing] = useState(false);
  const edit = can("manage_users");
  if (editing) return <EditKey k={k} onDone={() => setEditing(false)} />;
  return (
    <>
      <Facts>
        <Fact label={t("Key")}>
          <Code code={`${k.key_prefix}…`} />
        </Fact>
        <Fact label={t("Status")}>{labelText(k.status)}</Fact>
        <Fact label={t("Roles")}>{keyRoles(k)}</Fact>
        <Fact label={t("Created")}>{`${formatDate(k.created_at)}${k.created_by_name ? t(" by {created_by_name}", { created_by_name: k.created_by_name }) : ""}`}</Fact>
        <Fact label={t("Last used")}>{k.last_used_at ? `${formatDate(k.last_used_at, "datetime")}, ${since(k.last_used_at)}` : t("Never used")}</Fact>
        <Fact label={t("Expires")}>{k.expires_at ? formatDate(k.expires_at) : t("Never")}</Fact>
        {k.revoked_at ? <Fact label={t("Revoked")}>{formatDate(k.revoked_at, "datetime")}</Fact> : null}
      </Facts>
      {outcome ? <OutcomeView outcome={outcome} /> : null}
      <Actions>
        {k.status === "active" ? (
          <Button disabled={!edit || pending !== null} onClick={() => setEditing(true)}>
            {t("Edit the key")}
          </Button>
        ) : null}
        {k.status === "active" ? (
          <Button variant="danger" disabled={!edit || pending !== null} onClick={() => setAsk("revoke")}>
            {t("Revoke the key")}
          </Button>
        ) : null}
        <Button disabled={!edit || pending !== null} onClick={() => setAsk("delete")}>
          {t("Delete the key")}
        </Button>
      </Actions>
      <Note>{t("A revoked key stops working at once and cannot be restored. Its name stays in the audit log.")}</Note>
      <Confirm
        open={ask === "revoke"}
        title={t("Revoke {name}", { name: k.name })}
        consequence={t("Anything using this key stops working at once. This cannot be undone: create a new key instead.")}
        confirmLabel={t("Revoke the key")}
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() =>
          void run("revoke", async () => {
            await api.revokeApiKey(k.id);
            await refreshAdmin(qc, "apikeys");
            setAsk(null);
            return { tone: "ok", title: t("Key revoked") };
          })
        }
      />
      <Confirm
        open={ask === "delete"}
        title={t("Delete {name}", { name: k.name })}
        consequence={t("The key and its service account are removed. Its entries in the audit log stay.")}
        confirmLabel={t("Delete the key")}
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() =>
          void run("delete", async () => {
            await api.deleteApiKey(k.id);
            await refreshAdmin(qc, "apikeys");
            setAsk(null);
            close();
            return { tone: "ok", title: t("Key deleted") };
          })
        }
      />
    </>
  );
}

export function ApiKeyInspector({ id, onClose }: BodyProps) {
  const q = useApiKeys(id !== "new");
  if (id === "new") return <NewKey onClose={onClose} />;
  const k = q.data?.find((x) => x.id === id);
  return (
    <InspectorFrame title={k?.name ?? t("API key")} status={k ? t("{labelText} key", { labelText: labelText(k.status) }) : undefined} onClose={onClose}>
      {k ? (
        <KeyBody k={k} />
      ) : q.isLoading ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The key could not be read.")} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("This key does not exist. It may have been deleted.")} />
      )}
    </InspectorFrame>
  );
}
