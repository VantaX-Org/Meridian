"use client";

/** The facts the object screen shows. Every number comes from an existing lib hook; nothing is invented here. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPairs } from "@/lib/api/v2/compare";
import { useFixture } from "@/lib/api/v2/fixture";
import { downloadCleaningWorkbook } from "@/lib/api/next/runs";
import { DIMENSIONS, type RuleRow } from "@/lib/api/v2/types";
import { useObjectRules, useReceipt } from "@/lib/v2/queries";
import { useWorkGroups } from "@/lib/v2/object-queries";
import { t } from "@/lib/v2/i18n";
import { dqsOf } from "./format";
import type { ObjectRun } from "./useObjectRun";

export const SEV_ORDER = ["critical", "high", "medium", "low", "info"] as const;
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function useObjectData(o: ObjectRun) {
  const fx = useFixture();
  const rules = useObjectRules(o.module, o.runId);
  const receipt = useReceipt(o.module, o.runId, !!o.runId);
  const work = useWorkGroups(o.module, o.runId);
  const pairs = useQuery({ queryKey: ["system-compare", "pairs", fx], queryFn: getPairs, staleTime: 60_000 });
  const [busy, setBusy] = useState(false);

  return useMemo(() => {
    const cell = o.landscape.data?.cells.find((c) => c.system_id === o.systemId && c.module === o.module) ?? null;
    const now = dqsOf(o.run, o.module);
    const before = dqsOf(o.previous, o.module);
    const failing: RuleRow[] = (rules.data ?? [])
      .filter((r) => r.affected_count > 0)
      .sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || b.affected_count - a.affected_count);
    const bySev = SEV_ORDER.map((s) => {
      const rs = failing.filter((r) => r.severity === s);
      return { sev: s, rules: rs.length, records: rs.reduce((n, r) => n + r.affected_count, 0) };
    });
    const runs = [...o.heads].reverse();
    const trend = runs.map((h) => ({ axis: day(h.run_at), title: t("Run {n} on {date}", { n: h.run_number ?? "", date: day(h.run_at) }), value: dqsOf(h, o.module) }));
    const groups = work.data ?? [];
    const open = groups.reduce((n, g) => n + g.open, 0);
    const proposed = groups.reduce((n, g) => n + Math.min(g.proposed, g.open), 0);
    const pair = pairs.data?.pairs.find((p) => p.module === o.module && (p.source.id === o.systemId || p.target.id === o.systemId) && p.last?.scores) ?? null;
    const dims = DIMENSIONS.map((d) => ({ key: d.key, label: d.label, value: cell?.dimensions[d.key] ?? null }));
    const breaches = receipt.data?.breaches ?? [];
    return {
      loading: rules.isLoading || o.landscape.isLoading || o.runsLoading,
      error: rules.isError || o.landscape.isError,
      cell,
      now,
      delta: now !== null && before !== null ? now - before : null,
      failing,
      measured: (rules.data ?? []).length,
      bySev,
      trend,
      groups,
      open,
      proposed,
      person: open - proposed,
      pair,
      dims,
      receipt: receipt.data,
      capped: receipt.data?.capped ?? cell?.capped ?? false,
      capLevel: receipt.data?.cap_level ?? cell?.cap_level ?? null,
      capIds: breaches.map((b) => b.check_id),
      busy,
      download: o.runId
        ? () => {
            setBusy(true);
            downloadCleaningWorkbook(o.runId as string, o.module).catch(() => undefined).finally(() => setBusy(false));
          }
        : null,
      fixPath: (seg: "proposed" | "manual", rule?: string) => `/work?module=${encodeURIComponent(o.module)}&seg=${seg}${rule ? `&rule=${encodeURIComponent(rule)}` : ""}`,
    };
  }, [o, rules.data, rules.isLoading, rules.isError, receipt.data, work.data, pairs.data, busy]);
}

export type ObjectData = ReturnType<typeof useObjectData>;
