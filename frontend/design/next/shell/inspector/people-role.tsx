"use client";

/** The role inspector: create a role as a copy, rename it, edit what it may do, delete it. */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Matrix, Role } from "@/lib/api/roles";
import * as api from "@/lib/api/v2/admin";
import { formatDate } from "@/lib/format";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { refreshAdmin, useRolePermissions, useRoles } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { roleText } from "@/lib/v2/labels";
import { Button, Code, Confirm, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { OutcomeView, PermissionMatrix, Sec, matrixToPairs, useDone, useOutcome } from "./people-shared";

function NewRole({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const roles = useRoles();
  const [name, setName] = useState("");
  const [from, setFrom] = useState("viewer");
  const [description, setDescription] = useState("");
  const { outcome, pending, run } = useOutcome();
  const [made, setMade] = useState<string | null>(null);
  return (
    <InspectorFrame title={t("Create a role")} status={t("New role")} onClose={onClose}>
      <div className="nx-pp-form">
        <label className="nx-field">
          {t("Name")}
          <input className="nx-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="nx-field">
          {t("Start as a copy of")}
          <select className="nx-input" value={from} onChange={(e) => setFrom(e.target.value)}>
            {(roles.data ?? []).map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="nx-field">
          {t("Description (optional)")}
          <input className="nx-input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      {roles.isError ? <ErrorState error={roles.error} onRetry={() => void roles.refetch()} /> : null}
      {outcome ? <OutcomeView outcome={outcome} /> : null}
      <Actions>
        <Button
          variant="primary"
          disabled={!name.trim() || !from || pending !== null || made !== null}
          loading={pending === "create"}
          loadingLabel={t("Creating…")}
          onClick={() =>
            void run("create", async () => {
              const r = await api.createRole({ name: name.trim(), cloned_from: from, description: description.trim() || undefined });
              await refreshAdmin(qc, "roles");
              setMade(r.key);
              return { tone: "ok", title: t("Role {name} created", { name: r.name }), detail: t("It starts as a copy. Open it to change what it may do.") };
            })
          }
        >
          {t("Create the role")}
        </Button>
        {made ? <Button onClick={() => openItem({ kind: "role", id: made })}>{t("Open the role")}</Button> : null}
      </Actions>
    </InspectorFrame>
  );
}

function RoleBody({ role }: { role: Role }) {
  const qc = useQueryClient();
  const { openItem, close } = useOpenItem();
  const { can } = useV2Session();
  const done = useDone();
  const edit = can("manage_users") && !role.built_in;
  const perms = useRolePermissions(role.key);
  const [draft, setDraft] = useState<Matrix | null>(null);
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [ask, setAsk] = useState(false);
  const { outcome, pending, run } = useOutcome();
  const matrix = draft ?? perms.data?.matrix;
  const dirty = draft !== null && perms.data !== undefined && JSON.stringify(draft) !== JSON.stringify(perms.data.matrix);
  const saveMeta = name.trim() !== role.name || description.trim() !== (role.description ?? "");
  return (
    <>
      <Facts>
        <Fact label={t("Key")}>
          <Code code={role.key} />
        </Fact>
        <Fact label={t("Type")}>{role.built_in ? t("Built-in: fixed") : t("Custom")}</Fact>
        <Fact label={t("People")}>{role.users ?? 0}</Fact>
        <Fact label={t("Last changed")}>{role.updated_at ? formatDate(role.updated_at, "datetime") : t("Never")}</Fact>
        {role.cloned_from ? <Fact label={t("Copied from")}>{roleText(role.cloned_from)}</Fact> : null}
      </Facts>
      {edit ? (
        <Sec title={t("Name and description")}>
          <div className="nx-pp-form">
            <label className="nx-field">
              {t("Name")}
              <input className="nx-input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="nx-field">
              {t("Description")}
              <input className="nx-input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
          <div className="nx-ib-acts nx-pp-acts">
            <Button
              disabled={!saveMeta || !name.trim() || pending !== null}
              loading={pending === "meta"}
              onClick={() =>
                void run("meta", async () => {
                  const prev = { name: role.name, description: role.description ?? "" };
                  await api.updateRole(role.key, { name: name.trim(), description: description.trim() });
                  await refreshAdmin(qc, "roles");
                  done(t("Role {name} saved", { name: name.trim() }), async () => {
                    await api.updateRole(role.key, prev);
                    await refreshAdmin(qc, "roles");
                  });
                  return { tone: "ok", title: t("Role saved") };
                })
              }
            >
              {t("Save the name")}
            </Button>
          </div>
        </Sec>
      ) : null}
      <Sec title={edit ? t("What it may do") : t("What it may do (fixed)")}>
        {matrix ? (
          <PermissionMatrix matrix={matrix} editable={edit} base={perms.data?.matrix} onToggle={(r, a, on) => setDraft({ ...matrix, [r]: { ...matrix[r], [a]: on } })} />
        ) : perms.isError ? (
          <ErrorState sentence={t("The permissions could not be read.")} onRetry={() => void perms.refetch()} />
        ) : (
          <Skeleton lines={5} />
        )}
      </Sec>
      {outcome ? <OutcomeView outcome={outcome} /> : null}
      <Actions>
        {edit ? (
          <>
            <Button
              variant="primary"
              disabled={!dirty || pending !== null}
              loading={pending === "perm"}
              loadingLabel={t("Saving…")}
              onClick={() =>
                draft &&
                perms.data &&
                void run("perm", async () => {
                  const prev = perms.data.matrix;
                  await api.putRolePermissions(role.key, matrixToPairs(draft));
                  await refreshAdmin(qc, "roles");
                  setDraft(null);
                  done(t("Permissions of {name} saved", { name: role.name }), async () => {
                    await api.putRolePermissions(role.key, matrixToPairs(prev));
                    await refreshAdmin(qc, "roles");
                  });
                  return { tone: "ok", title: t("Permissions saved"), detail: t("They apply to everyone who holds the role, from their next request.") };
                })
              }
            >
              {t("Save permissions")}
            </Button>
            <Button disabled={!dirty} onClick={() => setDraft(null)}>
              {t("Reset")}
            </Button>
            <Button variant="danger" disabled={pending !== null} onClick={() => setAsk(true)}>
              {t("Delete the role")}
            </Button>
          </>
        ) : null}
        <Button onClick={() => openItem({ kind: "role", id: "new" })}>{role.built_in ? t("Copy to change it") : t("Copy this role")}</Button>
      </Actions>
      <Confirm
        open={ask}
        title={t("Delete {name}", { name: role.name })}
        consequence={role.users ? t("{users} {users, plural, one {person has} other {people have}} this role; the API refuses until they are moved.", { users: role.users }) : t("The role is removed for good.")}
        confirmLabel={t("Delete the role")}
        danger
        onCancel={() => setAsk(false)}
        onConfirm={() =>
          void run("delete", async () => {
            await api.removeRole(role.key);
            await refreshAdmin(qc, "roles");
            setAsk(false);
            close();
            return { tone: "ok", title: t("Role deleted") };
          })
        }
      />
    </>
  );
}

export function RoleInspector({ id, onClose }: BodyProps) {
  const roles = useRoles(id !== "new");
  if (id === "new") return <NewRole onClose={onClose} />;
  const role = roles.data?.find((r) => r.key === id);
  return (
    <InspectorFrame title={role?.name ?? t("Role")} status={role ? (role.built_in ? t("Built-in role") : t("Custom role")) : undefined} onClose={onClose}>
      {role ? (
        <RoleBody key={role.key} role={role} />
      ) : roles.isLoading ? (
        <Skeleton lines={4} />
      ) : roles.isError ? (
        <ErrorState sentence={t("The role could not be read.")} onRetry={() => void roles.refetch()} />
      ) : (
        <EmptyState heading={t("This role does not exist.")} />
      )}
    </InspectorFrame>
  );
}
