"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getConfigMatchSummary, getConfigRootCauseV2, type RootCauseType } from "@/lib/api/v2/config";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { whole } from "@/lib/v2/format";
import { BarList, EmptyState, ErrorState, FieldChip, Sheet, Skeleton, StatTile } from "@/ui/kit";

const CAUSE: Record<RootCauseType, () => string> = {
  bad_data: () => t("Bad data"), bad_config: () => t("Bad configuration"), bad_data_and_config: () => t("Bad data and bad configuration"), process_gap: () => t("Process gap"),
};

/** How many failing records of the run trace to data and how many to configuration, as the route counts them. */
export function MatchSummary({ id }: { id: string }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["next", "run", id, "config-summary", fx] as const, queryFn: () => getConfigMatchSummary(id), retry: false });
  if (q.isLoading) return <Skeleton lines={3} label={t("Loading the configuration summary")} />;
  if (q.isError) return <ErrorState heading={t("Could not load this")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d || "message" in d) return <EmptyState heading={t("No summary yet")} body={d && "message" in d ? d.message : t("No failing record of this run traces to configuration.")} />;
  return (
    <div className="mx-col">
      <dl className="mx-tiles">
        <StatTile label={t("Data errors")} value={whole(d.data_errors)} />
        <StatTile label={t("Configuration deviations")} value={whole(d.config_deviations)} />
        <StatTile label={t("Unclear")} value={whole(d.ambiguous)} />
      </dl>
      <BarList label={t("Verdicts of the run")} items={[
        { id: "data", label: t("Data error"), value: d.data_errors, display: whole(d.data_errors) },
        { id: "config", label: t("Configuration deviation"), value: d.config_deviations, display: whole(d.config_deviations), sev: "high" },
        { id: "amb", label: t("Unclear"), value: d.ambiguous, display: whole(d.ambiguous) },
      ]} />
      {d.modules_with_deviations.length ? <p className="mx-muted">{t("Deviations in")} {d.modules_with_deviations.map(moduleText).join(", ")}</p> : null}
    </div>
  );
}

/** Whether one rule's findings are bad data, bad configuration, both or a process gap, and the fix. */
export function RootCauseSheet({ checkId, module, onClose }: { checkId: string | null; module?: string; onClose: () => void }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["next", "root-cause", fx, checkId] as const, queryFn: () => getConfigRootCauseV2(checkId ?? ""), enabled: !!checkId, retry: false });
  const d = q.data;
  const row = (label: string, v: string | null) => (v ? <p><strong>{label}</strong><br />{v}</p> : null);
  return (
    <Sheet open={!!checkId} onClose={onClose} label={t("Root cause")} closeLabel={t("Close")}>
      {q.isLoading ? <Skeleton lines={4} label={t("Loading the root cause")} /> : q.isError || !d ? (
        <ErrorState heading={t("Could not load this")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />
      ) : (
        <div className="mx-col">
          <h2 className="mx-card-t"><FieldChip code={d.finding_id} description={module ? moduleText(module) : undefined} /></h2>
          <StatTile label={t("Root cause")} value={(CAUSE[d.root_cause_type] ?? (() => d.root_cause_type))()} />
          {row(t("In the data"), d.data_issue)}
          {row(t("In the configuration"), d.config_issue)}
          {row(t("In the process"), d.process_issue)}
          {row(t("What to do"), d.recommendation)}
        </div>
      )}
    </Sheet>
  );
}
