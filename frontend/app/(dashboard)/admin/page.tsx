"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI, SectionHeader, StatusDot, OwnerChip } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getUsers, inviteUser, updateUser } from "@/lib/api/users";
import { getAuditEntries } from "@/lib/api/audit";
import { getLicenceManifest } from "@/lib/api/licence";
import { downloadCsv } from "@/components/meridian/actions";
import { relativeTime } from "@/lib/format";
import type { User, UserRole } from "@/types/api";

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

const INVITE_ROLES: UserRole[] = ["admin", "steward", "approver", "analyst", "viewer", "auditor"];

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

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      updateUser(id, { is_active: active }),
    onSuccess: () => {
      toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["users.list"] });
    },
    onError: () => toast.error("Could not update user"),
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
                  <th style={{ width: 96 }}></th>
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
                      <button
                        type="button"
                        className="mn-btn mn-btn-ghost"
                        onClick={() => setActive.mutate({ id: u.id, active: !u.is_active })}
                        disabled={setActive.isPending}
                        style={{ padding: "5px 10px", fontSize: 12 }}
                      >
                        {u.is_active ? "Deactivate" : "Activate"}
                      </button>
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
      )}

      {tab === "roles" && (
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
      )}

      {tab === "licence" && (
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
