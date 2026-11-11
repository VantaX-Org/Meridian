"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { approveAnomalyRule, getFieldShifts, proposeAnomalyRule, proposeShiftRule, type AnomalyRuleProposal, type FieldShift } from "@/lib/api/v2/anomaly-rules";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { getAnomalies, type AnomalyItem } from "@/lib/api/v2/mining";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { f1, int } from "@/lib/v2/score";
import { NeedsPermission } from "../admin/kit";
import { Sev } from "../inspector/rule";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { Lede } from "../RunParts";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { Consequence, Steps } from "./rules-parts";
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
  const [saved, setSaved] = useState(false);
  const propose = useMutation({ mutationFn: (a: AnomalyItem) => proposeAnomalyRule(a.id), onMutate: (a) => {
      setPicked(a);
      setSaved(false);
    },
  });

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
      <Lede>{t("Aletheia finds values far outside the usual range of a field. Open an outlier, see the rule it would become, and approve it to keep watching that field.")}</Lede>
      <CcBanner
        testId="anomaly-rules"
        label={t("Anomaly rules")}
        eyebrow={t("Anomaly rules")}
        headline={t("{n, plural, one {# field has outliers} other {# fields have outliers}} that can become a rule", { n: groups.length })}
        why={t("The rule is a template on the usual range of the field. It runs on the same data first, so you see what it would flag before you approve it.")}
      />

      <Steps
        testId="anomaly-steps"
        label={t("Steps from an outlier to a rule")}
        steps={[t("Pick a field"), t("Check what the rule would flag"), t("Save it as a draft"), t("Publish it in the rule workbench")]}
        current={!picked ? 0 : saved ? 3 : propose.data?.rule_yaml ? 2 : 1}
      />
      {allowed ? <Consequence>{t("Proposing a rule only drafts it and runs it once on the same data. Nothing is saved and nothing is flagged until you save the draft.")}</Consequence> : (
        <NeedsPermission what={t("Proposing an anomaly rule")} permission="manage_rules" />
      )}

      <Panel title={t("Fields with outliers")} meta={t("Most outliers first.")} testId="anomaly-rules-fields">
        {groups.length === 0 ? <EmptyFrame>{t("No outlier was found.")}</EmptyFrame> : (
          <>
          <CcHBars
            label={t("Outliers by field")}
            testId="anomaly-rules-chart"
            rows={groups.slice(0, 8).map(({ first: a, count }) => ({ key: a.id, label: a.field_description ?? a.field_name, value: count, text: int(count), tone: "warn" as const }))}
          />
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
          </>
        )}
      </Panel>

      {picked ? (
        <Panel title={t("Proposed rule")} meta={picked.field_description ?? picked.field_name} testId="anomaly-rules-proposal">
          {propose.isPending ? <Skeleton width="100%" height={160} /> : propose.isError ? (
            <Dash why={errorSentence(propose.error, t("The rule could not be proposed."))} />
          ) : propose.data ? <Proposal p={propose.data} onSaved={() => setSaved(true)} /> : null}
        </Panel>
      ) : null}

      <FieldShifts allowed={allowed} />
    </CcPage>
  );
}

const pct = (n: number | null) => (n == null ? <Dash /> : t("{pct}% empty", { pct: f1(n) }));

/** Null spikes and unexpected codes: a run's field profile against the run before it. Counts only, no record is read. */
function FieldShifts({ allowed }: { allowed: boolean }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["anomaly-rules", fixture, "shifts"], queryFn: getFieldShifts, staleTime: 60_000 });
  return (
    <Panel title={t("Null spikes and unexpected codes")} meta={t("Each run against the run before it. Counts only.")} testId="anomaly-rules-shifts">
      {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The field shifts could not be read.")}</ErrorFrame>
      ) : q.data.length === 0 ? <EmptyFrame>{t("No null spike or unexpected code was found.")}</EmptyFrame> : (
        <ScrollFrame label={t("Null spikes and unexpected codes table, scrollable")}>
          <table className="m2-tbl m2-cards">
            <thead>
              <tr>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Field")}</th>
                <th scope="col">{t("Found")}</th>
                <th scope="col">{t("Runs compared")}</th>
                <th scope="col">{t("Before")}</th>
                <th scope="col">{t("Now")}</th>
                <th scope="col">{t("Severity")}</th>
                <th scope="col"><span className="m2-sr">{t("Propose a rule")}</span></th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((s) => (
                <tr key={s.id} data-testid={`shift-${s.id}`}>
                  <td data-label={t("Object")}>{moduleText(s.module)}</td>
                  <th scope="row" className="m2-card-lead"><FieldName code={s.field} text={s.field_description} /></th>
                  <td data-label={t("Found")}>{s.kind === "null_spike" ? t("Null spike") : t("Unexpected code")}</td>
                  <td data-label={t("Runs compared")}>
                    {s.run_number == null || s.prev_run_number == null ? <Dash /> : t("Run {a} against run {b}", { a: s.run_number, b: s.prev_run_number })}
                  </td>
                  <td data-label={t("Before")} className="m2-num">
                    {s.kind === "null_spike" ? <>{pct(s.previous.blank_pct)} <span className="m2-meta">{t("{n} of {rows}", { n: int(s.previous.blank ?? 0), rows: int(s.previous.rows ?? 0) })}</span></> : t("{n} distinct", { n: int(s.previous.distinct ?? 0) })}
                  </td>
                  <td data-label={t("Now")} className="m2-num">
                    {s.kind === "null_spike" ? <>{pct(s.current.blank_pct)} <span className="m2-meta">{t("{n} of {rows}", { n: int(s.current.blank ?? 0), rows: int(s.current.rows ?? 0) })}</span></> : (
                      <>
                        {s.codes.map((c) => <span key={c.value}><Mono>{c.value}</Mono> <span className="m2-meta">{t("{n} records", { n: int(c.count) })}</span> </span>)}
                      </>
                    )}
                  </td>
                  <td data-label={t("Severity")}><Sev severity={s.severity} /></td>
                  <td>{allowed ? <ProposeShift shift={s} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Panel>
  );
}

/** Saves a pending draft built from the shift's profile aggregates; a steward publishes it from the rule workbench. */
function ProposeShift({ shift }: { shift: FieldShift }) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => proposeShiftRule(shift),
    onSuccess: (d) => toast.show(d.created ? t("Draft saved. Find it in the rule workbench.") : t("This draft already exists. Find it in the rule workbench.")),
    onError: (e) => toast.show(errorSentence(e, t("The rule could not be proposed.")), "error"),
  });
  return (
    <button type="button" className="m2-btn m2-sm" disabled={m.isPending || m.isSuccess} onClick={() => m.mutate()} data-testid={`propose-shift-${shift.id}`}>
      {m.isSuccess ? t("Proposed") : t("Propose rule")}
    </button>
  );
}

function Proposal({ p, onSaved }: { p: AnomalyRuleProposal; onSaved: () => void }) {
  const toast = useToast();
  const g = p.grounding;
  const [saved, setSavedLocal] = useState(false);
  const save = useMutation({
    mutationFn: () => approveAnomalyRule(g.module, p.rule_yaml ?? "", t("Proposed by Aletheia from an outlier in {field}", { field: g.field })),
    onSuccess: () => {
      setSavedLocal(true);
      onSaved();
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
      {p.valid && !saved ? <Consequence>{t("Saving adds this rule to the rule workbench as a draft. It flags nothing until a steward publishes it.")}</Consequence> : null}
      {p.valid ? (
        <button type="button" className="m2-btn m2-next" disabled={save.isPending || saved} onClick={() => save.mutate()} data-testid="anomaly-rules-save">
          {saved ? t("Saved as draft") : t("Save as draft")}
        </button>
      ) : null}
    </div>
  );
}

