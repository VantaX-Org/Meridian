"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Card, Choice, ConfirmDialog, DataTable, Dialog, Drawer, EmptyState, ErrorState, Field, IconButton, Input, Menu, Mono, Notice, PageHeader, Pill, Select, Skeleton, Tabs, Textarea, IconMore, toast } from "@/design";
import { SettingsTabs } from "@/components/admin/settings-tabs";
import { ApiKeysTab } from "@/components/admin/api-keys-tab";
import { EffectivePermissionsView } from "@/components/admin/effective-permissions";
import { GrantDiff } from "@/components/admin/grant-diff";
import { GrantsPicker, scopeLabel, type GrantRowView } from "@/components/admin/grants-picker";
import { MatrixTab } from "@/components/admin/matrix-tab";
import { RoleNavPreview } from "@/components/admin/role-nav-preview";
import { UserStatusPill } from "@/components/admin/user-status-pill";
import { accessLabel } from "@/lib/rbac";
import { grantableRoles } from "@/lib/roles";
import { InviteForm } from "@/components/admin/invite-form";
import { matrixDiff, matrixToPairs, RoleMatrix } from "@/components/admin/role-matrix";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { getAuditEntries, type AuditEntry } from "@/lib/api/audit";
import { getSystems } from "@/lib/api/connectivity";
import { decideAccessRequest, listAccessRequests, type AccessRequest } from "@/lib/api/me";
import {
  addGrant, cloneRole, convertObjectApprovals, deleteGrant, deleteRole, getRolePermissions, listGrants, listRoles,
  putRolePermissions, updateRole, type ConvertResult, type GrantInput, type Matrix, type Role,
} from "@/lib/api/roles";
import { getUsers } from "@/lib/api/users";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate, formatModuleName, labelOf, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useTenantTimezone } from "@/lib/tenant-zone";
import { hasExpiringGrant, isPast, nextGrantExpiry } from "@/lib/users";
import type { User } from "@/types/api";
import { auditSentence, When } from "../_lib/audit-sentence";

const TABS = ["roles", "matrix", "users", "invite", "requests", "keys", "history"] as const;

export default function AdminRolesPage() {
  const { can, loading } = useRole();
  const [raw, setTab] = useUrlState("tab", "roles");
  const tab = (TABS as readonly string[]).includes(raw) ? raw : "roles";
  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: listRoles });

  if (loading) return <div aria-busy="true"><Skeleton height={320} /></div>;
  if (!can("manage_users")) {
    return (
      <div>
        <EmptyState title="Only administrators manage roles" detail="Ask an administrator to change roles or what people can reach." ghost="list" action={<Button variant="secondary" render={<Link href="/home">Back to home</Link>} />} />
      </div>
    );
  }
  const roles = rolesQ.data ?? [];
  const custom = roles.filter((r) => !r.built_in).length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader tabs={<SettingsTabs />} title="Roles and access" meta={`${rolesQ.isLoading ? "" : `${roles.length} roles, ${custom} custom. `}Decide what each role may do and which systems or objects each person reaches`} />
      <Notice tone="info">Built-in roles cannot be changed: clone one to make your own. Give a role for one system or object only, so people get just the access their work needs.</Notice>
      <Tabs
        value={tab} onValueChange={setTab}
        items={[
          { value: "roles", label: "Roles", content: <RolesTab roles={roles} loading={rolesQ.isLoading} error={rolesQ.isError ? rolesQ.error : null} retry={() => rolesQ.refetch()} /> },
          { value: "matrix", label: "Matrix", content: <MatrixTab /> },
          { value: "users", label: "Users & scopes", content: <UsersTab roles={roles} onInvite={() => setTab("invite")} /> },
          { value: "invite", label: "Invite", content: <InviteTab /> },
          { value: "requests", label: "Requests", content: <RequestsTab roles={roles} /> },
          { value: "keys", label: "API keys", content: <ApiKeysTab /> },
          { value: "history", label: "History", content: <HistoryTab /> },
        ]}
      />
    </div>
  );
}

/** What deleting a role takes away, with the holder count when the API reports it. */
function deleteRoleSentence(role: Role | null): string {
  const n = role?.users;
  if (n === 0) return "No one holds this role now. Deleting it cannot be undone.";
  const who = n == null ? "Everyone who holds it loses" : `${n.toLocaleString()} ${n === 1 ? "user loses" : "users lose"}`;
  return `${who} the access it grants at once, at every system and object it was granted for. Their other roles stay. Deleting it cannot be undone.`;
}

function RolesTab({ roles, loading, error, retry }: { roles: Role[]; loading: boolean; error: unknown; retry: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Role | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [editing, setEditing] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["roles"] });
  const del = useMutation({
    mutationFn: (r: Role) => deleteRole(r.key),
    onSuccess: (_, r) => { toast.success(`${r.name} deleted`); setDeleting(null); setOpen(null); refresh(); },
    onError: (e) => toast.error(`Not deleted. ${apiErrorMessage(e)}`),
  });
  const columns = useMemo<ColumnDef<Role, unknown>[]>(() => [
    { id: "key", header: "Key", cell: ({ row }) => <Mono>{row.original.key}</Mono> },
    { id: "name", header: "Name", cell: ({ row }) => row.original.name },
    { id: "kind", header: "Type", cell: ({ row }) => <Pill tone={row.original.built_in ? "neutral" : "go"}>{row.original.built_in ? "Built-in" : "Custom"}</Pill> },
    { id: "users", header: "Users", cell: ({ row }) => row.original.users ?? 0 },
    { id: "changed", header: "Last changed", cell: ({ row }) => row.original.updated_at ? relativeTime(row.original.updated_at) : "Never" },
    {
      id: "actions", header: "",
      cell: ({ row }) => {
        const r = row.original;
        const items = [{ label: "Clone", onSelect: () => setCloning(r.key) }];
        if (!r.built_in) items.push({ label: "Edit", onSelect: () => setEditing(r) }, { label: "Delete", onSelect: () => setDeleting(r) });
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <Menu trigger={<IconButton size="sm" aria-label={`Actions for ${r.name}`}><IconMore size={16} /></IconButton>} items={items} />
          </span>
        );
      },
    },
  ], []);

  if (error) return <ErrorState {...apiErrorState(error)} onRetry={retry} />;
  if (loading) return <Skeleton height={240} />;
  if (!roles.length) return <EmptyState title="No roles yet" detail="Built-in roles appear once the tenant is set up." ghost="list" action={<Button variant="secondary" onClick={retry}>Reload roles</Button>} />;
  return (
    <>
      <DataTable columns={columns} data={roles} getRowId={(r) => r.key} onRowClick={setOpen} />
      <Drawer open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }} title={open?.name ?? "Role"}>
        {open ? <RoleDrawer key={open.key} role={open} onClone={() => setCloning(open.key)} onSaved={refresh} /> : null}
      </Drawer>
      <CloneDialog roles={roles} from={cloning} onClose={() => setCloning(null)} onDone={() => { setCloning(null); refresh(); }} />
      <EditDialog role={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={`Delete ${deleting?.name ?? "role"}`}
        tone="danger"
        body={deleteRoleSentence(deleting)}
        confirmLabel="Delete role"
        cancelLabel="Keep role"
        typeToConfirm={deleting?.name}
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </>
  );
}

function RoleDrawer({ role, onClone, onSaved }: { role: Role; onClone: () => void; onSaved: () => void }) {
  const q = useQuery({ queryKey: ["role-matrix", role.key], queryFn: () => getRolePermissions(role.key) });
  const baseQ = useQuery({ queryKey: ["role-matrix", role.cloned_from], queryFn: () => getRolePermissions(role.cloned_from as string), enabled: !!role.cloned_from });
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Matrix | null>(null);
  const m = useMutation({
    mutationFn: (mx: Matrix) => putRolePermissions(role.key, matrixToPairs(mx)),
    onSuccess: () => { toast.success(`${role.name} saved`); setDraft(null); qc.invalidateQueries({ queryKey: ["role-matrix", role.key] }); onSaved(); },
    onError: (e) => toast.error(`Not saved. ${apiErrorMessage(e)}`),
  });
  if (q.isError) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton height={200} />;
  const matrix = draft ?? q.data.matrix;
  const diff = baseQ.data ? matrixDiff(baseQ.data.matrix, matrix) : null;
  return (
    <div className="flex flex-col gap-3">
      {role.description ? <p className="m-text-body m-ink-3">{role.description}</p> : null}
      {role.built_in ? (
        <div className="flex items-center gap-2">
          <Pill>Read-only</Pill>
          <Button variant="secondary" onClick={onClone}>Clone to edit</Button>
        </div>
      ) : null}
      {diff ? <p className="m-text-meta" aria-label="Difference from source role">+{diff.added} -{diff.removed} vs {role.cloned_from}</p> : null}
      <RoleMatrix label={`${role.name} permissions`} matrix={matrix} onChange={role.built_in ? undefined : setDraft} />
      {!role.built_in ? (
        <div className="flex gap-2">
          <Button disabled={!draft || m.isPending} onClick={() => draft && m.mutate(draft)}>Save permissions</Button>
          <Button variant="secondary" disabled={!draft} onClick={() => setDraft(null)}>Reset</Button>
        </div>
      ) : null}
      <RoleNavPreview roleKey={role.key} />
    </div>
  );
}

function CloneDialog({ roles, from, onClose, onDone }: { roles: Role[]; from: string | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [src, setSrc] = useState<string | null>(null);
  const source = src ?? from ?? "";
  const close = () => { setName(""); setSrc(null); onClose(); };
  const m = useMutation({
    mutationFn: () => cloneRole({ name, cloned_from: source }),
    onSuccess: () => { toast.success(`${name} created`); setName(""); setSrc(null); onDone(); },
    onError: (e) => toast.error(`Not cloned. ${apiErrorMessage(e)}`),
  });
  return (
    <Dialog open={!!from} onOpenChange={(o) => { if (!o) close(); }} title="Clone role">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) m.mutate(); }}>
        <Field label="Clone from"><Select options={roles.map((r) => ({ value: r.key, label: r.name }))} value={source} onValueChange={setSrc} /></Field>
        <Field label="New role name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={!name.trim() || m.isPending}>Create clone</Button>
          <Button type="button" variant="secondary" onClick={close}>Close</Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditDialog({ role, onClose, onDone }: { role: Role | null; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={!!role} onOpenChange={(o) => { if (!o) onClose(); }} title="Edit role">
      {role ? <EditForm key={role.key} role={role} onClose={onClose} onDone={onDone} /> : null}
    </Dialog>
  );
}

function EditForm({ role, onClose, onDone }: { role: Role; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const m = useMutation({
    mutationFn: () => updateRole(role.key, { name, description }),
    onSuccess: () => { toast.success(`${name} saved`); onDone(); },
    onError: (e) => toast.error(`Not saved. ${apiErrorMessage(e)}`),
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={!name.trim() || m.isPending}>Save</Button>
        <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </form>
  );
}

function UsersTab({ roles, onInvite }: { roles: Role[]; onInvite: () => void }) {
  // ?user=<id> (from Admin › Users) opens that person's grants; the URL holds the selection.
  const [selId, setSelId] = useUrlState("user", "");
  // ?expiring=1 lists people with a grant that has expired or ends within 30 days (the access review).
  const [expiring, setExpiring] = useUrlState("expiring", "");
  const onlyExpiring = expiring === "1";
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers });
  const all = useMemo(() => usersQ.data?.users ?? [], [usersQ.data]);
  const users = useMemo(() => (onlyExpiring ? all.filter((u) => hasExpiringGrant(u)) : all), [all, onlyExpiring]);
  const sel = selId ? all.find((u) => u.id === selId) ?? null : null;
  const setSel = (u: User | null) => setSelId(u?.id ?? "");
  const columns = useMemo<ColumnDef<User, unknown>[]>(() => [
    { id: "email", header: "Email", cell: ({ row }) => row.original.email },
    { id: "name", header: "Name", cell: ({ row }) => row.original.name },
    { id: "role", header: "Base role", cell: ({ row }) => labelOf(row.original.role) },
    { id: "status", header: "Status", cell: ({ row }) => <UserStatusPill user={row.original} /> },
    {
      id: "expires", header: "Expires",
      cell: ({ row }) => {
        const next = nextGrantExpiry(row.original);
        if (!next) return <span className="m-ink-3">Never</span>;
        return isPast(next) ? <Pill tone="at-risk">Expired {formatDate(next)}</Pill> : <span>{formatDate(next)}</span>;
      },
    },
  ], []);
  if (usersQ.isError) return <ErrorState {...apiErrorState(usersQ.error)} onRetry={() => usersQ.refetch()} />;
  if (usersQ.isLoading) return <Skeleton height={240} />;
  if (!all.length) return <EmptyState title="No users yet" detail="Invite the first one from the Invite tab." ghost="list" action={<Button onClick={() => onInvite()}>Invite user</Button>} />;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Choice pressed={onlyExpiring} onClick={() => setExpiring(onlyExpiring ? "" : "1")}>Expiring within 30 days</Choice>
      </div>
      <DataTable
        columns={columns} data={users} getRowId={(u) => u.id} onRowClick={setSel}
        emptyMessage={onlyExpiring ? "No one has a grant that expires within 30 days" : undefined}
      />
      <Drawer open={!!sel} onOpenChange={(o) => { if (!o) setSel(null); }} title={sel?.name ?? "User"}>
        {sel ? <UserScopes key={sel.id} user={sel} roles={roles} /> : null}
      </Drawer>
    </>
  );
}

function UserScopes({ user, roles }: { user: User; roles: Role[] }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [converted, setConverted] = useState(false);
  const [removing, setRemoving] = useState<GrantRowView | null>(null);
  // The grant being reviewed: written only after its diff has been shown and Save pressed.
  const [draft, setDraft] = useState<GrantInput | null>(null);
  const grantsQ = useQuery({ queryKey: ["grants", user.id], queryFn: () => listGrants(user.id) });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const systems = systemsQ.data ?? [];
  // A grant changes what the Users list shows for this person (their roles and scope), so it refetches too.
  const done = () => { qc.invalidateQueries({ queryKey: ["grants", user.id] }); qc.invalidateQueries({ queryKey: ["user-effective", user.id] }); qc.invalidateQueries({ queryKey: queryKeys.users() }); };
  const add = useMutation({ mutationFn: (g: Parameters<typeof addGrant>[1]) => addGrant(user.id, g), onSuccess: () => { setDraft(null); done(); }, onError: (e) => toast.error(`Grant not added. ${apiErrorMessage(e)}`) });
  const rem = useMutation({ mutationFn: (id: string) => deleteGrant(user.id, id), onSuccess: () => { setRemoving(null); done(); }, onError: (e) => toast.error(`Grant not removed. ${apiErrorMessage(e)}`) });
  const conv = useMutation({
    mutationFn: (confirm: boolean) => convertObjectApprovals(user.id, confirm),
    onSuccess: (r) => { setResult(r); if (r.confirmed) { setConverted(true); done(); } },
    onError: (e) => toast.error(`Not converted. ${apiErrorMessage(e)}`),
  });
  const legacy = !converted && user.permissions && Object.keys(user.permissions).length > 0;
  return (
    <div className="flex flex-col gap-4">
      <p className="m-text-body m-ink-3">{user.email}</p>
      <Card title="Grants">
        <GrantsPicker
          grants={grantsQ.data ?? []} roles={roles} systems={systems} busy={add.isPending || rem.isPending}
          onAdd={setDraft} onRemove={setRemoving} withExpiry addLabel="Review grant"
        />
        {draft ? (
          <GrantDiff userId={user.id} grant={draft} systems={systems} saving={add.isPending} onSave={() => add.mutate(draft)} onClose={() => setDraft(null)} />
        ) : null}
      </Card>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title={`Remove the ${removing ? roles.find((r) => r.key === removing.role_key)?.name ?? removing.role_key : ""} grant`}
        tone="danger"
        body={`${user.name} loses ${removing ? roles.find((r) => r.key === removing.role_key)?.name ?? removing.role_key : "this role"} at ${removing ? (scopeLabel(removing.system_id, removing.module, systems) === "all" ? "all systems" : scopeLabel(removing.system_id, removing.module, systems)) : ""} at once. Other grants stay.`}
        confirmLabel="Remove grant"
        cancelLabel="Keep grant"
        pending={rem.isPending}
        onConfirm={() => removing && rem.mutate(removing.id)}
      />
      {legacy ? (
        <Card title="Legacy object approvals">
          <Button variant="secondary" disabled={conv.isPending} onClick={() => conv.mutate(false)}>Convert to grants</Button>
          {result ? (
            <div className="m-text-meta flex flex-col gap-1">
              <p>Skipped (approve entries cannot become grants): {result.skipped.length ? result.skipped.join(", ") : "none"}</p>
              <p>Kept: {result.kept.length ? result.kept.join(", ") : "none"}</p>
              {!result.confirmed ? <Button onClick={() => conv.mutate(true)} disabled={conv.isPending}>Confirm conversion</Button> : <p>Conversion applied</p>}
            </div>
          ) : null}
        </Card>
      ) : null}
      <Card title="Effective permissions">
        <EffectivePermissionsView userId={user.id} systems={systems} />
      </Card>
    </div>
  );
}

function InviteTab() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <p className="m-text-body m-ink-3">Invite someone and choose what they can reach before they sign in.</p>
      <div><Button onClick={() => setOpen(true)}>Invite user</Button></div>
      <Drawer open={open} onOpenChange={setOpen} title="Invite a user">
        {open ? <InviteForm onDone={() => setOpen(false)} /> : null}
      </Drawer>
    </div>
  );
}

function RequestsTab({ roles }: { roles: Role[] }) {
  const qc = useQueryClient();
  const [granting, setGranting] = useState<AccessRequest | null>(null);
  const [role, setRole] = useState("");
  const [declining, setDeclining] = useState<AccessRequest | null>(null);
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["access-requests", "open"], queryFn: () => listAccessRequests("open") });
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const who = (id: string) => usersQ.data?.users.find((u) => u.id === id)?.email ?? "Unknown user";
  const where = (r: AccessRequest) => scopeLabel(r.system_id, r.module, systemsQ.data ?? []);
  const decide = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof decideAccessRequest>[1] }) => decideAccessRequest(v.id, v.body),
    onSuccess: () => { toast.success("Request decided"); setGranting(null); setDeclining(null); setReason(""); qc.invalidateQueries({ queryKey: ["access-requests"] }); },
    onError: (e) => toast.error(`Not decided. ${apiErrorMessage(e)}`),
  });
  if (q.isError) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <Skeleton height={160} />;
  const rows = q.data ?? [];
  if (!rows.length) return <EmptyState title="No open requests" detail="Access requests from users appear here for a decision." ghost="list" action={<Button variant="secondary" onClick={() => void q.refetch()}>Refresh</Button>} />;
  return (
    <>
      <ul className="flex flex-col gap-3" aria-label="Open access requests">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 m-text-body">
            <span>{who(r.user_id)} asks to {accessLabel(r.resource, r.action).toLowerCase()} at {where(r) === "all" ? "all systems" : where(r)}</span>
            <span className="m-ink-3">{r.reason}, {relativeTime(r.created_at)}</span>
            <Button onClick={() => { setRole(""); setGranting(r); }}>Grant</Button>
            <Button variant="secondary" onClick={() => setDeclining(r)}>Decline</Button>
          </li>
        ))}
      </ul>
      <Dialog open={!!granting} onOpenChange={(o) => { if (!o) setGranting(null); }} title="Grant access">
        <div className="flex flex-col gap-3">
          {granting ? <p className="m-text-body">{who(granting.user_id)}, {accessLabel(granting.resource, granting.action).toLowerCase()}, scope: {where(granting) === "all" ? "all systems" : where(granting)}. The grant is created at this scope</p> : null}
          <Field label="Role"><Select options={grantableRoles(roles).map((r) => ({ value: r.key, label: r.name }))} value={role} onValueChange={setRole} placeholder="Choose a role" /></Field>
          <div className="flex gap-2">
            <Button disabled={!role || decide.isPending} onClick={() => granting && decide.mutate({ id: granting.id, body: { decision: "granted", role_key: role } })}>Grant access</Button>
            <Button variant="secondary" onClick={() => setGranting(null)}>Close</Button>
          </div>
        </div>
      </Dialog>
      <Dialog open={!!declining} onOpenChange={(o) => { if (!o) setDeclining(null); }} title="Decline request">
        <div className="flex flex-col gap-3">
          <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
          <div className="flex gap-2">
            <Button disabled={!reason.trim() || decide.isPending} onClick={() => declining && decide.mutate({ id: declining.id, body: { decision: "declined", reason } })}>Decline request</Button>
            <Button variant="secondary" onClick={() => setDeclining(null)}>Close</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

const HISTORY_ACTIONS = ["role.create", "role.update", "role.delete", "grant.create", "grant.delete", "access_request.create", "access_request.decide", "api_key.create", "api_key.revoke", "api_key.delete"];

function HistoryTab() {
  const tz = useTenantTimezone();
  const columns = useMemo(() => historyCols(tz), [tz]);
  const qs = useQueries({
    queries: HISTORY_ACTIONS.map((action) => ({ queryKey: ["audit-history", action], queryFn: () => getAuditEntries({ action, limit: 50 }) })),
  });
  if (qs.some((q) => q.isError)) return <ErrorState {...apiErrorState(qs.find((q) => q.isError)?.error)} onRetry={() => qs.forEach((q) => q.refetch())} />;
  if (qs.some((q) => q.isLoading)) return <Skeleton height={240} />;
  const entries: AuditEntry[] = qs.flatMap((q) => q.data?.entries ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!entries.length) return <EmptyState title="No role changes yet" detail="Role, grant and request changes are listed here." ghost="list" action={<Button variant="secondary" onClick={() => qs.forEach((x) => void x.refetch())}>Refresh</Button>} />;
  return <DataTable columns={columns} data={entries} getRowId={(e) => e.id} />;
}

/** The same reading as Admin › Audit log: the time in the tenant zone and one sentence per action. */
const historyCols = (tz: string): ColumnDef<AuditEntry, unknown>[] => [
  { id: "when", header: "When", cell: ({ row }) => <When iso={row.original.created_at} tz={tz} /> },
  { id: "what", header: "What happened", cell: ({ row }) => auditSentence(row.original) },
  {
    id: "chg", header: "Change",
    cell: ({ row }) => {
      const lines = changeSentences(row.original.before_json, row.original.after_json);
      return lines.length ? <ul className="m-text-meta">{lines.map((l) => <li key={l}>{l}</li>)}</ul> : <span className="m-ink-3">No field changed</span>;
    },
  },
];

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const word = (v: unknown): string => (v === null || v === undefined || v === "" ? "nothing" : Array.isArray(v) ? v.map(word).join(", ") : typeof v === "object" ? JSON.stringify(v) : typeof v === "string" ? (v.includes("_") && !v.includes(" ") ? formatModuleName(v) : v) : String(v));

/** "Name: Ops to Ops 2", one sentence per field that differs between before and after. */
function changeSentences(before: unknown, after: unknown): string[] {
  const a = asRecord(before), b = asRecord(after);
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return keys.map((k) => {
    const label = labelOf(k);
    if (!(k in a)) return `${label}: ${word(b[k])}`;
    if (!(k in b)) return `${label}: ${word(a[k])} removed`;
    return `${label}: ${word(a[k])} to ${word(b[k])}`;
  });
}
