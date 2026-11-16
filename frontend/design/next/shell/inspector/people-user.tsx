"use client";

/** The user inspector: invite, facts, suspend and remove, invitations, passwords (generated only), roles and what they can do. */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { legacyRole } from "@/hooks/use-role";
import type { User } from "@/types/api";
import * as api from "@/lib/api/v2/admin";
import { errorSentence } from "@/lib/api/v2/client";
import { formatDate } from "@/lib/format";
import { isPast, userStatus } from "@/lib/users";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { refreshAdmin, useEffective, useGrantPreview, useRoles, useUsers } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText, roleText, userStatusText } from "@/lib/v2/labels";
import { Button, Confirm, EmptyState, ErrorState, Skeleton, useToast } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Note, OutcomeView, ScopeFields, Sec, UserStatusWord, copyText, grantBody, passwordFailure, roleNames, since, useDone, useOutcome, useSsoEnforced, type Scope } from "./people-shared";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function InviteUser({ onClose, role = "viewer" }: { onClose: () => void; role?: string }) {
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const roles = useRoles();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>({ role, system: "", module: "" });
  const { outcome, pending, run } = useOutcome();
  const [created, setCreated] = useState<string | null>(null);
  const emailOk = EMAIL.test(email.trim());
  return (
    <InspectorFrame title={t("Invite a user")} status={t("New user")} onClose={onClose}>
      <div className="nx-pp-form">
        <label className="nx-field">
          {t("Email")}
          <input className="nx-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <label className="nx-field">
          {t("Name (optional)")}
          <input className="nx-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <Sec title={t("First role")}>
        {roles.isError ? <ErrorState error={roles.error} onRetry={() => void roles.refetch()} /> : <ScopeFields scope={scope} onChange={setScope} roles={roles.data ?? []} />}
        <Note>{t("The invitation lasts seven days. More roles can be added from the person's own inspector once they exist.")}</Note>
      </Sec>
      {outcome ? <OutcomeView outcome={outcome} /> : null}
      <Actions>
        <Button
          variant="primary"
          disabled={!emailOk || !scope.role || pending !== null || created !== null}
          loading={pending === "invite"}
          loadingLabel={t("Inviting…")}
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
          {t("Send the invitation")}
        </Button>
        {created ? <Button onClick={() => openItem({ kind: "user", id: created })}>{t("Open the new user")}</Button> : null}
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
  const added = preview.data?.diff.added_pairs ?? [];
  return (
    <>
      <Sec title={t("Roles")}>
        {grants.length === 0 ? (
          <Note>
            {t("No grants.")} {user.role ? t("The account carries the {role} role.", { role: roleText(user.role) }) : ""}
          </Note>
        ) : (
          <ul className="nx-ib-list" aria-label={t("Roles granted")}>
            {grants.map((g) => (
              <li key={g.id} className="nx-ib-row">
                <span>
                  {(g.role_name || roleText(g.role_key)).replace(/\s*\(legacy\)\s*$/i, "")}
                  <span className="nx-ib-meta">{`, ${g.system_name ?? t("all systems")}${g.module ? `, ${moduleText(g.module)}` : ""}${g.expires_at ? `, ${isPast(g.expires_at) ? t("expired") : t("until")} ${formatDate(g.expires_at)}` : ""}`}</span>
                </span>
                {canEdit ? (
                  <Button
                    variant="quiet"
                    size={32}
                    disabled={pending !== null}
                    onClick={() =>
                      void run(`rm-${g.id}`, async () => {
                        await api.removeGrant(user.id, g.id);
                        await onChanged();
                        done(t("Removed {role_name} from {name}. They will be notified.", { role_name: g.role_name || g.role_key, name: user.name }), async () => {
                          await api.addGrant(user.id, { role_key: g.role_key, system_id: g.system_id, module: g.module, expires_at: g.expires_at ?? null });
                          await onChanged();
                        });
                        return { tone: "ok", title: t("Role removed"), detail: t("{name} no longer has {role_name}{value}.", { name: user.name, role_name: g.role_name || g.role_key, value: g.system_name ? t(" on {system_name}", { system_name: g.system_name }) : "" }) };
                      })
                    }
                  >
                    {t("Remove")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Sec>
      {canEdit ? (
        <Sec title={t("Add a role")}>
          <ScopeFields scope={scope} onChange={setScope} roles={roles.data ?? []} expires={expires} onExpires={setExpires} />
          {scope.role && preview.data ? (
            <Note role="status">
              <span data-testid="grant-preview">
                {added.length === 0
                  ? t("This adds nothing the person cannot already do.")
                  : t("This lets {name} {map}{value}.", { name: user.name, map: added.slice(0, 6).map(([r, a]) => `${a} ${r}`).join(", "), value: added.length > 6 ? t(" and {count} more", { count: added.length - 6 }) : "" })}
              </span>
            </Note>
          ) : null}
          <div className="nx-ib-acts nx-pp-acts">
            <Button
              disabled={!scope.role || pending !== null}
              loading={pending === "add"}
              loadingLabel={t("Adding…")}
              onClick={() =>
                void run("add", async () => {
                  const g = await api.addGrant(user.id, grantBody(scope, expires));
                  await onChanged();
                  setScope({ role: "", system: "", module: "" });
                  setExpires("");
                  done(t("Added {role} to {name}. They will be notified.", { role: labelText(scope.role), name: user.name }), async () => {
                    await api.removeGrant(user.id, g.id);
                    await onChanged();
                  });
                  return { tone: "ok", title: t("Role added") };
                })
              }
            >
              {t("Add the role")}
            </Button>
            <Button
              variant="quiet"
              disabled={pending !== null}
              onClick={() =>
                void run("convert", async () => {
                  const r = await api.convertObjectApprovals(user.id, false);
                  setConvert(r);
                  return {
                    tone: "info",
                    title: r.converted.length ? t("{convertedCount} object approvals can become grants", { convertedCount: r.converted.length }) : t("No legacy object approvals to convert"),
                    detail: r.skipped.length ? t("{skippedCount} would be skipped.", { skippedCount: r.skipped.length }) : undefined,
                  };
                })
              }
            >
              {t("Check legacy object approvals")}
            </Button>
          </div>
          {convert && convert.converted.length && !convert.confirmed ? (
            <div className="nx-ib-acts nx-pp-acts">
              <Button
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
              </Button>
            </div>
          ) : null}
        </Sec>
      ) : null}
      {outcome ? <OutcomeView outcome={outcome} /> : null}
    </>
  );
}

function EffectiveBlock({ userId }: { userId: string }) {
  const q = useEffective(userId);
  if (q.isLoading) return <Skeleton lines={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  const open = Object.entries(q.data.resources)
    .map(([r, acts]) => [r, Object.entries(acts).filter(([, on]) => on).map(([a]) => a)] as const)
    .filter(([, a]) => a.length > 0);
  return (
    <Sec title={t("What they can do now")}>
      {open.length === 0 ? (
        <Note>{t("Nothing yet. They can sign in and see nothing until a role is granted.")}</Note>
      ) : (
        <ul className="nx-ib-list" aria-label={t("Effective permissions")}>
          {open.map(([r, acts]) => (
            <li key={r} className="nx-ib-row">
              <span>{r}</span>
              <span className="nx-ib-meta">{acts.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </Sec>
  );
}

/** Who the user reports to. A workflow step assigned to "the requester's manager" goes to this person. */
function ManagerPicker({ user, disabled }: { user: User; disabled: boolean }) {
  const qc = useQueryClient();
  const users = useUsers();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const others = (users.data?.users ?? []).filter((u) => u.id !== user.id && u.is_active);
  return (
    <select
      className="nx-input"
      aria-label={t("Reports to")}
      value={user.manager_id ?? ""}
      disabled={disabled || busy}
      onChange={async (e) => {
        setBusy(true);
        try {
          await api.setUserManager(user.id, e.target.value || null);
          await refreshAdmin(qc, "users");
          toast({ text: t("Manager saved") });
        } catch (err) {
          toast({ text: errorSentence(err, t("The manager could not be saved.")), tone: "bad" });
        } finally {
          setBusy(false);
        }
      }}
    >
      <option value="">{t("No one")}</option>
      {others.map((u) => (
        <option key={u.id} value={u.id}>{`${u.name} (${u.email})`}</option>
      ))}
    </select>
  );
}

/**
 * Set a password: generated by the server and shown once. The typed-password mode of v2 is not offered here: this
 * screen never sends a password. Closing forgets the generated one.
 */
function SetPassword({ user, onClose }: { user: { id: string; name: string }; onClose: () => void }) {
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { outcome, pending, run } = useOutcome();
  const close = () => {
    setShown(null);
    onClose();
  };
  return (
    <Sec title={t("Set a password for {name}", { name: user.name })} label={t("Set a password for {name}", { name: user.name })}>
      <Note>{t("Hand it over yourself. They are signed out and must change it when they next sign in.")}</Note>
      {shown ? (
        <>
          <Note>{t("Copy it now. It is shown once and never again.")}</Note>
          <p className="nx-pp-secret" aria-label={t("New password")} data-testid="shown-password">
            {shown}
          </p>
          <div className="nx-ib-acts nx-pp-acts">
            <Button onClick={() => void copyText(shown).then(setCopied)}>{copied ? t("Copied") : t("Copy the password")}</Button>
            <Button variant="primary" onClick={close}>
              {t("Done")}
            </Button>
          </div>
        </>
      ) : (
        <>
          {outcome ? <OutcomeView outcome={outcome} /> : null}
          <div className="nx-ib-acts nx-pp-acts">
            <Button onClick={close}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              disabled={pending !== null}
              loading={pending !== null}
              loadingLabel={t("Working…")}
              onClick={() =>
                void run("set", async () => {
                  try {
                    const r = await api.setUserPassword(user.id, { generate: true });
                    if (r.password) setShown(r.password);
                    return { tone: "ok", title: t("Password set for {name}", { name: user.name }), detail: t("They are signed out everywhere and must choose their own password when they next sign in.") };
                  } catch (e) {
                    return passwordFailure(e);
                  }
                })
              }
            >
              {t("Set the password")}
            </Button>
          </div>
        </>
      )}
    </Sec>
  );
}

function UserBody({ user }: { user: User }) {
  const qc = useQueryClient();
  const { can } = useV2Session();
  const me = useAuth().user;
  const done = useDone();
  const { outcome, pending, run } = useOutcome();
  const [ask, setAsk] = useState<"remove" | "suspend" | "reset" | "set" | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const edit = can("manage_users");
  const self = me?.id === user.id;
  const all = useUsers({}, edit).data?.users;
  const admin = legacyRole(user.role) === "admin";
  const lastAdmin = admin && user.is_active && all !== undefined && !all.some((u) => u.id !== user.id && u.is_active && legacyRole(u.role) === "admin");
  // Under enforced single sign-on only admins keep a (break-glass) password; everyone else's lives with the identity provider.
  const ssoManaged = useSsoEnforced() && !admin;
  const pwWhy = !edit
    ? null
    : self
      ? t("Change your own password under Preferences, with your current password.")
      : ssoManaged
        ? t("Managed by your identity provider. This user signs in there, not with a password.")
        : lastAdmin
          ? t("This is the last admin. Add another admin before setting or resetting this password.")
          : !user.is_active
            ? t("Reactivate this user before setting a password.")
            : null;
  const pwBlocked = !edit || pwWhy !== null;
  const status = userStatus(user);
  const invited = status === "invited" || status === "invite_expired";
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
  const resetLink = () =>
    void run("reset-link", async () => {
      let r: Awaited<ReturnType<typeof api.resetUserPassword>>;
      try {
        r = await api.resetUserPassword(user.id, false);
      } catch (e) {
        setAsk(null);
        return passwordFailure(e);
      }
      if (r.link) {
        setLink(r.link);
        await copyText(r.link);
      }
      return { tone: "ok", title: t("One-time link copied"), detail: t("{name} is signed out. The link works once and ends in 24 hours.", { name: user.name }) };
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
        {invited ? (
          <Fact label={t("Invitation")}>{`${user.invite_status ? labelText(user.invite_status) : t("Sent")}${user.invite_expires_at ? `, ${isPast(user.invite_expires_at) ? t("expired") : t("expires")} ${formatDate(user.invite_expires_at)}` : ""}`}</Fact>
        ) : null}
        {user.locked_until && !isPast(user.locked_until) ? <Fact label={t("Locked until")}>{formatDate(user.locked_until, "datetime")}</Fact> : null}
        <Fact label={t("Password changed")}>{user.password_changed_at ? formatDate(user.password_changed_at) : t("Not yet")}</Fact>
        <Fact label={t("Reports to")}>
          <ManagerPicker user={user} disabled={!edit || pending !== null} />
        </Fact>
      </Facts>
      <Actions>
        {user.is_active ? (
          <Button disabled={!edit || self || pending !== null} aria-describedby={self ? "user-self-why" : undefined} onClick={() => setAsk("suspend")}>
            {t("Suspend")}
          </Button>
        ) : (
          <Button variant="primary" disabled={!edit || pending !== null} loading={pending === "reactivate"} onClick={() => setActive(true)}>
            {t("Reactivate")}
          </Button>
        )}
        {invited ? (
          <>
            <Button
              disabled={!edit || pending !== null}
              loading={pending === "resend"}
              onClick={() =>
                void run("resend", async () => {
                  const r = await api.resendInvite(user.id);
                  await refresh();
                  return { tone: "ok", title: t("Invitation sent to {email}", { email: user.email }), detail: t("It works until {invite_expires_at}.", { invite_expires_at: formatDate(r.invite_expires_at) }) };
                })
              }
            >
              {t("Resend the invitation")}
            </Button>
            <Button
              disabled={!edit || pending !== null}
              loading={pending === "link"}
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
            </Button>
          </>
        ) : (
          <>
            <Button disabled={pwBlocked || pending !== null} aria-describedby={pwWhy ? "user-pw-why" : undefined} onClick={() => setAsk("reset")}>
              {t("Reset the password")}
            </Button>
            <Button disabled={pwBlocked || pending !== null} aria-describedby={pwWhy ? "user-pw-why" : undefined} onClick={() => setAsk("set")}>
              {t("Set a password")}
            </Button>
          </>
        )}
        <Button variant="danger" disabled={!edit || self || pending !== null} aria-describedby={self ? "user-self-why" : undefined} onClick={() => setAsk("remove")}>
          {t("Remove the user")}
        </Button>
      </Actions>
      {link ? (
        <p className="nx-pp-secret" aria-label={t("Invite link")}>
          {link}
        </p>
      ) : null}
      {outcome ? <OutcomeView outcome={outcome} /> : null}
      {!edit ? <Note>{t("Changing a user needs the manage users permission.")}</Note> : null}
      {edit && self ? <Note id="user-self-why">{t("You can't suspend or remove yourself.")}</Note> : null}
      {pwWhy && !invited ? <Note id="user-pw-why">{pwWhy}</Note> : null}
      {ask === "set" ? (
        <SetPassword
          user={user}
          onClose={() => {
            setAsk(null);
            void refresh();
          }}
        />
      ) : null}
      {ask !== "reset" && status === "active" ? (
        <Note>
          <Button variant="quiet" size={32} disabled={pwBlocked || pending !== null} loading={pending === "reset-link"} onClick={resetLink}>
            {t("Copy a one-time reset link instead")}
          </Button>
        </Note>
      ) : null}
      <GrantsBlock user={user} canEdit={edit} onChanged={refresh} />
      <EffectiveBlock userId={user.id} />
      <Confirm
        open={ask === "suspend"}
        title={t("Suspend {name}", { name: user.name })}
        consequence={t("They are signed out and cannot sign in until someone reactivates them. Their work stays where it is.")}
        confirmLabel={t("Suspend")}
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() => setActive(false)}
      />
      <Confirm
        open={ask === "remove"}
        title={t("Remove {name}", { name: user.name })}
        consequence={t("The account is deleted and its seat is freed. Their audit entries stay.")}
        confirmLabel={t("Remove the user")}
        danger
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
      <Confirm
        open={ask === "reset"}
        title={t("Reset the password for {name}", { name: user.name })}
        consequence={t("They are signed out and must choose a new password. The emailed link works once and ends in 60 minutes; a copied link works once and ends in 24 hours.")}
        confirmLabel={t("Email the link")}
        onCancel={() => setAsk(null)}
        onConfirm={() =>
          void run("reset", async () => {
            let r: Awaited<ReturnType<typeof api.resetUserPassword>>;
            try {
              r = await api.resetUserPassword(user.id, true);
            } catch (e) {
              setAsk(null);
              return passwordFailure(e);
            }
            setAsk(null);
            return r.emailed
              ? { tone: "ok", title: t("Reset email sent to {email}", { email: user.email }), detail: t("{name} is signed out.", { name: user.name }) }
              : { tone: "fail", title: t("{name} is signed out, but the email could not be queued", { name: user.name }), detail: t("Copy a one-time link instead.") };
          })
        }
      />
    </>
  );
}

export function UserInspector({ id, onClose }: BodyProps) {
  const isNew = id === "new" || id.startsWith("new:");
  const q = useUsers({}, !isNew);
  // `user:new` invites; `user:new:<role key>` starts the invitation with that role (Invite SAP Basis on a new tenant).
  if (isNew) return <InviteUser onClose={onClose} role={id.slice(4) || undefined} />;
  const user = q.data?.users.find((u) => u.id === id);
  return (
    <InspectorFrame title={user?.name ?? t("User")} status={user ? `${user.email}, ${userStatusText(userStatus(user))}` : undefined} onClose={onClose}>
      {user ? (
        <UserBody user={user} />
      ) : q.isLoading ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The user could not be read.")} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("This user is not in the tenant. They may have been removed.")} />
      )}
    </InspectorFrame>
  );
}
