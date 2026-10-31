"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import type { User } from "@/types/api";
import type { ApiKey } from "@/lib/api/api-keys";
import type { Matrix, Role } from "@/lib/api/roles";
import * as api from "@/lib/api/v2/admin";
import { formatDate } from "@/lib/format";

import { isPast, userStatus } from "@/lib/users";
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
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText, roleText, userStatusText } from "@/lib/v2/labels";

/* ── A scope picker shared by grants and API keys ── */

interface Scope { role: string; system: string; module: string }
function ScopeFields({ scope, onChange, roles, expires, onExpires }: { scope: Scope; onChange: (s: Scope) => void; roles: Role[]; expires?: string; onExpires?: (v: string) => void }) {
  const systems = useSystemsExtended();
  const landscape = useLandscape(null);
  return (
    <div className="m2-aform">
      <label>
        {t("Role")}
        <select value={scope.role} onChange={(e) => onChange({ ...scope, role: e.target.value })}>
          <option value="">{t("Choose a role")}</option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("System")}
        <select value={scope.system} onChange={(e) => onChange({ ...scope, system: e.target.value })}>
          <option value="">{t("All systems")}</option>
          {(systems.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Object")}
        <select value={scope.module} onChange={(e) => onChange({ ...scope, module: e.target.value })}>
          <option value="">{t("All objects")}</option>
          {(landscape.data?.objects ?? []).map((o) => (
            <option key={o.module} value={o.module}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {onExpires ? (
        <label>
          {t("Expires (optional)")}
          <input type="date" value={expires ?? ""} onChange={(e) => onExpires(e.target.value)} />
        </label>
      ) : null}
    </div>
  );
}

const grantBody = (s: Scope, expires?: string) => ({ role_key: s.role, system_id: s.system || null, module: s.module || null, ...(expires ? { expires_at: `${expires}T23:59:59Z` } : {}) });

/* ── User ── */

function InviteUser({ onClose, role = "viewer" }: { onClose: () => void; role?: string }) {
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const roles = useRoles();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>({ role, system: "", module: "" });
  const { outcome, pending, run } = useOutcome();
  const [created, setCreated] = useState<string | null>(null);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  return (
    <InspectorFrame title={t("Invite a user")} status={t("New user")} onClose={onClose}>
      <div className="m2-aform">
        <label>
          {t("Email")}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <label>
          {t("Name (optional)")}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <h3>{t("First role")}</h3>
      <ScopeFields scope={scope} onChange={setScope} roles={roles.data ?? []} />
      <p className="m2-prov">{t("The invitation lasts seven days. More roles can be added from the person's own inspector once they exist.")}</p>
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
              return { tone: "ok", title: t("Invitation sent to {email}", { email: r.email }), detail: t("They get a link that works for seven days.") };
            })
          }
        >
          {pending === "invite" ? t("Inviting…") : t("Send the invitation")}
        </button>
        {created ? (
          <button type="button" className="m2-btn" onClick={() => openItem({ kind: "user", id: created })}>
            {t("Open the new user")}
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
      <h3>{t("Roles")}</h3>
      {grants.length === 0 ? (
        <p className="m2-prov">{t("No grants.")}{" "}{user.role ? t("The account carries the {role} role.", { role: roleText(user.role) }) : ""}</p>
      ) : (
        <ul className="m2-flist" aria-label={t("Roles granted")}>
          {grants.map((g) => (
            <li key={g.id}>
              <span>
                {(g.role_name || roleText(g.role_key)).replace(/\s*\(legacy\)\s*$/i, "")}
                <span className="m2-meta">{`, ${g.system_name ?? t("all systems")}${g.module ? `, ${moduleText(g.module)}` : ""}${g.expires_at ? `, ${isPast(g.expires_at) ? "expired" : "until"} ${formatDate(g.expires_at)}` : ""}`}</span>
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
                      done(t("Removed {role_name} from {name}", { role_name: g.role_name || g.role_key, name: user.name }), async () => {
                        await api.addGrant(user.id, { role_key: g.role_key, system_id: g.system_id, module: g.module, expires_at: g.expires_at ?? null });
                        await onChanged();
                      });
                      return { tone: "ok", title: t("Role removed"), detail: t("{name} no longer has {role_name}{value}.", { name: user.name, role_name: g.role_name || g.role_key, value: g.system_name ? t(" on {system_name}", { system_name: g.system_name }) : "" }) };
                    })
                  }
                >
                  {t("Remove")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <>
          <h3>{t("Add a role")}</h3>
          <ScopeFields scope={scope} onChange={setScope} roles={roles.data ?? []} expires={expires} onExpires={setExpires} />
          {scope.role && preview.data ? (
            <p className="m2-prov" role="status" data-testid="grant-preview">
              {preview.data.diff.added_pairs.length === 0 ? t("This adds nothing the person cannot already do.") : t("This lets {name} {map}{value}.", { name: user.name, map: preview.data.diff.added_pairs.slice(0, 6).map(([r, a]) => `${a} ${r}`).join(", "), value: preview.data.diff.added_pairs.length > 6 ? t(" and {count} more", { count: preview.data.diff.added_pairs.length - 6 }) : "" })}
            </p>
          ) : null}
          <div className="m2-acts" style={{ marginTop: "var(--m2-s2)" }}>
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
                  done(t("Added {role} to {name}", { role: labelText(scope.role), name: user.name }), async () => {
                    await api.removeGrant(user.id, g.id);
                    await onChanged();
                  });
                  return { tone: "ok", title: t("Role added") };
                })
              }
            >
              {pending === "add" ? t("Adding…") : t("Add the role")}
            </button>
            <button
              type="button"
              className="m2-btn m2-ghost"
              disabled={pending !== null}
              onClick={() =>
                void run("convert", async () => {
                  const r = await api.convertObjectApprovals(user.id, false);
                  setConvert(r);
                  return { tone: "info", title: r.converted.length ? t("{convertedCount} object approvals can become grants", { convertedCount: r.converted.length }) : t("No legacy object approvals to convert"), detail: r.skipped.length ? t("{skippedCount} would be skipped.", { skippedCount: r.skipped.length }) : undefined };
                })
              }
            >
              {t("Check legacy object approvals")}
            </button>
          </div>
          {convert && convert.converted.length && !convert.confirmed ? (
            <div className="m2-acts" style={{ marginTop: "var(--m2-s2)" }}>
              <button
                type="button"
                className="m2-btn"
                disabled={pending !== null}
                onClick={() =>
                  void run("convert-go", async () => {
                    const r = await api.convertObjectApprovals(user.id, true);
                    setConvert(r);
                    await onChanged();
                    return { tone: "ok", title: t("Converted to grants"), detail: t("{convertedCount} converted.", { convertedCount: r.converted.length }) };
                  })
                }
              >
                {t("Convert them to grants")}
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
      <h3>{t("What they can do now")}</h3>
      {open.length === 0 ? (
        <p className="m2-prov">{t("Nothing yet. They can sign in and see nothing until a role is granted.")}</p>
      ) : (
        <ul className="m2-flist" aria-label={t("Effective permissions")}>
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
      done(active ? t("{name} can sign in again", { name: user.name }) : t("{name} suspended", { name: user.name }), async () => {
        await api.setUserActive(user.id, !active);
        await refresh();
      });
      return { tone: "ok", title: active ? t("{name} can sign in again", { name: user.name }) : t("{name} is suspended", { name: user.name }), detail: active ? undefined : t("They are signed out and cannot sign in until reactivated.") };
    });
  return (
    <>
      <Facts>
        <Fact label={t("Email")}>{user.email}</Fact>
        <Fact label={t("Status")}>
          <UserStatusWord user={user} />
        </Fact>
        <Fact label={t("Roles")}>{roleNames(user)}</Fact>
        <Fact label={t("Last sign-in")}>{user.last_login ? `${formatDate(user.last_login, "datetime")}, ${since(user.last_login)}` : t("Never")}</Fact>
        <Fact label={t("Member since")}>{formatDate(user.created_at)}</Fact>
        {status === "invited" || status === "invite_expired" ? <Fact label={t("Invitation")}>{`${user.invite_status ? labelText(user.invite_status) : t("Sent")}${user.invite_expires_at ? `, ${isPast(user.invite_expires_at) ? "expired" : "expires"} ${formatDate(user.invite_expires_at)}` : ""}`}</Fact> : null}
        {user.locked_until && !isPast(user.locked_until) ? <Fact label={t("Locked until")}>{formatDate(user.locked_until, "datetime")}</Fact> : null}
        <Fact label={t("Password changed")}>{user.password_changed_at ? formatDate(user.password_changed_at) : t("Not yet")}</Fact>
      </Facts>
      <Actions>
        {user.is_active ? (
          <button type="button" className="m2-btn" disabled={!edit || self || pending !== null} title={self ? t("You can't change your own access") : undefined} onClick={() => setAsk("suspend")}>
            {t("Suspend")}
          </button>
        ) : (
          <button type="button" className="m2-btn m2-strong" disabled={!edit || pending !== null} onClick={() => setActive(true)}>
            {t("Reactivate")}
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
                  return { tone: "ok", title: t("Invitation sent to {email}", { email: user.email }), detail: t("It works until {invite_expires_at}.", { invite_expires_at: formatDate(r.invite_expires_at) }) };
                })
              }
            >
              {t("Resend the invitation")}
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
                  return { tone: copied ? "ok" : "info", title: copied ? t("Invite link copied") : t("Invite link made"), detail: t("It works until {expires_at}.", { expires_at: formatDate(r.expires_at) }) };
                })
              }
            >
              {t("Copy an invite link")}
            </button>
          </>
        ) : (
          <button type="button" className="m2-btn" disabled={!edit || pending !== null} onClick={() => setAsk("reset")}>
            {t("Reset the password")}
          </button>
        )}
        <button type="button" className="m2-btn m2-crit" disabled={!edit || self || pending !== null} title={self ? t("You can't remove yourself") : undefined} onClick={() => setAsk("remove")}>
          {t("Remove the user")}
        </button>
      </Actions>
      {link ? <p className="m2-secret" aria-label={t("Invite link")}>{link}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {!edit ? <p className="m2-prov">{t("Changing a user needs the manage users permission.")}</p> : null}
      <GrantsBlock user={user} canEdit={edit} onChanged={refresh} />
      <EffectiveBlock userId={user.id} />
      {ask === "suspend" ? <Confirm title={t("Suspend {name}", { name: user.name })} body={t("They are signed out and cannot sign in until someone reactivates them. Their work stays where it is.")} confirm={t("Suspend")} danger pending={pending === "suspend"} onCancel={() => setAsk(null)} onConfirm={() => setActive(false)} /> : null}
      {ask === "remove" ? (
        <Confirm
          title={t("Remove {name}", { name: user.name })}
          body={t("The account is deleted and its seat is freed. Their audit entries stay.")}
          confirm={t("Remove the user")}
          danger
          pending={pending === "remove"}
          onCancel={() => setAsk(null)}
          onConfirm={() =>
            void run("remove", async () => {
              await api.removeUser(user.id);
              await refresh();
              setAsk(null);
              return { tone: "ok", title: t("{name} removed", { name: user.name }) };
            })
          }
        />
      ) : null}
      {ask === "reset" ? (
        <Confirm
          title={t("Reset the password for {name}", { name: user.name })}
          body={t("They are signed out and must choose a new password. Email them a link, or copy a one-time link to hand over; it works once and ends in 24 hours.")}
          confirm={t("Email the link")}
          cancel={t("Cancel")}
          pending={pending === "reset"}
          onCancel={() => setAsk(null)}
          onConfirm={() =>
            void run("reset", async () => {
              const r = await api.resetUserPassword(user.id, true);
              setAsk(null);
              return r.emailed ? { tone: "ok", title: t("Reset email sent to {email}", { email: user.email }), detail: t("{name} is signed out.", { name: user.name }) } : { tone: "fail", title: t("{name} is signed out, but the email could not be queued", { name: user.name }), detail: t("Copy a one-time link instead.") };
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
                  return { tone: "ok", title: t("One-time link copied"), detail: t("{name} is signed out. The link works once and ends in 24 hours.", { name: user.name }) };
                })
              }
            >
              {t("Copy a one-time reset link instead")}
            </button>
          ) : null}
        </p>
      )}
    </>
  );
}

export function UserInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useUsers({}, id !== "new");
  // `user:new` invites; `user:new:<role key>` starts the invitation with that role (Invite SAP Basis on a new tenant).
  if (id === "new" || id.startsWith("new:")) return <InviteUser onClose={onClose} role={id.slice(4) || undefined} />;
  const user = q.data?.users.find((u) => u.id === id);
  return (
    <InspectorFrame title={user?.name ?? t("User")} status={user ? `${user.email}, ${userStatusText(userStatus(user))}` : undefined} onClose={onClose}>
      {user ? <UserBody user={user} /> : q.isLoading ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The user could not be read.")}</ErrorFrame> : <EmptyFrame>{t("This user is not in the tenant. They may have been removed.")}</EmptyFrame>}
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
    <InspectorFrame title={t("Create a role")} status={t("New role")} onClose={onClose}>
      <div className="m2-aform">
        <label>
          {t("Name")}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t("Start as a copy of")}
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {(roles.data ?? []).map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Description (optional)")}
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
              return { tone: "ok", title: t("Role {name} created", { name: r.name }), detail: t("It starts as a copy. Open it to change what it may do.") };
            })
          }
        >
          {pending === "create" ? t("Creating…") : t("Create the role")}
        </button>
        {made ? (
          <button type="button" className="m2-btn" onClick={() => openItem({ kind: "role", id: made })}>
            {t("Open the role")}
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
        <Fact label={t("Key")}>
          <span className="m2-mono">{role.key}</span>
        </Fact>
        <Fact label={t("Type")}>{role.built_in ? t("Built-in: fixed") : t("Custom")}</Fact>
        <Fact label={t("People")}>{role.users ?? 0}</Fact>
        <Fact label={t("Last changed")}>{role.updated_at ? formatDate(role.updated_at, "datetime") : t("Never")}</Fact>
        {role.cloned_from ? <Fact label={t("Copied from")}>{roleText(role.cloned_from)}</Fact> : null}
      </Facts>
      {edit ? (
        <>
          <h3>{t("Name and description")}</h3>
          <div className="m2-aform">
            <label>
              {t("Name")}
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              {t("Description")}
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
          <div className="m2-acts" style={{ marginTop: "var(--m2-s2)" }}>
            <button
              type="button"
              className="m2-btn"
              disabled={!saveMeta || !name.trim() || pending !== null}
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
            </button>
          </div>
        </>
      ) : null}
      <h3>{edit ? t("What it may do") : t("What it may do (fixed)")}</h3>
      {matrix ? (
        <PermissionMatrix matrix={matrix} editable={edit} base={perms.data?.matrix} onToggle={(r, a, on) => setDraft({ ...matrix, [r]: { ...matrix[r], [a]: on } })} />
      ) : perms.isError ? (
        <ErrorFrame onRetry={() => void perms.refetch()}>{t("The permissions could not be read.")}</ErrorFrame>
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
                  done(t("Permissions of {name} saved", { name: role.name }), async () => {
                    await api.putRolePermissions(role.key, matrixToPairs(prev));
                    await refreshAdmin(qc, "roles");
                  });
                  return { tone: "ok", title: t("Permissions saved"), detail: t("They apply to everyone who holds the role, from their next request.") };
                })
              }
            >
              {pending === "perm" ? t("Saving…") : t("Save permissions")}
            </button>
            <button type="button" className="m2-btn" disabled={!dirty} onClick={() => setDraft(null)}>
              {t("Reset")}
            </button>
            <button type="button" className="m2-btn m2-crit" disabled={pending !== null} onClick={() => setAsk(true)}>
              {t("Delete the role")}
            </button>
          </>
        ) : null}
        <button type="button" className="m2-btn" onClick={() => openItem({ kind: "role", id: "new" })}>
          {role.built_in ? t("Copy to change it") : t("Copy this role")}
        </button>
      </Actions>
      {ask ? (
        <Confirm
          title={t("Delete {name}", { name: role.name })}
          body={role.users ? t("{users} {users, plural, one {person has} other {people have}} this role; the API refuses until they are moved.", { users: role.users }) : t("The role is removed for good.")}
          confirm={t("Delete the role")}
          danger
          pending={pending === "delete"}
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
      ) : null}
    </>
  );
}

export function RoleInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const roles = useRoles(id !== "new");
  if (id === "new") return <NewRole onClose={onClose} />;
  const role = roles.data?.find((r) => r.key === id);
  return (
    <InspectorFrame title={role?.name ?? t("Role")} status={role ? (role.built_in ? t("Built-in role") : t("Custom role")) : undefined} onClose={onClose}>
      {role ? <RoleBody key={role.key} role={role} /> : roles.isLoading ? <Skeleton width="100%" height={120} /> : roles.isError ? <ErrorFrame onRetry={() => void roles.refetch()}>{t("The role could not be read.")}</ErrorFrame> : <EmptyFrame>{t("This role does not exist.")}</EmptyFrame>}
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
    <InspectorFrame title={t("Create an API key")} status={t("New key")} onClose={onClose}>
      <div className="m2-aform">
        <label>
          {t("Name")}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("BI export job")} />
        </label>
        <label>
          {t("Expires (optional)")}
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
      </div>
      <h3>{t("Roles the key acts with")}</h3>
      {grants.map((g, i) => (
        <div key={i} style={{ marginBottom: "var(--m2-s3)" }}>
          <ScopeFields scope={g} onChange={(s) => setGrants(grants.map((x, j) => (j === i ? s : x)))} roles={roles.data ?? []} />
          {grants.length > 1 ? (
            <button type="button" className="m2-linkbtn" onClick={() => setGrants(grants.filter((_, j) => j !== i))}>
              {t("Remove this role")}
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" className="m2-btn m2-sm" onClick={() => setGrants([...grants, { role: "", system: "", module: "" }])}>
        {t("Add another role")}
      </button>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {made ? (
        <div role="status">
          <h3>{t("Your key. It is shown once.")}</h3>
          <p className="m2-secret" data-testid="new-key">{made.key}</p>
          <div className="m2-acts" style={{ marginTop: "var(--m2-s2)" }}>
            <button
              type="button"
              className="m2-btn m2-strong"
              onClick={() => void copyText(made.key).then((ok) => setCopied(ok))}
            >
              {copied ? t("Copied") : t("Copy the key")}
            </button>
            <button type="button" className="m2-btn" onClick={() => openItem({ kind: "apikey", id: made.id })}>
              {t("Open the key")}
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
              return { tone: "ok", title: t("Key {name} created", { name: k.name }), detail: t("Copy it now: it cannot be shown again.") };
            })
          }
        >
          {pending === "create" ? t("Creating…") : t("Create the key")}
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
        <Fact label={t("Key")}>
          <span className="m2-mono">{`${k.key_prefix}…`}</span>
        </Fact>
        <Fact label={t("Status")}>{labelText(k.status)}</Fact>
        <Fact label={t("Roles")}>{keyRoles(k)}</Fact>
        <Fact label={t("Created")}>{`${formatDate(k.created_at)}${k.created_by_name ? t(" by {created_by_name}", { created_by_name: k.created_by_name }) : ""}`}</Fact>
        <Fact label={t("Last used")}>{k.last_used_at ? `${formatDate(k.last_used_at, "datetime")}, ${since(k.last_used_at)}` : t("Never used")}</Fact>
        <Fact label={t("Expires")}>{k.expires_at ? formatDate(k.expires_at) : t("Never")}</Fact>
        {k.revoked_at ? <Fact label={t("Revoked")}>{formatDate(k.revoked_at, "datetime")}</Fact> : null}
      </Facts>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        {k.status === "active" ? (
          <button type="button" className="m2-btn m2-crit" disabled={!edit || pending !== null} onClick={() => setAsk("revoke")}>
            {t("Revoke the key")}
          </button>
        ) : null}
        <button type="button" className="m2-btn" disabled={!edit || pending !== null} onClick={() => setAsk("delete")}>
          {t("Delete the key")}
        </button>
      </Actions>
      <p className="m2-prov">{t("A revoked key stops working at once and cannot be restored. Its name stays in the audit log.")}</p>
      {ask === "revoke" ? (
        <Confirm
          title={t("Revoke {name}", { name: k.name })}
          body={t("Anything using this key stops working at once. This cannot be undone: create a new key instead.")}
          confirm={t("Revoke the key")}
          danger
          pending={pending === "revoke"}
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
      ) : null}
      {ask === "delete" ? (
        <Confirm
          title={t("Delete {name}", { name: k.name })}
          body={t("The key and its service account are removed. Its entries in the audit log stay.")}
          confirm={t("Delete the key")}
          danger
          pending={pending === "delete"}
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
      ) : null}
    </>
  );
}

export function ApiKeyInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useApiKeys(id !== "new");
  if (id === "new") return <NewKey onClose={onClose} />;
  const k = q.data?.find((x) => x.id === id);
  return (
    <InspectorFrame title={k?.name ?? t("API key")} status={k ? t("{labelText} key", { labelText: labelText(k.status) }) : undefined} onClose={onClose}>
      {k ? <KeyBody k={k} /> : q.isLoading ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The key could not be read.")}</ErrorFrame> : <EmptyFrame>{t("This key does not exist. It may have been deleted.")}</EmptyFrame>}
    </InspectorFrame>
  );
}

