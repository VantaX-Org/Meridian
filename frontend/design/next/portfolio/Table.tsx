"use client";

import { useRouter } from "next/navigation";
import { formatDate, formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { actionOf, type PortfolioRow } from "@/lib/api/next/portfolio";
import { Chip, DataTable, type Column } from "../kit";
import { BulkActions, objectHref, rowKey, type PortfolioActions } from "./BulkBar";
import { stepLabel } from "./Cards";

/** One page of the portfolio as a table; the server sorts and pages, so no column sorts on the client. */
export function Table({ rows, total, act, loading, error }: { rows: PortfolioRow[]; total: number; act: PortfolioActions; loading?: boolean; error?: { sentence: string; onRetry?: () => void } }) {
  const router = useRouter();
  const columns: Column<PortfolioRow>[] = [
    { id: "object", label: t("Object"), cell: (r) => <><strong>{r.label}</strong> <span className="nx-mono nx-pf-code">{r.module}</span></> },
    { id: "system", label: t("System"), cell: (r) => act.sysName(r.system_id) },
    { id: "owner", label: t("Owner"), cell: (r) => r.owner ?? t("No owner") },
    { id: "stage", label: t("Cycle stage"), cell: (r) => stepLabel(actionOf(r)) },
    { id: "dqs", label: t("DQS"), align: "end", cell: (r) => f1(r.composite_score) },
    { id: "new", label: t("New"), align: "end", cell: (r) => <Chip tone="new" count={r.new_issues}>{t("New")}</Chip> },
    { id: "resolved", label: t("Resolved"), align: "end", cell: (r) => formatInt(r.resolved) },
    { id: "regressed", label: t("Regressed"), align: "end", cell: (r) => formatInt(r.regressed) },
    { id: "run", label: t("Run"), cell: (r) => t("Run {n}, {date}", { n: formatInt(r.run_number ?? 0), date: formatDate(r.run_at) }) },
    { id: "raw", label: t("Raw score"), align: "end", hidden: true, cell: (r) => f1(r.raw_score) },
  ];
  const byKey = new Map(rows.map((r) => [rowKey(r), r]));
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={rowKey}
      rowLabel={(r) => `${r.label} (${r.module})`}
      caption={t("Every object at its newest run")}
      total={total}
      selectable
      bulkActions={(keys) => <BulkActions rows={keys.map((k) => byKey.get(k)).filter((r): r is PortfolioRow => !!r)} act={act} />}
      onOpenRow={(r) => router.push(objectHref(r, act.sysName, `?run=${r.version_id}`))}
      loading={loading}
      error={error}
      empty={{ heading: t("No object matches these filters."), text: t("Clear a filter to see more objects.") }}
    />
  );
}
