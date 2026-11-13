"use client";

/**
 * The object's run switcher: the kit switcher over runs paged on the server 30 at a time. A row shows the
 * new and resolved counts against its parent when that comparison is already in the cache; nothing is fetched for it.
 */
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RunSwitcher as KitRunSwitcher, type RunOption } from "@/design/next/kit";
import { nextRunKeys, SWITCHER_PAGE, type CompareSummary } from "@/lib/api/next/runs";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { toOption } from "./model";
import type { ObjectRun } from "./useObjectRun";

export function ObjectRunSwitcher({ o, onCompare }: { o: ObjectRun; onCompare: () => void }) {
  const qc = useQueryClient();
  const fx = useFixture();
  const { heads, runs } = o;
  const total = runs.data?.pages[0]?.total ?? heads.length;
  const options = useMemo<RunOption[]>(() => {
    const byId = new Map(heads.map((h) => [h.id, h]));
    const list = heads.map((h, i) => {
      const parentId = h.parent_version_id ?? heads[i + 1]?.id ?? null;
      const parent = parentId ? byId.get(parentId) : undefined;
      const s = parentId ? qc.getQueryData<CompareSummary>(nextRunKeys.summary(fx, parentId, h.id)) : undefined;
      const chips = s ? [{ tone: "new" as const, count: s.totals.new, label: t("new") }, { tone: "resolved" as const, count: s.totals.resolved, label: t("resolved") }] : undefined;
      return toOption(h, o.module, h.parent_version_id ? (parent?.run_number ?? null) : null, chips);
    });
    // A run opened by address but older than the loaded pages still shows on the button.
    if (o.run && !byId.has(o.run.id)) list.push(toOption(o.run, o.module, null));
    return list;
  }, [heads, qc, fx, o.module, o.run]);
  if (!o.runId || options.length === 0) return null;
  return (
    <KitRunSwitcher
      runs={options}
      value={o.runId}
      onChange={o.setRun}
      onCompare={onCompare}
      onMore={runs.hasNextPage ? () => void runs.fetchNextPage() : undefined}
      moreLabel={runs.isFetchingNextPage ? t("Loading more runs") : t("Show {n} older runs ({shown} of {total} shown)", { n: Math.min(SWITCHER_PAGE, total - heads.length), shown: heads.length, total })}
    />
  );
}
