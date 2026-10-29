"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import type { User } from "@/types/api";
import type { ApiKey } from "@/lib/api/api-keys";
import type { Matrix, Role } from "@/lib/api/roles";
import * as api from "@/lib/api/v2/admin";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { roleLabel } from "@/lib/roles";
import { STATUS_LABEL, isPast, userStatus } from "@/lib/users";
import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin, useApiKeys, useEffective, useGrantPreview, useRolePermissions, useRoles, useUsers } from "@/lib/v2/admin-queries";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { Confirm, copyText, since, useCan, useDone } from "../admin/kit";
import { PermissionMatrix, matrixToPairs } from "../admin/roles";
import { UserStatusWord, roleNames } from "../admin/users";
import { keyRoles } from "../admin/apikeys";
import { ResultFrame, useOutcome } from "./shared";

/* ── A scope picker shared by grants and API keys ── */

interface Scope { role: string; system: string; module: string }
function ScopeFields({ scope, onChange, roles, expires, onExpires }: { scope: Scope; onChange: (s: Scope) => void; roles: Role[]; expires?: string; onExpires?: (v: string) => void }) {
  const systems = useSystemsExtended();
  const landscape = useLandscape(null);
  return (
    <div className="m2-aform">
      <label>
        Role
        <select value={scope.role} onChange={(e) => onChange({ ...scope, role: e.target.value })}>
          <option value="">Choose a role</option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        System
        <select value={scope.system} onChange={(e) => onChange({ ...scope, system: e.target.value })}>
          <option value="">All systems</option>
          {(systems.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Object
        <select value={scope.module} onChange={(e) => onChange({ ...scope, module: e.target.value })}>
          <option value="">All objects</option>
          {(landscape.data?.objects ?? []).map((o) => (
            <option key={o.module} value={o.module}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {onExpires ? (
        <label>
          Expires (optional)
          <input type="date" value={expires ?? ""} onChange={(e) => onExpires(e.target.value)} />
        </label>
      ) : null}
    </div>
  );
}

const grantBody = (s: Scope, expires?: string) => ({ role_key: s.role, system_id: s.system || null, module: s.module || null, ...(expires ? { expires_at: `${expires}T23:59:59Z` } : {}) });

/* ── User ── */

function InviteUser({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const roles = useRoles();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>({ role: "viewer", system: "", module: "" });
  const { outcome, pending, run } = useOutcome();
  const [created, setCreated] = useState<string | null>(null);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  return (
    <InspectorFrame title="Invite a user" status="New user" onClose={onClose}>
      <div className="m2-aform">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <h3>First role</h3>
      <ScopeFields scope={scope} onChange={setScope} roles={roles.data ?? []} />
      <p className="m2-prov">The invitation lasts seven days. More roles can be added from the person&apos;s own inspector once they exist.</p>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button
          type="button"
          className="m2-btn m2-next"
          disabled={!emailOk || !scope.role || pending !== null || created !== null}
          onClick={() =>
            void run("invite", async () => {
              const r = await api.inviteUser({ email: email.trim(), name: name.trim() || undefined, grants: [{ role_key: scope.role, system_id: scope.system || null, module: scope.module || null }] });
              await refreshAdmin(qc, "users");
              await refreshAdmin(qc, "licence");
              setCreated(r.id);
              return { tone: "ok", title: `Invitation sent to ${r.email}`, detail: "They get a link that works for seven days." };
            })
          }
        >
          {pending === "invite" ? "Inviting…" : "Send the invitation"}
        </button>
        {created ? (
          <button type="button" className="m2-btn" onClick={() => openItem({ kind: "user", id: created })}>
            Open the new user
          </button>
        ) : null}
      </Actions>
    </InspectorFrame>
  );
}

function GrantsBlock({ user, canEdit, onChanged }: { user: User; canEdit: boolean; onChanged: () => Promise<void> }) {
  const roles = useRoles();
  const done = useDone();
  const [scope, setScope] = useState<Scope>({ role: "", system: "", module: "" });
  const [expires, setExpires] = useState("");
  const preview = useGrantPreview(user.id, scope.role, scope.system, scope.module);
  const { outcome, pending, run } = useOutcome();
  const [convert, setConvert] = useState<Awaited<ReturnType<typeof api.convertObjectApprovals>> | null>(null);
  const grants = user.grants ?? [];
  return (
    <>
      <h3>Roles</h3>
      {grants.length === 0 ? (
        <p className="m2-prov">No grants. {user.role ? `The account carries the ${roleLabel(user.role)} role.` : ""}</p>
      ) : (
        <ul className="m2-flist" aria-label="Roles granted">
          {grants.map((g) => (
            <li key={g.id}>
              <span>
                {(g.role_name || roleLabel(g.role_key)).replace(/\s*\(legacy\)\s*$/i, "")}
                <span className="m2-meta">{`, ${g.system_name ?? "all systems"}${g.module ? `, ${formatModuleName(g.module)}` : ""}${g.expires_at ? `, ${isPast(g.expires_at) ? "expired" : "until"} ${formatDate(g.expires_at)}` : ""}`}</span>
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className="m2-linkbtn"
                  disabled={pending !== null}
                  onClick={() =>
                    void run(`rm-${g.id}`, async () => {
                      await api.removeGrant(user.id, g.id);
                      await onChanged();
                      done(`Removed ${g.role_name || g.role_key} from ${user.name}`, async () => {
                        await api.addGrant(user.id, { role_key: g.role_key, system_id: g.system_id, module: g.module, expires_at: g.expires_at ?? null });
                        await onChanged();
                      });
                      return { tone: "ok", title: "Role removed", detail: `${user.name} no longer has ${g.role_name || g.role_key}${g.system_name ? ` on ${g.system_name}` : ""}.` };
                    })
                  }
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <>
          <h3>Add a role</h3>
          <ScopeFields scope={scope} onChange={setScope} roles={roles.data ?? []} expires={expires} onExpires={setExpires} />
          {scope.role && preview.data ? (
            <p className="m2-prov" role="status" data-testid="grant-preview">
              {preview.data.diff.added_pairs.length === 0 ? "This adds nothing the person cannot already do." : `This lets ${user.name} ${preview.data.diff.added_pairs.slice(0, 6).map(([r, a]) => `${a} ${r}`).join(", ")}${preview.data.diff.added_pairs.length > 6 ? ` and ${preview.data.diff.added_pairs.length - 6} more` : ""}.`}
            </p>
          ) : null}
          <div className="m2-acts" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="m2-btn"
              disabled={!scope.role || pending !== null}
              onClick={() =>
                void run("add", async () => {
                  const g = await api.addGrant(user.id, grantBody(scope, expires));
                  await onChanged();
                  setScope({ role: "", system: "", module: "" });
                  setExpires("");
                  done(`Added ${labelOf(scope.role)} to ${user.name}`, async () => {
                    await api.removeGrant(user.id, g.id);
                    await onChanged();
                  });
                  return { tone: "ok", title: "Role added" };
                })
              }
            >
              {pending === "add" ? "Adding…" : "Add the role"}
            </button>
            <button
              type="button"
              className="m2-btn m2-ghost"
              disabled={pending !== null}
              onClick={() =>
                void run("convert", async () => {
                  const r = await api.convertObjectApprovals(user.id, false);
                  setConvert(r);
                  return { tone: "info", title: r.converted.length ? `${r.converted.length} object approvals can become grants` : "No legacy object approvals to convert", detail: r.skipped.length ? `${r.skipped.length} would be skipped.` : undefined };
                })
              }
            >
              Check legacy object approvals
            </button>
          </div>
          {convert && convert.converted.length && !convert.confirmed ? (
            <div className="m2-acts" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="m2-btn"
                disabled={pending !== null}
                onClick={() =>
                  void run("convert-go", async () => {
                    const r = await api.convertObjectApprovals(user.id, true);
                    setConvert(r);
                    await onChanged();
                    return { tone: "ok", title: "Converted to grants", detail: `${r.converted.length} converted.` };
                  })
                }
              >
                Convert them to grants
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </>
  );
}

function EffectiveBlock({ userId }: { userId: string }) {
  const q = useEffective(userId);
  if (q.isLoading) return <Skeleton width="100%" height={40} />;
  if (!q.data) return null;
  const e = q.data;
  const open = Object.entries(e.resources).map(([r, acts]) => [r, Object.entries(acts).filter(([, on]) => on).map(([a]) => a)] as const).filter(([, a]) => a.length > 0);
  return (
    <>
      <h3>What they can do now</h3>
      {open.length === 0 ? (
        <p className="m2-prov">Nothing yet. They can sign in and see nothing until a role is granted.</p>
      ) : (
        <ul className="m2-flist" aria-label="Effective permissions">
          {open.map(([r, acts]) => (
            <li key={r}>
              <span>{r}</span>
              <span className="m2-meta">{acts.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function UserBody({ user }: { user: User }) {
  const qc = useQueryClient();
  const can = useCan();
  const me = useAuth().user;
  const done = useDone();
  const { outcome, pending, run } = useOutcome();
  const [ask, setAsk] = useState<"remove" | "suspend" | "reset" | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const edit = can("manage_users");
  const self = me?.id === user.id;
  const status = userStatus(user);
  const refresh = async () => {
    await refreshAdmin(qc, "users");
    await refreshAdmin(qc, "licence");
  };
  const setActive = (active: boolean) =>
    void run(active ? "reactivate" : "suspend", async () => {
      await api.setUserActive(user.id, active);
      await refresh();
      setAsk(null);
      done(active ? `${user.name} can sign in again` : `${user.name} suspended`, async () => {
        await api.setUserActive(user.id, !active);
        await refresh();
      });
      return { tone: "ok", title: active ? `${user.name} can sign in again` : `${user.name} is suspended`, detail: active ? undefined : "They are signed out and cannot sign in until reactivated." };
    });
  return (
    <>
      <Facts>
        <Fact label="Email">{user.email}</Fact>
        <Fact label="Status">
          <UserStatusWord user={user} />
        </Fact>
        <Fact label="Roles">{roleNames(user)}</Fact>
        <Fact label="Last sign-in">{user.last_login ? `${formatDate(user.last_login, "datetime")}, ${since(user.last_login)}` : "Never"}</Fact>
        <Fact label="Member since">{formatDate(user.created_at)}</Fact>
        {status === "invited" || status === "invite_expired" ? <Fact label="Invitation">{`${user.invite_status ? labelOf(user.invite_status) : "Sent"}${user.invite_expires_at ? `, ${isPast(user.invite_expires_at) ? "expired" : "expires"} ${formatDate(user.invite_expires_at)}` : ""}`}</Fact> : null}
        {user.locked_until && !isPast(user.locked_until) ? <Fact label="Locked until">{formatDate(user.locked_until, "datetime")}</Fact> : null}
        <Fact label="Password changed">{user.password_changed_at ? formatDate(user.password_changed_at) : "Not yet"}</Fact>
      </Facts>
      <Actions>
        {user.is_active ? (
          <button type="button" className="m2-btn" disabled={!edit || self || pending !== null} title={self ? "You can't change your own access" : undefined} onClick={() => setAsk("suspend")}>
            Suspend
          </button>
        ) : (
          <button type="button" className="m2-btn m2-strong" disabled={!edit || pending !== null} onClick={() => setActive(true)}>
            Reactivate
          </button>
        )}
        {status === "invited" || status === "invite_expired" ? (
          <>
            <button
              type="button"
              className="m2-btn"
              disabled={!edit || pending !== null}
              onClick={() =>
                void run("resend", async () => {
                  const r = await api.resendInvite(user.id);
                  await refresh();
                  return { tone: "ok", title: `Invitation sent to ${user.email}`, detail: `It works until ${formatDate(r.invite_expires_at)}.` };
                })
              }
            >
              Resend the invitation
            </button>
            <button
              type="button"
              className="m2-btn"
              disabled={!edit || pending !== null}
              onClick={() =>
                void run("link", async () => {
                  const r = await api.createInviteLink(user.id);
                  setLink(r.url);
                  const copied = await copyText(r.url);
                  return { tone: copied ? "ok" : "info", title: copied ? "Invite link copied" : "Invite link made", detail: `It works until ${formatDate(r.expires_at)}.` };
                })
              }
            >
              Copy an invite link
            </button>
          </>
        ) : (
          <button type="button" className="m2-btn" disabled={!edit || pending !== null} onClick={() => setAsk("reset")}>
            Reset the password
          </button>
        )}
        <button type="button" className="m2-btn m2-crit" disabled={!edit || self || pending !== null} title={self ? "You can't remove yourself" : undefined} onClick={() => setAsk("remove")}>
          Remove the user
        </button>
      </Actions>
      {link ? <p className="m2-secret" aria-label="Invite link">{link}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {!edit ? <p className="m2-prov">Changing a user needs the manage users permission.</p> : null}
      <GrantsBlock user={user} canEdit={edit} onChanged={refresh} />
      <EffectiveBlock userId={user.id} />
      {ask === "suspend" ? <Confirm title={`Suspend ${user.name}`} body="They are signed out and cannot sign in until someone reactivates them. Their work stays where it is." confirm="Suspend" danger pending={pending === "suspend"} onCancel={() => setAsk(null)} onConfirm={() => setActive(false)} /> : null}
      {ask === "remove" ? (
        <Confirm
          title={`Remove ${user.name}`}
          body="The account is deleted and its seat is freed. Their audit entries stay."
          confirm="Remove the user"
          danger
          pending={pending === "remove"}
          onCancel={() => setAsk(null)}
          onConfirm={() =>
            void run("remove", async () => {
              await api.removeUser(user.id);
              await refresh();
              setAsk(null);
              return { tone: "ok", title: `${user.name} removed` };
            })
          }
        />
      ) : null}
      {ask === "reset" ? (
        <Confirm
          title={`Reset the password for ${user.name}`}
          body="They are signed out and must choose a new password. Email them a link, or copy a one-time link to hand over; it works once and ends in 24 hours."
          confirm="Email the link"
          cancel="Cancel"
          pending={pending === "reset"}
          onCancel={() => setAsk(null)}
          onConfirm={() =>
            void run("reset", async () => {
              const r = await api.resetUserPassword(user.id, true);
              setAsk(null);
              return r.emailed ? { tone: "ok", title: `Reset email sent to ${user.email}`, detail: `${user.name} is signed out.` } : { tone: "fail", title: `${user.name} is signed out, but the email could not be queued`, detail: "Copy a one-time link instead." };
            })
          }
        />
      ) : null}
      {ask === "reset" ? null : (
        <p className="m2-prov">
          {status === "active" ? (
            <button
              type="button"
              className="m2-linkbtn"
              disabled={!edit || pending !== null}
              onClick={() =>
                void run("reset-link", async () => {
                  const r = await api.resetUserPassword(user.id, false);
                  if (r.link) {
                    setLink(r.link);
                    await copyText(r.link);
                  }
                  return { tone: "ok", title: "One-time link copied", detail: `${user.name} is signed out. The link works once and ends in 24 hours.` };
                })
              }
            >
              Copy a one-time reset link instead
            </button>
          ) : null}
        </p>
      )}
    </>
  );
}

export function UserInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useUsers({}, id !== "new");
  if (id === "new") return <InviteUser onClose={onClose} />;
  const user = q.data?.users.find((u) => u.id === id);
  return (
    <InspectorFrame title={user?.name ?? "User"} status={user ? `${user.email}, ${STATUS_LABEL[userStatus(user)]}` : undefined} onClose={onClose}>
      {user ? <UserBody user={user} /> : q.isLoading ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>The user could not be read.</ErrorFrame> : <EmptyFrame>This user is not in the tenant. They may have been removed.</EmptyFrame>}
    </InspectorFrame>
  );
}

/* ── Role ── */

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
    <InspectorFrame title="Create a role" status="New role" onClose={onClose}>
      <div className="m2-aform">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Start as a copy of
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {(roles.data ?? []).map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description (optional)
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button
          type="button"
          className="m2-btn m2-next"
          disabled={!name.trim() || !from || pending !== null || made !== null}
          onClick={() =>
            void run("create", async () => {
              const r = await api.createRole({ name: name.trim(), cloned_from: from, description: description.trim() || undefined });
              await refreshAdmin(qc, "roles");
              setMade(r.key);
              return { tone: "ok", title: `Role ${r.name} created`, detail: "It starts as a copy. Open it to change what it may do." };
            })
          }
        >
          {pending === "create" ? "Creating…" : "Create the role"}
        </button>
        {made ? (
          <button type="button" className="m2-btn" onClick={() => openItem({ kind: "role", id: made })}>
            Open the role
          </button>
        ) : null}
      </Actions>
    </InspectorFrame>
  );
}

function RoleBody({ role }: { role: Role }) {
  const qc = useQueryClient();
  const { openItem, close } = useOpenItem();
  const can = useCan();
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
        <Fact label="Key">
          <span className="m2-mono">{role.key}</span>
        </Fact>
        <Fact label="Type">{role.built_in ? "Built-in: fixed" : "Custom"}</Fact>
        <Fact label="People">{role.users ?? 0}</Fact>
        <Fact label="Last changed">{role.updated_at ? formatDate(role.updated_at, "datetime") : "Never"}</Fact>
        {role.cloned_from ? <Fact label="Copied from">{roleLabel(role.cloned_from)}</Fact> : null}
      </Facts>
      {edit ? (
        <>
          <h3>Name and description</h3>
          <div className="m2-aform">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Description
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
          <div className="m2-acts" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="m2-btn"
              disabled={!saveMeta || !name.trim() || pending !== null}
              onClick={() =>
                void run("meta", async () => {
                  const prev = { name: role.name, description: role.description ?? "" };
                  await api.updateRole(role.key, { name: name.trim(), description: description.trim() });
                  await refreshAdmin(qc, "roles");
                  done(`Role ${name.trim()} saved`, async () => {
                    await api.updateRole(role.key, prev);
                    await refreshAdmin(qc, "roles");
                  });
                  return { tone: "ok", title: "Role saved" };
                })
              }
            >
              Save the name
            </button>
          </div>
        </>
      ) : null}
      <h3>{edit ? "What it may do" : "What it may do (fixed)"}</h3>
      {matrix ? (
        <PermissionMatrix matrix={matrix} editable={edit} base={perms.data?.matrix} onToggle={(r, a, on) => setDraft({ ...matrix, [r]: { ...matrix[r], [a]: on } })} />
      ) : perms.isError ? (
        <ErrorFrame onRetry={() => void perms.refetch()}>The permissions could not be read.</ErrorFrame>
      ) : (
        <Skeleton width="100%" height={160} />
      )}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        {edit ? (
          <>
            <button
              type="button"
              className="m2-btn m2-strong"
              disabled={!dirty || pending !== null}
              onClick={() =>
                draft &&
                perms.data &&
                void run("perm", async () => {
                  const prev = perms.data.matrix;
                  await api.putRolePermissions(role.key, matrixToPairs(draft));
                  await refreshAdmin(qc, "roles");
                  setDraft(null);
                  done(`Permissions of ${role.name} saved`, async () => {
                    await api.putRolePermissions(role.key, matrixToPairs(prev));
                    await refreshAdmin(qc, "roles");
                  });
                  return { tone: "ok", title: "Permissions saved", detail: "They apply to everyone who holds the role, from their next request." };
                })
              }
            >
              {pending === "perm" ? "Saving…" : "Save permissions"}
            </button>
            <button type="button" className="m2-btn" disabled={!dirty} onClick={() => setDraft(null)}>
              Reset
            </button>
            <button type="button" className="m2-btn m2-crit" disabled={pending !== null} onClick={() => setAsk(true)}>
              Delete the role
            </button>
          </>
        ) : null}
        <button type="button" className="m2-btn" onClick={() => openItem({ kind: "role", id: "new" })}>
          {role.built_in ? "Copy to change it" : "Copy this role"}
        </button>
      </Actions>
      {ask ? (
        <Confirm
          title={`Delete ${role.name}`}
          body={role.users ? `${role.users} ${role.users === 1 ? "person has" : "people have"} this role; the API refuses until they are moved.` : "The role is removed for good."}
          confirm="Delete the role"
          danger
          pending={pending === "delete"}
          onCancel={() => setAsk(false)}
          onConfirm={() =>
            void run("delete", async () => {
              await api.removeRole(role.key);
              await refreshAdmin(qc, "roles");
              setAsk(false);
              close();
              return { tone: "ok", title: "Role deleted" };
            })
          }
        />
      ) : null}
    </>
  );
}

export function RoleInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const roles = useRoles(id !== "new");
  if (id === "new") return <NewRole onClose={onClose} />;
  const role = roles.data?.find((r) => r.key === id);
  return (
    <InspectorFrame title={role?.name ?? "Role"} status={role ? (role.built_in ? "Built-in role" : "Custom role") : undefined} onClose={onClose}>
      {role ? <RoleBody key={role.key} role={role} /> : roles.isLoading ? <Skeleton width="100%" height={120} /> : roles.isError ? <ErrorFrame onRetry={() => void roles.refetch()}>The role could not be read.</ErrorFrame> : <EmptyFrame>This role does not exist.</EmptyFrame>}
    </InspectorFrame>
  );
}

/* ── API key ── */

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
    <InspectorFrame title="Create an API key" status="New key" onClose={onClose}>
      <div className="m2-aform">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="BI export job" />
        </label>
        <label>
          Expires (optional)
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
      </div>
      <h3>Roles the key acts with</h3>
      {grants.map((g, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          <ScopeFields scope={g} onChange={(s) => setGrants(grants.map((x, j) => (j === i ? s : x)))} roles={roles.data ?? []} />
          {grants.length > 1 ? (
            <button type="button" className="m2-linkbtn" onClick={() => setGrants(grants.filter((_, j) => j !== i))}>
              Remove this role
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" className="m2-btn m2-sm" onClick={() => setGrants([...grants, { role: "", system: "", module: "" }])}>
        Add another role
      </button>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {made ? (
        <div role="status">
          <h3>Your key. It is shown once.</h3>
          <p className="m2-secret" data-testid="new-key">{made.key}</p>
          <div className="m2-acts" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="m2-btn m2-strong"
              onClick={() => void copyText(made.key).then((ok) => setCopied(ok))}
            >
              {copied ? "Copied" : "Copy the key"}
            </button>
            <button type="button" className="m2-btn" onClick={() => openItem({ kind: "apikey", id: made.id })}>
              Open the key
            </button>
          </div>
        </div>
      ) : null}
      <Actions>
        <button
          type="button"
          className="m2-btn m2-next"
          disabled={!name.trim() || grants.some((g) => !g.role) || pending !== null || made !== null}
          onClick={() =>
            void run("create", async () => {
              const k = await api.createApiKey({ name: name.trim(), grants: grants.map((g) => ({ role_key: g.role, system_id: g.system || null, module: g.module || null })), expires_at: expires ? `${expires}T23:59:59Z` : null });
              await refreshAdmin(qc, "apikeys");
              setMade({ id: k.id, key: k.key });
              return { tone: "ok", title: `Key ${k.name} created`, detail: "Copy it now: it cannot be shown again." };
            })
          }
        >
          {pending === "create" ? "Creating…" : "Create the key"}
        </button>
      </Actions>
    </InspectorFrame>
  );
}

function KeyBody({ k }: { k: ApiKey }) {
  const qc = useQueryClient();
  const { close } = useOpenItem();
  const can = useCan();
  const { outcome, pending, run } = useOutcome();
  const [ask, setAsk] = useState<"revoke" | "delete" | null>(null);
  const edit = can("manage_users");
  return (
    <>
      <Facts>
        <Fact label="Key">
          <span className="m2-mono">{`${k.key_prefix}…`}</span>
        </Fact>
        <Fact label="Status">{labelOf(k.status)}</Fact>
        <Fact label="Roles">{keyRoles(k)}</Fact>
        <Fact label="Created">{`${formatDate(k.created_at)}${k.created_by_name ? ` by ${k.created_by_name}` : ""}`}</Fact>
        <Fact label="Last used">{k.last_used_at ? `${formatDate(k.last_used_at, "datetime")}, ${since(k.last_used_at)}` : "Never used"}</Fact>
        <Fact label="Expires">{k.expires_at ? formatDate(k.expires_at) : "Never"}</Fact>
        {k.revoked_at ? <Fact label="Revoked">{formatDate(k.revoked_at, "datetime")}</Fact> : null}
      </Facts>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        {k.status === "active" ? (
          <button type="button" className="m2-btn m2-crit" disabled={!edit || pending !== null} onClick={() => setAsk("revoke")}>
            Revoke the key
          </button>
        ) : null}
        <button type="button" className="m2-btn" disabled={!edit || pending !== null} onClick={() => setAsk("delete")}>
          Delete the key
        </button>
      </Actions>
      <p className="m2-prov">A revoked key stops working at once and cannot be restored. Its name stays in the audit log.</p>
      {ask === "revoke" ? (
        <Confirm
          title={`Revoke ${k.name}`}
          body="Anything using this key stops working at once. This cannot be undone: create a new key instead."
          confirm="Revoke the key"
          danger
          pending={pending === "revoke"}
          onCancel={() => setAsk(null)}
          onConfirm={() =>
            void run("revoke", async () => {
              await api.revokeApiKey(k.id);
              await refreshAdmin(qc, "apikeys");
              setAsk(null);
              return { tone: "ok", title: "Key revoked" };
            })
          }
        />
      ) : null}
      {ask === "delete" ? (
        <Confirm
          title={`Delete ${k.name}`}
          body="The key and its service account are removed. Its entries in the audit log stay."
          confirm="Delete the key"
          danger
          pending={pending === "delete"}
          onCancel={() => setAsk(null)}
          onConfirm={() =>
            void run("delete", async () => {
              await api.deleteApiKey(k.id);
              await refreshAdmin(qc, "apikeys");
              setAsk(null);
              close();
              return { tone: "ok", title: "Key deleted" };
            })
          }
        />
      ) : null}
    </>
  );
}

export function ApiKeyInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useApiKeys(id !== "new");
  if (id === "new") return <NewKey onClose={onClose} />;
  const k = q.data?.find((x) => x.id === id);
  return (
    <InspectorFrame title={k?.name ?? "API key"} status={k ? `${labelOf(k.status)} key` : undefined} onClose={onClose}>
      {k ? <KeyBody k={k} /> : q.isLoading ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>The key could not be read.</ErrorFrame> : <EmptyFrame>This key does not exist. It may have been deleted.</EmptyFrame>}
    </InspectorFrame>
  );
}

