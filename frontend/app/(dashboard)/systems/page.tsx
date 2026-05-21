"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI, SectionHeader, StatusDot } from "@/components/meridian/atoms";
import { ArrowRight, ArrowUpRight } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getSystems, registerSystem, testConnection, triggerSync } from "@/lib/api/systems";
import { relativeTime } from "@/lib/format";
import type { SAPSystem } from "@/types/api";

function envColor(env: SAPSystem["environment"]): string {
  switch (env) {
    case "PRD": return "#1E7C44";
    case "QAS": return "#B7610B";
    case "DEV": return "#6B7588";
  }
}

function statusToDot(status: string | null): "healthy" | "degraded" | "down" | "scheduled" {
  if (!status) return "scheduled";
  if (status === "running") return "healthy";
  if (status === "completed" || status === "complete") return "healthy";
  if (status === "failed") return "down";
  return "scheduled";
}

function systemInitials(name: string) {
  return name
    .split(/[\s·]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function SystemsPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  const { data: systems, isLoading, error } = useQuery({
    queryKey: ["systems.list"],
    queryFn: getSystems,
  });

  const sync = useMutation({
    mutationFn: (systemId: string) => triggerSync(systemId),
    onSuccess: () => {
      toast.success("Sync triggered");
      qc.invalidateQueries({ queryKey: ["systems.list"] });
    },
    onError: () => toast.error("Could not trigger sync"),
  });
  const test = useMutation({
    mutationFn: (systemId: string) => testConnection(systemId),
    onSuccess: (d) => {
      if (d.connected) toast.success("Connection OK");
      else toast.error(d.message ?? "Connection failed");
    },
  });
  const syncAll = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => triggerSync(id)));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      return { ok, total: ids.length };
    },
    onSuccess: (d) => {
      toast.success(`Triggered ${d.ok}/${d.total} sync${d.total === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["systems.list"] });
    },
    onError: () => toast.error("Could not trigger syncs"),
  });
  const register = useMutation({
    mutationFn: registerSystem,
    onSuccess: () => {
      toast.success("System registered");
      setConnectOpen(false);
      qc.invalidateQueries({ queryKey: ["systems.list"] });
    },
    onError: () => toast.error("Could not register system"),
  });

  if (isLoading) {
    return (
      <>
        <PageHead title="Systems" route="Connect · /systems" sub="Loading systems…" />
        <div className="mn-row" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 18 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-[10px]" />
          ))}
        </div>
        <div className="mn-syscard-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-[10px]" />
          ))}
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHead title="Systems" route="Connect · /systems" sub="Failed to load systems." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/systems</code>.
        </div>
      </>
    );
  }

  const list = systems ?? [];
  const active = list.find((s) => s.id === activeId) ?? list[0];

  const healthy = list.filter((s) => statusToDot(s.last_sync_status) === "healthy").length;
  const degraded = list.filter((s) => statusToDot(s.last_sync_status) === "degraded").length;
  const down = list.filter((s) => statusToDot(s.last_sync_status) === "down").length;
  const scheduled = list.filter((s) => statusToDot(s.last_sync_status) === "scheduled").length;

  return (
    <>
      <PageHead
        title="Systems"
        route="Connect · /systems"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{list.length} systems</strong> connected ·{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{healthy} healthy</strong>,{" "}
            <strong style={{ color: "var(--mn-warn)" }}>{degraded} degraded</strong>,{" "}
            <strong style={{ color: "var(--mn-neg)" }}>{down} down</strong>,{" "}
            <strong style={{ color: "var(--mn-ink-500)" }}>{scheduled} scheduled</strong>.
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="mn-btn mn-btn-ghost"
              onClick={() => {
                const ids = list.map((s) => s.id);
                if (ids.length === 0) {
                  toast.info("No systems to sync");
                  return;
                }
                syncAll.mutate(ids);
              }}
              disabled={syncAll.isPending || list.length === 0}
            >
              {syncAll.isPending ? "Syncing…" : "Sync all"}
            </button>
            <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
              <DialogTrigger type="button" className="mn-btn mn-btn-primary">
                Connect system
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Connect SAP system</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    register.mutate({
                      name: String(fd.get("name") ?? ""),
                      host: String(fd.get("host") ?? ""),
                      client: String(fd.get("client") ?? ""),
                      sysnr: String(fd.get("sysnr") ?? ""),
                      environment: String(fd.get("environment") ?? "DEV"),
                      password: String(fd.get("password") ?? ""),
                      description: String(fd.get("description") ?? "") || undefined,
                    });
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <span style={{ color: "var(--mn-ink-500)" }}>System name</span>
                      <input name="name" required className="mn-input" placeholder="e.g. ECC Production" />
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--mn-ink-500)" }}>Host</span>
                        <input name="host" required className="mn-input" placeholder="sap.example.com" />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--mn-ink-500)" }}>Client</span>
                        <input name="client" required className="mn-input" placeholder="100" />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--mn-ink-500)" }}>Sysnr</span>
                        <input name="sysnr" required className="mn-input" placeholder="00" />
                      </label>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--mn-ink-500)" }}>Environment</span>
                        <select name="environment" className="mn-input" defaultValue="DEV">
                          <option value="DEV">DEV</option>
                          <option value="QAS">QAS</option>
                          <option value="PRD">PRD</option>
                        </select>
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--mn-ink-500)" }}>Password</span>
                        <input name="password" type="password" required className="mn-input" placeholder="••••••••" />
                      </label>
                    </div>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <span style={{ color: "var(--mn-ink-500)" }}>Description (optional)</span>
                      <input name="description" className="mn-input" placeholder="Notes about this connection" />
                    </label>
                  </div>
                  <DialogFooter>
                    <button type="button" className="mn-btn mn-btn-ghost" onClick={() => setConnectOpen(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="mn-btn mn-btn-primary" disabled={register.isPending}>
                      {register.isPending ? "Connecting…" : "Connect"}
                    </button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Healthy" value={healthy} hint={`${list.length - healthy} need attention`} tone="pos" />
        <KPI label="Degraded" value={degraded} hint={degraded === 0 ? "all clear" : "review"} tone="warn" />
        <KPI label="Down" value={down} hint={down === 0 ? "no outages" : "investigate"} tone={down === 0 ? "pos" : "neg"} />
        <KPI label="Scheduled" value={scheduled} hint="awaiting first sync" />
        <KPI label="Total" value={list.length} hint="active connections" />
      </div>

      <SectionHeader title="Connected systems" caption="Cards link to deep system view · select one to inspect" />
      {list.length === 0 ? (
        <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
          No systems connected yet.
        </div>
      ) : (
        <div className="mn-syscard-grid">
          {list.map((s) => {
            const status = statusToDot(s.last_sync_status);
            const color = envColor(s.environment);
            return (
              <button
                type="button"
                key={s.id}
                className={`mn-syscard ${s.id === active?.id ? "active" : ""}`}
                onClick={() => setActiveId(s.id)}
              >
                <div className="mn-syscard-head">
                  <span className="mn-syscard-swatch" style={{ background: color }}>
                    {systemInitials(s.name)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mn-syscard-name">{s.name}</div>
                    <div className="mn-syscard-meta">
                      <span
                        className="mn-mod-chip"
                        style={{ background: "var(--mn-bg-tint)", color: "var(--mn-ink-500)" }}
                      >
                        {s.environment}
                      </span>
                      <span>{s.host}</span>
                    </div>
                  </div>
                  <ArrowUpRight size={14} style={{ color: "var(--mn-ink-300)" }} />
                </div>
                <div className="mn-syscard-stats">
                  <div className="stat">
                    <span className="mn-eyebrow">Client</span>
                    <span className="v mn-tabular">{s.client}</span>
                  </div>
                  <div className="stat">
                    <span className="mn-eyebrow">Sysnr</span>
                    <span className="v mn-tabular">{s.sysnr}</span>
                  </div>
                  <div className="stat">
                    <span className="mn-eyebrow">Active</span>
                    <span className="v mn-tabular">{s.is_active ? "yes" : "no"}</span>
                  </div>
                </div>
                <div className="mn-syscard-trend">
                  <div
                    style={{
                      width: "100%",
                      height: 28,
                      display: "flex",
                      alignItems: "center",
                      color: "var(--mn-ink-300)",
                      fontSize: 11,
                      fontFamily: "JetBrains Mono, monospace",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {s.last_sync_at
                      ? `LAST SYNC · ${relativeTime(s.last_sync_at).toUpperCase()}`
                      : "AWAITING FIRST SYNC"}
                  </div>
                </div>
                <div className="mn-syscard-foot">
                  <StatusDot status={status} />
                  <span
                    style={{
                      marginLeft: "auto",
                      color: "var(--mn-ink-400)",
                      font: "500 11px/1 'JetBrains Mono', monospace",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {s.last_sync_at ? relativeTime(s.last_sync_at) : "never"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <div style={{ marginTop: 22 }}>
          <SectionHeader
            title={active.name}
            caption={`${active.environment} · ${active.host} · client ${active.client} · sysnr ${active.sysnr}`}
            right={
              <a href="#" className="mn-link">
                Open system <ArrowRight size={12} />
              </a>
            }
          />
          <div className="mn-row mn-row-12">
            <div className="mn-col-8">
              <div className="mn-card mn-card-pad">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
                  <div>
                    <span className="mn-eyebrow">Last sync</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
                      <span
                        className="mn-tabular"
                        style={{ font: "600 32px/1 'Inter Tight'", letterSpacing: "-0.025em" }}
                      >
                        {active.last_sync_at ? relativeTime(active.last_sync_at) : "—"}
                      </span>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <StatusDot status={statusToDot(active.last_sync_status)} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="mn-btn mn-btn-ghost"
                      onClick={() => test.mutate(active.id)}
                      disabled={test.isPending}
                    >
                      {test.isPending ? "Testing…" : "Test connection"}
                    </button>
                    <button
                      type="button"
                      className="mn-btn mn-btn-primary"
                      onClick={() => sync.mutate(active.id)}
                      disabled={sync.isPending}
                    >
                      {sync.isPending ? "Triggering…" : "Trigger sync"}
                    </button>
                  </div>
                </div>
                {test.data && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 10,
                      borderRadius: 6,
                      background: test.data.connected ? "var(--mn-pos-bg)" : "var(--mn-neg-bg)",
                      color: test.data.connected ? "var(--mn-pos)" : "var(--mn-neg)",
                      fontSize: 13,
                    }}
                  >
                    {test.data.connected ? "✓" : "✗"} {test.data.message}
                  </div>
                )}
                <div className="mn-divider-dashed" />
                <div className="mn-keystats">
                  <div>
                    <span className="mn-eyebrow">Host</span>
                    <span className="v mn-tabular">{active.host}</span>
                  </div>
                  <div>
                    <span className="mn-eyebrow">Client</span>
                    <span className="v mn-tabular">{active.client}</span>
                  </div>
                  <div>
                    <span className="mn-eyebrow">Sysnr</span>
                    <span className="v mn-tabular">{active.sysnr}</span>
                  </div>
                  <div>
                    <span className="mn-eyebrow">Environment</span>
                    <span className="v">{active.environment}</span>
                  </div>
                  <div>
                    <span className="mn-eyebrow">Active</span>
                    <span className="v">{active.is_active ? "Yes" : "No"}</span>
                  </div>
                  <div>
                    <span className="mn-eyebrow">Created</span>
                    <span className="v mn-tabular">{relativeTime(active.created_at)}</span>
                  </div>
                </div>
                {active.description && (
                  <p style={{ marginTop: 14, fontSize: 13, color: "var(--mn-ink-500)" }}>{active.description}</p>
                )}
              </div>
            </div>
            <div className="mn-col-4">
              <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
                <SectionHeader title="Recent activity" caption="Last sync events" />
                <ul className="mn-event-list">
                  {active.last_sync_at && (
                    <li>
                      <span className="t mn-tabular">{relativeTime(active.last_sync_at)}</span>
                      <span
                        className={`tag ${active.last_sync_status === "failed" ? "fail" : "ok"}`}
                      >
                        {(active.last_sync_status ?? "OK").toUpperCase()}
                      </span>
                      <span>Last sync attempt</span>
                    </li>
                  )}
                  <li>
                    <span className="t mn-tabular">{relativeTime(active.created_at)}</span>
                    <span className="tag ok">OK</span>
                    <span>Registered in Meridian</span>
                  </li>
                  {active.updated_at !== active.created_at && (
                    <li>
                      <span className="t mn-tabular">{relativeTime(active.updated_at)}</span>
                      <span className="tag ok">OK</span>
                      <span>Configuration updated</span>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
