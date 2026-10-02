"use client";

/**
 * Admin → Users & audit: who has access and with which role, the role matrix
 * the API enforces, the licence this deployment runs under, and the audit
 * log. Everything here needs manage_users on the API.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  AdminAuditLogTable, AdminDestructiveConfirm, Banner, Button, Chip, DataTable, Drawer, EmptyState, Field, Input, KpiRail,
  Select, Stack, Stat, Tabs, Text, type AuroraColumnMeta, type ChipTone,
} from "@/components/aurora";
import { downloadCsv } from "@/components/meridian/actions";
import { PlatformVersionCard } from "@/components/platform-version-card";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { getAuditEntries } from "@/lib/api/audit";
import { getRoleMatrix } from "@/lib/api/auth";
import { getLicenceManifest } from "@/lib/api/licence";
import { deleteUser, getUsers, inviteUser, updateUser } from "@/lib/api/users";
import { relativeTime } from "@/lib/format";
import type { User, UserRole } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const ROLES: UserRole[] = ["admin", "manager", "steward", "ai_reviewer", "approver", "analyst", "viewer", "auditor"];
const ROLE_META: Record<UserRole, { label: string; desc: string }> = {
  admin: { label: "Admin", desc: "Full access — manage users, rules, and approve proposed rules." },
  manager: { label: "Manager", desc: "Run the programme — connect systems, sync, analyse, approve, apply and assign work." },
  steward: { label: "Steward", desc: "Own the data — fix, clean, approve/apply, maintain rules and assign work." },
  ai_reviewer: { label: "AI Reviewer", desc: "Review and approve proposed rules from steward corrections." },
  approver: { label: "Approver", desc: "Four-eyes approval of cleaning, golden records and stewardship changes." },
  analyst: { label: "Analyst", desc: "Upload, sync and run analysis; export results. No approvals." },
  viewer: { label: "Viewer", desc: "Read-only access to dashboards and findings." },
  auditor: { label: "Auditor", desc: "Read-only access including the audit log." },
};
const ROLE_TONE: Record<UserRole, ChipTone> = { admin: "danger", manager: "info", steward: "info", ai_reviewer: "warning", approver: "warning", analyst: "neutral", viewer: "neutral", auditor: "neutral" };
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_META[r].label }));
type View = "users" | "roles" | "licence" | "audit";

export function UsersSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  const canManage = can("manage_users");
  const [view, setView] = useUrlState("view", "users");
  const [invite, setInvite] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const usersQ = useQuery({ queryKey: ["users.list"], queryFn: getUsers, enabled: canManage });
  const licence = useQuery({ queryKey: ["licence.manifest"], queryFn: getLicenceManifest });
  const matrix = useQuery({ queryKey: ["auth.roles"], queryFn: getRoleMatrix, enabled: view === "roles" });
  const audit = useQuery({ queryKey: ["audit.entries", 50], queryFn: () => getAuditEntries({ limit: 50 }), enabled: view === "audit" && canManage });
  const users = useMemo(() => usersQ.data?.users ?? [], [usersQ.data]);
  const active = users.filter((u) => u.is_active);
  const seats = licence.data?.features?.max_users || 0;
  const rolesInUse = new Set(active.map((u) => u.role));
  const refresh = () => qc.invalidateQueries({ queryKey: ["users.list"] });

  const del = useMutation({
    mutationFn: (u: User) => deleteUser(u.id),
    onSuccess: (_, u) => { toast.success(`${u.name} removed`); setDeleting(null); refresh(); },
    onError: (e) => toast.error((e as { response?: { status?: number } }).response?.status === 409
      ? "This user is referenced by audit or stewardship records — deactivate them instead" : (e as Error).message || "Not removed"),
  });

  const columns = useMemo<ColumnDef<User, unknown>[]>(() => [
    { id: "user", header: "User", meta: meta({ sticky: "start", width: 260 }), cell: ({ row }) => (
      <span><strong>{row.original.name}</strong><Text variant="text-small" tone="muted" as="div">{row.original.email}</Text></span>) },
    { id: "role", header: "Role", meta: meta({ width: 130 }), cell: ({ row }) => <Chip tone={ROLE_TONE[row.original.role]}>{ROLE_META[row.original.role]?.label ?? row.original.role}</Chip> },
    { id: "active", header: "Status", meta: meta({ width: 110 }), cell: ({ row }) => <Chip tone={row.original.is_active ? "success" : "neutral"}>{row.original.is_active ? "active" : "inactive"}</Chip> },
    { id: "login", header: "Last sign-in", meta: meta({ width: 130 }), cell: ({ row }) => row.original.last_login ? relativeTime(row.original.last_login) : "never" },
    { id: "since", header: "Member since", meta: meta({ width: 130 }), cell: ({ row }) => relativeTime(row.original.created_at) },
    { id: "actions", header: "", meta: meta({ width: 150, align: "end" }), cell: ({ row }) => canManage ? (
      <Stack direction="row" gap={1} justify="end">
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(row.original); }}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDeleting(row.original); }}>Remove</Button>
      </Stack>) : null },
  ], [canManage]);

  if (!canManage) return <Banner tone="info" title="Users & audit needs the manage_users permission" className="aurora-page">Ask an administrator to change roles or review the audit log.</Banner>;

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Active users" value={active.length} unit={seats ? `/ ${seats} seats` : undefined} tone={seats && active.length >= seats ? "warning" : "neutral"} />
        <Stat label="Roles in use" value={rolesInUse.size} />
        <Stat label="Modules licensed" value={licence.data?.enabled_modules?.length ?? 0} unit={licence.data?.tier} />
        <Stat label="Licence" value={licence.data?.valid === false ? "invalid" : licence.data?.days_remaining != null ? `${licence.data.days_remaining} d` : "—"}
          tone={licence.data?.valid === false ? "danger" : licence.data?.days_remaining != null && licence.data.days_remaining < 30 ? "warning" : "neutral"} />
      </KpiRail>
      <Stack direction="row" gap={3} align="center" wrap>
        <Tabs ariaLabel="Users & audit sections" value={view as View} onValueChange={(v) => setView(v)} items={[
          { id: "users", label: "Users", count: users.length }, { id: "roles", label: "Roles" }, { id: "licence", label: "Licence & modules" }, { id: "audit", label: "Audit log" },
        ]} />
        <span style={{ flex: 1 }} />
        {view === "users" ? <>
          <Button variant="secondary" onClick={() => downloadCsv("meridian-users.csv", users.map((u) => ({ name: u.name, email: u.email, role: u.role, active: u.is_active, last_login: u.last_login ?? "" })))}>Export users</Button>
          <Button onClick={() => setInvite(true)}>Invite user</Button>
        </> : null}
      </Stack>

      {view === "users" ? (usersQ.isLoading ? <Text tone="muted">Reading users.</Text> : users.length
        ? <DataTable columns={columns} data={users} getRowId={(u) => u.id} onRowActivate={setEditing} ariaLabel="Users" maxHeight="60vh" />
        : <EmptyState title="No users yet." body="Invite the first steward or analyst." actions={<Button onClick={() => setInvite(true)}>Invite user</Button>} />) : null}

      {view === "roles" ? <RolesView matrix={matrix.data} users={active} /> : null}

      {view === "licence" ? (
        <Stack gap={4}>
          <table className="aurora-exec__table"><tbody>
            <tr><td>Tier</td><td>{licence.data?.tier ?? "—"}</td></tr>
            <tr><td>Seats</td><td className="aurora-number">{active.length} / {seats || "∞"}</td></tr>
            <tr><td>Renews</td><td>{licence.data?.expiry_date ?? "—"}{licence.data?.days_remaining != null ? ` · ${licence.data.days_remaining} days` : ""}</td></tr>
            <tr><td>Status</td><td><Chip tone={licence.data?.valid === true ? "success" : licence.data?.valid === false ? "danger" : "neutral"}>{licence.data?.status ?? "unknown"}</Chip></td></tr>
            <tr><td>Last validated</td><td>{licence.data?.last_validated ? relativeTime(licence.data.last_validated) : "—"}</td></tr>
          </tbody></table>
          <div>
            <Text variant="text-small" tone="secondary">Modules enabled on this licence</Text>
            <Stack direction="row" gap={1} wrap style={{ marginTop: "var(--aurora-space-2)" }}>
              {licence.data?.enabled_menu_items?.length ? licence.data.enabled_menu_items.map((m) => <Chip key={m} tone="info">{m}</Chip>) : <Text tone="muted">None enabled.</Text>}
            </Stack>
          </div>
          <Text variant="text-micro" tone="muted">Plan changes and invoices are managed centrally in Meridian HQ.</Text>
          <PlatformVersionCard />
        </Stack>
      ) : null}

      {view === "audit" ? (audit.isLoading ? <Text tone="muted">Reading the audit log.</Text> : (
        <AdminAuditLogTable entries={(audit.data?.entries ?? []).map((e) => ({
          id: e.id, timestamp: e.created_at, displayTime: relativeTime(e.created_at),
          actor: e.actor_email ? e.actor_email.split("@")[0] : "system",
          action: `${e.action} · ${e.entity_type}`, context: `${e.method} ${e.path} → ${e.status_code}${e.entity_id ? ` · ${e.entity_id.slice(0, 8)}` : ""}`,
        }))} emptyLabel="No audit activity recorded yet." />)) : null}

      <Drawer open={invite} onClose={() => setInvite(false)} ariaLabel="Invite a user" header={<Text variant="text-lead">Invite a user</Text>}>
        {invite ? <InviteForm onDone={() => { setInvite(false); refresh(); }} /> : null}
      </Drawer>
      <Drawer open={!!editing} onClose={() => setEditing(null)} ariaLabel="Edit user" header={editing ? <Text variant="text-lead">{editing.name}</Text> : null}>
        {editing ? <EditForm key={editing.id} user={editing} onDone={() => { setEditing(null); refresh(); }} /> : null}
      </Drawer>
      <Drawer open={!!deleting} onClose={() => setDeleting(null)} ariaLabel="Remove user">
        {deleting ? <AdminDestructiveConfirm title={`Remove ${deleting.name}`} expected={deleting.email}
          body={<>Type <span className="aurora-number">{deleting.email}</span> to remove this user. Their stewardship history stays attributed to them.</>}
          confirmLabel="Remove user" cancelLabel="Keep" onConfirm={() => del.mutate(deleting)} onCancel={() => setDeleting(null)} /> : null}
      </Drawer>
    </Stack>
  );
}

function RolesView({ matrix, users }: { matrix: Record<string, string[]> | undefined; users: User[] }) {
  const actions = useMemo(() => Array.from(new Set(Object.values(matrix ?? {}).flat())).sort(), [matrix]);
  return (
    <Stack gap={4}>
      <Text variant="text-small" tone="secondary">Permissions come from the API&apos;s role matrix; the frontend never keeps its own copy.</Text>
      {matrix ? (
        <div style={{ overflowX: "auto" }}>
          <table className="aurora-exec__table">
            <thead><tr><th>Role</th>{actions.map((a) => <th key={a} className="aurora-number">{a}</th>)}</tr></thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r}>
                  <td><Chip tone={ROLE_TONE[r]}>{ROLE_META[r].label}</Chip><Text variant="text-small" tone="muted" as="div">{ROLE_META[r].desc}</Text></td>
                  {actions.map((a) => <td key={a} style={{ textAlign: "center" }}>{matrix[r]?.includes(a) ? "✓" : ""}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Text tone="muted">Reading the role matrix.</Text>}
      <div className="aurora-compare__lists">
        {ROLES.filter((r) => users.some((u) => u.role === r)).map((r) => (
          <div key={r}>
            <Stack direction="row" gap={2} align="center"><Chip tone={ROLE_TONE[r]}>{ROLE_META[r].label}</Chip><Text variant="text-small" tone="secondary">{users.filter((u) => u.role === r).length}</Text></Stack>
            <ul className="aurora-exec__warnings">{users.filter((u) => u.role === r).map((u) => <li key={u.id}><span>{u.name} <Text variant="text-micro" tone="muted" as="span" className="aurora-number">{u.email}</Text></span></li>)}</ul>
          </div>
        ))}
      </div>
    </Stack>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [role, setRole] = useState<UserRole>("viewer");
  const m = useMutation({ mutationFn: () => inviteUser({ email, name: name || undefined, role }),
    onSuccess: () => { toast.success(`Invitation sent to ${email}`); onDone(); }, onError: (e) => toast.error((e as Error).message || "Invitation not sent") });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (email) m.mutate(); }}>
      <Stack gap={4}>
        <Field label="Email" required>{({ controlId }) => <Input id={controlId} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Name" helper="Optional">{({ controlId }) => <Input id={controlId} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Role" helper={ROLE_META[role].desc}>{({ controlId }) => <Select id={controlId} options={ROLE_OPTIONS} value={role} onValueChange={(v) => setRole(v as UserRole)} />}</Field>
        <Stack direction="row" gap={2}><Button type="submit" disabled={!email || m.isPending}>Send invitation</Button><Button type="button" variant="ghost" onClick={onDone}>Close</Button></Stack>
      </Stack>
    </form>
  );
}

function EditForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [role, setRole] = useState<UserRole>(user.role); const [isActive, setActive] = useState(user.is_active);
  const m = useMutation({ mutationFn: () => updateUser(user.id, { role, is_active: isActive }),
    onSuccess: () => { toast.success(`${user.name} updated`); onDone(); }, onError: (e) => toast.error((e as Error).message || "Not saved") });
  return (
    <Stack gap={4}>
      <Text variant="text-small" tone="secondary">{user.email}</Text>
      <Field label="Role" helper={ROLE_META[role].desc}>{({ controlId }) => <Select id={controlId} options={ROLE_OPTIONS} value={role} onValueChange={(v) => setRole(v as UserRole)} />}</Field>
      <Chip tone={isActive ? "success" : "neutral"} selected={isActive} role="switch" aria-checked={isActive} onClick={() => setActive(!isActive)} style={{ cursor: "pointer" }}>
        {isActive ? "Active — can sign in" : "Inactive — sign-in blocked"}
      </Chip>
      <Stack direction="row" gap={2}><Button onClick={() => m.mutate()} disabled={m.isPending}>Save</Button><Button variant="ghost" onClick={onDone}>Close</Button></Stack>
    </Stack>
  );
}
