"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ClipboardList,
  Crown,
  AlertTriangle,
  FileCheck2,
  XCircle,
  BookOpen,
  GitMerge,
  Brain,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { DetailPanel } from "@/components/ui/detail-panel";
import { LegacyPageBanner } from "@/components/ui/legacy-page-banner";
import { Textarea } from "@/components/ui/textarea";
import {
  bulkApprove,
  escalateItem,
  getQueueItems,
  resolveItem,
} from "@/lib/api/stewardship";
import { relativeTime } from "@/lib/format";
import type {
  StewardshipItemType,
  StewardshipQueueItem,
} from "@/types/api";
import { KpiRail, type KpiItem } from "@/components/ui/kpi-rail";
import { NarrativeStrip } from "@/components/ui/narrative-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { SavedView } from "@/components/ui/saved-view";
import { FilterChipBar } from "@/components/ui/filter-chip-bar";
import { useUrlMultiState } from "@/hooks/use-url-state";
import {
  DenseDataTable,
  type DenseColumnDef,
} from "@/components/ui/dense-data-table";
import {
  SmallMultiplesChart,
  type SmallMultipleSeries,
} from "@/components/charts/small-multiples";

/* ── Config ─────────────────────────────────────────────── */

const ITEM_TYPE_CONFIG: Record<
  StewardshipItemType,
  { label: string; icon: React.ReactNode; color: string }
> = {
  merge_decision: {
    label: "Merge",
    icon: <GitMerge className="h-3 w-3" />,
    color: "bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20",
  },
  golden_record_review: {
    label: "Golden",
    icon: <Crown className="h-3 w-3" />,
    color: "bg-[#E76500]/10 text-[#E76500] border-[#E76500]/20",
  },
  exception: {
    label: "Exception",
    icon: <AlertTriangle className="h-3 w-3" />,
    color: "bg-[#BB0000]/10 text-[#BB0000] border-[#BB0000]/20",
  },
  writeback_approval: {
    label: "Writeback",
    icon: <FileCheck2 className="h-3 w-3" />,
    color: "bg-primary/10 text-primary border-primary/20",
  },
  contract_breach: {
    label: "Contract",
    icon: <XCircle className="h-3 w-3" />,
    color: "bg-[#BB0000]/10 text-[#BB0000] border-[#BB0000]/20",
  },
  glossary_review: {
    label: "Glossary",
    icon: <BookOpen className="h-3 w-3" />,
    color: "bg-[#256F3A]/10 text-[#256F3A] border-[#256F3A]/20",
  },
};

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Crit", color: "bg-[#BB0000]/10 text-[#BB0000]" },
  2: { label: "High", color: "bg-[#E76500]/10 text-[#E76500]" },
  3: { label: "Med", color: "bg-primary/10 text-primary" },
  4: { label: "Low", color: "bg-[#256F3A]/10 text-[#256F3A]" },
  5: { label: "Info", color: "bg-white/[0.65] text-muted-foreground" },
};

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= 0.85 ? "bg-[#256F3A]" : confidence >= 0.6 ? "bg-[#E76500]" : "bg-[#BB0000]";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-black/[0.06]">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

function ageHours(created_at: string): number {
  return (Date.now() - new Date(created_at).getTime()) / 3_600_000;
}

function ageTone(hours: number, sla: number | null): "pos" | "neutral" | "warn" | "neg" {
  if (sla === null) return hours > 48 ? "warn" : "neutral";
  const pct = hours / sla;
  if (pct >= 1) return "neg";
  if (pct >= 0.7) return "warn";
  return "pos";
}

/* ── Page ──────────────────────────────────────────────── */

export default function StewardshipPage() {
  const [types, setTypes] = useUrlMultiState("type");
  const [statuses, setStatuses] = useUrlMultiState("status", ["open"]);
  const [priorities, setPriorities] = useUrlMultiState("priority");
  const [selected, setSelected] = useState<StewardshipQueueItem | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["stewardship-queue", statuses[0] ?? "open"],
    queryFn: () => getQueueItems({ status: statuses[0] ?? "open", limit: 200 }),
  });
  const items = data?.items ?? [];

  const resolveMutation = useMutation({
    mutationFn: ({ id, action, notes }: { id: string; action: "approve" | "reject"; notes?: string }) =>
      resolveItem(id, action, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stewardship-queue"] });
      setSelected(null);
    },
  });

  const escalateMutation = useMutation({
    mutationFn: (id: string) => escalateItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stewardship-queue"] });
      setSelected(null);
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (ids: string[]) => bulkApprove(ids, 0.85),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stewardship-queue"] }),
  });

  // Apply type + priority filters client-side
  const filtered = useMemo(() => {
    const typeSet = new Set(types);
    const priSet = new Set(priorities.map(Number));
    return items.filter((i) => {
      if (typeSet.size > 0 && !typeSet.has(i.item_type)) return false;
      if (priSet.size > 0 && !priSet.has(i.priority)) return false;
      return true;
    });
  }, [items, types, priorities]);

  // KPIs
  const kpis = useMemo((): KpiItem[] => {
    let critical = 0,
      overSla = 0,
      autoApprovable = 0,
      withAi = 0,
      confSum = 0;
    for (const item of filtered) {
      if (item.priority === 1) critical++;
      const age = ageHours(item.created_at);
      if (item.sla_hours !== null && age > item.sla_hours) overSla++;
      if (item.ai_confidence !== null && item.ai_confidence !== undefined) {
        withAi++;
        confSum += item.ai_confidence;
        if (item.ai_confidence >= 0.85) autoApprovable++;
      }
    }
    const avgConf = withAi > 0 ? (confSum / withAi) * 100 : 0;
    return [
      { label: "Open", value: filtered.length.toLocaleString() },
      { label: "Critical", value: critical, tone: critical > 0 ? "neg" : "pos" },
      { label: "Over SLA", value: overSla, tone: overSla > 0 ? "warn" : "pos" },
      {
        label: "Auto-approvable",
        value: autoApprovable,
        hint: "AI confidence ≥ 85%",
        tone: autoApprovable > 0 ? "pos" : "neutral",
      },
      {
        label: "Avg confidence",
        value: withAi > 0 ? `${avgConf.toFixed(0)}%` : "—",
        tone: avgConf >= 85 ? "pos" : avgConf >= 60 ? "warn" : "neg",
      },
      {
        label: "With AI",
        value: withAi,
        hint: `${filtered.length - withAi} items lack AI recommendation`,
      },
    ];
  }, [filtered]);

  // Small multiples — counts per type (use totals as single-value "bars")
  const typeSeries: SmallMultipleSeries[] = useMemo(() => {
    const keys: StewardshipItemType[] = [
      "merge_decision",
      "golden_record_review",
      "exception",
      "writeback_approval",
      "contract_breach",
      "glossary_review",
    ];
    return keys.map((k, i) => {
      const slice = filtered.filter((f) => f.item_type === k);
      const count = slice.length;
      // Fake a 7-point series from priority buckets (P1..P5 → counts)
      const data = [1, 2, 3, 4, 5].map((p) => ({
        x: p,
        y: slice.filter((s) => s.priority === p).length,
      }));
      return {
        key: k,
        label: ITEM_TYPE_CONFIG[k]?.label ?? k,
        data,
        value: count,
        color: i % 2 === 0 ? "#0070F2" : "#7C3AED",
      };
    });
  }, [filtered]);

  const autoApprovableIds = useMemo(
    () =>
      filtered
        .filter((f) => f.ai_confidence !== null && (f.ai_confidence ?? 0) >= 0.85 && f.status === "open")
        .map((f) => f.id),
    [filtered],
  );

  // Narrative
  const narrative = useMemo(() => {
    const critical = filtered.filter((f) => f.priority === 1).length;
    const autoCount = autoApprovableIds.length;
    const overSla = filtered.filter(
      (f) => f.sla_hours !== null && ageHours(f.created_at) > f.sla_hours,
    ).length;

    if (critical > 0) {
      return {
        headline: `${critical} critical item${critical === 1 ? "" : "s"} in the queue${overSla > 0 ? ` · ${overSla} past SLA` : ""}.`,
        detail:
          autoCount > 0
            ? `${autoCount} more items are AI-confident above 85% and eligible for bulk approval.`
            : "Triage the criticals manually.",
        tone: "neg" as const,
      };
    }
    if (autoCount > 0) {
      return {
        headline: `${autoCount} item${autoCount === 1 ? "" : "s"} are AI-confident ≥ 85% — ready for bulk approval.`,
        detail: `${filtered.length - autoCount} still need human judgement.`,
        tone: "info" as const,
      };
    }
    return {
      headline: `${filtered.length.toLocaleString()} item${filtered.length === 1 ? "" : "s"} in queue — no criticals, no auto-approvable.`,
      detail: overSla > 0 ? `${overSla} are past SLA.` : "All items within SLA.",
      tone: overSla > 0 ? ("warn" as const) : ("pos" as const),
    };
  }, [filtered, autoApprovableIds]);

  const columns: DenseColumnDef<StewardshipQueueItem>[] = useMemo(
    () => [
      {
        accessorKey: "priority",
        header: "P",
        size: 56,
        cell: ({ getValue }) => {
          const p = getValue() as number;
          const cfg = PRIORITY_LABELS[p] ?? PRIORITY_LABELS[3];
          return <Badge className={`text-[10px] ${cfg.color}`}>{cfg.label}</Badge>;
        },
      },
      {
        accessorKey: "item_type",
        header: "Type",
        cell: ({ getValue }) => {
          const t = getValue() as StewardshipItemType;
          const cfg = ITEM_TYPE_CONFIG[t] ?? {
            label: t,
            icon: <ClipboardList className="h-3 w-3" />,
            color: "bg-white/[0.65] text-muted-foreground",
          };
          return (
            <Badge variant="outline" className={`text-[10px] ${cfg.color}`}>
              {cfg.icon}
              <span className="ml-1">{cfg.label}</span>
            </Badge>
          );
        },
      },
      {
        accessorKey: "domain",
        header: "Subject",
        cell: ({ getValue }) => (
          <span className="max-w-[280px] truncate text-foreground">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "ai_confidence",
        header: "AI",
        size: 128,
        cell: ({ getValue }) => {
          const v = getValue() as number | null;
          if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
          return <ConfidenceBar confidence={v} />;
        },
      },
      {
        accessorKey: "assigned_to",
        header: "Assignee",
        cell: ({ getValue }) =>
          getValue() ? (
            <span className="text-foreground">{getValue() as string}</span>
          ) : (
            <span className="text-muted-foreground">unassigned</span>
          ),
      },
      {
        accessorKey: "created_at",
        header: "Age",
        size: 96,
        cell: ({ row }) => {
          const age = ageHours(row.original.created_at);
          const tone = ageTone(age, row.original.sla_hours);
          return (
            <span
              className={
                tone === "neg"
                  ? "font-medium text-[#BB0000] tabular-nums"
                  : tone === "warn"
                    ? "font-medium text-[#E76500] tabular-nums"
                    : "text-muted-foreground tabular-nums"
              }
            >
              {relativeTime(row.original.created_at)}
            </span>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 96,
        cell: ({ getValue }) => (
          <span className="capitalize text-muted-foreground">
            {(getValue() as string).replace("_", " ")}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <LegacyPageBanner
        auroraHref="/workbench"
        auroraLabel="Workbench"
        note="Aurora's Workbench combines the stewardship queue with findings triage and the record drawer in one keyboard-first surface."
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Stewardship queue</h1>
          <p className="text-sm text-muted-foreground">
            Manual decisions pending review · {items.length.toLocaleString()} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SavedView routeKey="stewardship" />
          {autoApprovableIds.length > 0 ? (
            <Button
              size="sm"
              onClick={() => bulkMutation.mutate(autoApprovableIds)}
              disabled={bulkMutation.isPending}
              className="gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Brain className="h-3.5 w-3.5" />
              Bulk approve {autoApprovableIds.length}
            </Button>
          ) : null}
          <Link href="/stewardship/metrics">
            <Button variant="outline" size="sm">
              Metrics
            </Button>
          </Link>
        </div>
      </div>

      <FilterChipBar
        groups={[
          {
            key: "status",
            label: "Status",
            selected: statuses,
            onChange: setStatuses,
            single: true,
            options: [
              { value: "open", label: "Open" },
              { value: "in_progress", label: "In progress" },
              { value: "resolved", label: "Resolved" },
              { value: "escalated", label: "Escalated" },
            ],
          },
          {
            key: "type",
            label: "Type",
            selected: types,
            onChange: setTypes,
            options: (Object.keys(ITEM_TYPE_CONFIG) as StewardshipItemType[]).map((k) => ({
              value: k,
              label: ITEM_TYPE_CONFIG[k].label,
            })),
          },
          {
            key: "priority",
            label: "Priority",
            selected: priorities,
            onChange: setPriorities,
            options: Object.entries(PRIORITY_LABELS).map(([k, v]) => ({
              value: k,
              label: `P${k} · ${v.label}`,
            })),
          },
        ]}
      />

      <KpiRail items={kpis} columns={6} />

      <NarrativeStrip
        headline={narrative.headline}
        detail={narrative.detail}
        tone={narrative.tone}
        cta={
          autoApprovableIds.length > 0
            ? {
                label: `Bulk approve ${autoApprovableIds.length}`,
                href: "#",
              }
            : null
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load queue.{" "}
            <Button variant="link" className="px-0" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div>
            <SectionHeader
              title="Queue"
              caption={`${filtered.length.toLocaleString()} match filters${filtered.length > 500 ? " · virtualized" : ""}`}
            />
            <div className="mt-2">
              <DenseDataTable<StewardshipQueueItem>
                data={filtered}
                columns={columns}
                onRowClick={(f) => setSelected(f)}
                maxHeight={560}
                emptyLabel="No items match these filters"
              />
            </div>
          </div>

          <div>
            <SectionHeader title="By type" caption="Counts split across priority" />
            <div className="mt-2">
              <SmallMultiplesChart series={typeSeries} columns={6} />
            </div>
          </div>
        </>
      )}

      {/* Detail slide-over */}
      <DetailPanel
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        width={520}
        title={
          selected ? (
            <span className="flex items-center gap-2">
              <Badge className={PRIORITY_LABELS[selected.priority]?.color}>
                P{selected.priority}
              </Badge>
              <span>{ITEM_TYPE_CONFIG[selected.item_type]?.label ?? selected.item_type}</span>
            </span>
          ) : null
        }
        subtitle={selected ? <span className="font-mono">{selected.domain}</span> : undefined}
        onPrev={
          selected
            ? () => {
                const i = filtered.findIndex((x) => x.id === selected.id);
                if (i > 0) setSelected(filtered[i - 1]);
              }
            : undefined
        }
        onNext={
          selected
            ? () => {
                const i = filtered.findIndex((x) => x.id === selected.id);
                if (i >= 0 && i < filtered.length - 1) setSelected(filtered[i + 1]);
              }
            : undefined
        }
        footer={
          selected ? (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => escalateMutation.mutate(selected.id)}
                disabled={escalateMutation.isPending}
              >
                Escalate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOverrideOpen(true)}
              >
                Reject
              </Button>
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={resolveMutation.isPending}
                onClick={() =>
                  resolveMutation.mutate({ id: selected.id, action: "approve" })
                }
              >
                Approve
              </Button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Source ID</p>
                <p className="font-mono text-xs text-foreground">{selected.source_id}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="capitalize text-foreground">{selected.status}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-foreground">{relativeTime(selected.created_at)}</p>
              </div>
              {selected.sla_hours ? (
                <div>
                  <p className="text-xs text-muted-foreground">SLA</p>
                  <p className="text-foreground">{selected.sla_hours}h</p>
                </div>
              ) : null}
            </div>

            {selected.ai_recommendation ? (
              <div className="rounded-lg border border-black/[0.06] bg-[#7858FF]/[0.05] p-3">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-[#7858FF]" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#7858FF]">
                    AI recommendation
                  </span>
                  {selected.ai_confidence !== null && selected.ai_confidence !== undefined ? (
                    <ConfidenceBar confidence={selected.ai_confidence} />
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-foreground">{selected.ai_recommendation}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </DetailPanel>

      {/* Override / reject reason dialog */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject with reason</DialogTitle>
          </DialogHeader>
          <Textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Correction reason (required)"
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOverrideOpen(false);
                setOverrideReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!overrideReason.trim() || !selected}
              onClick={() => {
                if (!selected) return;
                resolveMutation.mutate({
                  id: selected.id,
                  action: "reject",
                  notes: overrideReason.trim(),
                });
                setOverrideOpen(false);
                setOverrideReason("");
              }}
            >
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
