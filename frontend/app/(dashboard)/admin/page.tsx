"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI, SectionHeader, StatusDot, OwnerChip } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { deleteUser, getUsers, inviteUser, updateUser } from "@/lib/api/users";
import { getAuditEntries } from "@/lib/api/audit";
import { getLicenceManifest } from "@/lib/api/licence";
import { getUpdateStatus } from "@/lib/api/system-update";
import { downloadCsv } from "@/components/meridian/actions";
import { relativeTime } from "@/lib/format";
import { useAuth } from "@/context/auth-context";
import { useUpdateModal } from "@/context/update-modal-context";
import type { User, UserRole } from "@/types/api";

/**
 * Current running version + "check for updates" entry point, shown near
 * the licence/tier card. Fetches `/api/v1/system/update-status`, which is
 * admin-only (403 for everyone else) — hard-gated on the real
 * `useAuth().user.role`, not the `use-role.ts` demo stub.
 */
function PlatformVersionCard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { open: openUpdateModal } = useUpdateModal();

  const statusQ = useQuery({
    queryKey: ["system-update-status"],
    queryFn: getUpdateStatus,
    enabled: isAdmin,
    staleTime: 60_000,
  });

  if (!isAdmin) return null;

  return (
    <div className="mn-card mn-card-pad" style={{ marginTop: 18 }}>
      <SectionHeader title="Platform version" caption="Current Meridian release for this deployment" />
      {statusQ.isLoading ? (
        <Skeleton className="h-16 rounded-[10px]" />
      ) : statusQ.error || !statusQ.data ? (
        <div style={{ color: "var(--mn-ink-400)", fontSize: 12.5 }}>
          Could not reach <code>/api/v1/system/update-status</code>.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div className="mn-eyebrow">Running version</div>
            <div className="v mn-tabular">{statusQ.data.current_version}</div>
          </div>

          {statusQ.data.update_available && statusQ.data.updater_configured && (
            <button type="button" className="mn-btn mn-btn-primary" onClick={openUpdateModal}>
              View update ({statusQ.data.latest_version})
            </button>
          )}

          {statusQ.data.update_available && !statusQ.data.updater_configured && (
            <p style={{ fontSize: 12.5, color: "var(--mn-ink-500)", maxWidth: 340, margin: 0 }}>
              Version {statusQ.data.latest_version} is available, but the auto-update sidecar
              isn&apos;t configured on this deployment. Update manually or contact support.
            </p>
          )}

          {!statusQ.data.update_available && (
            <span style={{ fontSize: 12.5, color: "var(--mn-pos)" }}>Up to date</span>
          )}
        </div>
      )}
    </div>
  );
}

type Tab = "users" | "roles" | "licence" | "audit";

const ROLE_PALETTE: Record<string, { bg: string; fg: string }> = {
  admin:        { bg: "var(--mn-neg-bg)",      fg: "var(--mn-neg)" },
  steward:      { bg: "var(--mn-primary-50)",  fg: "var(--mn-primary-700)" },
  ai_reviewer:  { bg: "rgba(124,58,237,0.12)", fg: "#7C3AED" },
  approver:     { bg: "rgba(14,165,164,0.12)", fg: "#0EA5A4" },
  analyst:      { bg: "rgba(15,23,42,0.06)",   fg: "var(--mn-ink-500)" },
  viewer:       { bg: "rgba(15,23,42,0.06)",   fg: "var(--mn-ink-500)" },
  auditor:      { bg: "rgba(236,72,153,0.10)", fg: "#EC4899" },
};

function rolePalette(role: string) {
  return ROLE_PALETTE[role] ?? ROLE_PALETTE.viewer;
}

function RoleChip({ role }: { role: string }) {
  const t = rolePalette(role);
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "3px 8px",
        borderRadius: 4,
        background: t.bg,
        color: t.fg,
        font: "600 11.5px/1 'Inter'",
        letterSpacing: "0.01em",
        textTransform: "capitalize",
      }}
    >
      {role.replace(/_/g, " ")}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const INVITE_ROLES: UserRole[] = ["admin", "steward", "ai_reviewer", "approver", "analyst", "viewer", "auditor"];

// Role capability reference — mirrors api/services/rbac.py. Rendered read-only
// in the Roles tab so admins can see what each role can do, including which
// roles may review (approve proposed rules) AI-proposed match rules.
const ROLE_META: { role: string; label: string; desc: string; aiReview: boolean }[] = [
  { role: "admin", label: "Admin", desc: "Full access — manage users, rules, and approve proposed rules.", aiReview: true },
  { role: "steward", label: "Steward", desc: "Clean and match data, and approve proposed rules.", aiReview: true },
  { role: "ai_reviewer", label: "AI Reviewer", desc: "Review and approve proposed rules from steward corrections.", aiReview: true },
  { role: "approver", label: "Approver", desc: "Approve golden records and stewardship changes.", aiReview: false },
  { role: "analyst", label: "Analyst", desc: "Run analysis and view findings.", aiReview: false },
  { role: "viewer", label: "Viewer", desc: "Read-only access to dashboards and findings.", aiReview: false },
  { role: "auditor", label: "Auditor", desc: "Read-only access including the audit log.", aiReview: false },
];

export default function AdminPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("users");
  const [inviteOpen, setInviteOpen] = useState(false);

  const usersQ = useQuery({
    queryKey: ["users.list"],
    queryFn: getUsers,
  });
  const licenceQ = useQuery({
    queryKey: ["licence.manifest"],
    queryFn: getLicenceManifest,
  });
  const auditQ = useQuery({
    queryKey: ["audit.entries", { limit: 25 }],
    queryFn: () => getAuditEntries({ limit: 25 }),
    enabled: tab === "audit",
  });

  const [editing, setEditing] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<UserRole>("analyst");
  const [editActive, setEditActive] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);

  const saveEdit = useMutation({
    mutationFn: (body: { id: string; role: UserRole; is_active: boolean }) =>
      updateUser(body.id, { role: body.role, is_active: body.is_active }),
    onSuccess: () => {
      toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["users.list"] });
      setEditing(null);
    },
    onError: () => toast.error("Could not save user"),
  });

  const removeUser = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      toast.success("User deleted");
      qc.invalidateQueries({ queryKey: ["users.list"] });
      setConfirmDelete(null);
    },
    onError: () =>
      toast.error(
        "Could not delete user — they may be referenced by other records. Try Deactivate via Edit instead.",
      ),
  });

  const invite = useMutation({
    mutationFn: inviteUser,
    onSuccess: (d) => {
      toast.success(`Invitation sent to ${d.email}`);
      setInviteOpen(false);
      qc.invalidateQueries({ queryKey: ["users.list"] });
    },
    onError: () => toast.error("Could not send invitation"),
  });

  // All hooks must run before any conditional return. `users` is null-safe
  // here because we read off the query result directly.
  const users: User[] = usersQ.data?.users ?? [];

  const rolesGroups = useMemo(() => {
    const map = new Map<string, User[]>();
    for (const u of users) {
      if (!u.is_active) continue;
      const arr = map.get(u.role) ?? [];
      arr.push(u);
      map.set(u.role, arr);
    }
    return Array.from(map.entries());
  }, [users]);

  if (usersQ.isLoading || licenceQ.isLoading) {
    return (
      <>
        <PageHead title="Admin" route="Aurora · /admin" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (usersQ.error || licenceQ.error) {
    return (
      <>
        <PageHead title="Admin" route="Aurora · /admin" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/users</code> or <code>/api/v1/licence</code>.
        </div>
      </>
    );
  }

  const licence = licenceQ.data!;
  const activeUsers = users.filter((u) => u.is_active).length;
  const seatsMax = licence.features?.max_users ?? 0;

  return (
    <>
      <PageHead
        title="Admin"
        route="Aurora · /admin"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{licence.tier ?? "Estate"}</strong> ·{" "}
            <strong style={{ color: "var(--mn-pos)" }}>
              {activeUsers} of {seatsMax || users.length} seats
            </strong>{" "}
            used
            {licence.expiry_date && (
              <>
                {" "}· renews{" "}
                <span style={{ font: "500 12px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>
                  {licence.expiry_date}
                </span>
              </>
            )}
            .
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="mn-btn mn-btn-ghost"
              onClick={() =>
                downloadCsv(
                  "meridian-users.csv",
                  users.map((u) => ({
                    name: u.name,
                    email: u.email,
                    role: u.role,
                    active: u.is_active,
                    last_login: u.last_login ?? "",
                  })),
                )
              }
            >
              Export users
            </button>
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger type="button" className="mn-btn mn-btn-primary">
                Invite user
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite user</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    invite.mutate({
                      email: String(fd.get("email") ?? ""),
                      name: String(fd.get("name") ?? "") || undefined,
                      role: (String(fd.get("role") ?? "viewer") as UserRole) || undefined,
                    });
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <span style={{ color: "var(--mn-ink-500)" }}>Email</span>
                      <input name="email" type="email" required className="mn-input" placeholder="name@company.com" />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <span style={{ color: "var(--mn-ink-500)" }}>Name (optional)</span>
                      <input name="name" className="mn-input" placeholder="Full name" />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <span style={{ color: "var(--mn-ink-500)" }}>Role</span>
                      <select name="role" className="mn-input" defaultValue="viewer">
                        {INVITE_ROLES.map((r) => (
                          <option key={r} value={r} style={{ textTransform: "capitalize" }}>
                            {r.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <DialogFooter>
                    <button type="button" className="mn-btn mn-btn-ghost" onClick={() => setInviteOpen(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="mn-btn mn-btn-primary" disabled={invite.isPending}>
                      {invite.isPending ? "Sending…" : "Send invite"}
                    </button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Active users" value={activeUsers} hint={`${Math.max(0, seatsMax - activeUsers)} seats free`} tone="pos" />
        <KPI label="Roles in use" value={rolesGroups.length} />
        <KPI
          label="Modules"
          value={licence.enabled_modules?.length ?? 0}
          hint={licence.tier ?? "tier"}
        />
        <KPI
          label="Renews"
          value={licence.expiry_date ?? "—"}
          hint={licence.days_remaining !== undefined ? `${licence.days_remaining} days` : ""}
          tone={licence.valid ? "pos" : undefined}
        />
      </div>

      <div className="mn-segment" style={{ marginBottom: 14 }}>
        {(["users", "roles", "licence", "audit"] as const).map((k) => (
          <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {k === "users" ? "Users" : k === "roles" ? "Roles" : k === "licence" ? "Licence & modules" : "Audit log"}
          </button>
        ))}
      </div>

      {tab === "users" && (
        <>
          <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="mn-table-wrap">
              <table className="mn-table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 20 }}>User</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last active</th>
                    <th style={{ width: 160 }} aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td style={{ paddingLeft: 20 }}>
                        <span className="ico-cell">
                          <OwnerChip owner={initials(u.name)} />
                          <span className="module">{u.name}</span>
                        </span>
                      </td>
                      <td
                        className="mn-tabular"
                        style={{ font: "500 12px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                      >
                        {u.email}
                      </td>
                      <td><RoleChip role={u.role} /></td>
                      <td><StatusDot status={u.is_active ? "healthy" : "scheduled"} /></td>
                      <td
                        className="mn-tabular"
                        style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                      >
                        {u.last_login ? relativeTime(u.last_login) : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="mn-btn mn-btn-ghost"
                            onClick={() => {
                              setEditing(u);
                              setEditRole(u.role as UserRole);
                              setEditActive(u.is_active);
                            }}
                            style={{ padding: "5px 10px", fontSize: 12 }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="mn-btn mn-btn-ghost"
                            onClick={() => setConfirmDelete(u)}
                            disabled={removeUser.isPending}
                            style={{ padding: "5px 10px", fontSize: 12, color: "var(--mn-neg)" }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                        No users.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Edit user dialog — role + active status. updateUser only supports
              these two fields server-side; name/email edits would need a
              backend extension. */}
          <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit user</DialogTitle>
              </DialogHeader>
              {editing && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "8px 0" }}>
                  <div>
                    <div className="mn-eyebrow" style={{ marginBottom: 6 }}>Account</div>
                    <div style={{ fontSize: 13, color: "var(--mn-ink-700)" }}>{editing.name}</div>
                    <div
                      className="mn-tabular"
                      style={{
                        font: "500 12px/1 'JetBrains Mono', monospace",
                        color: "var(--mn-ink-500)",
                        marginTop: 4,
                      }}
                    >
                      {editing.email}
                    </div>
                  </div>
                  <div>
                    <label className="mn-eyebrow" style={{ display: "block", marginBottom: 6 }}>Role</label>
                    <select
                      aria-label="Role"
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as UserRole)}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        border: "1px solid var(--mn-line)",
                        borderRadius: 6,
                        fontSize: 13,
                        background: "white",
                      }}
                    >
                      {INVITE_ROLES.map((r) => (
                        <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={editActive}
                      onChange={(e) => setEditActive(e.target.checked)}
                    />
                    Active
                  </label>
                </div>
              )}
              <DialogFooter>
                <button
                  type="button"
                  className="mn-btn mn-btn-ghost"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="mn-btn"
                  onClick={() =>
                    editing &&
                    saveEdit.mutate({ id: editing.id, role: editRole, is_active: editActive })
                  }
                  disabled={saveEdit.isPending}
                >
                  {saveEdit.isPending ? "Saving…" : "Save"}
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete confirmation dialog. Hard delete fails (409) if the user
              has FK references — the API returns guidance to deactivate. */}
          <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete user</DialogTitle>
              </DialogHeader>
              {confirmDelete && (
                <p style={{ fontSize: 13, color: "var(--mn-ink-700)", padding: "8px 0" }}>
                  Delete <strong>{confirmDelete.name}</strong> ({confirmDelete.email})? This
                  can&apos;t be undone — they&apos;ll lose access immediately. If the user has
                  activity history they may need to be deactivated via Edit instead.
                </p>
              )}
              <DialogFooter>
                <button
                  type="button"
                  className="mn-btn mn-btn-ghost"
                  onClick={() => setConfirmDelete(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="mn-btn"
                  style={{ background: "var(--mn-neg)", color: "white" }}
                  onClick={() => confirmDelete && removeUser.mutate(confirmDelete.id)}
                  disabled={removeUser.isPending}
                >
                  {removeUser.isPending ? "Deleting…" : "Delete"}
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {tab === "roles" && (
        <>
        <div className="mn-card" style={{ padding: 0, overflow: "hidden", marginBottom: 18 }}>
          <SectionHeader title="Role capabilities" caption="What each role can do · mirrors the access policy" />
          <div className="mn-table-wrap">
            <table className="mn-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Role</th>
                  <th>Description</th>
                  <th style={{ width: 120, textAlign: "center" }}>AI Review</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_META.map((m) => (
                  <tr key={m.role}>
                    <td style={{ paddingLeft: 20 }} title={m.desc}>
                      <RoleChip role={m.role} />
                    </td>
                    <td style={{ color: "var(--mn-ink-500)", fontSize: 12.5 }}>{m.desc}</td>
                    <td style={{ textAlign: "center", color: m.aiReview ? "var(--mn-pos)" : "var(--mn-ink-300)" }}>
                      {m.aiReview ? "✓" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mn-row" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          {rolesGroups.map(([role, list]) => (
            <div key={role} className="mn-card mn-card-pad">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <RoleChip role={role} />
                <span
                  className="mn-tabular"
                  style={{ font: "600 12px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)" }}
                >
                  {list.length} user{list.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mn-divider-dashed" />
              <div className="mn-eyebrow">Members</div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                {list.map((u) => (
                  <div key={u.id} className="ico-cell">
                    <OwnerChip owner={initials(u.name)} />
                    <span style={{ fontSize: 13 }}>{u.name}</span>
                    <span
                      style={{
                        marginLeft: "auto",
                        font: "500 11.5px/1 'JetBrains Mono', monospace",
                        color: "var(--mn-ink-400)",
                      }}
                    >
                      {u.email}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {rolesGroups.length === 0 && (
            <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
              No active users.
            </div>
          )}
        </div>
        </>
      )}

      {tab === "licence" && (
        <>
          <div className="mn-row mn-row-12">
            <div className="mn-col-5" style={{ gridColumn: "span 5" }}>
              <div className="mn-card mn-card-pad">
                <SectionHeader title="Licence" caption="Tier, seats, renewal" />
                <div className="mn-licence">
                  <div className="mn-row" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div><div className="mn-eyebrow">Tier</div><div className="v">{licence.tier ?? "—"}</div></div>
                    <div><div className="mn-eyebrow">Seats</div><div className="v mn-tabular">{activeUsers} / {seatsMax || "∞"}</div></div>
                    <div><div className="mn-eyebrow">Renews</div><div className="v mn-tabular">{licence.expiry_date ?? "—"}</div></div>
                    <div>
                      <div className="mn-eyebrow">Status</div>
                      <div className="v">
                        <StatusDot status={licence.valid ? "healthy" : licence.valid === false ? "down" : "scheduled"} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mn-col-7" style={{ gridColumn: "span 7" }}>
              <div className="mn-card mn-card-pad">
                <SectionHeader title="Modules" caption="Enabled on this licence" />
                <div className="mn-modlist">
                  {(licence.enabled_menu_items ?? []).map((name) => (
                    <div key={name} className="mn-modrow">
                      <span style={{ fontWeight: 500, color: "var(--mn-ink-900)", textTransform: "capitalize" }}>
                        {name.replace(/_/g, " ")}
                      </span>
                      <span className="mn-toggle on" aria-hidden>
                        <span className="thumb" />
                      </span>
                    </div>
                  ))}
                  {(licence.enabled_menu_items ?? []).length === 0 && (
                    <div style={{ color: "var(--mn-ink-400)", padding: 8 }}>No modules enabled.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <PlatformVersionCard />
        </>
      )}

      {tab === "audit" && (
        <div className="mn-card mn-card-pad">
          <SectionHeader title="Audit log" caption="Latest 25 entries" />
          {auditQ.isLoading ? (
            <Skeleton className="h-40 rounded-[10px]" />
          ) : auditQ.error ? (
            <div style={{ color: "var(--mn-neg)" }}>Could not reach <code>/api/v1/audit</code>.</div>
          ) : (
            <ul className="mn-event-list">
              {(auditQ.data?.entries ?? []).map((e) => (
                <li key={e.id}>
                  <span className="t mn-tabular">{relativeTime(e.created_at)}</span>
                  <span
                    className="tag"
                    style={{
                      background: e.actor_email ? "var(--mn-primary-50)" : "rgba(15,23,42,0.06)",
                      color: e.actor_email ? "var(--mn-primary-700)" : "var(--mn-ink-500)",
                    }}
                  >
                    {(e.actor_email ?? "system").split("@")[0].toUpperCase()}
                  </span>
                  <span>
                    {e.action} · {e.entity_type ?? "—"} {e.entity_id ? `· ${e.entity_id.slice(0, 8)}` : ""}
                  </span>
                </li>
              ))}
              {(auditQ.data?.entries ?? []).length === 0 && (
                <li style={{ color: "var(--mn-ink-400)" }}>No audit entries.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
