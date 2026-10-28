"use client";
import { useUrlState } from "@/hooks/use-url-state";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Checkbox, ChoiceGroup, ConfirmDialog, DataTable, Dialog, Drawer, EmptyState, Field, Input, Menu, Notice, PageHeader, Pill, Select, Skeleton, Async, IconButton, IconMore, Tooltip, toast, type CellMeta } from "@/design";
import { useAuth } from "@/context/auth-context";
import { ImportUsersDrawer } from "@/components/admin/import-users-drawer";
import { useSeats } from "@/components/admin/use-seats";
import { UserStatusPill } from "@/components/admin/user-status-pill";
import { useRole } from "@/hooks/use-role";
import { downloadCsv } from "@/lib/actions";
import { getSystems } from "@/lib/api/connectivity";
import { listGrants, listRoles } from "@/lib/api/roles";
import { apiErrorDetail, apiErrorMessage } from "@/lib/error";
import {
  bulkUsers, createInviteLink, deleteUser, getAssignableUsers, getUsers, resendInvite, resetPassword, searchUsers, updateUser,
  type BulkAction, type UserFilters,
} from "@/lib/api/users";
import { InviteForm } from "@/components/admin/invite-form";
import { formatDate, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { User } from "@/types/api";
import { grantLabel, roleLabel } from "@/lib/roles";
import {
  STATUS_LABEL, inviteAttention, inviteAttentionSentence, isUserStatus, seatsFull, seatsNearlyFull, seatsSentence, userStatus, USER_STATUSES,
} from "@/lib/users";

// ponytail: getAssignableUsers() is unused here, same as the legacy component it replaces.
void getAssignableUsers;

/** Why your own row's Active and Remove are locked (the API refuses them too: api/routes/users.py). */
const SELF_ACCESS_REASON = "You can't change your own access";

/** Roles and access, opened on this user's grants. */
const manageHref = (id: string) => `/admin/roles?tab=users&user=${encodeURIComponent(id)}`;

/** The table's Roles cell: each granted role once, in grant order; users.role before any grant is listed. */
function grantNames(u: User): string {
  const names = Array.from(new Set((u.grants ?? []).map((g) => g.role_name || roleLabel(g.role_key))));
  return names.length ? names.join(", ") : roleLabel(u.role);
}

/** Copies text for the admin; false when the browser refuses (no permission, insecure page). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const ALL = "__all__";

export default function AdminUsersPage() {
  // Old links: ?tab=roles (the retired role matrix) and ?tab=audit point at the pages that own them now.
  const [tabRaw] = useUrlState("tab", "users");
  const { can, loading } = useRole();
  const canManage = can("manage_users");
  const [invite, setInvite] = useState(false);
  const [importing, setImporting] = useState(false);
  // The header meta counts the people: the same query the users table reads, so it is fetched once.
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers, enabled: canManage && !loading });
  const seats = useSeats(canManage && !loading);
  const usersMeta = usersMetaLine(usersQ.data?.users);
  const attention = inviteAttentionSentence(inviteAttention(usersQ.data?.users ?? []));

  // Grants fail closed while loading; a refusal must not flash before they arrive.
  if (loading) return <div aria-busy="true"><Skeleton height={320} /></div>;
  if (!canManage) {
    return (
      <div>
        <EmptyState title="Only administrators manage users" detail="Ask an administrator to invite someone, change a role or review the audit log." ghost="list" action={<Button variant="secondary" render={<Link href="/home">Back to home</Link>} />} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Users"
        meta={usersMeta ? (
          <>
            <span data-testid="users-meta">{usersMeta}</span>
            {seats ? <>, <span data-testid="seats-meta">{seatsSentence(seats)}</span></> : null}
          </>
        ) : "Who can sign in and which roles each person holds. Invite people or suspend someone's access"}
        actions={
          <>
            <Button variant="secondary" render={<Link href="/admin/roles">Roles and access</Link>} />
            <Button variant="secondary" render={<Link href="/admin/audit">Audit log</Link>} />
            <Button variant="secondary" onClick={() => setImporting(true)}>Import users</Button>
            <Button onClick={() => setInvite(true)}>Invite user</Button>
          </>
        }
      />
      {seats && (seatsFull(seats) || seatsNearlyFull(seats)) ? (
        <Notice tone={seatsFull(seats) ? "danger" : "warning"} title={seatsFull(seats) ? "No seats left" : "Seats are nearly used up"}>
          {seatsSentence(seats)} are in use. An invited person takes a seat at once, so suspend someone or raise the licence before inviting more.
        </Notice>
      ) : null}
      {attention ? <Notice tone="warning" title="Invitations need attention"><span data-testid="invite-attention">{attention}</span>. Resend them or revoke the ones nobody will accept.</Notice> : null}
      {tabRaw === "audit" ? <EmptyState variant="inline" title="The audit log has its own page" action={<Button render={<Link href="/admin/audit">Open the audit log</Link>} />} /> : null}
      {tabRaw === "roles" ? <EmptyState variant="inline" title="Roles are managed under Roles and access" action={<Button render={<Link href="/admin/roles">Open roles and access</Link>} />} /> : null}
      <p className="m-text-body m-ink-3">
        Roles are given and taken back as grants, for every system or for one system or object, under <Link href="/admin/roles" className="m-ink-accent underline underline-offset-2">Roles and access</Link>.
      </p>
      <UsersView invite={invite} setInvite={setInvite} />
      <ImportUsersDrawer open={importing} onOpenChange={setImporting} />
    </div>
  );
}

/** "3 users, 2 never signed in": the header line; undefined until the users are known. */
function usersMetaLine(users: User[] | undefined): string | undefined {
  if (!users) return undefined;
  const never = users.filter((u) => userStatus(u) === "active" && !u.last_login).length;
  const count = `${users.length.toLocaleString()} ${users.length === 1 ? "user" : "users"}`;
  return never ? `${count}, ${never.toLocaleString()} never signed in` : count;
}

const BULK_DONE: Record<BulkAction, string> = {
  suspend: "Suspended", reactivate: "Reactivated", resend: "Invitation sent to", reset: "Password reset email sent to",
};

function UsersView({ invite, setInvite }: { invite: boolean; setInvite: (open: boolean) => void }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [editing, setEditing] = useState<User | null>(null);
  const [revoking, setRevoking] = useState<User | null>(null);
  const [removing, setRemoving] = useState<User | null>(null);
  const [suspending, setSuspending] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [bulkSuspend, setBulkSuspend] = useState<User[] | null>(null);

  // The filters are the URL: a link to a filtered list opens the same list.
  const [q, setQ] = useUrlState("q", "");
  const [statusRaw, setStatus] = useUrlState("status", "");
  const [role, setRole] = useUrlState("role", "");
  const [system, setSystem] = useUrlState("system", "");
  const status = isUserStatus(statusRaw) ? statusRaw : "";
  const [qInput, setQInput] = useState(q);
  useEffect(() => {
    if (qInput === q) return;
    const t = setTimeout(() => setQ(qInput), 300);
    return () => clearTimeout(t);
  }, [qInput, q, setQ]);

  const filters = useMemo<UserFilters>(() => ({
    ...(q.trim() ? { q: q.trim() } : {}), ...(status ? { status } : {}), ...(role ? { role } : {}), ...(system ? { system_id: system } : {}),
  }), [q, status, role, system]);
  const filtered = Object.keys(filters).length > 0;

  const allQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers });
  const listQ = useQuery({ queryKey: [...queryKeys.users(), "filtered", filters], queryFn: () => searchUsers(filters), enabled: filtered });
  const usersQ = filtered ? listQ : allQ;
  const users = useMemo(() => usersQ.data?.users ?? [], [usersQ.data]);
  const everyone = allQ.data?.users ?? users;
  const nameOf = (id: string) => everyone.find((u) => u.id === id)?.name ?? "A user";
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.users() });

  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: listRoles });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const roleOptions = [{ value: ALL, label: "Any role" }, ...(rolesQ.data ?? []).map((r) => ({ value: r.key, label: r.name }))];
  const systemOptions = [{ value: ALL, label: "Any system" }, ...(systemsQ.data ?? []).map((s) => ({ value: s.id, label: s.name }))];

  const del = useMutation({
    mutationFn: (u: User) => deleteUser(u.id),
    onSuccess: (_, u) => { toast.success(`${u.name} removed`); setEditing(null); setRemoving(null); setRevoking(null); refresh(); },
    onError: (e) => toast.error(
      (e as { response?: { status?: number } }).response?.status === 409 && !apiErrorDetail(e)?.includes("last active admin")
        ? "This user is referenced by audit or stewardship records, deactivate them instead"
        : `Not removed. ${apiErrorMessage(e)}`,
    ),
  });
  const resend = useMutation({
    mutationFn: (u: User) => resendInvite(u.id),
    onSuccess: (_, u) => { toast.success(`Invitation sent to ${u.email}`); refresh(); },
    onError: (e) => toast.error(`Invitation not sent. ${apiErrorMessage(e)}`),
  });
  const copyLink = useMutation({
    mutationFn: async (u: User) => {
      const link = await createInviteLink(u.id);
      return { ...link, copied: await copyText(link.url) };
    },
    onSuccess: (r, u) => {
      if (r.copied) toast.success(`Invite link for ${u.email} copied. It works until ${formatDate(r.expires_at)}`);
      else toast.error("The link was made but your browser would not copy it. Try again from a secure page.");
      refresh();
    },
    onError: (e) => toast.error(`Link not made. ${apiErrorMessage(e)}`),
  });
  const setActive = useMutation({
    mutationFn: (v: { user: User; active: boolean }) => updateUser(v.user.id, { is_active: v.active }),
    onSuccess: (_, v) => { toast.success(`${v.user.name} ${v.active ? "can sign in again" : "suspended"}`); setSuspending(null); refresh(); },
    onError: (e, v) => toast.error(`${v.active ? "Not reactivated" : "Not suspended"}. ${apiErrorMessage(e)}`),
  });
  const bulk = useMutation({
    mutationFn: (v: { ids: string[]; action: BulkAction }) => bulkUsers(v.ids, v.action),
    onSuccess: (r) => {
      // One line for the people it worked for, one toast for each person it did not.
      const done = r.results.filter((x) => x.ok).map((x) => nameOf(x.id));
      if (done.length) toast.success(`${BULK_DONE[r.action]} ${done.length === 1 ? done[0] : `${done.length.toLocaleString()} people`}`);
      for (const x of r.results) if (!x.ok) toast.error(`${nameOf(x.id)}: ${x.error ?? "Not changed"}`);
      setSelection({});
      setBulkSuspend(null);
      refresh();
    },
    onError: (e) => toast.error(`Nothing was changed. ${apiErrorMessage(e)}`),
  });

  const rowItems = (u: User) => {
    const status = userStatus(u);
    const self = !!me && me.id === u.id;
    const items: { label: string; onSelect: () => void; disabled?: boolean }[] = [{ label: "Edit", onSelect: () => setEditing(u) }];
    if (status === "invited" || status === "invite_expired") {
      items.push(
        { label: "Resend invite", onSelect: () => resend.mutate(u) },
        { label: "Copy invite link", onSelect: () => copyLink.mutate(u) },
        { label: "Revoke invite", onSelect: () => setRevoking(u) },
      );
      return items;
    }
    if (status === "suspended") items.push({ label: "Reactivate", onSelect: () => setActive.mutate({ user: u, active: true }), disabled: self });
    else items.push(
      { label: "Reset password", onSelect: () => setResetting(u), disabled: self },
      { label: "Suspend", onSelect: () => setSuspending(u), disabled: self },
    );
    items.push({ label: "Remove", onSelect: () => setRemoving(u), disabled: self });
    return items;
  };

  const columns = useMemo<ColumnDef<User, unknown>[]>(() => [
    {
      // One line: the name, then the email in quiet ink, so the row keeps its height.
      id: "user", header: "User", meta: { sticky: "start" } satisfies CellMeta,
      cell: ({ row }) => (
        <span className="flex min-w-0 max-w-[420px] items-baseline gap-2 whitespace-nowrap" title={row.original.email}>
          <strong className="truncate">{row.original.name}</strong>
          <span className="m-text-meta m-ink-3 truncate">{row.original.email}</span>
        </span>
      ),
    },
    { id: "role", header: "Roles", cell: ({ row }) => <span>{grantNames(row.original)}</span> },
    { id: "active", header: "Status", cell: ({ row }) => <UserStatusPill user={row.original} /> },
    { id: "login", header: "Last sign-in", cell: ({ row }) => row.original.last_login ? relativeTime(row.original.last_login) : "Never" },
    { id: "since", header: "Member since", meta: { priority: "low" } satisfies CellMeta, cell: ({ row }) => relativeTime(row.original.created_at) },
    {
      id: "actions", header: "Action", meta: { sticky: "end" } satisfies CellMeta,
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu
            trigger={<IconButton type="button" size="sm" aria-label={`Actions for ${row.original.name}`}><IconMore size={16} /></IconButton>}
            items={rowItems(row.original)}
          />
        </span>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [me?.id]);

  const clearFilters = () => { setQInput(""); setQ(""); setStatus(""); setRole(""); setSystem(""); };
  const runBulk = (rows: User[], action: BulkAction) => bulk.mutate({ ids: rows.map((u) => u.id), action });

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-wrap items-end gap-3" role="search" aria-label="Filter users">
        <Field label="Search"><Input type="search" value={qInput} placeholder="Name or email" onChange={(e) => setQInput(e.target.value)} /></Field>
        <Field label="Role">
          <Select options={roleOptions} value={role || ALL} onValueChange={(v) => setRole(v === ALL ? "" : v)} />
        </Field>
        <Field label="System">
          <Select options={systemOptions} value={system || ALL} onValueChange={(v) => setSystem(v === ALL ? "" : v)} />
        </Field>
        {filtered ? <Button variant="ghost" onClick={clearFilters}>Clear filters</Button> : null}
      </div>
      <ChoiceGroup
        label="Status" showLabel
        options={[{ value: "all", label: "All" }, ...USER_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
        value={status || "all"}
        onChange={(v) => setStatus(v === "all" ? "" : v)}
      />

      <Async query={usersQ} skeleton={240}>{users.length || filtered ? (
        <DataTable
          columns={columns}
          data={users}
          getRowId={(u) => u.id}
          onRowClick={(u) => setEditing(u)}
          tableId="admin-users"
          hideSearch
          rowLabel={(u) => u.name}
          emptyMessage="No one matches these filters"
          selection={selection}
          onSelectionChange={setSelection}
          bulkActions={(rows) => (
            <>
              <Button variant="ghost" disabled={bulk.isPending} onClick={() => runBulk(rows, "resend")}>Resend invites</Button>
              <Button variant="ghost" disabled={bulk.isPending} onClick={() => runBulk(rows, "reset")}>Reset passwords</Button>
              <Button variant="ghost" disabled={bulk.isPending} onClick={() => runBulk(rows, "reactivate")}>Reactivate</Button>
              <Button variant="ghost" disabled={bulk.isPending} onClick={() => setBulkSuspend(rows)}>Suspend</Button>
            </>
          )}
          exportOptions={[{
            format: "csv",
            label: "Export users",
            run: async () => downloadCsv("meridian-users.csv", users.map((u) => ({ name: u.name, email: u.email, roles: grantNames(u), status: STATUS_LABEL[userStatus(u)], active: u.is_active, last_login: u.last_login ?? "" }))),
          }]}
        />
      ) : (
        <EmptyState title="No users yet" detail="Invite the first steward or analyst." action={<Button onClick={() => setInvite(true)}>Invite user</Button>}/>
      )}</Async>

      <Drawer open={invite} onOpenChange={setInvite} title="Invite a user">
        {invite ? <InviteForm onDone={() => { setInvite(false); refresh(); }} /> : null}
      </Drawer>
      <Drawer open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} title={editing?.name ?? "Edit user"}>
        {editing ? (
          <EditForm
            key={editing.id}
            user={editing}
            onDone={() => { setEditing(null); refresh(); }}
            onRemove={() => del.mutate(editing)}
            removing={del.isPending}
          />
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => { if (!o) setRevoking(null); }}
        title={`Revoke the invite for ${revoking?.email ?? ""}`}
        body="The invitation link stops working and the person is removed from the list. You can invite them again later."
        confirmLabel="Revoke invite"
        cancelLabel="Keep invite"
        tone="danger"
        pending={del.isPending}
        onConfirm={() => revoking && del.mutate(revoking)}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title={`Remove ${removing?.name ?? "user"}`}
        body={`${removing?.name ?? "This user"} loses access at once. A user referenced by audit or stewardship records cannot be removed; suspend them instead.`}
        confirmLabel="Remove user"
        cancelLabel="Keep user"
        tone="danger"
        typeToConfirm={removing?.email}
        pending={del.isPending}
        onConfirm={() => removing && del.mutate(removing)}
      />
      <ConfirmDialog
        open={!!suspending}
        onOpenChange={(o) => { if (!o) setSuspending(null); }}
        title={`Suspend ${suspending?.name ?? "user"}`}
        body={`${suspending?.name ?? "This user"} can no longer sign in; their history stays attributed to them.`}
        confirmLabel="Suspend"
        cancelLabel="Keep active"
        tone="danger"
        pending={setActive.isPending}
        onConfirm={() => suspending && setActive.mutate({ user: suspending, active: false })}
      />
      <ConfirmDialog
        open={!!bulkSuspend}
        onOpenChange={(o) => { if (!o) setBulkSuspend(null); }}
        title={`Suspend ${bulkSuspend?.length.toLocaleString() ?? 0} ${bulkSuspend?.length === 1 ? "user" : "users"}`}
        body="They can no longer sign in; their history stays attributed to them. Anyone the system refuses, such as yourself or the last admin, is skipped and named."
        confirmLabel="Suspend"
        cancelLabel="Keep active"
        tone="danger"
        pending={bulk.isPending}
        onConfirm={() => bulkSuspend && runBulk(bulkSuspend, "suspend")}
      />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} onDone={refresh} />
    </div>
  );
}

/** Force a password change: email the link, or copy a one-time link to hand over. */
function ResetPasswordDialog({ user, onClose, onDone }: { user: User | null; onClose: () => void; onDone: () => void }) {
  const m = useMutation({
    mutationFn: async (v: { user: User; email: boolean }) => {
      const r = await resetPassword(v.user.id, v.email);
      return { ...r, copied: r.link ? await copyText(r.link) : false };
    },
    onSuccess: (r, v) => {
      if (v.email) {
        if (r.emailed) toast.success(`Reset email sent to ${v.user.email}. ${v.user.name} is signed out`);
        else toast.error(`${v.user.name} is signed out, but the email could not be queued. Copy a one-time link instead.`);
      } else if (r.copied) toast.success(`One-time link for ${v.user.email} copied. It works once and ends in 24 hours`);
      else toast.error("The link was made but your browser would not copy it. Try again from a secure page.");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(`Password not reset. ${apiErrorMessage(e)}`),
  });
  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => { if (!o && !m.isPending) onClose(); }}
      title={`Reset the password for ${user?.name ?? ""}`}
      footer={user ? (
        <>
          <Button variant="secondary" disabled={m.isPending} onClick={onClose}>Close</Button>
          <Button variant="secondary" disabled={m.isPending} onClick={() => m.mutate({ user, email: false })}>Copy a one-time link</Button>
          <Button pending={m.isPending} onClick={() => m.mutate({ user, email: true })}>Email the link</Button>
        </>
      ) : null}
    >
      {user ? `${user.name} is signed out everywhere and must choose a new password. Email the link to ${user.email}, or copy a one-time link to hand over yourself.` : null}
    </Dialog>
  );
}

/** The user's grants, read-only: each role with where it applies. Changed under Roles and access. */
function UserGrants({ userId }: { userId: string }) {
  const grantsQ = useQuery({ queryKey: ["grants", userId], queryFn: () => listGrants(userId) });
  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: listRoles });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const roleName = (key: string) => rolesQ.data?.find((r) => r.key === key)?.name;
  const systemName = (id: string | null) => id ? systemsQ.data?.find((s) => s.id === id)?.name ?? "Unknown system" : null;
  return (
    <div className="flex flex-col gap-2">
      <span className="m-text-label m-ink-3">Roles</span>
      <Async query={grantsQ} skeleton={32}>{grantsQ.data?.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Roles granted">
          {grantsQ.data.map((g) => (
            <li key={g.id}><Pill>{grantLabel(roleName(g.role_key), g.role_key, systemName(g.system_id), g.module)}</Pill></li>
          ))}
        </ul>
      ) : (
        <p className="m-text-meta m-ink-3">No roles granted, this user can view only</p>
      )}</Async>
    </div>
  );
}

function EditForm({ user, onDone, onRemove, removing }: { user: User; onDone: () => void; onRemove: () => void; removing: boolean }) {
  const [isActive, setActive] = useState(user.is_active);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { user: me } = useAuth();
  const self = !!me && me.id === user.id;
  const m = useMutation({
    mutationFn: () => updateUser(user.id, { is_active: isActive }),
    onSuccess: () => { toast.success(`${user.name} saved`); setConfirmSave(false); onDone(); },
    onError: (e) => toast.error(`Not saved. ${apiErrorMessage(e)}`),
  });
  const suspending = user.is_active && !isActive;
  const reactivating = !user.is_active && isActive;
  const body = suspending
    ? `${user.name} can no longer sign in; their history stays attributed to them.`
    : reactivating ? `${user.name} can sign in again.` : "";

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (suspending) setConfirmSave(true); else m.mutate(); }}>
      <p className="m-text-body m-ink-3">{user.email}</p>
      {self ? <Notice tone="info">{SELF_ACCESS_REASON}. Another admin can change your roles or access.</Notice> : null}
      <UserGrants userId={user.id} />
      <div>
        <Button type="button" variant="secondary" render={<Link href={manageHref(user.id)}>Manage roles</Link>} />
      </div>
      <label className="flex items-center gap-2 m-text-body">
        <Checkbox aria-label="Active" checked={isActive} disabled={self} title={self ? SELF_ACCESS_REASON : undefined} onChange={(e) => setActive(e.target.checked)} />
        <span>Active, {isActive ? "this user can sign in" : "sign-in is blocked"}</span>
      </label>
      <div className="flex gap-2">
        <Button type="submit" pending={m.isPending} disabled={self || isActive === user.is_active}>Save</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Close</Button>
      </div>
      <p className="m-text-meta m-ink-3">To stop someone signing in but keep their name on past work, untick Active and save instead of removing them.</p>
      <div>
        {self ? (
          <Tooltip label={SELF_ACCESS_REASON} render={<Button type="button" variant="ghost" disabled aria-disabled="true" aria-label={`Remove user. ${SELF_ACCESS_REASON}`} />}>
            Remove user
          </Tooltip>
        ) : (
          <Button type="button" variant="ghost" disabled={removing} onClick={() => setConfirmRemove(true)}>Remove user</Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title={`Suspend ${user.name}`}
        body={body}
        confirmLabel="Suspend and save"
        cancelLabel="Keep as is"
        tone="danger"
        pending={m.isPending}
        onConfirm={() => m.mutate()}
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${user.name}`}
        body={`${user.name} (${user.email}) loses access at once. Their stewardship history stays attributed to them. A user referenced by audit or stewardship records cannot be removed; suspend them instead.`}
        confirmLabel="Remove user"
        cancelLabel="Keep user"
        tone="danger"
        typeToConfirm={user.email}
        pending={removing}
        onConfirm={() => { setConfirmRemove(false); onRemove(); }}
      />
    </form>
  );
}
