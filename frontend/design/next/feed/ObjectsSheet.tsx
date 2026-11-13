"use client";

import { useState } from "react";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { V2Link } from "@/design/v2/parts";
import { usePortfolio, type PortfolioRow } from "@/lib/api/next/portfolio";
import { Chip, EmptyState, ErrorState, Skeleton } from "../kit";
import { Sheet } from "../kit/Sheet";
import { objectHref } from "../portfolio/BulkBar";

/** Every licensed object, searchable, grouped by system with code and text and DQS. */
export function ObjectsSheet({ onClose }: { onClose: () => void }) {
  // ponytail: one 500-row read covers the licensed scope, as the old Objects list did.
  const q = usePortfolio({ limit: 500, sort: "module" });
  const systems = useSystemsExtended().data ?? [];
  const [find, setFind] = useState("");
  const sysName = (id: string | null) => systems.find((s) => s.id === id)?.name ?? id ?? t("Unknown system");
  const needle = find.trim().toLowerCase();
  const rows = (q.data?.objects ?? []).filter((r) => !needle || `${r.label} ${r.module}`.toLowerCase().includes(needle));
  const groups = new Map<string, PortfolioRow[]>();
  for (const r of rows) groups.set(r.system_id ?? "", [...(groups.get(r.system_id ?? "") ?? []), r]);
  return (
    <Sheet open onClose={onClose} title={t("Objects")} size="small">
      <label className="nx-field">
        <span>{t("Search")}</span>
        <input className="nx-input" type="search" value={find} placeholder={t("Object name or code")} onChange={(e) => setFind(e.target.value)} />
      </label>
      {q.isError ? <ErrorState error={q.error} fallback={t("The objects could not be read. Check that the API is reachable, then retry.")} onRetry={() => void q.refetch()} />
        : q.isLoading ? <Skeleton lines={6} label={t("Loading the objects")} />
        : groups.size === 0 ? <EmptyState icon="inbox" heading={needle ? t("No object matches this search.") : t("No system is connected yet.")}>{needle ? t("Try a shorter name or the object code.") : t("Connect a system to see its objects here.")}</EmptyState>
        : [...groups].map(([id, list]) => (
          <section key={id} className="nx-fd-os-group" data-testid="os-system">
            <h3>{sysName(id || null)} <Chip>{t("{n} objects", { n: formatInt(list.length) })}</Chip></h3>
            <ul className="nx-fd-os-list">
              {list.map((r) => (
                <li key={r.version_id}>
                  <V2Link href={objectHref(r, sysName, `?run=${r.version_id}`)}><strong>{r.label}</strong> <span className="nx-mono nx-fd-code">{r.module}</span></V2Link>
                  <span className="nx-fd-meta">{t("DQS {v}", { v: f1(r.composite_score) })}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </Sheet>
  );
}
