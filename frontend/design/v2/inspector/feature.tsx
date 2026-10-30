"use client";

import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useConfigImpact } from "@/lib/v2/object-queries";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { Fact, InspectorFrame } from "../Inspector";
import { FactList, Sec } from "./mdm-parts";
import { VerdictMark } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { t } from "@/lib/v2/i18n";

/** `?open=feature:<name>`: one S/4HANA feature, whether it is blocked or degraded, by which rules, and what that costs. */
export function FeatureInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const { hrefFor } = useOpenItem();
  const run = useRunParam();
  const L = useLandscape(run);
  const runId = run ?? L.data?.run_id ?? L.data?.cells.find((c) => c.run_id)?.run_id ?? null;
  const q = useConfigImpact(runId);
  const res = q.data?.find((r) => r.feature === id);
  const blocked = res?.status === "blocked";
  const rules = res ? [...new Map(res.blocking_findings.map((f) => [f.check_id, f])).values()] : [];

  return (
    <InspectorFrame title={id} status={t("S/4HANA feature")} onClose={onClose}>
      {q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The feature impact could not be read for this run.")}</ErrorFrame>
      ) : L.isPending || (q.isPending && Boolean(runId)) ? (
        <div aria-busy="true">
          <Skeleton width="100%" height={120} />
        </div>
      ) : !res || res.status === "ok" ? (
        <EmptyFrame>{runId ? t("No failing rule blocks or degrades this feature in this run.") : t("No run has scored an object yet, so the impact model has nothing to say about this feature.")}</EmptyFrame>
      ) : (
        <>
          <Sec title={t("Facts")}>
            <FactList>
              <Fact label={t("Status")}>
                <span className="m2-v">
                  <VerdictMark verdict={blocked ? "no-go" : "at-risk"} />
                  {blocked ? t("Blocked") : t("Degraded")}
                </span>
              </Fact>
              <Fact label={t("System")}>{res.system || <Dash />}</Fact>
              <Fact label={t("Blocking rules")}>{int(rules.length)}</Fact>
              <Fact label={t("Records affected")}>{res.total_affected_records == null ? <Dash why={t("The run did not store a count")} /> : int(res.total_affected_records)}</Fact>
              <Fact label={t("Transactions blocked")}>{res.blocked_transactions?.length ? res.blocked_transactions.join(", ") : <Dash why={t("No transaction is named for this feature")} />}</Fact>
            </FactList>
          </Sec>
          <Sec title={t("Blocking rules: {rulesCount}", { rulesCount: rules.length })}>
            <ul className="m2-lk" aria-label={t("Rules blocking this feature")}>
              {rules.map((f) => (
                <li key={f.check_id}>
                  <V2Link href={hrefFor({ kind: "rule", id: f.check_id })} className="m2-mono">
                    {f.check_id}
                  </V2Link>
                  <span className="m2-meta">{[f.severity, f.affected_count != null ? t("{affected_count} failing", { affected_count: int(f.affected_count) }) : null].filter(Boolean).join(", ")}</span>
                </li>
              ))}
            </ul>
          </Sec>
          <Sec title={t("Opportunity cost")}>
            <p className="m2-rp">{res.opportunity_cost_summary || t("The impact model has no cost summary for this feature in this run.")}</p>
          </Sec>
          <Sec title={t("Actions")}>
            <div className="m2-acts">
              {rules[0] ? (
                <V2Link href={`/work?rule=${encodeURIComponent(rules[0].check_id)}`} className="m2-btn m2-strong">
                  <>{t("Fix")}{" "}<Mono>{rules[0].check_id}</Mono>{" "}{t("in Work")}</>
                </V2Link>
              ) : null}
            </div>
          </Sec>
        </>
      )}
    </InspectorFrame>
  );
}
