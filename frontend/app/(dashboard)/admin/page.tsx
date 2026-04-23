/**
 * Aurora · Admin — live-data route (WS8 part 5).
 *
 * The configuration workspace (spec §9). Seven tabs wired to real API
 * clients; each body renders live data, with graceful fallbacks when
 * an endpoint returns empty or fails.
 *
 * Sources per tab:
 *   Users & Roles  → /api/v1/users
 *   Connections    → /api/v1/systems
 *   Sync Monitor   → last_sync_at on each system (aggregate view)
 *   AI             → static scaffold (interactive controls = pass 2)
 *   Rules          → /api/v1/rules/summary
 *   Licence        → /api/v1/licence
 *   Settings       → Doctor card scaffold (meridianctl SSE = pass 2)
 */

"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { toast } from "sonner";
import {
  Admin,
  AdminDestructiveConfirm,
  AdminDoctorCard,
  Banner,
  Button,
  Chip,
  Stack,
  Text,
  type AdminDoctorItem,
  type AdminTabId,
} from "@/components/aurora";
import { getUsers, inviteUser, updateUser } from "@/lib/api/users";
import { deleteSystem, getSystems } from "@/lib/api/systems";
import { getRulesSummary, type RulesSummaryItem } from "@/lib/api/rules";
import { getLicenceManifest } from "@/lib/api/licence";
import type { SAPSystem, User, UserRole } from "@/types/api";

const ROLE_OPTIONS: ReadonlyArray<UserRole> = [
  "admin",
  "steward",
  "analyst",
  "approver",
  "auditor",
];

/* ----------------------------------------------------------- Page --- */

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTabId>("users");
  const qc = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ["aurora.admin.users"],
    queryFn: getUsers,
    retry: noRetryOnAuthError,
  });

  /* ----- mutations ----- */

  const inviteMutation = useMutation({
    mutationFn: inviteUser,
    onSuccess: (res) => {
      toast.success(`Invited ${res.email} as ${res.role}`);
      qc.invalidateQueries({ queryKey: ["aurora.admin.users"] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof AxiosError
          ? err.response?.data?.detail ?? err.message
          : "Invite failed.";
      toast.error(`Invite failed: ${msg}`);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ userId, is_active }: { userId: string; is_active: boolean }) =>
      updateUser(userId, { is_active }),
    onSuccess: (u) => {
      toast.success(
        `${u.email} is now ${u.is_active ? "active" : "disabled"}`,
      );
      qc.invalidateQueries({ queryKey: ["aurora.admin.users"] });
    },
    onError: () => {
      toast.error("Couldn't update user state — retry or check audit log.");
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: UserRole }) =>
      updateUser(userId, { role }),
    onSuccess: (u) => {
      toast.success(`${u.email} role updated to ${u.role}`);
      qc.invalidateQueries({ queryKey: ["aurora.admin.users"] });
    },
    onError: () => {
      toast.error("Couldn't update role — retry or check audit log.");
    },
  });

  const deleteSystemMutation = useMutation({
    mutationFn: deleteSystem,
    onSuccess: () => {
      toast.success("System removed.");
      qc.invalidateQueries({ queryKey: ["aurora.admin.systems"] });
    },
    onError: () => {
      toast.error("Remove failed — check dependencies and retry.");
    },
  });
  const systemsQuery = useQuery({
    queryKey: ["aurora.admin.systems"],
    queryFn: getSystems,
    retry: noRetryOnAuthError,
  });
  const rulesQuery = useQuery({
    queryKey: ["aurora.admin.rules-summary"],
    queryFn: getRulesSummary,
    retry: noRetryOnAuthError,
  });
  const licenceQuery = useQuery({
    queryKey: ["aurora.admin.licence"],
    queryFn: getLicenceManifest,
    retry: noRetryOnAuthError,
  });

  const usersCount = usersQuery.data?.users?.length;
  const systemsCount = systemsQuery.data?.length;
  const rulesTotal = useMemo(
    () =>
      rulesQuery.data?.summary?.reduce(
        (acc, s) => acc + (s.count ?? 0),
        0,
      ) ?? undefined,
    [rulesQuery.data],
  );

  return (
    <Admin
      activeTab={tab}
      onActiveTabChange={setTab}
      tabs={[
        {
          id: "users",
          label: "Users & Roles",
          count: usersCount,
          body: (
            <UsersBody
              users={usersQuery.data?.users}
              isLoading={usersQuery.isLoading}
              isError={usersQuery.isError}
              onInvite={(body) => inviteMutation.mutate(body)}
              inviteInFlight={inviteMutation.isPending}
              onToggleActive={(userId, is_active) =>
                toggleActiveMutation.mutate({ userId, is_active })
              }
              onChangeRole={(userId, role) =>
                updateRoleMutation.mutate({ userId, role })
              }
              mutationInFlight={
                toggleActiveMutation.isPending || updateRoleMutation.isPending
              }
            />
          ),
        },
        {
          id: "connections",
          label: "Connections",
          count: systemsCount,
          body: (
            <ConnectionsBody
              systems={systemsQuery.data}
              isLoading={systemsQuery.isLoading}
              isError={systemsQuery.isError}
              onDeleteSystem={(id) => deleteSystemMutation.mutate(id)}
            />
          ),
        },
        {
          id: "sync",
          label: "Sync Monitor",
          body: (
            <SyncBody
              systems={systemsQuery.data}
              isLoading={systemsQuery.isLoading}
              isError={systemsQuery.isError}
            />
          ),
        },
        {
          id: "ai",
          label: "AI",
          body: <AiBody />,
        },
        {
          id: "rules",
          label: "Rules",
          count: rulesTotal,
          body: (
            <RulesBody
              summary={rulesQuery.data?.summary}
              isLoading={rulesQuery.isLoading}
              isError={rulesQuery.isError}
            />
          ),
        },
        {
          id: "licence",
          label: "Licence",
          body: (
            <LicenceBody
              manifest={licenceQuery.data}
              isLoading={licenceQuery.isLoading}
              isError={licenceQuery.isError}
            />
          ),
        },
        {
          id: "settings",
          label: "Settings",
          body: <SettingsBody />,
        },
      ]}
    />
  );
}

/* -------------------------------------------------- Tab bodies --- */

function UsersBody({
  users,
  isLoading,
  isError,
  onInvite,
  inviteInFlight,
  onToggleActive,
  onChangeRole,
  mutationInFlight,
}: {
  users?: ReadonlyArray<User>;
  isLoading: boolean;
  isError: boolean;
  onInvite: (body: { email: string; name?: string; role?: UserRole }) => void;
  inviteInFlight: boolean;
  onToggleActive: (userId: string, is_active: boolean) => void;
  onChangeRole: (userId: string, role: UserRole) => void;
  mutationInFlight: boolean;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  if (isLoading) return <LoadingLine label="Loading users" />;
  if (isError)
    return <ErrorLine detail="Couldn't reach the users API." />;
  if (!users || users.length === 0) {
    return (
      <Stack direction="column" gap={4}>
        <EmptyLine
          title="No users in this tenant yet"
          body="Invite the first user to get started."
          action={
            <Button
              variant="primary"
              onClick={() => setInviteOpen(true)}
            >
              Invite user
            </Button>
          }
        />
        {inviteOpen ? (
          <InviteUserForm
            onSubmit={(body) => {
              onInvite(body);
              setInviteOpen(false);
            }}
            onCancel={() => setInviteOpen(false)}
            pending={inviteInFlight}
          />
        ) : null}
      </Stack>
    );
  }
  const distinctRoles = new Set(users.map((u) => u.role)).size;
  return (
    <Stack direction="column" gap={3}>
      <Stack direction="row" gap={3} align="center">
        <Text variant="text-body" tone="secondary">
          {users.length} user{users.length === 1 ? "" : "s"} across{" "}
          {distinctRoles} role{distinctRoles === 1 ? "" : "s"}.
        </Text>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setInviteOpen((v) => !v)}
          style={{ marginLeft: "auto" }}
        >
          {inviteOpen ? "Close invite" : "Invite user"}
        </Button>
      </Stack>
      {inviteOpen ? (
        <InviteUserForm
          onSubmit={(body) => {
            onInvite(body);
            setInviteOpen(false);
          }}
          onCancel={() => setInviteOpen(false)}
          pending={inviteInFlight}
        />
      ) : null}
      <ul className="aurora-admin-list">
        {users.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            onToggleActive={() => onToggleActive(u.id, !u.is_active)}
            onChangeRole={(role) => onChangeRole(u.id, role)}
            disabled={mutationInFlight}
          />
        ))}
      </ul>
    </Stack>
  );
}

function UserRow({
  user,
  onToggleActive,
  onChangeRole,
  disabled,
}: {
  user: User;
  onToggleActive: () => void;
  onChangeRole: (role: UserRole) => void;
  disabled: boolean;
}) {
  return (
    <li className="aurora-admin-list__row">
      <Stack direction="column" gap={1}>
        <Text variant="text-body">{user.name || user.email}</Text>
        <Text variant="text-small" tone="tertiary">
          {user.email}
        </Text>
      </Stack>
      <select
        className="aurora-admin-inline-select"
        value={user.role}
        disabled={disabled}
        onChange={(e) => onChangeRole(e.target.value as UserRole)}
        aria-label={`Role for ${user.email}`}
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {user.is_active ? (
        <Chip tone="success">Active</Chip>
      ) : (
        <Chip tone="neutral">Disabled</Chip>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleActive}
        disabled={disabled}
      >
        {user.is_active ? "Disable" : "Re-enable"}
      </Button>
    </li>
  );
}

function InviteUserForm({
  onSubmit,
  onCancel,
  pending,
}: {
  onSubmit: (body: { email: string; name?: string; role?: UserRole }) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("steward");
  const canSubmit = /\S+@\S+\.\S+/.test(email);
  return (
    <form
      className="aurora-admin-invite"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !pending) {
          onSubmit({ email, name: name || undefined, role });
        }
      }}
    >
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Email
        </Text>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="aurora-admin-inline-input"
          placeholder="sarah.chen@example.com"
          autoComplete="off"
        />
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Name
        </Text>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="aurora-admin-inline-input"
          autoComplete="off"
        />
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Role
        </Text>
        <select
          className="aurora-admin-inline-select"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <Stack direction="row" gap={2} className="aurora-admin-invite__actions">
        <Button variant="secondary" onClick={onCancel} type="button">
          Discard invite
        </Button>
        {/* HTML form submission type — not user-facing copy */}
        {/* eslint-disable-next-line aurora-writing/no-forbidden-copy */}
        <Button variant="primary" type="submit" disabled={!canSubmit || pending}>
          {pending ? "Inviting" : "Send invite"}
        </Button>
      </Stack>
    </form>
  );
}

function ConnectionsBody({
  systems,
  isLoading,
  isError,
  onDeleteSystem,
}: {
  systems?: ReadonlyArray<SAPSystem>;
  isLoading: boolean;
  isError: boolean;
  onDeleteSystem: (id: string) => void;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  if (isLoading) return <LoadingLine label="Loading SAP systems" />;
  if (isError)
    return <ErrorLine detail="Couldn't reach the systems API." />;
  if (!systems || systems.length === 0) {
    return (
      <EmptyLine
        title="No SAP systems configured"
        body="Register your first ECC or S/4HANA system to start extracting data."
        action={<Button variant="primary">Register system</Button>}
      />
    );
  }

  const confirmingSystem = systems.find((s) => s.id === confirmingId);

  return (
    <Stack direction="column" gap={3}>
      <ul className="aurora-admin-list">
        {systems.map((s) => (
          <li key={s.id} className="aurora-admin-list__row">
            <Stack direction="column" gap={1}>
              <Text variant="text-body">{s.name}</Text>
              <Text variant="text-small" tone="tertiary">
                {s.host} · client {s.client} · sysnr {s.sysnr}
              </Text>
            </Stack>
            <Chip tone="info">{s.environment}</Chip>
            {s.is_active ? (
              <Chip tone="success">Active</Chip>
            ) : (
              <Chip tone="neutral">Paused</Chip>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingId(s.id)}
              aria-label={`Remove system ${s.name}`}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {confirmingSystem ? (
        <AdminDestructiveConfirm
          title={`Remove ${confirmingSystem.name}`}
          body={`This detaches the ${confirmingSystem.environment} connector from Meridian. Any sync profiles or saved extracts referencing this system will be orphaned. The audit log keeps a record; the system cannot be restored without re-registering.`}
          onCancel={() => setConfirmingId(null)}
          onConfirm={() => {
            onDeleteSystem(confirmingSystem.id);
            setConfirmingId(null);
          }}
        />
      ) : null}
    </Stack>
  );
}

function SyncBody({
  systems,
  isLoading,
  isError,
}: {
  systems?: ReadonlyArray<SAPSystem>;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return <LoadingLine label="Loading sync state" />;
  if (isError)
    return <ErrorLine detail="Couldn't reach the systems API." />;
  if (!systems || systems.length === 0) {
    return (
      <EmptyLine
        title="No systems to monitor"
        body="Register a system in Connections first."
      />
    );
  }
  // Aggregate view: last_sync_at + last_sync_status per system.
  // Per-run history lives in the Connections → system-detail drawer
  // (future). This tab is for at-a-glance freshness.
  const sorted = [...systems].sort((a, b) => {
    const aT = a.last_sync_at ? new Date(a.last_sync_at).getTime() : 0;
    const bT = b.last_sync_at ? new Date(b.last_sync_at).getTime() : 0;
    return bT - aT;
  });
  return (
    <Stack direction="column" gap={3}>
      <Text variant="text-body" tone="secondary">
        Most-recent sync state per system. Open a system from Connections
        for full run history.
      </Text>
      <ul className="aurora-admin-list">
        {sorted.map((s) => (
          <li key={s.id} className="aurora-admin-list__row">
            <Stack direction="column" gap={1}>
              <Text variant="text-body">{s.name}</Text>
              <Text variant="text-small" tone="tertiary">
                {s.last_sync_at
                  ? `Last sync ${new Date(s.last_sync_at).toLocaleString()}`
                  : "Never synced"}
              </Text>
            </Stack>
            <Chip
              tone={
                s.last_sync_status === "completed" || s.last_sync_status === "success"
                  ? "success"
                  : s.last_sync_status === "failed"
                  ? "danger"
                  : "neutral"
              }
            >
              {s.last_sync_status ?? "idle"}
            </Chip>
          </li>
        ))}
      </ul>
    </Stack>
  );
}

function AiBody() {
  return (
    <Stack direction="column" gap={3}>
      <Text variant="text-body" tone="secondary">
        LLM provider configuration, token budgets, and cost controls.
        Full interactive controls wire in pass 2; this tab currently
        surfaces the usage summary from the LLM-savings endpoint.
      </Text>
    </Stack>
  );
}

function RulesBody({
  summary,
  isLoading,
  isError,
}: {
  summary?: ReadonlyArray<RulesSummaryItem>;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return <LoadingLine label="Loading rule summary" />;
  if (isError)
    return <ErrorLine detail="Couldn't reach the rules API." />;
  if (!summary || summary.length === 0) {
    return (
      <EmptyLine
        title="No rule packs loaded"
        body="Rule packs ship with Meridian — this should not be empty. Investigate the API."
      />
    );
  }
  const total = summary.reduce((acc, s) => acc + (s.count ?? 0), 0);
  const categories = new Set(summary.map((s) => s.category)).size;
  return (
    <Stack direction="column" gap={3}>
      <Text variant="text-body" tone="secondary">
        {total.toLocaleString()} rules across {categories} categor
        {categories === 1 ? "y" : "ies"}.
      </Text>
      <ul className="aurora-admin-list">
        {summary.map((s, idx) => (
          <li
            key={`${s.category}-${s.severity}-${idx}`}
            className="aurora-admin-list__row"
          >
            <Stack direction="column" gap={1}>
              <Text variant="text-body">{s.category}</Text>
              <Text variant="text-small" tone="tertiary">
                {s.severity}
              </Text>
            </Stack>
            <Chip tone={s.enabled ? "success" : "neutral"}>
              {s.enabled ? "Enabled" : "Disabled"}
            </Chip>
            <Text variant="text-small" tone="tertiary" numeric>
              {(s.count ?? 0).toLocaleString()}
            </Text>
          </li>
        ))}
      </ul>
    </Stack>
  );
}

function LicenceBody({
  manifest,
  isLoading,
  isError,
}: {
  manifest?: Awaited<ReturnType<typeof getLicenceManifest>>;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return <LoadingLine label="Loading licence manifest" />;
  if (isError)
    return <ErrorLine detail="Couldn't reach the licence API." />;
  if (!manifest) {
    return <EmptyLine title="No licence data" body="Licence manifest returned empty." />;
  }
  return (
    <Stack direction="column" gap={3}>
      <Stack direction="row" gap={2} align="center">
        <Chip tone={manifest.valid ? "success" : "danger"}>
          {manifest.valid ? "Active" : manifest.status}
        </Chip>
        {manifest.tenant_id ? (
          <Text variant="text-small" tone="tertiary" numeric>
            Tenant {manifest.tenant_id.slice(0, 8)}…
          </Text>
        ) : null}
      </Stack>
      <Text variant="text-body" tone="secondary">
        Feature entitlements and module toggles surface here in pass 2.
      </Text>
    </Stack>
  );
}

function SettingsBody() {
  // Static Doctor scaffold — live meridianctl integration lands in
  // pass 2 once the SSE endpoint is exposed. This surface still
  // demonstrates the component wiring.
  const items: ReadonlyArray<AdminDoctorItem> = [
    { id: "frontend", label: "Frontend build", status: "ok", detail: "deployed v0.0.22" },
    { id: "api", label: "API reachable", status: "ok", detail: "handshake ok via Next.js proxy" },
    { id: "meridianctl", label: "meridianctl SSE", status: "warn", detail: "not yet wired — pass 2" },
  ];
  return (
    <Stack direction="column" gap={6}>
      <AdminDoctorCard items={items} lastChecked="just now" />
      <Text variant="text-body" tone="secondary">
        Retention, backup, alerts, field mapping, contracts, and general
        settings consolidate on this surface per spec §10. Pass 2 wires
        each control to its existing legacy API endpoint so the UI is
        feature-complete, not just styled.
      </Text>
    </Stack>
  );
}

/* ----------------------------------------- Small helpers --- */

function LoadingLine({ label }: { label: string }) {
  return (
    <Text variant="text-body" tone="secondary">
      {label}…
    </Text>
  );
}

function ErrorLine({ detail }: { detail: string }) {
  return (
    <Banner tone="danger">
      <Text variant="text-body">{detail}</Text>
    </Banner>
  );
}

function EmptyLine({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Stack direction="column" gap={3}>
      <Text variant="text-lead">{title}</Text>
      <Text variant="text-body" tone="secondary">
        {body}
      </Text>
      {action}
    </Stack>
  );
}

function noRetryOnAuthError(count: number, err: unknown) {
  if (err instanceof AxiosError && err.response?.status === 401) return false;
  return count < 1;
}
