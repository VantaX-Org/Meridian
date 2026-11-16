"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatInt } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { CHIPS, DEFAULT_STATE, STATUS_LABEL, filtersOf, ownerLabel, recordItemId, type ChipId } from "@/lib/v2/work";
import { useWorkRows, useWorkSummary } from "@/lib/v2/work-queries";
import type { WorkRow } from "@/lib/api/v2/types";
import { Button, Chip, Code, DataTable, SegmentedControl, type Column } from "@/design/next/kit";
import { ExportTable } from "@/design/next/more/ExportTable";
import { WorkBulkBar } from "@/design/next/work/BulkBar";
import type { ObjectRun } from "../useObjectRun";
import "./tabs-f.css";

const SEVERITY_TONE: Record<string, "bad" | "warn" | "neutral"> = { critical: "bad", high: "bad", medium: "warn", low: "neutral", info: "neutral" };
const SEVERITY: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };
const rowId = (r: WorkRow) => `${r.module}|${r.record_key}|${r.version_id ?? ""}`;

/** The object's records in the work ledger: state pills, mine or everyone, bulk actions on a selection. A chosen run shows the ledger as it stood then. */
export function RecordsTab({ o }: { o: ObjectRun }) {
  const asOf = useSearchParams().get("run");
  const summary = useWorkSummary().data;
  const { openItem } = useOpenItem();
  const [chip, setChip] = useState<ChipId>(DEFAULT_STATE.chip ?? "tofix");
  const [mine, setMine] = useState<"all" | "mine">("all");
  const [gen, setGen] = useState(0);
  const state = useMemo(
    () => ({ ...DEFAULT_STATE, chip, assigned: mine === "mine" ? "me" : null, module: o.module, system: o.systemId, asOf }),
    [chip, mine, o.module, o.systemId, asOf],
  );
  const q = useWorkRows(filtersOf(state), state.sort);
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const total = q.data?.pages[0]?.total;
  const byId = useMemo(() => new Map(rows.map((r) => [rowId(r), r])), [rows]);

  const columns: Column<WorkRow>[] = [
    { id: "record", label: t("Record"), cell: (r) => <Code code={r.record_key} text={r.name ?? undefined} /> },
    { id: "rule", label: t("Rule"), cell: (r) => (r.checks[0] ? <Code code={r.checks[0]} text={r.top_message ?? undefined} /> : (r.top_message ?? "")) },
    { id: "severity", label: t("Severity"), cell: (r) => <Chip tone={SEVERITY_TONE[r.severity] ?? "neutral"}>{SEVERITY[r.severity]?.() ?? t("Info")}</Chip> },
    { id: "state", label: t("State"), cell: (r) => <Chip tone={r.status === "fixed" ? "resolved" : "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Chip> },
    { id: "who", label: t("Who"), cell: (r) => ownerLabel(r) ?? t("Nobody yet") },
  ];

  return (
    <div className="nx-tf" data-testid="records-tab">
      <div className="nx-tf-tools" role="group" aria-label={t("State")}>
        {CHIPS.map((c) => (
          <Chip key={c.id} tone="neutral" pressed={chip === c.id} count={c.count(summary, o.module) ?? undefined} onClick={() => setChip(c.id)}>
            {c.label}
          </Chip>
        ))}
        <SegmentedControl label={t("Whose work")} value={mine} onChange={setMine} items={[{ value: "all", label: t("Everyone") }, { value: "mine", label: t("Mine") }]} />
      </div>
      <p className="nx-tf-sub" aria-live="polite">
        {total != null ? `${formatInt(total)} ${t("{n, plural, one {record} other {records}}", { n: total })}` : ""}
      </p>
      <ExportTable>
        <DataTable<WorkRow>
          key={`${chip}-${mine}-${gen}`}
          rows={rows}
          columns={columns}
          rowKey={rowId}
          rowLabel={(r) => `${r.record_key} ${r.name ?? ""}`.trim()}
          caption={t("{label} records that need work", { label: o.label })}
          total={total}
          selectable
          bulkActions={(keys) => <WorkBulkBar rows={keys.map((k) => byId.get(k)).filter((r): r is WorkRow => !!r)} onDone={() => setGen((g) => g + 1)} />}
          onOpenRow={(r) => openItem({ kind: "record", id: recordItemId(r) })}
          loading={q.isLoading}
          error={q.isError ? { sentence: t("The records could not be loaded."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("Nothing here"), text: t("No record is in this state right now.") }}
        />
      </ExportTable>
      {q.hasNextPage ? (
        <p className="nx-tf-tools">
          <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("Show more")}</Button>
        </p>
      ) : null}
    </div>
  );
}
