"use client";

/**
 * Admin, Users and audit: who has access and with which role, the role matrix
 * the API enforces, the licence this deployment runs under, and the audit
 * log. Everything here needs manage_users on the API.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { AdminAuditLogTable, AdminDestructiveConfirm } from "@/components/aurora";
import {
  Banner, Button, DataTable, DetailDrawer, EmptyState, Field, Input, KeyValue, Metric, MetricStrip, Mono, PageHeader, SectionCard, Select,
  StatusBadge, TableSkeleton, Tabs, type AuroraColumnMeta,
} from "@/components/ui-core";
import { apiErrorMessage } from "@/lib/api/optional";
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
  admin: { label: "Admin", desc: "Full access. Manage users and rules, approve proposed rules." },
  manager: { label: "Manager", desc: "Run the programme. Connect systems, sync, analyse, approve, apply and assign work." },
  steward: { label: "Steward", desc: "Own the data. Fix, clean, approve and apply, maintain rules and assign work." },
  ai_reviewer: { label: "AI reviewer", desc: "Review and approve proposed rules from steward corrections." },
  approver: { label: "Approver", desc: "Four-eyes approval of cleaning, golden records and stewardship changes." },
  analyst: { label: "Analyst", desc: "Upload, sync and run analysis; export results. No approvals." },
  viewer: { label: "Viewer", desc: "Read-only access to dashboards and findings." },
  auditor: { label: "Auditor", desc: "Read-only access including the audit log." },
};
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
      ? "This user is referenced by audit or stewardship records. Deactivate them instead." : `Not removed. ${apiErrorMessage(e)}`),
  });

  const columns = useMemo<ColumnDef<User, unknown>[]>(() => [
    { id: "user", header: "User", meta: meta({ sticky: "start", width: 260 }), cell: ({ row }) => (
      <span><strong>{row.original.name}</strong><div className="ui-micro">{row.original.email}</div></span>) },
    { id: "role", header: "Role", meta: meta({ width: 130 }), cell: ({ row }) => ROLE_META[row.original.role]?.label ?? row.original.role },
    { id: "active", header: "Status", meta: meta({ width: 110 }), cell: ({ row }) => <StatusBadge status={row.original.is_active ? "ok" : "idle"}>{row.original.is_active ? "Active" : "Inactive"}</StatusBadge> },
    { id: "login", header: "Last sign-in", meta: meta({ width: 130 }), cell: ({ row }) => row.original.last_login ? relativeTime(row.original.last_login) : "Never" },
    { id: "since", header: "Member since", meta: meta({ width: 130 }), cell: ({ row }) => relativeTime(row.original.created_at) },
    { id: "actions", header: "", meta: meta({ width: 150, align: "end" }), cell: ({ row }) => canManage ? (
      <span className="ui-form__actions" style={{ justifyContent: "flex-end" }}>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(row.original); }}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDeleting(row.original); }}>Remove</Button>
      </span>) : null },
  ], [canManage]);

  if (!canManage) return <div className="ui-page"><Banner tone="info" title="Users and audit needs the manage_users permission">Ask an administrator to change roles or review the audit log.</Banner></div>;

  return (
    <div className="ui-page">
      <PageHeader title="Users and audit" summary="Who can sign in, with which role, and what they did."
        actions={view === "users" ? <>
          <Button variant="secondary" onClick={() => downloadCsv("meridian-users.csv", users.map((u) => ({ name: u.name, email: u.email, role: u.role, active: u.is_active, last_login: u.last_login ?? "" })))}>Export users</Button>
          <Button onClick={() => setInvite(true)}>Invite user</Button>
        </> : null} />
      <MetricStrip label="Access">
        <Metric label="Active users" value={active.length} unit={seats ? `of ${seats} seats` : undefined} tone={seats && active.length >= seats ? "warning" : "default"} />
        <Metric label="Roles in use" value={rolesInUse.size} />
        <Metric label="Modules licensed" value={licence.data?.enabled_modules?.length ?? 0} unit={licence.data?.tier} />
        <Metric label="Licence" value={licence.data?.valid === false ? "Not valid" : licence.data?.days_remaining ?? "—"} unit={licence.data?.valid !== false && licence.data?.days_remaining != null ? "days left" : undefined}
          tone={licence.data?.valid === false ? "danger" : licence.data?.days_remaining != null && licence.data.days_remaining < 30 ? "warning" : "default"} />
      </MetricStrip>
      <div>
        <Tabs ariaLabel="Users and audit sections" value={view as View} onValueChange={(v) => setView(v)} items={[
          { id: "users", label: "Users", count: users.length }, { id: "roles", label: "Roles" }, { id: "licence", label: "Licence and modules" }, { id: "audit", label: "Audit log" },
        ]} />
      </div>

      {view === "users" ? (usersQ.isLoading ? <TableSkeleton rows={6} label="Loading users" /> : users.length
        ? <DataTable columns={columns} data={users} getRowId={(u) => u.id} onRowActivate={setEditing} ariaLabel="Users" maxHeight="60vh" />
        : <EmptyState action={<Button onClick={() => setInvite(true)}>Invite user</Button>}>No users yet. Invite the first steward or analyst.</EmptyState>) : null}

      {view === "roles" ? <RolesView matrix={matrix.data} users={active} /> : null}

      {view === "licence" ? (
        <div className="ui-columns">
          <div className="ui-stack">
            <SectionCard title="Licence">
              <KeyValue rows={[
                { k: "Tier", v: licence.data?.tier ?? "—" },
                { k: "Seats", v: `${active.length} of ${seats || "unlimited"}` },
                { k: "Renews", v: licence.data?.expiry_date ? `${licence.data.expiry_date}${licence.data.days_remaining != null ? `, ${licence.data.days_remaining} days` : ""}` : "—" },
                { k: "Status", v: <StatusBadge status={licence.data?.valid === true ? "ok" : licence.data?.valid === false ? "failed" : "idle"}>{licence.data?.status ?? "Unknown"}</StatusBadge> },
                { k: "Last validated", v: licence.data?.last_validated ? relativeTime(licence.data.last_validated) : "—" },
              ]} />
            </SectionCard>
            <p className="ui-note">Plan changes and invoices are handled in Meridian HQ.</p>
          </div>
          <div className="ui-stack">
            <SectionCard title="Modules enabled" meta={licence.data?.enabled_menu_items?.length || undefined}>
              {licence.data?.enabled_menu_items?.length
                ? <ul className="ui-plain-list">{licence.data.enabled_menu_items.map((m) => <li key={m}>{m}</li>)}</ul>
                : <p className="ui-note">None enabled.</p>}
            </SectionCard>
            <PlatformVersionCard />
          </div>
        </div>
      ) : null}

      {view === "audit" ? (audit.isLoading ? <TableSkeleton rows={8} label="Loading the audit log" /> : (
        <AdminAuditLogTable entries={(audit.data?.entries ?? []).map((e) => ({
          id: e.id, timestamp: e.created_at, displayTime: relativeTime(e.created_at),
          actor: e.actor_email ? e.actor_email.split("@")[0] : "system",
          action: `${e.action}, ${e.entity_type}`, context: `${e.method} ${e.path} returned ${e.status_code}${e.entity_id ? `, ${e.entity_id.slice(0, 8)}` : ""}`,
        }))} emptyLabel="No audit activity recorded yet." />)) : null}

      <DetailDrawer open={invite} onClose={() => setInvite(false)} ariaLabel="Invite a user" header={<div className="ui-drawer-head"><h2 className="ui-drawer-head__title">Invite a user</h2></div>}>
        {invite ? <InviteForm onDone={() => { setInvite(false); refresh(); }} /> : null}
      </DetailDrawer>
      <DetailDrawer open={!!editing} onClose={() => setEditing(null)} ariaLabel="Edit user" header={editing ? <div className="ui-drawer-head"><h2 className="ui-drawer-head__title">{editing.name}</h2></div> : null}>
        {editing ? <EditForm key={editing.id} user={editing} onDone={() => { setEditing(null); refresh(); }} /> : null}
      </DetailDrawer>
      <DetailDrawer open={!!deleting} onClose={() => setDeleting(null)} ariaLabel="Remove user">
        {deleting ? <AdminDestructiveConfirm title={`Remove ${deleting.name}`} expected={deleting.email}
          body={<>Type <Mono>{deleting.email}</Mono> to remove this user. Their stewardship history stays attributed to them.</>}
          confirmLabel="Remove user" cancelLabel="Keep" onConfirm={() => del.mutate(deleting)} onCancel={() => setDeleting(null)} /> : null}
      </DetailDrawer>
    </div>
  );
}

function RolesView({ matrix, users }: { matrix: Record<string, string[]> | undefined; users: User[] }) {
  const actions = useMemo(() => Array.from(new Set(Object.values(matrix ?? {}).flat())).sort(), [matrix]);
  return (
    <div className="ui-stack">
      <p className="ui-note">Permissions come from the API&apos;s role matrix. The frontend never keeps its own copy.</p>
      {matrix ? (
        <SectionCard title="Role matrix" flush>
          <div style={{ overflowX: "auto" }}>
            <table className="ui-mini-table">
              <thead><tr><th>Role</th>{actions.map((a) => <th key={a} className="ui-mono">{a}</th>)}</tr></thead>
              <tbody>
                {ROLES.map((r) => (
                  <tr key={r}>
                    <td><strong>{ROLE_META[r].label}</strong><div className="ui-micro">{ROLE_META[r].desc}</div></td>
                    {actions.map((a) => <td key={a} style={{ textAlign: "center" }}>{matrix[r]?.includes(a) ? <span aria-label="Allowed">✓</span> : <span className="ui-visually-hidden">Not allowed</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : <TableSkeleton rows={8} label="Loading the role matrix" />}
      <SectionCard title="Who holds each role">
        <table className="ui-mini-table">
          <tbody>
            {ROLES.filter((r) => users.some((u) => u.role === r)).map((r) => (
              <tr key={r}>
                <td style={{ width: 160 }}><strong>{ROLE_META[r].label}</strong> <span className="ui-micro">{users.filter((u) => u.role === r).length}</span></td>
                <td>{users.filter((u) => u.role === r).map((u) => u.name).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [role, setRole] = useState<UserRole>("viewer");
  const m = useMutation({ mutationFn: () => inviteUser({ email, name: name || undefined, role }),
    onSuccess: () => { toast.success(`Invitation sent to ${email}`); onDone(); }, onError: (e) => toast.error(`Invitation not sent. ${apiErrorMessage(e)}`) });
  return (
    <form className="ui-form" onSubmit={(e) => { e.preventDefault(); if (email) m.mutate(); }}>
      <Field label="Email" required>{({ controlId }) => <Input id={controlId} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
      <Field label="Name" helper="Optional">{({ controlId }) => <Input id={controlId} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Role" helper={ROLE_META[role].desc}>{({ controlId }) => <Select id={controlId} options={ROLE_OPTIONS} value={role} onValueChange={(v) => setRole(v as UserRole)} />}</Field>
      <div className="ui-form__actions"><Button type="submit" disabled={!email || m.isPending}>Send invitation</Button><Button type="button" variant="ghost" onClick={onDone}>Close</Button></div>
    </form>
  );
}

function EditForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [role, setRole] = useState<UserRole>(user.role); const [isActive, setActive] = useState(user.is_active);
  const m = useMutation({ mutationFn: () => updateUser(user.id, { role, is_active: isActive }),
    onSuccess: () => { toast.success(`${user.name} saved`); onDone(); }, onError: (e) => toast.error(`Not saved. ${apiErrorMessage(e)}`) });
  return (
    <form className="ui-form" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="ui-note">{user.email}</p>
      <Field label="Role" helper={ROLE_META[role].desc}>{({ controlId }) => <Select id={controlId} options={ROLE_OPTIONS} value={role} onValueChange={(v) => setRole(v as UserRole)} />}</Field>
      <label className="ui-check">
        <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} />
        <span>Active. {isActive ? "This user can sign in." : "Sign-in is blocked."}</span>
      </label>
      <div className="ui-form__actions"><Button type="submit" disabled={m.isPending}>Save</Button><Button type="button" variant="ghost" onClick={onDone}>Close</Button></div>
    </form>
  );
}
