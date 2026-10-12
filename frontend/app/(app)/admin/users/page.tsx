"use client";
import { useUrlState } from "@/hooks/use-url-state";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { Button, Card, DataTable, Dialog, Drawer, EmptyState, ErrorState, ExportMenu, Field, Menu, PageHeader, Pill, Select, Skeleton, Stat, Tabs } from "@/design";
import { useRole } from "@/hooks/use-role";
import { downloadCsv } from "@/lib/actions";
import { getRoleMatrix } from "@/lib/api/auth";
import { exportAuditEntries, getAuditEntries, type AuditEntry } from "@/lib/api/audit";
import { apiErrorMessage } from "@/lib/error";
import { deleteUser, getAssignableUsers, getUsers, updateUser } from "@/lib/api/users";
import { InviteForm } from "@/components/admin/invite-form";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { User, UserRole } from "@/types/api";

// ponytail: getAssignableUsers() is unused here, same as the legacy component it replaces.
void getAssignableUsers;

const ROLES: UserRole[] = ["admin", "manager", "steward", "ai_reviewer", "approver", "analyst", "viewer", "auditor", "process_analyst"];
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
};
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_META[r].label }));

export default function AdminUsersPage() {
  const [tabRaw, setTab] = useUrlState("tab", "users");
  const tab = (["users", "roles", "audit"] as string[]).includes(tabRaw) ? tabRaw : "users";
  const { can } = useRole();
  const canManage = can("manage_users");

  if (!canManage) {
    return (
      <div className="p-6">
        <EmptyState title="Needs the manage_users permission" detail="Ask an administrator to change roles or review the audit log." ghost="list" action={<Button variant="secondary" render={<Link href="/home">Back to home</Link>} />} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="Users" meta="Who can sign in, with which role, and what they did" />
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "users", label: "Users", content: <UsersView /> },
          { value: "roles", label: "Roles", content: <RolesView /> },
          { value: "audit", label: "Audit log", content: <AuditView /> },
        ]}
      />
    </div>
  );
  // ponytail: dropped URL-sync for the active tab. Tabs now takes onValueChange, but
  // each view is its own component below and its query only runs once its panel
  // mounts, so a tab switch needs no URL state to work correctly.
}

function UsersView() {
  const qc = useQueryClient();
  const [invite, setInvite] = useState(false);
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
      (e as { response?: { status?: number } }).response?.status === 409
        ? "This user is referenced by audit or stewardship records, deactivate them instead"
        : `Not removed. ${apiErrorMessage(e)}`,
    ),
  });

  const columns = useMemo<ColumnDef<User, unknown>[]>(() => [
    {
      id: "user", header: "User",
      cell: ({ row }) => <span><strong>{row.original.name}</strong><div className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{row.original.email}</div></span>,
    },
    { id: "role", header: "Role", cell: ({ row }) => <span>{ROLE_META[row.original.role]?.label ?? row.original.role}</span> },
    { id: "active", header: "Status", cell: ({ row }) => <Pill tone={row.original.is_active ? "go" : "neutral"}>{row.original.is_active ? "Active" : "Suspended"}</Pill> },
    { id: "login", header: "Last sign-in", cell: ({ row }) => row.original.last_login ? relativeTime(row.original.last_login) : "Never" },
    { id: "since", header: "Member since", cell: ({ row }) => relativeTime(row.original.created_at) },
    {
      id: "actions", header: "",
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu
            trigger={<button aria-label={`Actions for ${row.original.name}`}><MoreHorizontal size={16} aria-hidden /></button>}
            items={[{ label: "Edit", onSelect: () => setEditing(row.original) }]}
          />
        </span>
      ),
    },
  ], []);

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex justify-end gap-2">
        <ExportMenu
          options={[{
            format: "csv",
            label: "Export users",
            run: async () => downloadCsv("meridian-users.csv", users.map((u) => ({ name: u.name, email: u.email, role: u.role, active: u.is_active, last_login: u.last_login ?? "" }))),
          }]}
        />
        <Button onClick={() => setInvite(true)}>Invite user</Button>
      </div>

      <div className="flex gap-4">
        <Stat label="Never signed in" value={usersQ.isLoading ? undefined : neverSignedIn} />
      </div>

      {usersQ.isError ? (
        <ErrorState message={apiErrorMessage(usersQ.error)} onRetry={() => usersQ.refetch()} />
      ) : usersQ.isLoading ? <Skeleton height={240} /> : users.length ? (
        <DataTable columns={columns} data={users} getRowId={(u) => u.id} onRowClick={(u) => setEditing(u)} />
      ) : (
        <EmptyState title="No users yet" detail="Invite the first steward or analyst." action={<Button onClick={() => setInvite(true)}>Invite user</Button>}/>
      )}

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

function RolesView() {
  const matrixQ = useQuery({ queryKey: queryKeys.authRoles(), queryFn: getRoleMatrix });
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers });
  const users = (usersQ.data?.users ?? []).filter((u) => u.is_active);
  const matrix = matrixQ.data;
  const actions = useMemo(() => Array.from(new Set(Object.values(matrix ?? {}).flat())).sort(), [matrix]);

  const matrixCols = useMemo<ColumnDef<UserRole, unknown>[]>(() => [
    { id: "role", header: "Role", cell: ({ row }) => <span>{ROLE_META[row.original].label}<div className="m-text-label" style={{ color: "var(--m-ink-3)" }}>{ROLE_META[row.original].desc}</div></span> },
    ...actions.map((a): ColumnDef<UserRole, unknown> => ({
      id: a, header: a,
      cell: ({ row }) => (matrix?.[row.original]?.includes(a) ? <span aria-label="Allowed">Yes</span> : <span className="sr-only">Not allowed</span>),
    })),
  ], [actions, matrix]);
  const holderCols = useMemo<ColumnDef<UserRole, unknown>[]>(() => [
    { id: "role", header: "Role", cell: ({ row }) => <strong>{ROLE_META[row.original].label}</strong> },
    { id: "n", header: "Users", cell: ({ row }) => users.filter((u) => u.role === row.original).length },
    { id: "who", header: "Who", cell: ({ row }) => users.filter((u) => u.role === row.original).map((u) => u.name).join(", ") },
  ], [users]);

  return (
    <div className="flex flex-col gap-6 pt-4">
      <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>Permissions come from the API role matrix, the frontend keeps no copy.</p>
      {matrixQ.isError ? (
        <ErrorState message={apiErrorMessage(matrixQ.error)} onRetry={() => matrixQ.refetch()} />
      ) : matrix ? (
        <Card title="Role matrix" padding="sm">
          <DataTable columns={matrixCols} data={ROLES} getRowId={(r) => r} />
        </Card>
      ) : <Skeleton height={240} />}
      <Card title="Who holds each role" padding="sm">
        <DataTable columns={holderCols} data={ROLES.filter((r) => users.some((u) => u.role === r))} getRowId={(r) => r} />
      </Card>
    </div>
  );
}

function AuditView() {
  const auditQ = useQuery({ queryKey: queryKeys.auditEntries(50), queryFn: () => getAuditEntries({ limit: 50 }) });
  const entries: AuditEntry[] = auditQ.data?.entries ?? [];
  const auditCols = useMemo<ColumnDef<AuditEntry, unknown>[]>(() => [
    { id: "when", header: "When", cell: ({ row }) => <time dateTime={row.original.created_at}>{relativeTime(row.original.created_at)}</time> },
    { id: "who", header: "Actor", cell: ({ row }) => (row.original.actor_email ? row.original.actor_email.split("@")[0] : "system") },
    { id: "what", header: "Action", cell: ({ row }) => `${row.original.action}, ${row.original.entity_type}` },
    { id: "ctx", header: "Context", cell: ({ row }) => `${row.original.method} ${row.original.path} returned ${row.original.status_code}${row.original.entity_id ? `, ${row.original.entity_id.slice(0, 8)}` : ""}` },
  ], []);

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex justify-end">
        <ExportMenu
          options={[
            { format: "xlsx", run: () => exportAuditEntries("xlsx") },
            { format: "csv", run: () => exportAuditEntries("csv") },
          ]}
        />
      </div>
      {auditQ.isError ? (
        <ErrorState message={apiErrorMessage(auditQ.error)} onRetry={() => auditQ.refetch()} />
      ) : auditQ.isLoading ? <Skeleton height={240} /> : entries.length ? (
        <DataTable columns={auditCols} data={entries} getRowId={(e) => e.id} />
      ) : <EmptyState title="No audit activity yet" detail="Changes to users, rules and data are recorded here." ghost="list" action={<Button variant="secondary" onClick={() => void auditQ.refetch()}>Refresh</Button>} />}
    </div>
  );
}

function EditForm({ user, onDone, onRemove, removing }: { user: User; onDone: () => void; onRemove: () => void; removing: boolean }) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setActive] = useState(user.is_active);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => updateUser(user.id, { role, is_active: isActive }),
    onSuccess: () => { toast.success(`${user.name} saved`); onDone(); },
    onError: (e) => toast.error(`Not saved. ${apiErrorMessage(e)}`),
  });

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>{user.email}</p>
      <Field label="Role">
        <Select options={ROLE_OPTIONS} value={role} onValueChange={(v) => setRole(v as UserRole)} />
      </Field>
      <p className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{ROLE_META[role].desc}</p>
      <label className="flex items-center gap-2 m-text-body">
        <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} />
        <span>Active, {isActive ? "this user can sign in" : "sign-in is blocked"}</span>
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={m.isPending}>Save</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Close</Button>
      </div>
      <Button type="button" variant="secondary" disabled={removing} onClick={() => setConfirmOpen(true)}>Remove user</Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} title={`Remove ${user.name}?`}>
        <div className="flex flex-col gap-3">
          <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>
            Why remove {user.name}? Their stewardship history stays attributed to them
          </p>
          {/* ponytail: this reason is a client-side confirmation gate only, same as the
              legacy ReasonButton it replaces — deleteUser() takes no reason parameter. */}
          <textarea className="m-input" style={{ height: "auto", padding: "6px 10px" }} aria-label="Reason for removal" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={!reason.trim() || removing}
              onClick={() => { setConfirmOpen(false); setReason(""); onRemove(); }}
            >
              Remove user
            </Button>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Keep as is</Button>
          </div>
        </div>
      </Dialog>
    </form>
  );
}
