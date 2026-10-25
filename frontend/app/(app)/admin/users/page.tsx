"use client";
import { useUrlState } from "@/hooks/use-url-state";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, Field, Menu, Notice, PageHeader, Pill, Select, Skeleton, Stat, Async, IconMore, Tooltip, toast } from "@/design";
import { useAuth } from "@/context/auth-context";
import { permissionLabel } from "@/components/admin/role-matrix";
import { useRole } from "@/hooks/use-role";
import { downloadCsv } from "@/lib/actions";
import { getRoleMatrix } from "@/lib/api/auth";
import { apiErrorDetail, apiErrorMessage } from "@/lib/error";
import { deleteUser, getAssignableUsers, getUsers, updateUser } from "@/lib/api/users";
import { InviteForm } from "@/components/admin/invite-form";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { User, UserRole } from "@/types/api";

// ponytail: getAssignableUsers() is unused here, same as the legacy component it replaces.
void getAssignableUsers;

const ROLES: UserRole[] = [
  "admin", "manager", "steward", "ai_reviewer", "approver", "analyst", "viewer", "auditor", "process_analyst",
  "programme_lead", "data_steward", "data_owner", "sap_basis", "platform_admin",
];
const ROLE_META: Record<UserRole, { label: string; desc: string }> = {
  admin: { label: "Admin", desc: "Full access. Manage users and rules, approve proposed rules." },
  manager: { label: "Manager", desc: "Run the programme. Connect systems, sync, analyse, approve, apply and assign work." },
  steward: { label: "Steward", desc: "Own the data. Fix, clean, approve and apply, maintain rules and assign work." },
  ai_reviewer: { label: "AI Reviewer", desc: "Review and approve proposed rules from steward corrections." },
  approver: { label: "Approver", desc: "Four-eyes approval of cleaning, golden records and stewardship changes." },
  analyst: { label: "Analyst", desc: "Upload, sync and run analysis; export results. No approvals." },
  viewer: { label: "Viewer", desc: "Read-only access to dashboards and findings." },
  auditor: { label: "Auditor", desc: "Read-only access including the audit log." },
  process_analyst: { label: "Process analyst", desc: "Read everything, run process discovery and export as-is process models." },
  // Persona keys (rbac.py PERSONA_ROLES): each carries the actions of the legacy role it replaces.
  programme_lead: { label: "Programme lead / CIO", desc: "Same access as Manager. Lands on the lead home." },
  data_steward: { label: "Data steward", desc: "Same access as Steward. Lands on the steward home." },
  data_owner: { label: "Data owner / approver", desc: "Same access as Approver. Lands on the steward home." },
  sap_basis: { label: "SAP Basis / integration admin", desc: "Analyst access plus connecting systems, sync and field mapping. Lands on the basis home." },
  platform_admin: { label: "Platform admin", desc: "Same access as Admin, including platform updates." },
};
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_META[r].label }));
/** Why your own row's role, Active and Remove are locked (the API refuses them too: api/routes/users.py). */
const SELF_ACCESS_REASON = "You can't change your own access";

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
        meta="Who can sign in and what each person may do. Invite people, change a role, or suspend someone's access"
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
        What each role may do, and roles granted for one system or object, are set under <Link href="/admin/roles" className="m-ink-accent hover:underline">Roles and access</Link>.
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
    { id: "role", header: "Role", cell: ({ row }) => <span>{ROLE_META[row.original.role]?.label ?? row.original.role}</span> },
    { id: "active", header: "Status", cell: ({ row }) => <Pill tone={row.original.is_active ? "go" : "neutral"}>{row.original.is_active ? "Active" : "Suspended"}</Pill> },
    { id: "login", header: "Last sign-in", cell: ({ row }) => row.original.last_login ? relativeTime(row.original.last_login) : "Never" },
    { id: "since", header: "Member since", cell: ({ row }) => relativeTime(row.original.created_at) },
    {
      id: "actions", header: "Action",
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu
            trigger={<button aria-label={`Actions for ${row.original.name}`}><IconMore size={16} /></button>}
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
            run: async () => downloadCsv("meridian-users.csv", users.map((u) => ({ name: u.name, email: u.email, role: u.role, active: u.is_active, last_login: u.last_login ?? "" }))),
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

/** The actions a role gains and loses when it changes, in words, for the confirmation. */
function roleChangeSentence(matrix: Record<string, string[]> | undefined, from: UserRole, to: UserRole): string {
  const a = new Set(matrix?.[from] ?? []);
  const b = new Set(matrix?.[to] ?? []);
  const gained = [...b].filter((x) => !a.has(x)).map(permissionLabel);
  const lost = [...a].filter((x) => !b.has(x)).map(permissionLabel);
  const words = (xs: string[]) => xs.slice(0, 6).join(", ") + (xs.length > 6 ? ` and ${xs.length - 6} more` : "");
  if (!matrix) return "The role's permissions change at once.";
  return `${gained.length ? `Gains: ${words(gained)}.` : "Gains nothing new."} ${lost.length ? `Loses: ${words(lost)}.` : "Loses nothing."}`;
}

function EditForm({ user, onDone, onRemove, removing }: { user: User; onDone: () => void; onRemove: () => void; removing: boolean }) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setActive] = useState(user.is_active);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { user: me } = useAuth();
  const self = !!me && me.id === user.id;
  const matrixQ = useQuery({ queryKey: queryKeys.authRoles(), queryFn: getRoleMatrix });
  const m = useMutation({
    mutationFn: () => updateUser(user.id, { role, is_active: isActive }),
    onSuccess: () => { toast.success(`${user.name} saved`); setConfirmSave(false); onDone(); },
    onError: (e) => toast.error(`Not saved. ${apiErrorMessage(e)}`),
  });
  const roleChanged = role !== user.role;
  const suspending = user.is_active && !isActive;
  const reactivating = !user.is_active && isActive;
  const consequential = roleChanged || suspending;
  const body = [
    suspending ? `${user.name} can no longer sign in; their history stays attributed to them.` : reactivating ? `${user.name} can sign in again.` : "",
    roleChanged ? `Role ${ROLE_META[user.role].label} to ${ROLE_META[role].label}. ${roleChangeSentence(matrixQ.data, user.role, role)}` : "",
  ].filter(Boolean).join(" ");

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (consequential) setConfirmSave(true); else m.mutate(); }}>
      <p className="m-text-body m-ink-3">{user.email}</p>
      {self ? <Notice tone="info">{SELF_ACCESS_REASON}. Another admin can change your role or access.</Notice> : null}
      {self ? (
        <div className="flex flex-col gap-1">
          <span className="m-text-label m-ink-3">Role</span>
          <span className="m-text-body">{ROLE_META[role]?.label ?? role}</span>
        </div>
      ) : (
        <Field label="Role">
          <Select options={ROLE_OPTIONS} value={role} onValueChange={(v) => setRole(v as UserRole)} />
        </Field>
      )}
      <p className="m-text-meta m-ink-3">{ROLE_META[role].desc}</p>
      <p className="m-text-meta m-ink-3">Scoped grants (a role at one system or module) are managed under <Link href={`/admin/roles?tab=users&user=${encodeURIComponent(user.id)}`} className="underline">Roles and access</Link>.</p>
      <label className="flex items-center gap-2 m-text-body">
        <Checkbox aria-label="Active" checked={isActive} disabled={self} title={self ? SELF_ACCESS_REASON : undefined} onChange={(e) => setActive(e.target.checked)} />
        <span>Active, {isActive ? "this user can sign in" : "sign-in is blocked"}</span>
      </label>
      <div className="flex gap-2">
        <Button type="submit" pending={m.isPending}>Save</Button>
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
        title={suspending ? `Suspend ${user.name}` : `Change the role of ${user.name}`}
        body={body}
        confirmLabel={suspending ? "Suspend and save" : "Change role"}
        cancelLabel="Keep as is"
        tone={suspending ? "danger" : "default"}
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
