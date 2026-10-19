"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import Link from "next/link";
import { Button, Card, DataTable, Dialog, Drawer, EmptyState, ErrorState, Field, Input, Menu, Mono, Notice, PageHeader, Pill, Select, Skeleton, Tabs, IconMore } from "@/design";
import { EffectivePermissionsView } from "@/components/admin/effective-permissions";
import { GrantsPicker, scopeLabel } from "@/components/admin/grants-picker";
import { InviteForm } from "@/components/admin/invite-form";
import { matrixDiff, matrixToPairs, RoleMatrix } from "@/components/admin/role-matrix";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { getAuditEntries, type AuditEntry } from "@/lib/api/audit";
import { getSystems } from "@/lib/api/connectivity";
import { decideAccessRequest, listAccessRequests, type AccessRequest } from "@/lib/api/me";
import {
  addGrant, cloneRole, convertObjectApprovals, deleteGrant, deleteRole, getRolePermissions, listGrants, listRoles,
  putRolePermissions, updateRole, type ConvertResult, type Matrix, type Role,
} from "@/lib/api/roles";
import { getUsers } from "@/lib/api/users";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { User } from "@/types/api";

const TABS = ["roles", "users", "invite", "requests", "history"] as const;

export default function AdminRolesPage() {
  const { can, loading } = useRole();
  const [raw, setTab] = useUrlState("tab", "roles");
  const tab = (TABS as readonly string[]).includes(raw) ? raw : "roles";
  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: listRoles });

  if (loading) return <div aria-busy="true"><Skeleton height={320} /></div>;
  if (!can("manage_users")) {
    return (
      <div>
        <EmptyState title="Needs the manage_users permission" detail="Ask an administrator to change roles or grants." ghost="list" action={<Button variant="secondary" render={<Link href="/home">Back to home</Link>} />} />
      </div>
    );
  }
  const roles = rolesQ.data ?? [];
  const custom = roles.filter((r) => !r.built_in).length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Roles and access" meta={`${roles.length} roles, ${custom} custom`} />
      <Notice tone="info">Built-in roles are read-only, clone one to change it. Grant a role at a system or module to scope it, so people get the least access that lets them work.</Notice>
      <Tabs
        value={tab} onValueChange={setTab}
        items={[
          { value: "roles", label: "Roles", content: <RolesTab roles={roles} loading={rolesQ.isLoading} error={rolesQ.isError ? rolesQ.error : null} retry={() => rolesQ.refetch()} /> },
          { value: "users", label: "Users & scopes", content: <UsersTab roles={roles} onInvite={() => setTab("invite")} /> },
          { value: "invite", label: "Invite", content: <InviteTab /> },
          { value: "requests", label: "Requests", content: <RequestsTab roles={roles} /> },
          { value: "history", label: "History", content: <HistoryTab /> },
        ]}
      />
    </div>
  );
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
            <Menu trigger={<button aria-label={`Actions for ${r.name}`}><IconMore size={16} /></button>} items={items} />
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
      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} title={`Delete ${deleting?.name ?? "role"}?`}>
        <div className="flex flex-col gap-3">
          <p className="m-text-body m-ink-3">Users holding it lose its grants.</p>
          <div className="flex gap-2">
            <Button disabled={del.isPending} onClick={() => deleting && del.mutate(deleting)}>Delete role</Button>
            <Button variant="secondary" onClick={() => setDeleting(null)}>Keep role</Button>
          </div>
        </div>
      </Dialog>
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
  const [sel, setSel] = useState<User | null>(null);
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers });
  const users = usersQ.data?.users ?? [];
  const columns = useMemo<ColumnDef<User, unknown>[]>(() => [
    { id: "email", header: "Email", cell: ({ row }) => row.original.email },
    { id: "name", header: "Name", cell: ({ row }) => row.original.name },
    { id: "role", header: "Legacy role", cell: ({ row }) => <Mono>{row.original.role}</Mono> },
    { id: "status", header: "Status", cell: ({ row }) => <Pill tone={row.original.is_active ? "go" : "neutral"}>{row.original.is_active ? "Active" : "Suspended"}</Pill> },
  ], []);
  if (usersQ.isError) return <ErrorState {...apiErrorState(usersQ.error)} onRetry={() => usersQ.refetch()} />;
  if (usersQ.isLoading) return <Skeleton height={240} />;
  if (!users.length) return <EmptyState title="No users yet" detail="Invite the first one from the Invite tab." ghost="list" action={<Button onClick={() => onInvite()}>Invite user</Button>} />;
  return (
    <>
      <DataTable columns={columns} data={users} getRowId={(u) => u.id} onRowClick={setSel} />
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
  const grantsQ = useQuery({ queryKey: ["grants", user.id], queryFn: () => listGrants(user.id) });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const systems = systemsQ.data ?? [];
  const done = () => { qc.invalidateQueries({ queryKey: ["grants", user.id] }); qc.invalidateQueries({ queryKey: ["user-effective", user.id] }); };
  const add = useMutation({ mutationFn: (g: Parameters<typeof addGrant>[1]) => addGrant(user.id, g), onSuccess: done, onError: (e) => toast.error(`Grant not added. ${apiErrorMessage(e)}`) });
  const rem = useMutation({ mutationFn: (id: string) => deleteGrant(user.id, id), onSuccess: done, onError: (e) => toast.error(`Grant not removed. ${apiErrorMessage(e)}`) });
  const conv = useMutation({
    mutationFn: (confirm: boolean) => convertObjectApprovals(user.id, confirm),
    onSuccess: (r) => { setResult(r); if (r.confirmed) { setConverted(true); done(); qc.invalidateQueries({ queryKey: queryKeys.users() }); } },
    onError: (e) => toast.error(`Not converted. ${apiErrorMessage(e)}`),
  });
  const legacy = !converted && user.permissions && Object.keys(user.permissions).length > 0;
  return (
    <div className="flex flex-col gap-4">
      <p className="m-text-body m-ink-3">{user.email}</p>
      <Card title="Grants">
        <GrantsPicker
          grants={grantsQ.data ?? []} roles={roles} systems={systems} busy={add.isPending || rem.isPending}
          onAdd={(g) => add.mutate(g)} onRemove={(g) => rem.mutate(g.id)}
        />
      </Card>
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
            <span>{who(r.user_id)} wants <Mono>{r.resource} {r.action}</Mono> at {where(r) === "all" ? "all systems" : where(r)}</span>
            <span className="m-ink-3">{r.reason}, {relativeTime(r.created_at)}</span>
            <Button onClick={() => { setRole(""); setGranting(r); }}>Grant</Button>
            <Button variant="secondary" onClick={() => setDeclining(r)}>Decline</Button>
          </li>
        ))}
      </ul>
      <Dialog open={!!granting} onOpenChange={(o) => { if (!o) setGranting(null); }} title="Grant access">
        <div className="flex flex-col gap-3">
          {granting ? <p className="m-text-body">{who(granting.user_id)}, {granting.resource} {granting.action}, scope: {where(granting) === "all" ? "all systems" : where(granting)}. The grant is created at this scope</p> : null}
          <Field label="Role"><Select options={roles.map((r) => ({ value: r.key, label: r.name }))} value={role} onValueChange={setRole} placeholder="Choose a role" /></Field>
          <div className="flex gap-2">
            <Button disabled={!role || decide.isPending} onClick={() => granting && decide.mutate({ id: granting.id, body: { decision: "granted", role_key: role } })}>Grant access</Button>
            <Button variant="secondary" onClick={() => setGranting(null)}>Close</Button>
          </div>
        </div>
      </Dialog>
      <Dialog open={!!declining} onOpenChange={(o) => { if (!o) setDeclining(null); }} title="Decline request">
        <div className="flex flex-col gap-3">
          <Field label="Reason"><textarea className="m-input [height:auto] [padding:6px_10px]" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
          <div className="flex gap-2">
            <Button disabled={!reason.trim() || decide.isPending} onClick={() => declining && decide.mutate({ id: declining.id, body: { decision: "declined", reason } })}>Decline request</Button>
            <Button variant="secondary" onClick={() => setDeclining(null)}>Close</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

const HISTORY_ACTIONS = ["role.create", "role.update", "role.delete", "grant.create", "grant.delete", "access_request.create", "access_request.decide"];

function HistoryTab() {
  const qs = useQueries({
    queries: HISTORY_ACTIONS.map((action) => ({ queryKey: ["audit-history", action], queryFn: () => getAuditEntries({ action, limit: 50 }) })),
  });
  if (qs.some((q) => q.isError)) return <ErrorState {...apiErrorState(qs.find((q) => q.isError)?.error)} onRetry={() => qs.forEach((q) => q.refetch())} />;
  if (qs.some((q) => q.isLoading)) return <Skeleton height={240} />;
  const entries: AuditEntry[] = qs.flatMap((q) => q.data?.entries ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!entries.length) return <EmptyState title="No role changes yet" detail="Role, grant and request changes are listed here." ghost="list" action={<Button variant="secondary" onClick={() => qs.forEach((x) => void x.refetch())}>Refresh</Button>} />;
  return <DataTable columns={historyCols} data={entries} getRowId={(e) => e.id} />;
}

const historyCols: ColumnDef<AuditEntry, unknown>[] = [
  { id: "when", header: "When", cell: ({ row }) => <time dateTime={row.original.created_at}>{relativeTime(row.original.created_at)}</time> },
  { id: "who", header: "Actor", cell: ({ row }) => row.original.actor_email ?? "system" },
  { id: "act", header: "Action", cell: ({ row }) => <span><Mono>{row.original.action}</Mono> {row.original.entity_id ?? ""}</span> },
  {
    id: "chg", header: "Change",
    cell: ({ row }) => (
      <details>
        <summary>Before and after</summary>
        <pre>{JSON.stringify({ before: row.original.before_json, after: row.original.after_json }, null, 2)}</pre>
      </details>
    ),
  },
];
