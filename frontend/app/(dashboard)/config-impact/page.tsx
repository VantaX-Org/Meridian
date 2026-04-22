"use client";

import { useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getVersions } from "@/lib/api/versions";
import { getConfigImpact } from "@/lib/api/connectivity";
import { severityColor } from "@/lib/format";
import type { ConfigImpactResult, Version } from "@/types/api";
import { KpiRail, type KpiItem } from "@/components/ui/kpi-rail";
import { NarrativeStrip } from "@/components/ui/narrative-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { SavedView } from "@/components/ui/saved-view";
import { FilterChipBar } from "@/components/ui/filter-chip-bar";
import { useUrlMultiState, useUrlState } from "@/hooks/use-url-state";
import {
  DenseDataTable,
  type DenseColumnDef,
} from "@/components/ui/dense-data-table";
import {
  SmallMultiplesChart,
  type SmallMultipleSeries,
} from "@/components/charts/small-multiples";
import { ConfigSankey } from "@/components/charts/config-sankey";

type Status = "blocked" | "degraded" | "ok";

const STATUS_CONFIG: Record<Status, { icon: React.ReactNode; badge: string; label: string }> = {
  blocked: {
    icon: <AlertOctagon className="h-3 w-3" />,
    badge: "bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20",
    label: "Blocked",
  },
  degraded: {
    icon: <AlertTriangle className="h-3 w-3" />,
    badge: "bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20",
    label: "Degraded",
  },
  ok: {
    icon: <CheckCircle className="h-3 w-3" />,
    badge: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20",
    label: "OK",
  },
};

export default function ConfigImpactPage() {
  const [versionId, setVersionId] = useUrlState("version_id");
  const [statuses, setStatuses] = useUrlMultiState("status");
  const [systems, setSystems] = useUrlMultiState("system");
  const [selected, setSelected] = useState<ConfigImpactResult | null>(null);

  const { data: versionData, isLoading: versionsLoading } = useQuery({
    queryKey: ["versions-list"],
    queryFn: () => getVersions({ limit: 20 }),
  });
  const completedVersions = (versionData?.versions ?? []).filter(
    (v: Version) => v.status === "agents_complete" || v.status === "complete",
  );
  const activeVersion = versionId || completedVersions[0]?.id || "";

  const {
    data: impactData,
    isLoading: impactLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["config-impact", activeVersion],
    queryFn: () => getConfigImpact(activeVersion),
    enabled: Boolean(activeVersion),
  });

  const results = impactData?.results ?? [];
  const summary = impactData?.summary;

  const availableSystems = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) set.add(r.system);
    return Array.from(set).sort();
  }, [results]);

  const filtered = useMemo(() => {
    const statusSet = new Set(statuses);
    const systemSet = new Set(systems);
    return results.filter((r) => {
      if (statusSet.size > 0 && !statusSet.has(r.status)) return false;
      if (systemSet.size > 0 && !systemSet.has(r.system)) return false;
      return true;
    });
  }, [results, statuses, systems]);

  const kpis = useMemo((): KpiItem[] => {
    const blocked = filtered.filter((r) => r.status === "blocked").length;
    const degraded = filtered.filter((r) => r.status === "degraded").length;
    const ok = filtered.filter((r) => r.status === "ok").length;
    const totalRecords = filtered.reduce((s, r) => s + r.total_affected_records, 0);
    const totalTransactions = filtered.reduce(
      (s, r) => s + (r.blocked_transactions?.length ?? 0),
      0,
    );
    const systemCount = availableSystems.length;
    return [
      { label: "Features", value: filtered.length },
      { label: "Blocked", value: blocked, tone: blocked > 0 ? "neg" : "pos" },
      { label: "Degraded", value: degraded, tone: degraded > 0 ? "warn" : "neutral" },
      { label: "OK", value: ok, tone: ok > 0 ? "pos" : "neutral" },
      {
        label: "Affected",
        value: totalRecords.toLocaleString(),
        hint: "Total affected records across blocking findings",
      },
      {
        label: "Txns blocked",
        value: totalTransactions,
        tone: totalTransactions > 0 ? "neg" : "neutral",
      },
      { label: "Systems", value: systemCount },
    ];
  }, [filtered, availableSystems]);

  const systemSeries: SmallMultipleSeries[] = useMemo(() => {
    return availableSystems.slice(0, 6).map((system, i) => {
      const slice = filtered.filter((r) => r.system === system);
      const blocked = slice.filter((r) => r.status === "blocked").length;
      const degraded = slice.filter((r) => r.status === "degraded").length;
      const ok = slice.filter((r) => r.status === "ok").length;
      const data = [
        { x: 0, y: blocked },
        { x: 1, y: degraded },
        { x: 2, y: ok },
      ];
      return {
        key: system,
        label: system,
        data,
        value: slice.length,
        color: i % 2 === 0 ? "#DC2626" : "#D97706",
      };
    });
  }, [availableSystems, filtered]);

  const narrative = useMemo(() => {
    const blocked = filtered.filter((r) => r.status === "blocked").length;
    const topBlocked = [...filtered]
      .filter((r) => r.status === "blocked")
      .sort((a, b) => b.total_affected_records - a.total_affected_records)[0];
    if (blocked > 0 && topBlocked) {
      return {
        headline: `${blocked} feature${blocked === 1 ? "" : "s"} blocked — worst: ${topBlocked.feature} on ${topBlocked.system} (${topBlocked.total_affected_records.toLocaleString()} records).`,
        detail: topBlocked.opportunity_cost_summary || "Clear the blocking findings to restore this flow.",
        tone: "neg" as const,
      };
    }
    const degraded = filtered.filter((r) => r.status === "degraded").length;
    if (degraded > 0) {
      return {
        headline: `${degraded} feature${degraded === 1 ? "" : "s"} degraded but none blocked.`,
        detail: "Data quality findings are slowing these flows.",
        tone: "warn" as const,
      };
    }
    return {
      headline: `${filtered.length} feature${filtered.length === 1 ? "" : "s"} assessed — all healthy.`,
      detail: "No blocked or degraded flows in this run.",
      tone: "pos" as const,
    };
  }, [filtered]);

  const columns: DenseColumnDef<ConfigImpactResult>[] = useMemo(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        size: 100,
        cell: ({ getValue }) => {
          const s = getValue() as Status;
          const cfg = STATUS_CONFIG[s];
          return (
            <Badge variant="outline" className={`text-[10px] ${cfg.badge}`}>
              {cfg.icon}
              <span className="ml-1">{cfg.label}</span>
            </Badge>
          );
        },
      },
      {
        accessorKey: "feature",
        header: "Feature",
        cell: ({ getValue }) => <span className="text-foreground">{getValue() as string}</span>,
      },
      {
        accessorKey: "system",
        header: "System",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "total_affected_records",
        header: "Affected",
        size: 100,
        cell: ({ getValue }) => (
          <span className="tabular-nums text-foreground">
            {(getValue() as number).toLocaleString()}
          </span>
        ),
      },
      {
        id: "blocking_count",
        header: "Findings",
        size: 90,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.blocking_findings.length}
          </span>
        ),
      },
      {
        id: "txns",
        header: "Txns",
        size: 80,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.blocked_transactions?.length ?? 0}
          </span>
        ),
      },
      {
        accessorKey: "opportunity_cost_summary",
        header: "Cost",
        enableSorting: false,
        cell: ({ getValue }) => (
          <span className="block max-w-[320px] truncate text-xs text-muted-foreground">
            {(getValue() as string) || "—"}
          </span>
        ),
      },
    ],
    [],
  );

  const isLoading = versionsLoading || impactLoading;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Config impact</h1>
          <p className="text-sm text-muted-foreground">
            How configuration findings affect business features across systems
            {summary ? ` · ${summary.total_features_assessed} feature${summary.total_features_assessed === 1 ? "" : "s"} assessed` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={activeVersion}
            onChange={(e) => setVersionId(e.target.value)}
            disabled={versionsLoading}
            className="rounded-full border border-black/[0.08] bg-white/[0.60] px-2.5 py-1 text-xs"
          >
            {completedVersions.map((v: Version) => (
              <option key={v.id} value={v.id}>
                {v.label || new Date(v.run_at).toLocaleDateString()}
              </option>
            ))}
            {completedVersions.length === 0 && !versionsLoading && (
              <option value="">No completed analyses</option>
            )}
          </select>
          <SavedView routeKey="config-impact" />
        </div>
      </div>

      <FilterChipBar
        groups={[
          {
            key: "status",
            label: "Status",
            selected: statuses,
            onChange: setStatuses,
            options: (Object.keys(STATUS_CONFIG) as Status[]).map((s) => ({
              value: s,
              label: STATUS_CONFIG[s].label,
            })),
          },
          {
            key: "system",
            label: "System",
            selected: systems,
            onChange: setSystems,
            options: availableSystems.map((s) => ({ value: s, label: s })),
          },
        ]}
      />

      <KpiRail items={kpis} columns={7} />

      <NarrativeStrip
        headline={narrative.headline}
        detail={narrative.detail}
        tone={narrative.tone}
        cta={null}
      />

      {isLoading ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load config impact.{" "}
            <Button variant="link" className="px-0" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div>
            <SectionHeader
              title="Findings → features → systems"
              caption="Width ∝ affected records on each edge"
            />
            <div className="mt-2">
              <ConfigSankey results={filtered} height={360} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-12">
              <SectionHeader
                title="Feature impact"
                caption={`${filtered.length.toLocaleString()} feature${filtered.length === 1 ? "" : "s"} after filters`}
              />
              <div className="mt-2">
                <DenseDataTable<ConfigImpactResult>
                  data={filtered}
                  columns={columns}
                  onRowClick={(r) => setSelected(r)}
                  emptyLabel="No features match these filters"
                />
              </div>
            </div>
          </div>

          <div>
            <SectionHeader title="By system" caption="Status split across top 6 systems" />
            <div className="mt-2">
              <SmallMultiplesChart series={systemSeries} columns={6} />
            </div>
          </div>
        </>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${STATUS_CONFIG[selected.status].badge}`}
                  >
                    {STATUS_CONFIG[selected.status].icon}
                    <span className="ml-1">{STATUS_CONFIG[selected.status].label}</span>
                  </Badge>
                  <span>{selected.feature}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{selected.system}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Affected records</p>
                    <p className="font-semibold text-foreground tabular-nums">
                      {selected.total_affected_records.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Blocked transactions</p>
                    <p className="font-semibold text-foreground tabular-nums">
                      {selected.blocked_transactions?.length ?? 0}
                    </p>
                  </div>
                </div>

                {selected.opportunity_cost_summary ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Opportunity cost
                    </p>
                    <p className="text-sm text-foreground">{selected.opportunity_cost_summary}</p>
                  </div>
                ) : null}

                {selected.blocking_findings.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Blocking findings ({selected.blocking_findings.length})
                    </p>
                    <div className="divide-y divide-black/[0.06] rounded-lg border border-black/[0.06] bg-white/[0.60]">
                      {selected.blocking_findings.slice(0, 8).map((b, i) => (
                        <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                          <Badge className={`text-[10px] ${severityColor(b.severity)}`}>
                            {b.severity}
                          </Badge>
                          <span className="font-mono text-foreground">{b.check_id}</span>
                          <span className="text-muted-foreground">· {b.module}</span>
                          <span className="ml-auto tabular-nums text-muted-foreground">
                            {b.affected_count.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selected.cross_system_dependencies &&
                Object.keys(selected.cross_system_dependencies).length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Cross-system dependencies
                    </p>
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {Object.entries(selected.cross_system_dependencies).map(([k, v]) => (
                        <li key={k}>
                          <span className="font-mono text-foreground">{k}</span>
                          {" → "}
                          <span>{v}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
