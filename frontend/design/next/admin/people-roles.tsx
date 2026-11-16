"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Matrix, Pair, Role } from "@/lib/api/roles";
import * as api from "@/lib/api/v2/admin";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { auditSentence } from "@/lib/v2/audit-sentence";
import { refreshAdmin, useAccessRequests, useAudit, useRolePermissions, useRoles, useRolesMatrix, useUsers } from "@/lib/v2/admin-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { roleText } from "@/lib/v2/labels";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, ErrorState, Sheet, Skeleton, useToast, type Column } from "../kit";
import { Denied } from "../more/states";
import { Block, Field, Loaded, Notes, Page, Since } from "./people-kit";

/** Matrix to the allowed pairs the API takes. */
export const matrixToPairs = (m: Matrix): Pair[] =>
  Object.entries(m).flatMap(([resource, acts]) => Object.entries(acts).filter(([, on]) => on).map(([action]) => ({ resource, action })));

/** Resource by action grid; checkboxes when editable, a cell that differs from base is marked. */
export function PermissionMatrix({ matrix, editable, base, onToggle }: { matrix: Matrix; editable: boolean; base?: Matrix; onToggle?: (r: string, a: string, on: boolean) => void }) {
  const resources = Object.keys(matrix);
  const actions = Object.keys(matrix[resources[0]] ?? {});
  return (
    <div className="nx-ppl-scroll">
      <table className="nx-ppl-table" aria-label={t("Permissions by resource and action")}>
        <thead>
          <tr>
            <th scope="col">{t("Resource")}</th>
            {actions.map((a) => <th key={a} scope="col"><Code code={a} /></th>)}
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r}>
              <th scope="row"><Code code={r} /></th>
              {actions.map((a) => {
                const on = !!matrix[r]?.[a];
                const changed = base ? on !== !!base[r]?.[a] : false;
                return (
                  <td key={a} data-changed={changed || undefined}>
                    {editable ? (
                      <input type="checkbox" aria-label={`${r} ${a}`} checked={on} onChange={(e) => onToggle?.(r, a, e.target.checked)} />
                    ) : on ? (
                      <span aria-label={t("{r} {a}: allowed", { r, a })}>{t("Yes")}</span>
                    ) : (
                      <span aria-label={t("{r} {a}: not allowed", { r, a })}>—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useRun() {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const run = async (which: string, job: () => Promise<{ text: string; onUndo?: () => void } | void>) => {
    if (pending) return;
    setPending(which);
    try {
      const r = await job();
      if (r) toast({ text: r.text, tone: "good", onUndo: r.onUndo });
    } catch (e) {
      toast({ text: apiErrorMessage(e), tone: "bad" });
    } finally {
      setPending(null);
    }
  };
  return { pending, run };
}

function Requests() {
  const qc = useQueryClient();
  const q = useAccessRequests();
  const roles = useRoles();
  const users = useUsers({});
  const { pending, run } = useRun();
  const [granting, setGranting] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [reason, setReason] = useState("");
  const nameOf = (id: string) => users.data?.users.find((u) => u.id === id)?.name ?? id;
  const decide = (id: string, body: Parameters<typeof api.decideAccessRequest>[1], text: string) =>
    void run(id, async () => {
      await api.decideAccessRequest(id, body);
      await refreshAdmin(qc, "users");
      setGranting(null);
      setDeclining(null);
      return { text };
    });
  return (
    <Block title={t("Access requests")} hint={t("People ask for access from the place they were refused. Granting adds a role to them; declining needs a reason they will read.")} testid="access-requests">
      <Loaded q={q} what={t("The requests")}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState heading={t("No open requests. A request appears here when someone asks for access they do not have.")} />
          ) : (
            <div className="nx-ppl-scroll">
              <table className="nx-ppl-table">
                <thead>
                  <tr>
                    <th scope="col">{t("Who")}</th>
                    <th scope="col">{t("Asks for")}</th>
                    <th scope="col">{t("Reason")}</th>
                    <th scope="col">{t("Asked")}</th>
                    <th scope="col"><span className="nx-sr-only">{t("Actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{nameOf(r.user_id)}</td>
                      <td>{t("{action} on {resource}", { action: r.action, resource: r.resource })}</td>
                      <td>{r.reason || "—"}</td>
                      <td><Since at={r.created_at} /></td>
                      <td className="nx-ppl-end">
                        <span className="nx-ppl-acts">
                          <Button size={32} disabled={pending !== null} onClick={() => (setRole(""), setGranting(r.id))}>{t("Grant")}</Button>
                          <Button size={32} variant="quiet" disabled={pending !== null} onClick={() => (setReason(""), setDeclining(r.id))}>{t("Decline")}</Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      <Sheet
        open={granting !== null}
        onClose={() => setGranting(null)}
        title={t("Grant access")}
        meta={t("Choose the role to add. It applies to the scope they asked about.")}
        size="small"
        secondary={<Button onClick={() => setGranting(null)}>{t("Cancel")}</Button>}
        primary={<Button variant="primary" loading={pending === granting} disabled={!role || pending !== null} onClick={() => granting && decide(granting, { decision: "granted", role_key: role }, t("Access granted"))}>{t("Grant access")}</Button>}
      >
        <Field label={t("Role")}>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t("Choose a role")}</option>
            {(roles.data ?? []).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </Field>
      </Sheet>
      <Sheet
        open={declining !== null}
        onClose={() => setDeclining(null)}
        title={t("Decline the request")}
        meta={t("They see this reason.")}
        size="small"
        secondary={<Button onClick={() => setDeclining(null)}>{t("Cancel")}</Button>}
        primary={<Button variant="danger" loading={pending === declining} disabled={!reason.trim() || pending !== null} onClick={() => declining && decide(declining, { decision: "declined", reason: reason.trim() }, t("Request declined"))}>{t("Decline")}</Button>}
      >
        <Field label={t("Reason")}>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Sheet>
    </Block>
  );
}

function History() {
  const q = useAudit({ limit: 8, entity_type: "roles" });
  return (
    <Block title={t("Recent changes to roles")} hint={t("Role, grant and request changes from the audit log.")}>
      <Loaded q={q} what={t("The history")}>
        {(d) =>
          d.entries.length === 0 ? (
            <EmptyState heading={t("No role changes yet.")} />
          ) : (
            <ul className="nx-ppl-list" aria-label={t("Role changes")}>
              {d.entries.map((e) => (
                <li key={e.id}>
                  <span className="nx-sub"><Since at={e.created_at} /></span>
                  <span>{auditSentence(e)}</span>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </Block>
  );
}

function NewRole({ open, from: initial, onClose, onOpen }: { open: boolean; from: string; onClose: () => void; onOpen: (key: string) => void }) {
  const qc = useQueryClient();
  const roles = useRoles();
  const { pending, run } = useRun();
  const [name, setName] = useState("");
  const [from, setFrom] = useState(initial);
  const [description, setDescription] = useState("");
  const [made, setMade] = useState<string | null>(null);
  const create = () =>
    void run("create", async () => {
      const r = await api.createRole({ name: name.trim(), cloned_from: from, description: description.trim() || undefined });
      await refreshAdmin(qc, "roles");
      setMade(r.key);
      return { text: `${t("Role {name} created", { name: r.name })}. ${t("It starts as a copy. Open it to change what it may do.")}` };
    });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("Create a role")}
      meta={t("New role")}
      size="medium"
      secondary={made ? <Button onClick={() => onOpen(made)}>{t("Open the role")}</Button> : undefined}
      primary={<Button variant="primary" loading={pending === "create"} loadingLabel={t("Creating…")} disabled={!name.trim() || !from || pending !== null || made !== null} onClick={create}>{t("Create the role")}</Button>}
    >
      <div className="nx-ppl-form">
        <Field label={t("Name")}>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("Start as a copy of")}>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {(roles.data ?? []).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </Field>
        <Field label={t("Description (optional)")} wide>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

function RoleBody({ role, onCopy, onClose }: { role: Role; onCopy: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useV2Session();
  const edit = can("manage_users") && !role.built_in;
  const perms = useRolePermissions(role.key);
  const { pending, run } = useRun();
  const [draft, setDraft] = useState<Matrix | null>(null);
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [asking, setAsking] = useState(false);
  const saved = perms.data?.matrix;
  const matrix = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const metaChanged = name.trim() !== role.name || description.trim() !== (role.description ?? "");
  const saveMeta = () =>
    void run("meta", async () => {
      const prev = { name: role.name, description: role.description ?? "" };
      await api.updateRole(role.key, { name: name.trim(), description: description.trim() });
      await refreshAdmin(qc, "roles");
      return { text: t("Role {name} saved", { name: name.trim() }), onUndo: () => void api.updateRole(role.key, prev).then(() => refreshAdmin(qc, "roles")) };
    });
  const savePerms = () =>
    void run("perms", async () => {
      if (!draft || !saved) return;
      const prev = saved;
      await api.putRolePermissions(role.key, matrixToPairs(draft));
      await refreshAdmin(qc, "roles");
      setDraft(null);
      return {
        text: `${t("Permissions of {name} saved", { name: role.name })}. ${t("They apply to everyone who holds the role, from their next request.")}`,
        onUndo: () => void api.putRolePermissions(role.key, matrixToPairs(prev)).then(() => refreshAdmin(qc, "roles")),
      };
    });
  const remove = () =>
    void run("delete", async () => {
      setAsking(false);
      await api.removeRole(role.key);
      await refreshAdmin(qc, "roles");
      onClose();
      return { text: t("Role deleted") };
    });
  return (
    <div className="nx-ppl">
      <Notes
        rows={[
          [t("Key"), <Code key="k" code={role.key} />],
          [t("Type"), role.built_in ? t("Built-in: fixed") : t("Custom")],
          [t("People"), String(role.users ?? 0)],
          [t("Last changed"), role.updated_at ? formatDate(role.updated_at, "datetime") : t("Never")],
          ...(role.cloned_from ? ([[t("Copied from"), roleText(role.cloned_from)]] as [string, string][]) : []),
        ]}
      />
      {edit ? (
        <section className="nx-ppl" aria-label={t("Name and description")}>
          <h3 className="nx-ppl-h3">{t("Name and description")}</h3>
          <div className="nx-ppl-form">
            <Field label={t("Name")}>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("Description")}>
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <div className="nx-ppl-acts">
            <Button loading={pending === "meta"} loadingLabel={t("Saving…")} disabled={!metaChanged || !name.trim() || pending !== null} onClick={saveMeta}>{t("Save the name")}</Button>
          </div>
        </section>
      ) : null}
      <h3 className="nx-ppl-h3">{edit ? t("What it may do") : t("What it may do (fixed)")}</h3>
      {perms.isError ? (
        <ErrorState sentence={t("The permissions could not be read.")} error={perms.error} onRetry={() => void perms.refetch()} />
      ) : !matrix ? (
        <Skeleton lines={6} label={t("What it may do")} />
      ) : (
        <PermissionMatrix matrix={matrix} editable={edit} base={saved} onToggle={(r, a, on) => setDraft({ ...matrix, [r]: { ...matrix[r], [a]: on } })} />
      )}
      <div className="nx-ppl-acts">
        {edit ? (
          <>
            <Button variant="primary" loading={pending === "perms"} loadingLabel={t("Saving…")} disabled={!dirty || pending !== null} onClick={savePerms}>{t("Save permissions")}</Button>
            <Button variant="quiet" disabled={!dirty} onClick={() => setDraft(null)}>{t("Reset")}</Button>
            <Button variant="danger" disabled={pending !== null} onClick={() => setAsking(true)}>{t("Delete the role")}</Button>
          </>
        ) : null}
        <Button onClick={onCopy}>{role.built_in ? t("Copy to change it") : t("Copy this role")}</Button>
      </div>
      <Confirm
        open={asking}
        title={t("Delete {name}", { name: role.name })}
        consequence={role.users ? t("{users} {users, plural, one {person has} other {people have}} this role; the API refuses until they are moved.", { users: role.users }) : t("The role is removed for good.")}
        confirmLabel={t("Delete the role")}
        danger
        onCancel={() => setAsking(false)}
        onConfirm={remove}
      />
    </div>
  );
}

function RoleSheet({ id, onClose, onCopy }: { id: string | null; onClose: () => void; onCopy: (key: string) => void }) {
  const q = useRoles();
  const role = q.data?.find((r) => r.key === id);
  return (
    <Sheet open={id !== null} onClose={onClose} title={role?.name ?? t("Role")} meta={role ? (role.built_in ? t("Built-in role") : t("Custom role")) : undefined} size="large">
      {q.isError ? (
        <ErrorState sentence={t("The role could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton lines={6} label={t("Role")} />
      ) : !role ? (
        <EmptyState heading={t("This role does not exist.")} />
      ) : (
        <RoleBody key={role.key} role={role} onCopy={() => onCopy(role.key)} onClose={onClose} />
      )}
    </Sheet>
  );
}

const roleColumns = (): Column<Role>[] => [
  { id: "name", label: t("Role"), cell: (r) => r.name, compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "key", label: t("Key"), cell: (r) => <Code code={r.key} /> },
  { id: "type", label: t("Type"), cell: (r) => (r.built_in ? t("Built-in") : t("Custom")) },
  { id: "users", label: t("People"), align: "end", cell: (r) => r.users ?? 0, compare: (a, b) => (a.users ?? 0) - (b.users ?? 0) },
  { id: "updated", label: t("Last changed"), cell: (r) => <Since at={r.updated_at} /> },
];

function MatrixBlock() {
  const q = useRolesMatrix();
  return (
    <Block title={t("What each role may do")} hint={t("The actions each role allows, by resource. Open a role to see or change its full matrix.")}>
      <Loaded q={q} what={t("The matrix")}>
        {(m) => (
          <>
            <div className="nx-ppl-scroll">
              <table className="nx-ppl-table" aria-label={t("Roles by resource")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Resource")}</th>
                    {m.roles.map((r) => <th key={r.key} scope="col">{r.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {m.resources.map((res) => (
                    <tr key={res}>
                      <th scope="row"><Code code={res} /></th>
                      {m.roles.map((r) => {
                        const acts = m.actions.filter((a) => r.matrix[res]?.[a]);
                        return <td key={r.key}>{acts.length === 0 ? "—" : acts.length === m.actions.length ? t("Everything") : acts.join(", ")}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="nx-sub"><Chip tone="neutral">{t("Read only here")}</Chip>{t(" Changes happen in the role's own inspector.")}</p>
          </>
        )}
      </Loaded>
    </Block>
  );
}

/** Roles: the list, the matrix, access requests and recent changes; a role opens in its own sheet. */
export function RolesSection() {
  const { can } = useV2Session();
  const allowed = can("manage_users");
  const q = useRoles(allowed);
  const [open, setOpen] = useState<string | null>(null);
  const [copy, setCopy] = useState<string | null>(null);
  if (!allowed) return <Denied what={t("Managing roles")} />;
  return (
    <Page
      lead={t("Built-in roles cannot be changed. Copy one to start a custom role, then set exactly what it may do. Give a role for one system or object only, from a person's grants.")}
      actions={<Button variant="primary" onClick={() => setCopy("viewer")}>{t("Create a role")}</Button>}
    >
      <DataTable
        rows={q.data ?? []}
        columns={roleColumns()}
        rowKey={(r) => r.key}
        rowLabel={(r) => r.name}
        caption={t("Roles")}
        loading={q.isPending}
        error={q.isError ? { sentence: t("The roles could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(q.error) }), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("No roles yet. Built-in roles appear once the tenant is set up.") }}
        onOpenRow={(r) => setOpen(r.key)}
      />
      <MatrixBlock />
      <Requests />
      <History />
      <RoleSheet id={open} onClose={() => setOpen(null)} onCopy={(k) => (setOpen(null), setCopy(k))} />
      {copy !== null ? <NewRole key={copy} open from={copy} onClose={() => setCopy(null)} onOpen={(k) => (setCopy(null), setOpen(k))} /> : null}
    </Page>
  );
}
