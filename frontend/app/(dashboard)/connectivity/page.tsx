"use client";

/**
 * Connectivity: every SAP connector and its last health check. The topology
 * draws each system on a ring around Meridian; an edge's colour and dash say
 * only how the last probe went.
 */

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Banner, Button, EmptyState, Metric, MetricStrip, Mono, PageHeader, SectionCard, StatusBadge, TableSkeleton, type Status,
} from "@/components/ui-core";
import { getSystems } from "@/lib/api/connectivity";
import { testConnection } from "@/lib/api/systems";
import { relativeTime } from "@/lib/format";
import type { HealthStatus, SAPSystemExtended } from "@/types/api";

type ConnKind = "RFC" | "OData" | "REST";

const KIND_NOTE: Record<ConnKind, string> = {
  RFC: "SAP remote function calls",
  OData: "SAP gateway services",
  REST: "Token-based REST clients",
};

function connKindFor(sys: SAPSystemExtended): ConnKind {
  // auth_type first, then system_type; matches the /sap/* connector layer.
  if (sys.auth_type === "rfc") return "RFC";
  if (sys.system_type === "s4hana_cloud" || sys.system_type === "successfactors") return "OData";
  if (sys.system_type === "ecc" || sys.system_type === "s4hana_onprem" || sys.system_type === "ewm") return "RFC";
  return "REST";
}

const HEALTH: Record<HealthStatus, { status: Status; edge: string; label: string }> = {
  healthy: { status: "ok", edge: "ok", label: "Healthy" },
  degraded: { status: "medium", edge: "degraded", label: "Degraded" },
  unreachable: { status: "failed", edge: "down", label: "Unreachable" },
  auth_failed: { status: "failed", edge: "down", label: "Sign-in failed" },
  unknown: { status: "idle", edge: "unknown", label: "Not checked" },
};
const health = (s: HealthStatus) => HEALTH[s] ?? HEALTH.unknown;

/* Radial layout: Meridian in the middle, systems evenly on one ring. */
const NW = 168, NH = 52, HW = 120, HH = 40;

function Topology({ systems }: { systems: SAPSystemExtended[] }) {
  const r = Math.max(150, systems.length * 34);
  const w = 2 * r + NW + 32, h = 2 * r + NH + 32;
  const cx = w / 2, cy = h / 2;
  const nodes = systems.map((s, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / systems.length;
    return { s, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

  return (
    <svg className="ui-graph" viewBox={`0 0 ${w} ${h}`} width={w} height={h}
         role="img" aria-label={`Topology: ${systems.length} systems connected to Meridian`}>
      {nodes.map(({ s, x, y }) => (
        <line key={s.id} className="ui-graph__edge" data-status={health(s.health_status).edge} x1={cx} y1={cy} x2={x} y2={y} strokeWidth="1.5" />
      ))}
      <rect className="ui-graph__hub" x={cx - HW / 2} y={cy - HH / 2} width={HW} height={HH} rx="4" />
      <text className="ui-graph__title" x={cx} y={cy + 4} textAnchor="middle">Meridian</text>
      {nodes.map(({ s, x, y }) => {
        const hs = health(s.health_status);
        return (
          <g key={s.id} transform={`translate(${x - NW / 2} ${y - NH / 2})`}>
            <title>{`${s.name}: ${hs.label}${s.health_message ? `. ${s.health_message}` : ""}`}</title>
            <rect className="ui-graph__node" width={NW} height={NH} rx="4" />
            <circle className="ui-graph__dot" data-status={hs.status} cx="14" cy="19" r="4" />
            <text className="ui-graph__title" x="26" y="23">{s.name.length > 19 ? `${s.name.slice(0, 18)}…` : s.name}</text>
            <text className="ui-graph__sub" x="26" y="40">{`${connKindFor(s)}, ${s.environment}`}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ConnectivityPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["connectivity.systems"], queryFn: getSystems });

  const testAll = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => testConnection(id)));
      return { ok: results.filter((r) => r.status === "fulfilled" && r.value.connected).length, total: ids.length };
    },
    onSuccess: (d) => toast.success(`${d.ok} of ${d.total} connector${d.total === 1 ? "" : "s"} reachable`),
    onError: () => toast.error("Connectors could not be tested. Check the API is reachable and try again."),
  });

  const list = data ?? [];
  const addLink = <Link href="/systems" className="aurora-button aurora-focus-ring" data-variant="primary" data-size="md"><span>Add connector</span></Link>;

  if (isLoading) {
    return <div className="ui-page"><PageHeader title="Connectivity" /><TableSkeleton rows={8} label="Loading connectors" /></div>;
  }
  if (error) {
    return (
      <div className="ui-page">
        <PageHeader title="Connectivity" />
        <Banner tone="danger" title="Connectors could not be read">{(error as Error).message}</Banner>
      </div>
    );
  }
  if (!list.length) {
    return (
      <div className="ui-page">
        <PageHeader title="Connectivity" actions={addLink} />
        <EmptyState action={<Link className="ui-link" href="/systems">Open systems</Link>}>
          No connectors yet. Add an SAP system to see its connection and health here.
        </EmptyState>
      </div>
    );
  }

  const counts = new Map<ConnKind, number>();
  for (const s of list) counts.set(connKindFor(s), (counts.get(connKindFor(s)) ?? 0) + 1);
  const healthy = list.filter((s) => s.health_status === "healthy").length;
  const degraded = list.filter((s) => s.health_status === "degraded").length;
  const offline = list.filter((s) => s.health_status === "unreachable" || s.health_status === "auth_failed").length;
  const checks = list
    .filter((s) => s.last_health_check)
    .sort((a, b) => new Date(b.last_health_check!).getTime() - new Date(a.last_health_check!).getTime())
    .slice(0, 8);

  return (
    <div className="ui-page">
      <PageHeader
        title="Connectivity"
        summary={`${list.length} connector${list.length === 1 ? "" : "s"} over ${counts.size} protocol${counts.size === 1 ? "" : "s"}. ${
          offline || degraded ? `${offline} unreachable, ${degraded} degraded. Test them to refresh.` : "All reachable at the last check."}`}
        actions={
          <>
            <Button variant="secondary" disabled={testAll.isPending} onClick={() => testAll.mutate(list.map((s) => s.id))}>
              {testAll.isPending ? "Testing" : "Test all"}
            </Button>
            {addLink}
          </>
        }
      />

      <MetricStrip label="Connector health">
        <Metric label="Connectors" value={list.length} />
        <Metric label="Healthy" value={healthy} />
        <Metric label="Degraded" value={degraded} tone={degraded ? "warning" : "default"} />
        <Metric label="Unreachable" value={offline} tone={offline ? "danger" : "default"} />
      </MetricStrip>

      <SectionCard title="Topology" meta="Every connector runs through Meridian" flush>
        <div className="ui-graph-scroll"><Topology systems={list} /></div>
        <ul className="ui-legend" aria-label="Edge state">
          <li><span className="ui-legend__line" />Healthy</li>
          <li><span className="ui-legend__line" data-status="degraded" />Degraded</li>
          <li><span className="ui-legend__line" data-status="down" />Unreachable or sign-in failed</li>
          <li><span className="ui-legend__line" data-status="unknown" />Not checked</li>
        </ul>
      </SectionCard>

      <div className="ui-columns">
        <SectionCard title="Connector types" flush>
          <ul className="ui-ranked">
            {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <li key={k}>
                <div className="ui-ranked__row">
                  <Mono>{k}</Mono>
                  <span className="ui-ranked__title">{KIND_NOTE[k]}</span>
                  <span className="ui-ranked__num">{n}</span>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Recent health checks" meta={checks.length ? "Newest first" : undefined} flush>
          {checks.length ? (
            <ul className="ui-ranked ui-ranked--status">
              {checks.map((s) => {
                const hs = health(s.health_status);
                return (
                  <li key={s.id}>
                    <Link href={`/systems/${s.id}`}>
                      <StatusBadge status={hs.status}>{hs.label}</StatusBadge>
                      <span className="ui-ranked__title">{s.name}</span>
                      <span className="ui-ranked__num">{relativeTime(s.last_health_check!)}</span>
                      {s.health_message ? <span className="ui-ranked__meta">{s.health_message}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState>No health checks recorded yet. Use Test all to probe every connector.</EmptyState>}
        </SectionCard>
      </div>
    </div>
  );
}
