"use client";

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI, SectionHeader } from "@/components/meridian/atoms";
import { ArrowRight, SparklesIcon } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { getSystems } from "@/lib/api/connectivity";
import { testConnection } from "@/lib/api/systems";
import { relativeTime } from "@/lib/format";
import type { SAPSystemExtended, AuthType, HealthStatus, SystemType } from "@/types/api";

/* ── Visual mappings ────────────────────────────────────────────── */

type ConnKind = "RFC" | "OData" | "HANA" | "REST";

const CONN_PALETTE: Record<ConnKind, { bg: string; fg: string; label: string }> = {
  RFC:   { bg: "var(--mn-primary-50)",  fg: "var(--mn-primary-700)", label: "RFC" },
  OData: { bg: "rgba(124,58,237,0.12)", fg: "#7C3AED",               label: "OData" },
  HANA:  { bg: "var(--mn-pos-bg)",      fg: "var(--mn-pos)",         label: "HANA" },
  REST:  { bg: "var(--mn-warn-bg)",     fg: "var(--mn-warn)",        label: "REST" },
};

function connKindFor(sys: SAPSystemExtended): ConnKind {
  // Prefer explicit auth_type, fall back to system_type heuristics. The
  // mapping here matches the canonical /sap/* connector layer (see CLAUDE.md).
  if (sys.auth_type === "rfc") return "RFC";
  if (sys.system_type === "s4hana_cloud" || sys.system_type === "successfactors") return "OData";
  if (sys.system_type === "ecc" || sys.system_type === "s4hana_onprem") return "RFC";
  if (sys.system_type === "concur" || sys.system_type === "ariba" || sys.system_type === "fieldglass") return "REST";
  if (sys.system_type === "btp") return "REST";
  if (sys.auth_type === "basic" || sys.auth_type === "oauth2_client_credentials" || sys.auth_type === "oauth2_saml" || sys.auth_type === "api_key") return "REST";
  return "REST";
}

function statusColour(s: HealthStatus): string {
  switch (s) {
    case "healthy":     return "var(--mn-pos)";
    case "degraded":    return "var(--mn-warn)";
    case "unreachable": return "var(--mn-neg)";
    case "auth_failed": return "var(--mn-neg)";
    default:            return "var(--mn-ink-300)";
  }
}

function statusToDot(s: HealthStatus): "healthy" | "degraded" | "down" | "scheduled" {
  if (s === "healthy")     return "healthy";
  if (s === "degraded")    return "degraded";
  if (s === "unreachable" || s === "auth_failed") return "down";
  return "scheduled";
}

function shortLabel(name: string): string {
  return name.length > 18 ? name.slice(0, 17) + "…" : name;
}

/* ── Topology graph ─────────────────────────────────────────────── */

function ConnectivityGraph({ systems }: { systems: SAPSystemExtended[] }) {
  const w = 960;
  const h = 540;
  const cx = w / 2;
  const cy = h / 2;
  const r = 220;

  const positions = systems.map((s, i) => {
    const angle = -Math.PI * 5 / 6 + i * ((Math.PI * 2) / Math.max(systems.length, 1));
    return { ...s, _x: cx + r * Math.cos(angle), _y: cy + r * Math.sin(angle) };
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="xMidYMid meet" className="mn-conn-graph">
      <defs>
        <radialGradient id="conn-core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--mn-primary)" stopOpacity="0.55" />
          <stop offset="40%" stopColor="var(--mn-primary)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--mn-primary)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="conn-core-fill" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.32" />
          <stop offset="40%" stopColor="var(--mn-primary)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--mn-primary-700)" stopOpacity="1" />
        </radialGradient>
        <pattern id="conn-dotgrid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="rgba(15,23,42,0.10)" />
        </pattern>
        <mask id="conn-bg-mask">
          <rect x="0" y="0" width={w} height={h} fill="white" />
          <circle cx={cx} cy={cy} r={r + 50} fill="black" />
        </mask>
      </defs>

      <rect x="0" y="0" width={w} height={h} fill="url(#conn-dotgrid)" mask="url(#conn-bg-mask)" />
      <circle cx={cx} cy={cy} r="200" fill="url(#conn-core-glow)" />
      {[120, 170, 220].map((rr, i) => (
        <circle
          key={rr}
          cx={cx}
          cy={cy}
          r={rr}
          fill="none"
          stroke="var(--mn-primary)"
          strokeOpacity="0.16"
          strokeWidth="1"
          strokeDasharray={i === 1 ? "0" : "3 5"}
        >
          <animate attributeName="r" values={`${rr};${rr + 14};${rr}`} dur={`${4 + i}s`} repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="0.16;0.04;0.16" dur={`${4 + i}s`} repeatCount="indefinite" />
        </circle>
      ))}

      {positions.map((s, i) => {
        const c = statusColour(s.health_status);
        const op = s.health_status === "unknown" ? 0.3 : 0.85;
        const dx = s._x - cx;
        const dy = s._y - cy;
        const len = Math.hypot(dx, dy);
        const nx = -dy / len;
        const ny = dx / len;
        const bow = 40 * Math.sin(i);
        const mx = (cx + s._x) / 2;
        const my = (cy + s._y) / 2;
        const c1x = mx + nx * bow;
        const c1y = my + ny * bow;
        const path = `M ${cx} ${cy} Q ${c1x} ${c1y}, ${s._x} ${s._y}`;
        const pathId = `conn-path-${s.id}`;
        return (
          <g key={s.id}>
            <path
              id={pathId}
              d={path}
              fill="none"
              stroke={c}
              strokeOpacity={op}
              strokeWidth={s.health_status === "unknown" ? 1 : 1.8}
              strokeDasharray={s.health_status === "degraded" ? "5 5" : s.health_status === "unknown" ? "2 5" : "0"}
              strokeLinecap="round"
            />
            {s.health_status === "healthy" && (
              <>
                <circle r="3" fill={c}>
                  <animateMotion dur={`${2.4 + i * 0.3}s`} repeatCount="indefinite">
                    <mpath href={`#${pathId}`} />
                  </animateMotion>
                </circle>
                <circle r="5" fill={c} opacity="0.35">
                  <animateMotion dur={`${2.4 + i * 0.3}s`} repeatCount="indefinite" begin="-0.15s">
                    <mpath href={`#${pathId}`} />
                  </animateMotion>
                </circle>
              </>
            )}
          </g>
        );
      })}

      <g>
        <circle cx={cx} cy={cy} r="62" fill="url(#conn-core-fill)" />
        <circle cx={cx} cy={cy} r="62" fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth="1" />
        <g transform={`translate(${cx - 18}, ${cy - 24})`}>
          <path
            d="M 4 38 L 4 4 L 18 16 L 32 4 L 32 38"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="2" y1="44" x2="34" y2="44" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <text
          x={cx}
          y={cy + 38}
          textAnchor="middle"
          fontSize="10"
          fontWeight="700"
          fill="rgba(255,255,255,0.85)"
          fontFamily="JetBrains Mono, monospace"
          letterSpacing="0.16em"
        >
          MERIDIAN
        </text>
      </g>

      {positions.map((s) => {
        const c = statusColour(s.health_status);
        const ct = CONN_PALETTE[connKindFor(s)];
        const nodeW = 156;
        const nodeH = 84;
        const x = s._x - nodeW / 2;
        const y = s._y - nodeH / 2;
        return (
          <g key={s.id}>
            <rect
              x={x - 6}
              y={y - 6}
              rx="14"
              width={nodeW + 12}
              height={nodeH + 12}
              fill="none"
              stroke={c}
              strokeOpacity="0.18"
              strokeWidth="1"
            />
            <rect x={x} y={y} rx="10" width={nodeW} height={nodeH} fill="white" stroke="var(--mn-line)" strokeWidth="1" />
            <rect x={x} y={y} rx="10" width="3" height={nodeH} fill={c} />
            <circle cx={x + 16} cy={y + 18} r="4" fill={c} />
            <circle cx={x + 16} cy={y + 18} r="4" fill="none" stroke={c} strokeOpacity="0.25" strokeWidth="6" />
            <text
              x={x + 28}
              y={y + 22}
              fontSize="12.5"
              fontWeight="600"
              fill="var(--mn-ink-900)"
              fontFamily="Inter Tight, sans-serif"
              letterSpacing="-0.01em"
            >
              {shortLabel(s.name)}
            </text>
            <rect x={x + 14} y={y + 36} rx="4" width="56" height="20" fill={ct.bg} />
            <text
              x={x + 42}
              y={y + 49}
              textAnchor="middle"
              fontSize="10"
              fontWeight="700"
              fill={ct.fg}
              fontFamily="JetBrains Mono, monospace"
              letterSpacing="0.08em"
            >
              {ct.label}
            </text>
            <text
              x={x + 80}
              y={y + 50}
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
              fontWeight="600"
              fill="var(--mn-ink-300)"
              letterSpacing="0.06em"
            >
              {s.environment}
            </text>
            <rect x={x + 14} y={y + 68} rx="2" width={nodeW - 28} height="3" fill="rgba(15,23,42,0.06)" />
            <rect
              x={x + 14}
              y={y + 68}
              rx="2"
              width={(nodeW - 28) * (s.health_status === "healthy" ? 0.7 : s.health_status === "degraded" ? 0.38 : 0)}
              height="3"
              fill={c}
            />
          </g>
        );
      })}
    </svg>
  );
}

/* ── Page ───────────────────────────────────────────────────────── */

export default function ConnectivityPage() {
  const { data: systems, isLoading, error } = useQuery({
    queryKey: ["connectivity.systems"],
    queryFn: getSystems,
  });

  const testAll = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => testConnection(id)));
      const ok = results.filter(
        (r) => r.status === "fulfilled" && r.value.connected,
      ).length;
      return { ok, total: ids.length };
    },
    onSuccess: (d) => {
      toast.success(`${d.ok}/${d.total} connector${d.total === 1 ? "" : "s"} reachable`);
    },
    onError: () => toast.error("Could not test connectors"),
  });

  if (isLoading) {
    return (
      <>
        <PageHead title="Connectivity" route="Connect · /connectivity" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHead title="Connectivity" route="Connect · /connectivity" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/systems</code>.
        </div>
      </>
    );
  }

  const list = systems ?? [];

  // Connector counts grouped by inferred protocol.
  const counts = list.reduce(
    (acc, sys) => {
      const k = connKindFor(sys);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {} as Record<ConnKind, number>,
  );
  const types = Object.keys(counts).length;

  const oauthCount = list.filter(
    (s) => s.auth_type === "oauth2_client_credentials" || s.auth_type === "oauth2_saml",
  ).length;

  const healthy = list.filter((s) => s.health_status === "healthy").length;
  const degraded = list.filter((s) => s.health_status === "degraded").length;
  const offline = list.filter((s) => s.health_status === "unreachable" || s.health_status === "auth_failed").length;

  const recentChecks = list
    .filter((s) => s.last_health_check)
    .sort(
      (a, b) =>
        new Date(b.last_health_check!).getTime() - new Date(a.last_health_check!).getTime(),
    )
    .slice(0, 6);

  return (
    <>
      <PageHead
        title="Connectivity"
        route="Connect · /connectivity"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{list.length} systems</strong> wired in via{" "}
            <strong style={{ color: "var(--mn-ink-700)" }}>{types}</strong> connector types.
            {oauthCount > 0 && (
              <>
                {" "}<strong style={{ color: "var(--mn-pos)" }}>{oauthCount} use OAuth</strong>.
              </>
            )}
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="mn-btn mn-btn-ghost"
              onClick={() => {
                if (list.length === 0) {
                  toast.info("No connectors to test");
                  return;
                }
                testAll.mutate(list.map((s) => s.id));
              }}
              disabled={testAll.isPending || list.length === 0}
            >
              {testAll.isPending ? "Testing…" : "Test all"}
            </button>
            <Link href="/systems" className="mn-btn mn-btn-primary">Add connector</Link>
          </>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Connectors" value={list.length} hint={`${types} types in use`} tone="pos" />
        <KPI label="Healthy" value={healthy} tone="pos" />
        <KPI label="Degraded" value={degraded} tone={degraded > 0 ? "warn" : "pos"} />
        <KPI label="Offline" value={offline} tone={offline > 0 ? "neg" : "pos"} />
      </div>

      <SectionHeader
        title="Topology"
        caption="All systems connect through the Meridian core · live packet flow on healthy edges"
        right={
          <a href="/systems" className="mn-link">
            Systems <ArrowRight size={11} />
          </a>
        }
      />
      <div
        className="mn-card"
        style={{
          padding: "12px 12px 4px",
          overflow: "hidden",
          background: "linear-gradient(180deg, #FAFAFB, #FFFFFF 80%)",
        }}
      >
        {list.length > 0 ? (
          <ConnectivityGraph systems={list} />
        ) : (
          <div style={{ padding: 60, textAlign: "center", color: "var(--mn-ink-400)" }}>
            No systems connected yet.
          </div>
        )}
      </div>

      <div className="mn-row mn-row-12" style={{ marginTop: 18 }}>
        <div className="mn-col-7" style={{ gridColumn: "span 7" }}>
          <div className="mn-card mn-card-pad">
            <SectionHeader title="Connector types" caption="Per-protocol counts" />
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              {(Object.entries(counts) as [ConnKind, number][]).map(([k, n]) => {
                const ct = CONN_PALETTE[k];
                return (
                  <div
                    key={k}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      alignItems: "center",
                      gap: 14,
                      padding: "12px 0",
                      borderBottom: "1px dashed var(--mn-line-2)",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        padding: "5px 10px",
                        borderRadius: 5,
                        background: ct.bg,
                        color: ct.fg,
                        font: "700 11px/1 'JetBrains Mono', monospace",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {ct.label}
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--mn-ink-500)" }}>
                      {k === "RFC" && "Native SAP remote function calls"}
                      {k === "OData" && "Standardised REST-ful SAP gateway"}
                      {k === "HANA" && "Direct HANA database connection"}
                      {k === "REST" && "Token-based REST clients"}
                    </span>
                    <span
                      className="mn-tabular"
                      style={{ font: "600 16px/1 'Inter Tight'", color: "var(--mn-ink-900)" }}
                    >
                      {n}
                    </span>
                  </div>
                );
              })}
              {types === 0 && (
                <div style={{ color: "var(--mn-ink-400)" }}>No connector types detected.</div>
              )}
            </div>
          </div>
        </div>

        <div className="mn-col-5" style={{ gridColumn: "span 5" }}>
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader title="Recent health checks" caption={`Last ${recentChecks.length} probes`} />
            <ul className="mn-event-list">
              {recentChecks.map((s) => {
                const cls =
                  s.health_status === "healthy"
                    ? "ok"
                    : s.health_status === "degraded"
                      ? "warn"
                      : "fail";
                return (
                  <li key={s.id}>
                    <span className="t mn-tabular">{relativeTime(s.last_health_check!)}</span>
                    <span className={`tag ${cls}`}>
                      {s.health_status.replace(/_/g, " ").toUpperCase()}
                    </span>
                    <span>{s.name} {s.health_message ? `· ${s.health_message}` : ""}</span>
                  </li>
                );
              })}
              {recentChecks.length === 0 && (
                <li style={{ color: "var(--mn-ink-400)" }}>No health checks recorded yet.</li>
              )}
            </ul>
            {(degraded > 0 || offline > 0) && (
              <div className="mn-narrative" style={{ marginTop: 16, padding: 10 }}>
                <div className="ico"><SparklesIcon size={13} /></div>
                <div style={{ flex: 1, fontSize: 12.5, color: "var(--mn-ink-700)" }}>
                  {offline > 0 && (
                    <>
                      <strong style={{ color: "var(--mn-neg)" }}>{offline} unreachable</strong>
                      {degraded > 0 ? " · " : ""}
                    </>
                  )}
                  {degraded > 0 && (
                    <>
                      <strong style={{ color: "var(--mn-warn)" }}>{degraded} degraded</strong>
                    </>
                  )}
                  . Run a connectivity test on Systems to refresh.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
