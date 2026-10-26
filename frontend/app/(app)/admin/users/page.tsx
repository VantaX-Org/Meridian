"use client";
import { useUrlState } from "@/hooks/use-url-state";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, Menu, Notice, PageHeader, Pill, Skeleton, Stat, Async, IconButton, IconMore, Tooltip, toast } from "@/design";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { downloadCsv } from "@/lib/actions";
import { getSystems } from "@/lib/api/connectivity";
import { listGrants, listRoles } from "@/lib/api/roles";
import { apiErrorDetail, apiErrorMessage } from "@/lib/error";
import { deleteUser, getAssignableUsers, getUsers, updateUser } from "@/lib/api/users";
import { InviteForm } from "@/components/admin/invite-form";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { User } from "@/types/api";
import { grantLabel, roleLabel } from "@/lib/roles";

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

export default function AdminUsersPage() {
  // Old links: ?tab=roles (the retired role matrix) and ?tab=audit point at the pages that own them now.
  const [tabRaw] = useUrlState("tab", "users");
  const { can, loading } = useRole();
  const canManage = can("manage_users");
  const [invite, setInvite] = useState(false);

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
        meta="Who can sign in and which roles each person holds. Invite people or suspend someone's access"
        actions={
          <>
            <Button variant="secondary" render={<Link href="/admin/roles">Roles and access</Link>} />
            <Button variant="secondary" render={<Link href="/admin/audit">Audit log</Link>} />
            <Button onClick={() => setInvite(true)}>Invite user</Button>
          </>
        }
      />
      {tabRaw === "audit" ? <EmptyState variant="inline" title="The audit log has its own page" action={<Button render={<Link href="/admin/audit">Open the audit log</Link>} />} /> : null}
      {tabRaw === "roles" ? <EmptyState variant="inline" title="Roles are managed under Roles and access" action={<Button render={<Link href="/admin/roles">Open roles and access</Link>} />} /> : null}
      <p className="m-text-body m-ink-3">
        Roles are given and taken back as grants, for every system or for one system or object, under <Link href="/admin/roles" className="m-ink-accent underline underline-offset-2">Roles and access</Link>.
      </p>
      <UsersView invite={invite} setInvite={setInvite} />
    </div>
  );
}

function UsersView({ invite, setInvite }: { invite: boolean; setInvite: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | null>(null);

  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers });
  const users = useMemo(() => usersQ.data?.users ?? [], [usersQ.data]);
  const active = users.filter((u) => u.is_active);
  const neverSignedIn = active.filter((u) => !u.last_login).length;
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.users() });

  const del = useMutation({
    mutationFn: (u: User) => deleteUser(u.id),
    onSuccess: (_, u) => { toast.success(`${u.name} removed`); setEditing(null); refresh(); },
    onError: (e) => toast.error(
      (e as { response?: { status?: number } }).response?.status === 409 && !apiErrorDetail(e)?.includes("last active admin")
        ? "This user is referenced by audit or stewardship records, deactivate them instead"
        : `Not removed. ${apiErrorMessage(e)}`,
    ),
  });

  const columns = useMemo<ColumnDef<User, unknown>[]>(() => [
    {
      id: "user", header: "User",
      cell: ({ row }) => <span><strong>{row.original.name}</strong><div className="m-text-meta m-ink-3">{row.original.email}</div></span>,
    },
    { id: "role", header: "Roles", cell: ({ row }) => <span>{grantNames(row.original)}</span> },
    { id: "active", header: "Status", cell: ({ row }) => <Pill tone={row.original.is_active ? "go" : "neutral"}>{row.original.is_active ? "Active" : "Suspended"}</Pill> },
    { id: "login", header: "Last sign-in", cell: ({ row }) => row.original.last_login ? relativeTime(row.original.last_login) : "Never" },
    { id: "since", header: "Member since", cell: ({ row }) => relativeTime(row.original.created_at) },
    {
      id: "actions", header: "Action",
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu
            trigger={<IconButton type="button" size="sm" aria-label={`Actions for ${row.original.name}`}><IconMore size={16} /></IconButton>}
            items={[{ label: "Edit", onSelect: () => setEditing(row.original) }]}
          />
        </span>
      ),
    },
  ], []);

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex gap-4">
        <Stat label="Never signed in" value={usersQ.isLoading ? undefined : neverSignedIn} />
      </div>

      <Async query={usersQ} skeleton={240}>{users.length ? (
        <DataTable
          columns={columns}
          data={users}
          getRowId={(u) => u.id}
          onRowClick={(u) => setEditing(u)}
          tableId="admin-users"
          exportOptions={[{
            format: "csv",
            label: "Export users",
            run: async () => downloadCsv("meridian-users.csv", users.map((u) => ({ name: u.name, email: u.email, roles: grantNames(u), active: u.is_active, last_login: u.last_login ?? "" }))),
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
    </div>
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
