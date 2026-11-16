"use client";

import { useState } from "react";
import { Button, Card, Code, Confirm, DataTable, EmptyState, Field, Input, Select, SeverityPill, Sheet, StatTile, type Column } from "@/ui/kit";
import { Facts, Frame, day, removeBlock, useAct, useCan, useSectionChat } from "../common";
import { useAccessRequests, useEffective, useGrantPreview, useGrants, useLicence, useRoles, useUsers } from "@/lib/v2/admin-queries";
import {
  addGrant, bulkUsers, createInviteLink, decideAccessRequest, importUsers, inviteUser, previewUserImport, removeGrant, removeUser,
  resendInvite, resetUserPassword, setUserActive, setUserPassword, type BulkAction, type User, type UserStatus,
} from "@/lib/api/v2/admin";
import type { ImportPreview } from "@/lib/api/users";
import { STATUS_LABEL, USER_STATUSES, inviteAttention, seatsFull, seatsNearlyFull, userStatus } from "@/lib/users";
import { inviteAttentionText, labelText, moduleText, roleText, seatsText, userStatusText } from "@/lib/v2/labels";
import { t, tx } from "@/lib/v2/i18n";

const SEV: Record<UserStatus, "info" | "medium" | "low" | "high" | "critical"> = {
  invited: "info", invite_expired: "medium", active: "low", locked: "critical", suspended: "high",
};

type Ask = { kind: "remove" | "suspend" | "reactivate"; user: User } | { kind: "bulk"; action: BulkAction } | null;

export function Users() {
  const can = useCan();
  const editable = can("manage_users");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<UserStatus | "">("");
  const users = useUsers({ q: q || undefined, role: role || undefined, status: status || undefined });
  const everyone = useUsers({});
  const roles = useRoles();
  const lic = useLicence();
  const reqs = useAccessRequests();
  const { run, busy } = useAct();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<User | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [invite, setInvite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = users.data?.users ?? [];
  const all = everyone.data?.users ?? rows;
  const seats = { used: lic.data?.seats_used ?? all.filter((u) => u.is_active).length, limit: lic.data?.seats ?? null };
  const attention = inviteAttention(all);
  const attentionText = inviteAttentionText(attention);
  const openReqs = reqs.data ?? [];
  const byId = new Map(all.map((u) => [u.id, u]));

  useSectionChat("users", t("Users"), [
    t("{n} people, {used} active seats.", { n: all.length, used: seats.used }),
    ...(attentionText ? [attentionText] : []),
    t("{n} open access requests.", { n: openReqs.length }),
  ], [t("Who has not signed in yet?"), t("Which invites are stale?")]);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const cols: Column<User>[] = [
    { key: "sel", label: "", render: (u) => <input type="checkbox" aria-label={t("Select {name}", { name: u.name })} checked={picked.has(u.id)} onChange={() => toggle(u.id)} /> },
    { key: "name", label: t("Name"), sort: (u) => u.name, render: (u) => <Button variant="ghost" type="button" onClick={() => setOpen(u)}>{u.name}</Button> },
    { key: "email", label: t("Email"), sort: (u) => u.email, render: (u) => u.email },
    { key: "role", label: t("Role"), sort: (u) => u.role, render: (u) => <Code code={u.role} description={roleText(u.role)} /> },
    { key: "status", label: t("Status"), sort: (u) => userStatus(u), render: (u) => <SeverityPill sev={SEV[userStatus(u)]} label={userStatusText(userStatus(u))} /> },
    { key: "last", label: t("Last sign-in"), sort: (u) => u.last_login ?? "", render: (u) => day(u.last_login) },
  ];

  const doBulk = async (action: BulkAction) => {
    const r = await run(() => bulkUsers([...picked], action), t("Bulk action finished."), ["users"]);
    if (r) { setNotice(t("{ok} done, {bad} failed.", { ok: r.succeeded, bad: r.failed })); setPicked(new Set()); }
  };

  const doAsk = (a: NonNullable<Ask>) => {
    if (a.kind === "bulk") return void doBulk(a.action);
    const u = a.user;
    if (a.kind === "remove") void run(() => removeUser(u.id), t("User removed."), ["users"]);
    else void run(() => setUserActive(u.id, a.kind === "reactivate"), a.kind === "reactivate" ? t("User reactivated.") : t("User suspended."), ["users"]);
    setOpen(null);
  };

  const blocked = ask && ask.kind !== "bulk" && ask.kind !== "reactivate" ? removeBlock(ask.user, all, null) : null;
  const blockText = blocked === "self" ? t("You cannot do this to your own account.") : blocked === "last-admin" ? t("This is the last active administrator.") : null;

  return (
    <Frame
      slug="users"
      title={t("Users")}
      lead={t("Who can sign in, what they hold, and what is waiting on you.")}
      loading={users.isLoading}
      error={users.isError}
      actions={editable ? (
        <span className="mx-links">
          <Button variant="secondary" type="button" onClick={() => setImporting(true)}>{t("Import CSV")}</Button>
          <Button variant="primary" type="button" onClick={() => setInvite(true)} disabled={seatsFull(seats)}>{t("Invite someone")}</Button>
        </span>
      ) : undefined}
    >
      <div className="mx-tiles">
        <StatTile label={t("Seats")} value={seatsText(seats)} bar={seats.limit ? Math.min(100, (seats.used / seats.limit) * 100) : undefined} />
        <StatTile label={t("People")} value={String(all.length)} />
        <StatTile label={t("Open access requests")} value={String(openReqs.length)} />
      </div>
      {seatsFull(seats) && <p role="alert">{t("Every seat is in use. Suspend or remove someone before inviting.")}</p>}
      {!seatsFull(seats) && seatsNearlyFull(seats) && <p>{t("Seats are nearly full.")}</p>}
      {attentionText && <p role="status">{attentionText}</p>}
      {notice && <p role="status">{notice}</p>}

      {openReqs.length > 0 && (
        <Card title={t("Access requests")} sub={t("{n} waiting", { n: openReqs.length })}>
          <ul className="mx-col">
            {openReqs.map((r) => (
              <li key={r.id} className="mx-links">
                <span>{byId.get(r.user_id)?.name ?? r.user_id}</span>
                <Code code={`${r.resource}.${r.action}`} description={labelText(r.resource)} />
                {r.module && <span className="mx-muted">{moduleText(r.module)}</span>}
                {r.reason && <span className="mx-muted">{r.reason}</span>}
                {editable && (
                  <>
                    <Button variant="secondary" type="button" disabled={busy} onClick={() => void run(() => decideAccessRequest(r.id, { decision: "granted" }), t("Request granted."), ["users"])}>{t("Grant")}</Button>
                    <Button variant="ghost" type="button" disabled={busy} onClick={() => void run(() => decideAccessRequest(r.id, { decision: "declined" }), t("Request declined."), ["users"])}>{t("Decline")}</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t("People")} sub={t("{n} shown", { n: rows.length })}>
        <div className="mx-links">
          <Field label={t("Search")}><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label={t("Role")}>
            <Select value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: "", label: t("Any role") }, ...(roles.data ?? []).map((r) => ({ value: r.key, label: tx(r.name) }))]} />
          </Field>
          <Field label={t("Status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as UserStatus | "")} options={[{ value: "", label: t("Any status") }, ...USER_STATUSES.map((s) => ({ value: s, label: tx(STATUS_LABEL[s]) }))]} />
          </Field>
        </div>
        {editable && picked.size > 0 && (
          <div className="mx-links" role="group" aria-label={t("Bulk actions")}>
            <span>{t("{n} selected", { n: picked.size })}</span>
            {(["suspend", "reactivate", "resend", "reset"] as const).map((a) => (
              <Button key={a} variant="secondary" type="button" disabled={busy} onClick={() => setAsk({ kind: "bulk", action: a })}>
                {a === "suspend" ? t("Suspend") : a === "reactivate" ? t("Reactivate") : a === "resend" ? t("Resend invites") : t("Reset passwords")}
              </Button>
            ))}
          </div>
        )}
        {rows.length === 0 ? <EmptyState heading={t("No one matches")} body={t("Clear a filter to see more people.")} /> : <DataTable columns={cols} rows={rows} rowKey={(u) => u.id} label={t("People")} />}
      </Card>

      <Invite open={invite} onClose={() => setInvite(false)} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
      <Person user={open} editable={editable} all={all} onClose={() => setOpen(null)} onAsk={setAsk} />

      <Confirm
        open={!!ask}
        danger={ask?.kind === "remove" || ask?.kind === "suspend"}
        title={ask?.kind === "remove" ? t("Remove this person?") : ask?.kind === "suspend" ? t("Suspend this person?") : ask?.kind === "reactivate" ? t("Reactivate this person?") : t("Apply to {n} people?", { n: picked.size })}
        confirmLabel={t("Confirm")}
        cancelLabel={t("Cancel")}
        onCancel={() => setAsk(null)}
        onConfirm={() => { const a = ask; if (!a || blockText) return; setAsk(null); doAsk(a); }}
      >
        {blockText ? <p role="alert">{blockText}</p> : <p>{ask && ask.kind !== "bulk" ? ask.user.name : t("Each person is handled on its own, and failures are listed afterwards.")}</p>}
      </Confirm>
    </Frame>
  );
}

function Invite({ open, onClose }: { open: boolean; onClose: () => void }) {
  const roles = useRoles();
  const { run, busy } = useAct();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const send = async () => {
    const r = await run(() => inviteUser({ email: email.trim(), name: name.trim() || undefined, grants: [{ role_key: role }] }), t("Invitation sent."), ["users"]);
    if (r) { setEmail(""); setName(""); setRole(""); onClose(); }
  };
  return (
    <Sheet open={open} onClose={onClose} label={t("Invite someone")} closeLabel={t("Close")}>
      <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <Field label={t("Email")}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t("Name")} hint={t("Optional.")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("Role")}>
          <Select value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: "", label: t("Choose a role") }, ...(roles.data ?? []).map((r) => ({ value: r.key, label: tx(r.name) }))]} />
        </Field>
        <div><Button variant="primary" type="submit" disabled={busy || !email.includes("@") || !role}>{t("Send invitation")}</Button></div>
      </form>
    </Sheet>
  );
}

function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, busy } = useAct();
  const [csv, setCsv] = useState("");
  const [prev, setPrev] = useState<ImportPreview | null>(null);
  const check = async () => { const r = await run(() => previewUserImport(csv), t("File checked."), []); if (r) setPrev(r); };
  const go = async () => { const r = await run(() => importUsers(csv), t("Users imported."), ["users"]); if (r) { setCsv(""); setPrev(null); onClose(); } };
  const cols: Column<ImportPreview["rows"][number]>[] = [
    { key: "line", label: t("Line"), render: (r) => r.line },
    { key: "email", label: t("Email"), render: (r) => r.email },
    { key: "role", label: t("Role"), render: (r) => <Code code={r.role} description={roleText(r.role)} /> },
    { key: "ok", label: t("Result"), render: (r) => (r.ok ? t("Accepted") : r.error ? tx(r.error) : t("Rejected")) },
  ];
  return (
    <Sheet open={open} onClose={onClose} label={t("Import users")} closeLabel={t("Close")}>
      <div className="mx-col">
        <Field label={t("CSV with email, name and role")} hint={t("One person per line, with a header row.")}>
          <textarea className="mx-input" rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setPrev(null); }} />
        </Field>
        <div className="mx-links">
          <Button variant="secondary" type="button" disabled={busy || !csv.trim()} onClick={() => void check()}>{t("Check file")}</Button>
          <Button variant="primary" type="button" disabled={busy || !prev || prev.accepted === 0 || !prev.seats.ok} onClick={() => void go()}>{t("Import")}</Button>
        </div>
        {prev && (
          <>
            <p>{t("{ok} accepted, {bad} rejected.", { ok: prev.accepted, bad: prev.rejected })}</p>
            {!prev.seats.ok && <p role="alert">{t("Not enough seats for this file.")}</p>}
            <DataTable columns={cols} rows={prev.rows} rowKey={(r) => String(r.line)} label={t("Import preview")} height={240} />
          </>
        )}
      </div>
    </Sheet>
  );
}

function Person({ user, editable, all, onClose, onAsk }: { user: User | null; editable: boolean; all: User[]; onClose: () => void; onAsk: (a: Ask) => void }) {
  const id = user?.id ?? "";
  const grants = useGrants(id, !!user);
  const eff = useEffective(id, !!user);
  const roles = useRoles(!!user);
  const { run, busy } = useAct();
  const [role, setRole] = useState("");
  const [system, setSystem] = useState("");
  const [module, setModule] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const preview = useGrantPreview(id, role, system, module);
  const s = user ? userStatus(user) : "active";
  const pending = s === "invited" || s === "invite_expired";
  const added = preview.data?.diff.added_actions ?? [];
  if (!user) return <Sheet open={false} onClose={onClose} label="" closeLabel="">{null}</Sheet>;
  void all;

  const cols: Column<NonNullable<typeof grants.data>[number]>[] = [
    { key: "role", label: t("Role"), render: (g) => <Code code={g.role_key} description={roleText(g.role_key)} /> },
    { key: "scope", label: t("Scope"), render: (g) => [g.system_id ?? t("All systems"), g.module ? moduleText(g.module) : t("All objects")].join(", ") },
    { key: "exp", label: t("Expires"), render: (g) => (g.expires_at ? day(g.expires_at) : t("Never")) },
    { key: "act", label: "", render: (g) => editable ? <Button variant="ghost" type="button" disabled={busy} onClick={() => void run(() => removeGrant(id, g.id), t("Grant removed."), ["users"])}>{t("Remove")}</Button> : null },
  ];

  return (
    <Sheet open onClose={onClose} label={user.name} closeLabel={t("Close")}>
      <div className="mx-col">
        <Facts items={[
          [t("Email"), user.email],
          [t("Status"), <SeverityPill key="s" sev={SEV[s]} label={userStatusText(s)} />],
          [t("Last sign-in"), day(user.last_login)],
          [t("Effective actions"), String(eff.data?.actions.length ?? 0)],
        ]} />
        {shown && <p><code className="mx-code">{shown}</code></p>}
        {editable && (
          <div className="mx-links">
            {pending && <Button variant="secondary" type="button" disabled={busy} onClick={() => void run(() => resendInvite(id), t("Invitation sent again."), ["users"])}>{t("Resend invite")}</Button>}
            {pending && <Button variant="secondary" type="button" disabled={busy} onClick={async () => { const r = await run(() => createInviteLink(id), t("Invite link created."), []); if (r) setShown(r.url); }}>{t("Invite link")}</Button>}
            {!pending && <Button variant="secondary" type="button" disabled={busy} onClick={() => void run(() => resetUserPassword(id, true), t("Reset email sent."), ["users"])}>{t("Email a reset")}</Button>}
            {!pending && <Button variant="secondary" type="button" disabled={busy} onClick={async () => { const r = await run(() => setUserPassword(id, { generate: true }), t("Password set. Copy it now."), ["users"]); if (r?.password) setShown(r.password); }}>{t("Set a password")}</Button>}
            {user.is_active
              ? <Button variant="ghost" type="button" onClick={() => onAsk({ kind: "suspend", user })}>{t("Suspend")}</Button>
              : <Button variant="ghost" type="button" onClick={() => onAsk({ kind: "reactivate", user })}>{t("Reactivate")}</Button>}
            <Button variant="ghost" type="button" onClick={() => onAsk({ kind: "remove", user })}>{t("Remove")}</Button>
          </div>
        )}
        <Card title={t("Grants")} sub={t("{n} grants", { n: grants.data?.length ?? 0 })}>
          {(grants.data ?? []).length === 0 ? <EmptyState heading={t("No grants")} body={t("This person holds no role yet.")} /> : <DataTable columns={cols} rows={grants.data ?? []} rowKey={(g) => g.id} label={t("Grants")} height={200} />}
        </Card>
        {editable && (
          <Card title={t("Add a grant")} sub={t("The preview shows what changes before you save.")}>
            <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => addGrant(id, { role_key: role, system_id: system || null, module: module || null }), t("Grant added."), ["users"]).then((r) => { if (r) setRole(""); }); }}>
              <Field label={t("Role")}>
                <Select value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: "", label: t("Choose a role") }, ...(roles.data ?? []).map((r) => ({ value: r.key, label: tx(r.name) }))]} />
              </Field>
              <Field label={t("System id")} hint={t("Leave empty for every system.")}><Input value={system} onChange={(e) => setSystem(e.target.value)} /></Field>
              <Field label={t("Object")} hint={t("Leave empty for every object.")}><Input value={module} onChange={(e) => setModule(e.target.value)} /></Field>
              {role && <p className="mx-muted">{added.length ? t("Adds: {list}", { list: added.map((a) => labelText(a)).join(", ") }) : t("Adds nothing new.")}</p>}
              <div><Button variant="primary" type="submit" disabled={busy || !role}>{t("Add grant")}</Button></div>
            </form>
          </Card>
        )}
      </div>
    </Sheet>
  );
}
