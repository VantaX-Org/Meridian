"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { formatDate, labelOf } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { useV2Session } from "@/lib/v2/hooks";
import { useRefreshV2, useZDormant, useZDrift, useZGhost, useZRegistry, useZReport } from "@/lib/v2/sys-queries";
import { detectZ } from "@/lib/api/v2/sys";
import { errorSentence } from "@/lib/api/v2/client";
import type { ZDormant, ZDrift, ZGhost, ZRegistryEntry } from "@/lib/api/z-objects";
import { Button, Chip, DataTable, SegmentedControl, StatCard, useToast, type Column } from "../kit";
import { ListSearch, QueryView } from "./states";

const day = (v: string | null | undefined): string => (v ? formatDate(v, "date") : t("Never"));
const statusOf = (err: unknown): number | undefined => (err as { response?: { status?: number } } | null)?.response?.status;
/** 404 from the Z-object routes means no detection has run yet: an empty state, not an error. */
const realError = (err: unknown): unknown => (statusOf(err) === 404 ? null : err);
const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = { active: "good", dormant: "warn", ghost: "bad" };

type Side = "ghost" | "dormant" | "drift";

/**
 * Custom Z and Y objects found in the connected SAP system (api/routes/z_object_intelligence.py): how many there are, how
 * many have a data quality rule, how many map to a standard object, and which are ghosts, dormant or drifting. Run
 * detection queues POST /z-objects/detect/latest over the newest extraction.
 */
export function ZObjects() {
  const session = useV2Session();
  const toast = useToast();
  const refresh = useRefreshV2();
  const reg = useZRegistry();
  const report = useZReport();
  const ghost = useZGhost();
  const dormant = useZDormant();
  const drift = useZDrift();
  const [find, setFind] = useState("");
  const [side, setSide] = useState<Side>("ghost");
  const live = !session.shared && !session.viewAs;

  const detect = useMutation({
    mutationFn: () => detectZ(),
    onSuccess: (r) => {
      toast({ text: r.queued ? t("Detection is queued over the newest run. The lists fill in when it finishes.") : t("Detection did not start."), tone: r.queued ? "good" : "neutral" });
      refresh();
    },
    onError: (e) => toast({ text: errorSentence(e, t("Detection could not start.")), tone: "bad" }),
  });

  const entries = useMemo(() => reg.data?.entries ?? [], [reg.data]);
  const shown = useMemo(() => {
    const n = find.trim().toLowerCase();
    return n ? entries.filter((e) => `${e.object_name} ${e.description ?? ""} ${e.module}`.toLowerCase().includes(n)) : entries;
  }, [entries, find]);
  const covered = entries.filter((e) => (e.rules_applied?.length ?? 0) > 0).length;
  const r = report.data;

  const columns: Column<ZRegistryEntry>[] = [
    {
      id: "object", label: t("Object"), compare: (a, b) => a.object_name.localeCompare(b.object_name),
      cell: (e) => (
        <span className="nx-cell-stack">
          <span className="nx-mono">{e.object_name}</span>
          <span className="nx-sub">{e.description || t("No description in SAP")}</span>
        </span>
      ),
    },
    { id: "module", label: t("Area"), cell: (e) => labelOf(e.module) },
    { id: "category", label: t("Kind"), cell: (e) => labelOf(e.category) },
    { id: "standard", label: t("Standard equivalent"), cell: (e) => e.standard_equivalent ?? t("None mapped") },
    { id: "owner", label: t("Owner"), cell: (e) => e.owner ?? t("Nobody") },
    { id: "tx", label: t("Transactions"), align: "end", compare: (a, b) => a.transaction_count_total - b.transaction_count_total, cell: (e) => int(e.transaction_count_total) },
    { id: "last", label: t("Last active"), compare: (a, b) => (a.last_active_date ?? "").localeCompare(b.last_active_date ?? ""), cell: (e) => day(e.last_active_date) },
    {
      id: "rules", label: t("Rules"), align: "end", compare: (a, b) => (a.rules_applied?.length ?? 0) - (b.rules_applied?.length ?? 0),
      cell: (e) => ((e.rules_applied?.length ?? 0) > 0 ? int(e.rules_applied.length) : <Chip tone="warn">{t("No rule")}</Chip>),
    },
    { id: "status", label: t("Status"), cell: (e) => <Chip tone={STATUS_TONE[e.status] ?? "neutral"}>{labelOf(e.status)}</Chip> },
  ];

  const ghostCols: Column<ZGhost>[] = [
    { id: "object", label: t("Object"), cell: (g) => <span className="nx-mono">{g.object_name}</span> },
    { id: "module", label: t("Area"), cell: (g) => labelOf(g.module) },
    { id: "category", label: t("Kind"), cell: (g) => labelOf(g.category) },
    { id: "field", label: t("Found in field"), cell: (g) => <span className="nx-mono">{g.source_field}</span> },
    { id: "last", label: t("Last active"), cell: (g) => day(g.last_active_date) },
  ];
  const dormantCols: Column<ZDormant>[] = [
    { id: "object", label: t("Object"), cell: (d) => <span className="nx-mono">{d.object_name}</span> },
    { id: "module", label: t("Area"), cell: (d) => labelOf(d.module) },
    { id: "category", label: t("Kind"), cell: (d) => labelOf(d.category) },
    { id: "last", label: t("Last active"), cell: (d) => day(d.last_active_date) },
    { id: "months", label: t("Months inactive"), align: "end", compare: (a, b) => a.months_inactive - b.months_inactive, cell: (d) => int(d.months_inactive) },
  ];
  const driftCols: Column<ZDrift>[] = [
    { id: "object", label: t("Object"), cell: (d) => <span className="nx-mono">{d.object_name}</span> },
    { id: "module", label: t("Area"), cell: (d) => labelOf(d.module) },
    { id: "field", label: t("Field"), cell: (d) => <span className="nx-mono">{d.source_field}</span> },
    { id: "change", label: t("Change"), cell: (d) => labelOf(d.change_type) },
    { id: "first", label: t("First seen"), cell: (d) => day(d.first_detected) },
  ];

  return (
    <div className="nx-body" data-testid="zobjects-page">
      <div className="nx-row nx-wrap">
        {session.can("analyse") && live ? (
          <Button variant="primary" icon="refresh" loading={detect.isPending} loadingLabel={t("Queuing detection")} onClick={() => detect.mutate()} data-testid="zobjects-detect">
            {t("Run detection")}
          </Button>
        ) : (
          <p className="nx-sub">{t("Running detection needs the analyse permission.")}</p>
        )}
      </div>
      <QueryView loading={reg.isLoading} error={realError(reg.error)} onRetry={() => void reg.refetch()} empty={entries.length === 0} emptyHeading={t("No custom objects found yet")} emptyText={t("Run detection to scan the newest extraction for Z and Y tables, fields and transactions.")} label={t("Loading custom objects")}>
        <div className="nx-statgrid" data-testid="zobjects-stats">
          <StatCard label={t("Custom objects")} value={r?.total_z_objects ?? entries.length} />
          <StatCard label={t("Covered by a rule")} value={entries.length ? Math.round((covered / entries.length) * 100) : 0} format={(n) => `${Math.round(n)}%`} />
          <StatCard label={t("Mapped to standard")} value={r?.mapped_to_standard ?? entries.filter((e) => e.standard_equivalent).length} />
          <StatCard label={t("Ghost or dormant")} value={(r?.ghost_objects ?? 0) + (r?.dormant_objects ?? 0)} />
          <StatCard label={t("Active anomalies")} value={r?.active_anomalies ?? 0} />
        </div>
        <p className="nx-sub">{t("{covered} of {total} custom objects have at least one data quality rule.", { covered: int(covered), total: int(entries.length) })}</p>
        <ListSearch value={find} onChange={setFind} label={t("Search custom objects")} />
        <DataTable rows={shown} columns={columns} rowKey={(e) => e.id} rowLabel={(e) => e.object_name} caption={t("Custom objects")} total={entries.length} empty={{ heading: t("No custom object matches this search.") }} />
        <SegmentedControl<Side>
          label={t("Objects that need a look")}
          items={[{ value: "ghost", label: t("Ghost") }, { value: "dormant", label: t("Dormant") }, { value: "drift", label: t("Drift") }]}
          value={side}
          onChange={setSide}
        />
        {side === "ghost" ? (
          <>
            <p className="nx-sub">{t("Ghost objects are referenced in data but have no definition in the system.")}</p>
            <DataTable rows={ghost.data ?? []} columns={ghostCols} rowKey={(g) => `${g.object_name}-${g.source_field}`} rowLabel={(g) => g.object_name} caption={t("Ghost")} loading={ghost.isLoading} empty={{ heading: t("No ghost objects.") }} />
          </>
        ) : side === "dormant" ? (
          <>
            <p className="nx-sub">{t("Dormant objects have had no activity for months and are candidates to leave out of the migration.")}</p>
            <DataTable rows={dormant.data ?? []} columns={dormantCols} rowKey={(d) => d.object_name} rowLabel={(d) => d.object_name} caption={t("Dormant")} loading={dormant.isLoading} empty={{ heading: t("No dormant objects.") }} />
          </>
        ) : (
          <>
            <p className="nx-sub">{t("Drift lists custom fields whose shape changed between runs.")}</p>
            <DataTable rows={drift.data ?? []} columns={driftCols} rowKey={(d) => `${d.object_name}-${d.source_field}-${d.first_detected}`} rowLabel={(d) => d.object_name} caption={t("Drift")} loading={drift.isLoading} empty={{ heading: t("No drift between runs.") }} />
          </>
        )}
      </QueryView>
    </div>
  );
}
