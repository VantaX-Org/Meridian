"use client";

/** New and resolved failing records of the last 12 run pairs as stacked bars, numbers written on each bar. */
import { useQueries } from "@tanstack/react-query";
import { getCompareSummary, nextRunKeys } from "@/lib/api/next/runs";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import type { ObjectRun } from "./useObjectRun";

export function TrendStack({ o }: { o: ObjectRun }) {
  const fx = useFixture();
  const pairs = o.heads.slice(0, 13).map((h, i, all) => ({ b: h, a: h.parent_version_id ? (all.find((x) => x.id === h.parent_version_id) ?? all[i + 1]) : all[i + 1] })).filter((p) => p.a).slice(0, 12).reverse();
  const qs = useQueries({ queries: pairs.map((p) => ({ queryKey: nextRunKeys.summary(fx, p.a!.id, p.b.id), queryFn: () => getCompareSummary(p.a!.id, p.b.id), staleTime: Infinity })) });
  if (pairs.length === 0) return null;
  const max = Math.max(1, ...qs.map((q) => (q.data ? q.data.totals.new + q.data.totals.resolved : 0)));
  return (
    <section className="nx-card nx-trend" aria-label={t("New and resolved by run")} data-testid="trend-stack">
      <h3 className="nx-cycle-h">{t("New and resolved by run")}</h3>
      <ol className="nx-trend-bars">
        {pairs.map((p, i) => {
          const d = qs[i]?.data?.totals;
          const n = d?.new ?? 0;
          const r = d?.resolved ?? 0;
          return (
            <li key={p.b.id} className="nx-trend-col" aria-label={d ? t("Run {n}: {new} new, {resolved} resolved", { n: p.b.run_number ?? "", new: int(n), resolved: int(r) }) : t("Run {n}: loading", { n: p.b.run_number ?? "" })}>
              <span className="nx-trend-stack" aria-hidden="true">
                <span className="nx-trend-new" style={{ blockSize: `${(n / max) * 100}%` }} />
                <span className="nx-trend-res" style={{ blockSize: `${(r / max) * 100}%` }} />
              </span>
              <span className="nx-trend-label nx-num" aria-hidden="true">{p.b.run_number}</span>
            </li>
          );
        })}
      </ol>
      <p className="nx-muted nx-trend-key"><span className="nx-trend-swatch nx-trend-new" /> {t("New")} <span className="nx-trend-swatch nx-trend-res" /> {t("Resolved")}</p>
    </section>
  );
}
