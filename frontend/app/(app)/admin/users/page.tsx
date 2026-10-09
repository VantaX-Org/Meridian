"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import { Button, DataTable, Dialog, Drawer, EmptyState, ErrorState, Field, Menu, Pill, Select, Skeleton, Stat, Tabs } from "@/design";
import { useRole } from "@/hooks/use-role";
import { downloadCsv } from "@/lib/actions";
import { getRoleMatrix } from "@/lib/api/auth";
import { getAuditEntries, type AuditEntry } from "@/lib/api/audit";
import { downloadBlob } from "@/lib/api/download";
import { apiErrorMessage } from "@/lib/api/optional";
import { deleteUser, getAssignableUsers, getUsers, inviteUser, updateUser } from "@/lib/api/users";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { User, UserRole } from "@/types/api";

// ponytail: getAssignableUsers() is unused here, same as the legacy component it replaces.
void getAssignableUsers;

const ROLES: UserRole[] = ["admin", "manager", "steward", "ai_reviewer", "approver", "analyst", "viewer", "auditor"];
const ROLE_META: Record<UserRole, { label: string; desc: string }> = {
  admin: { label: "Admin", desc: "Full access. Manage users and rules, approve proposed rules." },
  manager: { label: "Manager", desc: "Run the programme. Connect systems, sync, analyse, approve, apply and assign work." },
  steward: { label: "Steward", desc: "Own the data. Fix, clean, approve and apply, maintain rules and assign work." },
  ai_reviewer: { label: "AI Reviewer", desc: "Review and approve proposed rules from steward corrections." },
  approver: { label: "Approver", desc: "Four-eyes approval of cleaning, golden records and stewardship changes." },
  analyst: { label: "Analyst", desc: "Upload, sync and run analysis; export results. No approvals." },
  viewer: { label: "Viewer", desc: "Read-only access to dashboards and findings." },
  auditor: { label: "Auditor", desc: "Read-only access including the audit log." },
};
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_META[r].label }));
const WEEK = 7 * 24 * 3600 * 1000;

export default function AdminUsersPage() {
  const { can } = useRole();
  const canManage = can("manage_users");

  if (!canManage) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <strong>Users and audit needs the manage_users permission</strong>
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          Ask an administrator to change roles or review the audit log.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Who can sign in, with which role, and what they did.</p>
      </header>
      <Tabs
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
  const [mountedAt] = useState(() => Date.now());
  const activeWeek = useMemo(
    () => users.filter((u) => u.is_active && u.last_login && new Date(u.last_login).getTime() > mountedAt - WEEK).length,
    [users, mountedAt],
  );
  const neverSignedIn = active.filter((u) => !u.last_login).length;
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.users() });

  const del = useMutation({
    mutationFn: (u: User) => deleteUser(u.id),
    onSuccess: (_, u) => { toast.success(`${u.name} removed`); setEditing(null); refresh(); },
    onError: (e) => toast.error(
      (e as { response?: { status?: number } }).response?.status === 409
        ? "This user is referenced by audit or stewardship records. Deactivate them instead."
        : `Not removed. ${apiErrorMessage(e)}`,
    ),
  });

  const columns = useMemo<ColumnDef<User, unknown>[]>(() => [
    {
      id: "user", header: "User",
      cell: ({ row }) => <span><strong>{row.original.name}</strong><div className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{row.original.email}</div></span>,
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
        <Button
          variant="secondary"
          onClick={() => downloadCsv("meridian-users.csv", users.map((u) => ({ name: u.name, email: u.email, role: u.role, active: u.is_active, last_login: u.last_login ?? "" })))}
        >
          Export users
        </Button>
        <Button onClick={() => setInvite(true)}>Invite user</Button>
      </div>

      <div className="flex gap-4">
        <Stat label="Users" value={usersQ.isLoading ? undefined : users.length} />
        <Stat label="Active this week" value={usersQ.isLoading ? undefined : activeWeek} />
        <Stat label="Never signed in" value={usersQ.isLoading ? undefined : neverSignedIn} />
      </div>

      {usersQ.isError ? (
        <ErrorState message={(usersQ.error as Error)?.message || "Could not load users."} onRetry={() => usersQ.refetch()} />
      ) : usersQ.isLoading ? <Skeleton height={240} /> : users.length ? (
        <DataTable columns={columns} data={users} getRowId={(u) => u.id} onRowClick={(u) => setEditing(u)} />
      ) : (
        <EmptyState title="No users yet. Invite the first steward or analyst." action={<Button onClick={() => setInvite(true)}>Invite user</Button>}/>
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

  return (
    <div className="flex flex-col gap-6 pt-4">
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Permissions come from the API&apos;s role matrix. The frontend never keeps its own copy.</p>
      {matrixQ.isError ? (
        <ErrorState message={(matrixQ.error as Error)?.message || "Could not load the role matrix."} onRetry={() => matrixQ.refetch()} />
      ) : matrix ? (
        <section>
          <h2 className="text-[13px] font-semibold mb-2">Role matrix</h2>
          <div className="overflow-x-auto">
            <table className="text-[12px]">
              <thead><tr><th className="text-left pr-3">Role</th>{actions.map((a) => <th key={a} className="text-left pr-3 font-mono">{a}</th>)}</tr></thead>
              <tbody>
                {ROLES.map((r) => (
                  <tr key={r}>
                    <td className="pr-3 py-1">{ROLE_META[r].label}<div className="text-[11px]" style={{ color: "var(--m-ink-3)" }}>{ROLE_META[r].desc}</div></td>
                    {actions.map((a) => <td key={a} className="text-center">{matrix[r]?.includes(a) ? <span aria-label="Allowed">Yes</span> : <span className="sr-only">Not allowed</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : <Skeleton height={240} />}
      <section>
        <h2 className="text-[13px] font-semibold mb-2">Who holds each role</h2>
        <table className="text-[12px]">
          <tbody>
            {ROLES.filter((r) => users.some((u) => u.role === r)).map((r) => (
              <tr key={r}>
                <td className="pr-3 py-1" style={{ width: 160 }}><strong>{ROLE_META[r].label}</strong> <span style={{ color: "var(--m-ink-3)" }}>{users.filter((u) => u.role === r).length}</span></td>
                <td>{users.filter((u) => u.role === r).map((u) => u.name).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function AuditView() {
  const auditQ = useQuery({ queryKey: queryKeys.auditEntries(50), queryFn: () => getAuditEntries({ limit: 50 }) });
  const entries: AuditEntry[] = auditQ.data?.entries ?? [];

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => downloadBlob("/api/v1/audit/export", {}, "audit_log.csv").catch((e) => toast.error(apiErrorMessage(e)))}>
          Export audit log
        </Button>
      </div>
      {auditQ.isError ? (
        <ErrorState message={(auditQ.error as Error)?.message || "Could not load the audit log."} onRetry={() => auditQ.refetch()} />
      ) : auditQ.isLoading ? <Skeleton height={240} /> : entries.length ? (
        <div className="overflow-x-auto">
          <table className="text-[12px]" aria-label="Audit log">
            <thead><tr><th className="text-left pr-3">When</th><th className="text-left pr-3">Actor</th><th className="text-left pr-3">Action</th><th className="text-left pr-3">Context</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="pr-3 py-1"><time dateTime={e.created_at}>{relativeTime(e.created_at)}</time></td>
                  <td className="pr-3">{e.actor_email ? e.actor_email.split("@")[0] : "system"}</td>
                  <td className="pr-3">{e.action}, {e.entity_type}</td>
                  <td style={{ color: "var(--m-ink-3)" }}>{e.method} {e.path} returned {e.status_code}{e.entity_id ? `, ${e.entity_id.slice(0, 8)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No audit activity recorded yet.</p>}
    </div>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("viewer");
  const m = useMutation({
    mutationFn: () => inviteUser({ email, name: name || undefined, role }),
    onSuccess: () => { toast.success(`Invitation sent to ${email}`); onDone(); },
    onError: (e) => toast.error(`Invitation not sent. ${apiErrorMessage(e)}`),
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (email) m.mutate(); }}>
      <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Role">
        <Select options={ROLE_OPTIONS} value={role} onValueChange={(v) => setRole(v as UserRole)} />
      </Field>
      <p className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{ROLE_META[role].desc}</p>
      <div className="flex gap-2">
        <Button type="submit" disabled={!email || m.isPending}>Send invitation</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Close</Button>
      </div>
    </form>
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
      <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>{user.email}</p>
      <Field label="Role">
        <Select options={ROLE_OPTIONS} value={role} onValueChange={(v) => setRole(v as UserRole)} />
      </Field>
      <p className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{ROLE_META[role].desc}</p>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} />
        <span>Active. {isActive ? "This user can sign in." : "Sign-in is blocked."}</span>
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={m.isPending}>Save</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Close</Button>
      </div>
      <Button type="button" variant="secondary" disabled={removing} onClick={() => setConfirmOpen(true)}>Remove user</Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} title={`Remove ${user.name}?`}>
        <div className="flex flex-col gap-3">
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
            Why remove {user.name}? Their stewardship history stays attributed to them.
          </p>
          {/* ponytail: this reason is a client-side confirmation gate only, same as the
              legacy ReasonButton it replaces — deleteUser() takes no reason parameter. */}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
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
