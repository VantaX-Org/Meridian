"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { approveAnomalyRule, proposeAnomalyRule, type AnomalyRuleProposal } from "@/lib/api/v2/anomaly-rules";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { getAnomalies, type AnomalyItem } from "@/lib/api/v2/mining";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { f1, int } from "@/lib/v2/score";
import { Sev } from "../inspector/rule";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Aletheia anomaly to rule: a statistically found outlier becomes a proposed rule. The rule is a template on the
 * field's usual range, so the check stays deterministic; the AI only drafts when no template fits and then sees the
 * field, the statistic and counts, never a record. The rule is dry-run on the same data and its hit count sits beside
 * the outliers before a steward saves it as a draft through the rule workbench's own draft path.
 */

const FieldName = ({ code, text }: { code: string; text?: string | null }) =>
  text ? <>{text} <span className="m2-meta"><Mono>{code}</Mono></span></> : <Mono>{code}</Mono>;

interface FieldGroup {
  /** The first outlier of the field: the proposal is made from it. */
  first: AnomalyItem;
  count: number;
}

/** One row per object and field, the most severe outlier first. */
export function groupByField(rows: readonly AnomalyItem[]): FieldGroup[] {
  const rank = { low: 1, medium: 2, high: 3, critical: 4 } as const;
  const by = new Map<string, FieldGroup>();
  for (const a of rows) {
    const k = `${a.module_id}:${a.field_name}`;
    const g = by.get(k);
    if (!g) by.set(k, { first: a, count: 1 });
    else {
      g.count += 1;
      if (rank[a.severity] > rank[g.first.severity]) g.first = a;
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

const usual = (lo: number | null, hi: number | null, z: number | null): ReactNode =>
  lo != null && hi != null ? t("{lo} to {hi}", { lo: int(lo), hi: int(hi) }) : z != null ? t("{z} standard deviations away", { z: f1(Math.abs(z)) }) : <Dash />;

export function AnomalyRules() {
  const fixture = useFixture();
  const { can } = useV2Session();
  const out = useQuery({ queryKey: ["mining", fixture, "anomalies"], queryFn: getAnomalies, staleTime: 60_000 });
  const [picked, setPicked] = useState<AnomalyItem | null>(null);
  const propose = useMutation({ mutationFn: (a: AnomalyItem) => proposeAnomalyRule(a.id), onMutate: (a) => setPicked(a) });

  if (out.isPending) return <CcPage title={t("Anomaly rules")}><Skeleton width="100%" height={320} /></CcPage>;
  if (out.isError) {
    return (
      <CcPage title={t("Anomaly rules")}>
        <ErrorFrame onRetry={() => void out.refetch()}>{t("The outliers could not be read.")}</ErrorFrame>
      </CcPage>
    );
  }
  const groups = groupByField(out.data);
  const allowed = can("manage_rules");

  return (
    <CcPage title={t("Anomaly rules")}>
      <CcBanner
        testId="anomaly-rules"
        label={t("Anomaly rules")}
        eyebrow={t("Anomaly rules")}
        headline={t("{n, plural, one {# field has outliers} other {# fields have outliers}} that can become a rule", { n: groups.length })}
        why={t("The rule is a template on the usual range of the field. It runs on the same data first, so you see what it would flag before you approve it.")}
      />

      <Panel title={t("Fields with outliers")} meta={t("Most outliers first.")} testId="anomaly-rules-fields">
        {groups.length === 0 ? <EmptyFrame>{t("No outlier was found.")}</EmptyFrame> : (
          <ScrollFrame label={t("Fields with outliers table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Field")}</th>
                  <th scope="col">{t("Outliers")}</th>
                  <th scope="col">{t("Usual")}</th>
                  <th scope="col">{t("Severity")}</th>
                  <th scope="col"><span className="m2-sr">{t("Propose a rule")}</span></th>
                </tr>
              </thead>
              <tbody>
                {groups.map(({ first: a, count }) => (
                  <tr key={a.id}>
                    <td data-label={t("Object")}>{moduleText(a.module_id)}</td>
                    <th scope="row" className="m2-card-lead"><FieldName code={a.field_name} text={a.field_description} /></th>
                    <td data-label={t("Outliers")} className="m2-num">{int(count)}</td>
                    <td data-label={t("Usual")}>{usual(a.lower_bound ?? null, a.upper_bound ?? null, a.z_score ?? null)}</td>
                    <td data-label={t("Severity")}><Sev severity={a.severity} /></td>
                    <td>
                      {allowed ? (
                        <button type="button" className="m2-btn m2-sm" disabled={propose.isPending} onClick={() => propose.mutate(a)} data-testid={`propose-${a.id}`}>
                          {t("Propose a rule")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>

      {picked ? (
        <Panel title={t("Proposed rule")} meta={picked.field_description ?? picked.field_name} testId="anomaly-rules-proposal">
          {propose.isPending ? <Skeleton width="100%" height={160} /> : propose.isError ? (
            <Dash why={errorSentence(propose.error, t("The rule could not be proposed."))} />
          ) : propose.data ? <Proposal p={propose.data} /> : null}
        </Panel>
      ) : null}
    </CcPage>
  );
}

function Proposal({ p }: { p: AnomalyRuleProposal }) {
  const toast = useToast();
  const g = p.grounding;
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => approveAnomalyRule(g.module, p.rule_yaml ?? "", t("Proposed by Aletheia from an outlier in {field}", { field: g.field })),
    onSuccess: () => {
      setSaved(true);
      toast.show(t("Draft saved. Find it in the rule workbench."));
    },
    onError: (e) => toast.show(errorSentence(e, t("The draft could not be saved.")), "error"),
  });
  if (!p.rule_yaml) return <EmptyFrame>{t("No rule could be proposed for this outlier.")}</EmptyFrame>;
  const d = p.dry_run;
  return (
    <div>
      <pre className="m2-code" data-testid="anomaly-rules-yaml">{p.rule_yaml}</pre>
      <dl className="m2-cc-figs" data-testid="anomaly-rules-evidence">
        <div>
          <dt>{t("Outliers found")}</dt>
          <dd>{g.anomaly_count == null ? <Dash /> : int(g.anomaly_count)}</dd>
        </div>
        <div>
          <dt>{t("Rule would flag")}</dt>
          <dd data-testid="anomaly-rules-hits">{d.evaluated ? int(d.hits ?? 0) : <Dash why={d.reason ?? t("The dry run did not run.")} />}</dd>
          {d.evaluated && d.population != null ? <dd className="m2-cc-note">{t("of {n} records", { n: int(d.population) })}</dd> : null}
        </div>
        <div>
          <dt>{t("Confidence")}</dt>
          <dd>{p.confidence ? labelText(p.confidence.level) : <Dash />}</dd>
        </div>
      </dl>
      <ul className="m2-cl-changes">
        <li>{t("Field")}: <FieldName code={g.field} text={g.field_description} /></li>
        <li>{t("Found by")}: {usual(g.statistic.lower, g.statistic.upper, g.statistic.z_score)}</li>
        <li>{p.source === "template" ? t("No AI was used. The rule is a template, and the check is deterministic.") : t("The AI drafted this rule from the field, the statistic and the counts. It saw no record.")}</li>
        {!p.valid ? p.errors.map((e) => <li key={e}>{e}</li>) : null}
      </ul>
      {p.valid ? (
        <button type="button" className="m2-btn m2-next" disabled={save.isPending || saved} onClick={() => save.mutate()} data-testid="anomaly-rules-save">
          {saved ? t("Saved as draft") : t("Save as draft")}
        </button>
      ) : null}
    </div>
  );
}

