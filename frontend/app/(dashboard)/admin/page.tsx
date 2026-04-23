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
  AdminAuditLogTable,
  AdminDestructiveConfirm,
  AdminDoctorCard,
  Banner,
  Button,
  Chip,
  Stack,
  Text,
  type AdminAuditLogEntry,
  type AdminDoctorItem,
  type AdminTabId,
} from "@/components/aurora";
import { getUsers, inviteUser, updateUser } from "@/lib/api/users";
import { deleteSystem, getSystems, registerSystem } from "@/lib/api/systems";
import { getRulesSummary, type RulesSummaryItem } from "@/lib/api/rules";
import { getLicenceManifest } from "@/lib/api/licence";
import {
  getLLMConfig,
  getLLMProviders,
  testLLMConnection,
  updateLLMConfig,
  type LLMConfig,
  type LLMConfigUpdate,
  type LLMProvider,
} from "@/lib/api/llm-settings";
import { getLlmSavingsSummary, type LlmSavingsSummary } from "@/lib/api/llm-savings";
import { getDoctor, type DoctorItem as ApiDoctorItem } from "@/lib/api/admin-doctor";
import { getAuditEntries, type AuditEntry } from "@/lib/api/audit";
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

  const auditQuery = useQuery({
    queryKey: ["aurora.admin.audit", 50],
    queryFn: () => getAuditEntries({ limit: 50 }),
    retry: noRetryOnAuthError,
    enabled: tab === "users",
    // Audit writes are fire-and-forget so poll to catch async inserts.
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
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

  const registerSystemMutation = useMutation({
    mutationFn: registerSystem,
    onSuccess: (s) => {
      toast.success(`System ${s.name} registered.`);
      qc.invalidateQueries({ queryKey: ["aurora.admin.systems"] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof AxiosError
          ? err.response?.data?.detail ?? err.message
          : "Register failed.";
      toast.error(`Register failed: ${msg}`);
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
  const llmConfigQuery = useQuery({
    queryKey: ["aurora.admin.llm-config"],
    queryFn: getLLMConfig,
    retry: noRetryOnAuthError,
    enabled: tab === "ai",
  });
  const llmSavingsQuery = useQuery({
    queryKey: ["aurora.admin.llm-savings", 30],
    queryFn: () => getLlmSavingsSummary(30),
    retry: noRetryOnAuthError,
    enabled: tab === "ai",
  });
  const doctorQuery = useQuery({
    queryKey: ["aurora.admin.doctor"],
    queryFn: getDoctor,
    retry: noRetryOnAuthError,
    enabled: tab === "settings",
    // 30s poll cadence per spec §10.4
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const llmProvidersQuery = useQuery({
    queryKey: ["aurora.admin.llm-providers"],
    queryFn: getLLMProviders,
    retry: noRetryOnAuthError,
    enabled: tab === "ai",
  });

  const updateLlmMutation = useMutation({
    mutationFn: updateLLMConfig,
    onSuccess: () => {
      toast.success("LLM configuration updated");
      qc.invalidateQueries({ queryKey: ["aurora.admin.llm-config"] });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof AxiosError
          ? err.response?.data?.detail ?? err.message
          : "Update failed.";
      toast.error(`LLM update failed: ${msg}`);
    },
  });

  const testLlmMutation = useMutation({
    mutationFn: testLLMConnection,
    onSuccess: (res) => {
      if (res.success) {
        toast.success(`LLM reachable — ${res.message}`);
      } else {
        toast.error(`LLM test failed: ${res.message}`);
      }
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof AxiosError
          ? err.response?.data?.detail ?? err.message
          : "Connection test failed.";
      toast.error(msg);
    },
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
              auditEntries={auditQuery.data?.entries}
              auditLoading={auditQuery.isLoading}
              auditError={auditQuery.isError}
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
              onRegisterSystem={(body) => registerSystemMutation.mutate(body)}
              registerInFlight={registerSystemMutation.isPending}
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
          body: (
            <AiBody
              config={llmConfigQuery.data}
              savings={llmSavingsQuery.data}
              providers={llmProvidersQuery.data}
              isLoading={llmConfigQuery.isLoading || llmSavingsQuery.isLoading}
              isError={llmConfigQuery.isError}
              onUpdate={(update) => updateLlmMutation.mutate(update)}
              onTest={(update) => testLlmMutation.mutate(update)}
              updateInFlight={updateLlmMutation.isPending}
              testInFlight={testLlmMutation.isPending}
            />
          ),
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
          // Doctor query is passed explicitly so SettingsBody stays
          // pure-view and easy to snapshot.
          label: "Settings",
          body: (
            <SettingsBody
              items={doctorQuery.data?.items}
              lastChecked={doctorQuery.data?.last_checked}
              isLoading={doctorQuery.isLoading}
              isError={doctorQuery.isError}
              onRefresh={() => doctorQuery.refetch()}
            />
          ),
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
  auditEntries,
  auditLoading,
  auditError,
}: {
  users?: ReadonlyArray<User>;
  isLoading: boolean;
  isError: boolean;
  onInvite: (body: { email: string; name?: string; role?: UserRole }) => void;
  inviteInFlight: boolean;
  onToggleActive: (userId: string, is_active: boolean) => void;
  onChangeRole: (userId: string, role: UserRole) => void;
  mutationInFlight: boolean;
  auditEntries?: ReadonlyArray<AuditEntry>;
  auditLoading: boolean;
  auditError: boolean;
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
      <AuditSection
        entries={auditEntries}
        isLoading={auditLoading}
        isError={auditError}
      />
    </Stack>
  );
}

/* ----- Audit section (Users & Roles tab) ----- */

function AuditSection({
  entries,
  isLoading,
  isError,
}: {
  entries?: ReadonlyArray<AuditEntry>;
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <Stack direction="column" gap={2} style={{ marginTop: 24 }}>
      <Stack direction="row" gap={2} align="center">
        <Text variant="text-lead">Audit log</Text>
        <Text variant="text-small" tone="tertiary">
          Every state change in Meridian, newest first.
        </Text>
      </Stack>
      {isLoading ? (
        <LoadingLine label="Loading audit log" />
      ) : isError ? (
        <ErrorLine detail="Couldn't reach the audit log API." />
      ) : (
        <AdminAuditLogTable entries={toAdminAuditEntries(entries ?? [])} />
      )}
    </Stack>
  );
}

function toAdminAuditEntries(
  entries: ReadonlyArray<AuditEntry>,
): AdminAuditLogEntry[] {
  return entries.map((e) => ({
    id: e.id,
    timestamp: e.created_at,
    displayTime: formatRelative(e.created_at),
    actor: e.actor_email ?? "system",
    action: describeAction(e),
    context: describeContext(e),
  }));
}

function describeAction(e: AuditEntry): string {
  // Prefer verb + entity when both present (e.g. "update rules abc123").
  const bits: string[] = [e.action];
  if (e.entity_type) bits.push(e.entity_type);
  if (e.entity_id) bits.push(e.entity_id.slice(0, 8));
  return bits.join(" ");
}

function describeContext(e: AuditEntry): string {
  const parts: string[] = [`${e.method} ${e.path} (${e.status_code})`];
  if (e.ip) parts.push(e.ip);
  return parts.join(" · ");
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(then)) return iso;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
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
  onRegisterSystem,
  registerInFlight,
}: {
  systems?: ReadonlyArray<SAPSystem>;
  isLoading: boolean;
  isError: boolean;
  onDeleteSystem: (id: string) => void;
  onRegisterSystem: (body: {
    name: string;
    host: string;
    client: string;
    sysnr: string;
    environment: string;
    password: string;
    description?: string;
  }) => void;
  registerInFlight: boolean;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  if (isLoading) return <LoadingLine label="Loading SAP systems" />;
  if (isError)
    return <ErrorLine detail="Couldn't reach the systems API." />;

  if (!systems || systems.length === 0) {
    return (
      <Stack direction="column" gap={4}>
        <EmptyLine
          title="No SAP systems configured"
          body="Register your first ECC or S/4HANA system to start extracting data."
          action={
            <Button variant="primary" onClick={() => setRegisterOpen(true)}>
              Register system
            </Button>
          }
        />
        {registerOpen ? (
          <RegisterSystemForm
            onSubmit={(body) => {
              onRegisterSystem(body);
              setRegisterOpen(false);
            }}
            onCancel={() => setRegisterOpen(false)}
            pending={registerInFlight}
          />
        ) : null}
      </Stack>
    );
  }

  const confirmingSystem = systems.find((s) => s.id === confirmingId);

  return (
    <Stack direction="column" gap={3}>
      <Stack direction="row" gap={3} align="center">
        <Text variant="text-body" tone="secondary">
          {systems.length} system{systems.length === 1 ? "" : "s"} configured.
        </Text>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRegisterOpen((v) => !v)}
          style={{ marginLeft: "auto" }}
        >
          {registerOpen ? "Close form" : "Register system"}
        </Button>
      </Stack>
      {registerOpen ? (
        <RegisterSystemForm
          onSubmit={(body) => {
            onRegisterSystem(body);
            setRegisterOpen(false);
          }}
          onCancel={() => setRegisterOpen(false)}
          pending={registerInFlight}
        />
      ) : null}
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

function RegisterSystemForm({
  onSubmit,
  onCancel,
  pending,
}: {
  onSubmit: (body: {
    name: string;
    host: string;
    client: string;
    sysnr: string;
    environment: string;
    password: string;
    description?: string;
  }) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [client, setClient] = useState("");
  const [sysnr, setSysnr] = useState("00");
  const [env, setEnv] = useState<"PRD" | "QAS" | "DEV">("DEV");
  const [password, setPassword] = useState("");
  const [description, setDescription] = useState("");

  const canSubmit =
    name.trim() !== "" &&
    host.trim() !== "" &&
    client.trim() !== "" &&
    /^\d{3}$/.test(client) &&
    /^\d{2}$/.test(sysnr) &&
    password !== "";

  return (
    <form
      className="aurora-admin-register"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !pending) {
          onSubmit({
            name: name.trim(),
            host: host.trim(),
            client: client.trim(),
            sysnr: sysnr.trim(),
            environment: env,
            password,
            description: description.trim() || undefined,
          });
        }
      }}
    >
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Name
        </Text>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="aurora-admin-inline-input"
          placeholder="ECC-PRD"
          autoComplete="off"
        />
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Environment
        </Text>
        <select
          className="aurora-admin-inline-select"
          value={env}
          onChange={(e) => setEnv(e.target.value as "PRD" | "QAS" | "DEV")}
        >
          <option value="PRD">PRD</option>
          <option value="QAS">QAS</option>
          <option value="DEV">DEV</option>
        </select>
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Host
        </Text>
        <input
          type="text"
          required
          value={host}
          onChange={(e) => setHost(e.target.value)}
          className="aurora-admin-inline-input"
          placeholder="sap-prd.internal.customer.com"
          autoComplete="off"
        />
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Client (3 digits)
        </Text>
        <input
          type="text"
          required
          value={client}
          onChange={(e) => setClient(e.target.value)}
          pattern="\d{3}"
          maxLength={3}
          className="aurora-admin-inline-input"
          placeholder="100"
          autoComplete="off"
        />
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          System number (2 digits)
        </Text>
        <input
          type="text"
          required
          value={sysnr}
          onChange={(e) => setSysnr(e.target.value)}
          pattern="\d{2}"
          maxLength={2}
          className="aurora-admin-inline-input"
          autoComplete="off"
        />
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          RFC user password
        </Text>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="aurora-admin-inline-input"
          autoComplete="new-password"
        />
      </label>
      <label
        className="aurora-admin-invite__field"
        style={{ gridColumn: "1 / -1" }}
      >
        <Text variant="text-small" tone="tertiary" as="span">
          Description (optional)
        </Text>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="aurora-admin-inline-input"
          placeholder="Production ECC 6.0 SPS 14, 16M records"
          autoComplete="off"
        />
      </label>
      <Stack direction="row" gap={2} className="aurora-admin-invite__actions">
        <Button variant="secondary" onClick={onCancel} type="button">
          Discard
        </Button>
        {/* HTML form submission type — not user-facing copy */}
        {/* eslint-disable-next-line aurora-writing/no-forbidden-copy */}
        <Button variant="primary" type="submit" disabled={!canSubmit || pending}>
          {pending ? "Registering" : "Register system"}
        </Button>
      </Stack>
    </form>
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

function AiBody({
  config,
  savings,
  providers,
  isLoading,
  isError,
  onUpdate,
  onTest,
  updateInFlight,
  testInFlight,
}: {
  config?: LLMConfig;
  savings?: LlmSavingsSummary;
  providers?: Record<string, LLMProvider>;
  isLoading: boolean;
  isError: boolean;
  onUpdate: (update: LLMConfigUpdate) => void;
  onTest: (update: LLMConfigUpdate) => void;
  updateInFlight: boolean;
  testInFlight: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  if (isLoading) return <LoadingLine label="Loading LLM configuration" />;
  if (isError)
    return (
      <ErrorLine detail="Couldn't reach the LLM configuration endpoint." />
    );
  if (!config) {
    return (
      <EmptyLine
        title="No LLM configured"
        body="Meridian runs deterministic-first; an LLM is optional and only used for narrative enrichment. Configure one from the legacy Settings → AI page to enable narration."
      />
    );
  }

  return (
    <Stack direction="column" gap={6}>
      <section className="aurora-admin-ai__card">
        <Stack direction="column" gap={3}>
          <Stack direction="row" gap={2} align="center">
            <Text variant="text-lead" as="h3">
              Provider
            </Text>
            <Chip tone="info">{config.provider}</Chip>
            <Chip tone={config.source === "database" ? "success" : "neutral"}>
              {config.source === "database" ? "Tenant-managed" : "Env-managed"}
            </Chip>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditOpen((v) => !v)}
              style={{ marginLeft: "auto" }}
            >
              {editOpen ? "Close editor" : "Edit configuration"}
            </Button>
          </Stack>
          <dl className="aurora-admin-ai__kv">
            <dt>Model</dt>
            <dd>{config.model || "—"}</dd>
            <dt>Base URL</dt>
            <dd>{config.base_url || "—"}</dd>
            <dt>API key</dt>
            <dd>
              {config.has_api_key
                ? config.api_key_preview || "••••••"
                : "not set"}
            </dd>
            <dt>Temperature</dt>
            <dd>{config.temperature.toFixed(2)}</dd>
            <dt>Max tokens</dt>
            <dd>{config.max_tokens.toLocaleString()}</dd>
            <dt>Request timeout</dt>
            <dd>{config.request_timeout}s</dd>
          </dl>
          {config.updated_at ? (
            <Text variant="text-small" tone="tertiary">
              Last updated {new Date(config.updated_at).toLocaleString()}
              {config.updated_by ? ` by ${config.updated_by}` : ""}
            </Text>
          ) : null}
        </Stack>
      </section>

      {editOpen ? (
        <LlmEditForm
          config={config}
          providers={providers}
          onUpdate={(body) => {
            onUpdate(body);
            setEditOpen(false);
          }}
          onTest={onTest}
          onCancel={() => setEditOpen(false)}
          updateInFlight={updateInFlight}
          testInFlight={testInFlight}
        />
      ) : null}

      {savings ? (
        <section className="aurora-admin-ai__card">
          <Stack direction="column" gap={3}>
            <Text variant="text-lead" as="h3">
              Usage — last {savings.window_days} days
            </Text>
            <Stack direction="row" gap={6} align="center">
              <Stack direction="column" gap={1}>
                <Text variant="text-small" tone="tertiary">
                  Calls
                </Text>
                <Text variant="display-sm" numeric>
                  {savings.calls_total.toLocaleString()}
                </Text>
              </Stack>
              <Stack direction="column" gap={1}>
                <Text variant="text-small" tone="tertiary">
                  Deterministic ratio
                </Text>
                <Text variant="display-sm" numeric>
                  {(savings.deterministic_ratio * 100).toFixed(1)}%
                </Text>
              </Stack>
              <Stack direction="column" gap={1}>
                <Text variant="text-small" tone="tertiary">
                  Cost saved
                </Text>
                <Text variant="display-sm" numeric>
                  ${savings.cost_saved_usd.toFixed(2)}
                </Text>
              </Stack>
            </Stack>
            <Text variant="text-small" tone="tertiary">
              Deterministic-first: {savings.calls_saved.toLocaleString()}
              {" "}LLM calls avoided,{" "}
              {savings.tokens_saved.toLocaleString()} tokens saved. A ratio
              above 80% is the target — higher is healthier.
            </Text>
          </Stack>
        </section>
      ) : null}

      <Text variant="text-small" tone="tertiary">
        Per-call budget caps and prompt templates remain on the legacy
        Settings → AI page for now. Every provider-level change on
        this tab is captured in the audit log.
      </Text>
    </Stack>
  );
}

function LlmEditForm({
  config,
  providers,
  onUpdate,
  onTest,
  onCancel,
  updateInFlight,
  testInFlight,
}: {
  config: LLMConfig;
  providers?: Record<string, LLMProvider>;
  onUpdate: (body: LLMConfigUpdate) => void;
  onTest: (body: LLMConfigUpdate) => void;
  onCancel: () => void;
  updateInFlight: boolean;
  testInFlight: boolean;
}) {
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const [baseUrl, setBaseUrl] = useState(config.base_url);
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState(String(config.temperature));
  const [maxTokens, setMaxTokens] = useState(String(config.max_tokens));

  const providerSpec = providers?.[provider];
  const apiKeyRequired = providerSpec?.requires_api_key ?? false;
  const apiKeyAlreadySet = config.has_api_key && provider === config.provider;

  const body: LLMConfigUpdate = {
    provider,
    model: model || undefined,
    base_url: baseUrl || undefined,
    api_key: apiKey || undefined,
    temperature: Number.parseFloat(temperature),
    max_tokens: Number.parseInt(maxTokens, 10),
  };

  const validTemperature =
    !Number.isNaN(body.temperature as number) &&
    (body.temperature as number) >= 0 &&
    (body.temperature as number) <= 2;
  const validMaxTokens =
    !Number.isNaN(body.max_tokens as number) && (body.max_tokens as number) > 0;
  const keyOkForSave = !apiKeyRequired || apiKey !== "" || apiKeyAlreadySet;
  const canSubmit = validTemperature && validMaxTokens && keyOkForSave;

  return (
    <form
      className="aurora-admin-register"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !updateInFlight) onUpdate(body);
      }}
    >
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Provider
        </Text>
        <select
          className="aurora-admin-inline-select"
          value={provider}
          onChange={(e) => {
            const next = e.target.value;
            setProvider(next);
            const spec = providers?.[next];
            if (spec) {
              setModel(spec.default_model);
              setBaseUrl(spec.default_base_url);
            }
          }}
        >
          {providers
            ? Object.entries(providers).map(([key, p]) => (
                <option key={key} value={key}>
                  {p.label}
                </option>
              ))
            : (
                <option value={config.provider}>{config.provider}</option>
              )}
        </select>
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Model
        </Text>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="aurora-admin-inline-input"
          placeholder={providerSpec?.default_model ?? ""}
          autoComplete="off"
        />
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Base URL
        </Text>
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="aurora-admin-inline-input"
          placeholder={providerSpec?.default_base_url ?? ""}
          autoComplete="off"
        />
      </label>
      <label
        className="aurora-admin-invite__field"
        style={{ gridColumn: "1 / -1" }}
      >
        <Text variant="text-small" tone="tertiary" as="span">
          API key{" "}
          {apiKeyRequired
            ? apiKeyAlreadySet
              ? `(leave blank to keep ${config.api_key_preview || "current"})`
              : "(required)"
            : "(optional)"}
        </Text>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="aurora-admin-inline-input"
          autoComplete="new-password"
          placeholder={apiKeyAlreadySet ? "•••••• (unchanged)" : ""}
        />
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Temperature (0–2)
        </Text>
        <input
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={temperature}
          onChange={(e) => setTemperature(e.target.value)}
          className="aurora-admin-inline-input"
        />
      </label>
      <label className="aurora-admin-invite__field">
        <Text variant="text-small" tone="tertiary" as="span">
          Max tokens
        </Text>
        <input
          type="number"
          step="100"
          min="100"
          value={maxTokens}
          onChange={(e) => setMaxTokens(e.target.value)}
          className="aurora-admin-inline-input"
        />
      </label>
      <Stack
        direction="row"
        gap={2}
        className="aurora-admin-invite__actions"
      >
        <Button variant="secondary" type="button" onClick={onCancel}>
          Discard
        </Button>
        <Button
          variant="secondary"
          type="button"
          onClick={() => onTest(body)}
          disabled={!canSubmit || testInFlight}
        >
          {testInFlight ? "Testing" : "Test connection"}
        </Button>
        <Button
          variant="primary"
          /* HTML form submission type — not user-facing copy */
          /* eslint-disable-next-line aurora-writing/no-forbidden-copy */
          type="submit"
          disabled={!canSubmit || updateInFlight}
        >
          {updateInFlight ? "Saving" : "Save configuration"}
        </Button>
      </Stack>
    </form>
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

function SettingsBody({
  items,
  lastChecked,
  isLoading,
  isError,
  onRefresh,
}: {
  items?: ReadonlyArray<ApiDoctorItem>;
  lastChecked?: string;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
}) {
  // Map the API doctor items onto the component shape. The component
  // accepts our exact shape already — but we widen it to readonly and
  // provide a friendly timestamp.
  const friendlyWhen = lastChecked
    ? relativeWhen(lastChecked)
    : isLoading
    ? "checking…"
    : "never";

  const doctorItems: ReadonlyArray<AdminDoctorItem> = items ?? [];

  return (
    <Stack direction="column" gap={6}>
      {isError ? (
        <Banner tone="danger">
          <Text variant="text-body">
            Couldn&apos;t reach the doctor endpoint. The API might be
            starting up or unreachable from this browser.
          </Text>
        </Banner>
      ) : null}
      <AdminDoctorCard
        items={doctorItems}
        lastChecked={friendlyWhen}
        onRefresh={onRefresh}
      />
      <Text variant="text-body" tone="secondary">
        Polling every 30 seconds. Retention, backup, alerts, field mapping,
        and contracts consolidate on this surface per spec §10. Interactive
        config writes move over from the legacy Settings page in pass 3.
      </Text>
    </Stack>
  );
}

function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "just now";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return new Date(iso).toLocaleString();
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
