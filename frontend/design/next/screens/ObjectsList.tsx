"use client";

import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { V2Link } from "@/design/v2/parts";
import { usePortfolio, type PortfolioRow } from "@/lib/api/next/portfolio";
import { Chip, EmptyState, ErrorState, Skeleton } from "../kit";
import { objectHref } from "../portfolio/BulkBar";
import { stepLabel } from "../portfolio/Cards";
import "../portfolio/portfolio.css";
import "../portfolio/feeds.css";

/** Every licensed object on every connected system, grouped by system, each at its newest run. */
export function ObjectsList() {
  // ponytail: one 500-row read covers the licensed scope; page per system if a tenant grows past it.
  const q = usePortfolio({ limit: 500, sort: "module" });
  const systems = useSystemsExtended().data ?? [];
  const rows = q.data?.objects ?? [];
  const sysName = (id: string | null) => systems.find((s) => s.id === id)?.name ?? id ?? t("Unknown system");
  const groups = new Map<string, PortfolioRow[]>(systems.map((s) => [s.id, []]));
  for (const r of rows) {
    const k = r.system_id ?? "";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <main className="nx-pf" data-testid="objects-list">
      <header className="nx-pf-head nx-lt">
        <div>
          <h1>{t("Objects")}</h1>
          <p>{t("Every licensed object on every connected system, at its newest run.")}</p>
        </div>
      </header>
      {q.isError ? <ErrorState error={q.error} fallback={t("The objects could not be read. Check that the API is reachable, then retry.")} onRetry={() => void q.refetch()} />
        : q.isLoading ? <Skeleton lines={6} label={t("Loading the objects")} />
        : groups.size === 0 ? <EmptyState icon="inbox" heading={t("No system is connected yet.")}>{t("Connect a system to see its objects here.")}</EmptyState>
        : [...groups].map(([id, list]) => (
          <details key={id} open className="nx-card nx-ol-system" data-testid="ol-system">
            <summary>
              <h2>{sysName(id || null)}</h2>
              <Chip>{t("{n} objects", { n: formatInt(list.length) })}</Chip>
              <Chip tone="new">{t("{n} new issues", { n: formatInt(list.reduce((a, r) => a + r.new_issues, 0)) })}</Chip>
            </summary>
            <div>
              {list.length === 0 ? <p>{t("{system} is connected but nothing has been pulled yet.", { system: sysName(id || null) })}</p> : (
                <ul className="nx-ol-list">
                  {list.map((r) => (
                    <li key={r.version_id}>
                      <V2Link href={objectHref(r, sysName, `?run=${r.version_id}`)}><strong>{r.label}</strong> <span className="nx-mono nx-pf-code">{r.module}</span></V2Link>
                      <span className="nx-pf-meta">{t("DQS {v}", { v: f1(r.composite_score) })}</span>
                      <Chip>{stepLabel(r.step)}</Chip>
                      {r.owner ? <span className="nx-pf-meta">{r.owner}</span> : <span className="nx-pf-meta">{t("No owner")}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ))}
    </main>
  );
}
