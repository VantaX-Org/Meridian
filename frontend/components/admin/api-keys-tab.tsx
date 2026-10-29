"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Field, IconButton, IconMore, Input, Menu, Mono, Notice, Pill, Skeleton, toast, type PillTone } from "@/design";
import { listApiKeys, createApiKey, deleteApiKey, revokeApiKey, type ApiKey, type ApiKeyCreated, type ApiKeyGrantInput, type ApiKeyStatus } from "@/lib/api/api-keys";
import { getSystems } from "@/lib/api/connectivity";
import { listRoles, type Role } from "@/lib/api/roles";
import { copyToClipboard } from "@/lib/actions";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate, relativeTime } from "@/lib/format";
import { grantLabel } from "@/lib/roles";
import { queryKeys } from "@/lib/query-keys";
import { useTenantTimezone } from "@/lib/tenant-zone";
import { GrantsPicker, type GrantRowView } from "./grants-picker";
import { localId } from "@/lib/browser";

const API_KEYS_KEY = ["api-keys"] as const;

const STATUS_LABEL: Record<ApiKeyStatus, string> = { active: "Active", expired: "Expired", revoked: "Revoked", suspended: "Suspended" };
const STATUS_TONE: Record<ApiKeyStatus, PillTone> = { active: "go", expired: "at-risk", revoked: "neutral", suspended: "at-risk" };

/** A key never holds administration (the API refuses it): the picker does not offer those roles. */
const ADMIN_ROLE_KEYS: ReadonlySet<string> = new Set(["platform_admin", "admin"]);

/** The first day a key may expire on: the API refuses an expiry in the past. */
const tomorrow = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

/** Roles and access, API keys: keys for schedulers and scripts, each acting as a service account with its own grants. */
export function ApiKeysTab() {
  const qc = useQueryClient();
  const tz = useTenantTimezone();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [deleting, setDeleting] = useState<ApiKey | null>(null);
  const keysQ = useQuery({ queryKey: API_KEYS_KEY, queryFn: listApiKeys });
  const refresh = () => qc.invalidateQueries({ queryKey: API_KEYS_KEY });
  const revoke = useMutation({
    mutationFn: (k: ApiKey) => revokeApiKey(k.id),
    onSuccess: (_, k) => { toast.success(`${k.name} revoked`); setRevoking(null); void refresh(); },
    onError: (e) => toast.error(`Not revoked. ${apiErrorMessage(e)}`),
  });
  const del = useMutation({
    mutationFn: (k: ApiKey) => deleteApiKey(k.id),
    onSuccess: (_, k) => { toast.success(`${k.name} deleted`); setDeleting(null); void refresh(); },
    onError: (e) => toast.error(`Not deleted. ${apiErrorMessage(e)}`),
  });

  const columns = useMemo<ColumnDef<ApiKey, unknown>[]>(() => [
    { id: "name", header: "Name", cell: ({ row }) => row.original.name },
    { id: "prefix", header: "Key", cell: ({ row }) => <Mono>{`mk_${row.original.key_prefix}`}</Mono> },
    {
      id: "roles", header: "Roles",
      cell: ({ row }) => row.original.grants.length
        ? row.original.grants.map((g) => grantLabel(g.role_name, g.role_key, g.system_name, g.module)).join("; ")
        : <span className="m-ink-3">None</span>,
    },
    { id: "created", header: "Created", cell: ({ row }) => formatDate(row.original.created_at, "date", tz, false) },
    { id: "expires", header: "Expires", cell: ({ row }) => row.original.expires_at ? formatDate(row.original.expires_at, "date", tz, false) : <span className="m-ink-3">Never</span> },
    { id: "used", header: "Last used", cell: ({ row }) => row.original.last_used_at ? relativeTime(row.original.last_used_at) : <span className="m-ink-3">Never used</span> },
    { id: "status", header: "Status", cell: ({ row }) => <Pill tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Pill> },
    {
      id: "actions", header: "",
      cell: ({ row }) => {
        const k = row.original;
        const items = [
          ...(k.status === "revoked" ? [] : [{ label: "Revoke", onSelect: () => setRevoking(k) }]),
          { label: "Delete", onSelect: () => setDeleting(k) },
        ];
        return <Menu trigger={<IconButton size="sm" aria-label={`Actions for ${k.name}`}><IconMore size={16} /></IconButton>} items={items} />;
      },
    },
  ], [tz]);

  if (keysQ.isError) return <ErrorState {...apiErrorState(keysQ.error)} onRetry={() => keysQ.refetch()} />;
  if (keysQ.isLoading) return <Skeleton height={240} />;
  const keys = keysQ.data ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="m-text-body m-ink-3">A key lets a scheduler or script call Meridian without a browser. It acts as its own service account and can do only what the roles you choose allow. It never holds administration.</p>
      <div><Button onClick={() => setCreating(true)}>Create API key</Button></div>
      {keys.length ? (
        <DataTable columns={columns} data={keys} getRowId={(k) => k.id} label="API keys" />
      ) : (
        <EmptyState title="No API keys yet" detail="Create a key for the scheduler or script that triggers extraction or pulls reports." ghost="list" action={<Button onClick={() => setCreating(true)}>Create API key</Button>} />
      )}
      <Drawer open={creating} onOpenChange={setCreating} title="Create an API key">
        {creating ? <CreateKey onDone={() => { setCreating(false); void refresh(); }} onCreated={() => void refresh()} /> : null}
      </Drawer>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => { if (!o) setRevoking(null); }}
        title={`Revoke ${revoking?.name ?? "key"}`}
        tone="danger"
        body="Anything using this key stops working at once. A revoked key cannot be used again."
        confirmLabel="Revoke key"
        cancelLabel="Keep key"
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={`Delete ${deleting?.name ?? "key"}`}
        tone="danger"
        body="The key stops working and is removed from this list. When it is the service account's last key, the account is suspended and its roles are removed. Deleting cannot be undone."
        confirmLabel="Delete key"
        cancelLabel="Keep key"
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </div>
  );
}

type PickedGrant = GrantRowView & ApiKeyGrantInput;

function CreateKey({ onDone, onCreated }: { onDone: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [grants, setGrants] = useState<PickedGrant[]>([]);
  // Held only here, in this drawer: closing it forgets the key, which the server cannot show again.
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: listRoles });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const roles: Role[] = (rolesQ.data ?? []).filter((r) => !ADMIN_ROLE_KEYS.has(r.key));
  const m = useMutation({
    mutationFn: () => createApiKey({
      name: name.trim(),
      grants: grants.map((g) => ({ role_key: g.role_key, system_id: g.system_id ?? null, module: g.module ?? null })),
      ...(expires ? { expires_at: `${expires}T23:59:59Z` } : {}),
    }),
    onSuccess: (key) => { setCreated(key); onCreated(); },
    onError: (e) => toast.error(`Key not created. ${apiErrorMessage(e)}`),
  });

  if (created) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="warning" title="Copy this key now">This key will not be shown again. Store it where your scheduler keeps secrets. If you lose it, revoke it and create a new one.</Notice>
        <Field label={`Key for ${created.name}`}>
          <div data-testid="new-api-key" className="break-all"><Mono>{created.key}</Mono></div>
        </Field>
        <p className="m-text-meta m-ink-3">Send it as a header on each request: Authorization: Bearer followed by the key.</p>
        <div className="flex gap-2">
          <Button onClick={() => void copyToClipboard(created.key, "Key copied")}>Copy key</Button>
          <Button variant="secondary" onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim() && grants.length) m.mutate(); }}>
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Nightly extraction" required /></Field>
      <p className="m-text-meta m-ink-3">Choose what the key may do. It gets only these roles, at the system or object you pick.</p>
      <GrantsPicker
        grants={grants} roles={roles} systems={systemsQ.data ?? []} busy={m.isPending} addLabel="Add role"
        onAdd={(g) => setGrants((cur) => {
          const system_id = g.system_id ?? null, mod = g.module ?? null;
          if (cur.some((c) => c.role_key === g.role_key && c.system_id === system_id && c.module === mod)) return cur;
          return [...cur, { id: localId(), role_key: g.role_key, system_id, module: mod }];
        })}
        onRemove={(g) => setGrants((cur) => cur.filter((c) => c.id !== g.id))}
      />
      <Field label="Expires (optional)"><Input type="date" value={expires} min={tomorrow()} onChange={(e) => setExpires(e.target.value)} /></Field>
      <p className="m-text-meta m-ink-3">{expires ? `The key stops working at the end of ${formatDate(`${expires}T00:00:00Z`)}.` : "Without a date the key never expires. Prefer a date, and renew it before then."}</p>
      <div className="flex gap-2">
        <Button type="submit" disabled={!name.trim() || grants.length === 0 || m.isPending}>Create key</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Close</Button>
      </div>
    </form>
  );
}
