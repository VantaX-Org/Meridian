"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyPromotion, getPromotionModules, getPromotionPreview, promoteAnyway, revertPromotion, type PromotionBucket, type PromotionPreview, type PromotionRule } from "@/lib/api/v2/rule-promotion";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { Field, Gate } from "../forms";
import { Coded, Dash, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { Lede, PrimaryAction } from "../RunParts";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Aletheia rule promotion: the roughly 2,700 switched-off rules generated from the SAP data dictionary are dry-run on
 * the tenant's latest extraction and sorted by evidence. Promote means populated enough with a failure rate inside the
 * threshold; review means populated but failing above it; skipped means the field is unused; needs a value set means
 * the system's live configuration has no list to judge the values against, so it is never switched on automatically.
 * Everything is deterministic and local. The evidence holds counts, rates and record keys, never a field value.
 */

const BUCKETS: readonly PromotionBucket[] = ["promote", "review", "needs_value_set", "skip_unused"];
const bucketName = (b: PromotionBucket): string =>
  b === "promote" ? t("Ready to promote") : b === "review" ? t("Needs review") : b === "needs_value_set" ? t("Needs a value set") : t("Skipped, unused");

const REASON: Record<string, () => string> = {
  within_threshold: () => t("Failure rate is within the threshold"),
  failure_rate_high: () => t("Failure rate is above the threshold"),
  no_value_set: () => t("The system's live configuration has no value list for it"),
  not_extracted: () => t("The field was not extracted"),
  empty: () => t("The field is empty"),
  sparse: () => t("Too few records fill the field"),
  few_records: () => t("Too few records to judge"),
  not_evaluable: () => t("The rule could not be evaluated"),
};
const reasonText = (r: string): string => (REASON[r] ? REASON[r]() : r);

/** A rate as a percentage; small rates keep their digits so 0.02% does not read as zero. */
export const ratePct = (rate: number): string => `${(rate * 100).toFixed(rate > 0 && rate < 0.001 ? 3 : 1)}%`;

export function RulePromotion() {
  const fixture = useFixture();
  const modules = useQuery({ queryKey: ["rule-promotion", fixture, "modules"], queryFn: getPromotionModules, staleTime: 30_000 });
  const [picked, setPicked] = useState<string | null>(null);
  if (modules.isPending) return <CcPage title={t("Aletheia rule promotion")}><Skeleton width="100%" height={320} /></CcPage>;
  if (modules.isError) {
    return (
      <CcPage title={t("Aletheia rule promotion")}>
        <ErrorFrame onRetry={() => void modules.refetch()}>{t("The generated rules could not be read.")}</ErrorFrame>
      </CcPage>
    );
  }
  const list = modules.data.modules;
  const object = picked ?? list[0]?.module ?? null;
  const total = list.reduce((n, m) => n + m.generated, 0);
  const promoted = list.reduce((n, m) => n + m.promoted, 0);
  return (
    <CcPage title={t("Aletheia rule promotion")}>
      <Lede>{t("Aletheia generated these rules from the SAP data dictionary. Pick an object, preview what each rule does on your data, then approve the ones that hold.")}</Lede>
      <CcBanner
        testId="rule-promotion"
        label={t("Aletheia rule promotion")}
        eyebrow={t("Aletheia rule promotion")}
        headline={t("{n, plural, one {# generated rule} other {# generated rules}} wait to be proved on your data", { n: total - promoted })}
        why={t("Each rule is dry-run on your latest extraction first. Only rules that hold on your data are promoted, and every promotion is audited and can be reverted.")}
        figs={[
          { label: t("Promoted"), value: int(promoted), hint: t("Rules switched on after proving themselves on your data.") },
          { label: t("Generated"), value: int(total), hint: t("All rules Aletheia wrote for the objects below.") },
        ]}
      />
      <Panel title={t("Objects")} meta={t("Bucket counts from the last evaluation.")} testId="rule-promotion-modules">
        {list.length === 0 ? <EmptyFrame>{t("No object has generated rules.")}</EmptyFrame> : (
          <ScrollFrame label={t("Objects table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Generated")}</th>
                  <th scope="col">{t("Promoted")}</th>
                  {BUCKETS.map((b) => <th key={b} scope="col">{bucketName(b)}</th>)}
                  <th scope="col"><span className="m2-sr">{t("Open")}</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.module} data-testid={`promo-module-${m.module}`} aria-selected={m.module === object}>
                    <th scope="row" className="m2-card-lead">{moduleText(m.module)}</th>
                    <td data-label={t("Generated")} className="m2-num">{int(m.generated)}</td>
                    <td data-label={t("Promoted")} className="m2-num">{int(m.promoted)}</td>
                    {BUCKETS.map((b) => <td key={b} data-label={bucketName(b)} className="m2-num">{m.summary ? int(m.summary[b]) : <Dash why={t("Not evaluated yet. Press Preview.")} />}</td>)}
                    <td><button type="button" className="m2-btn m2-sm" aria-pressed={m.module === object} onClick={() => setPicked(m.module)}>{t("Open")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>
      {object ? <ObjectPanel key={object} object={object} /> : null}
    </CcPage>
  );
}

function ObjectPanel({ object }: { object: string }) {
  const fixture = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useV2Session();
  const allowed = can("manage_rules");
  const [run, setRun] = useState(false);
  const [filter, setFilter] = useState<PromotionBucket | "promoted">("promote");
  const [anyway, setAnyway] = useState<PromotionRule | null>(null);
  const q = useQuery({ queryKey: ["rule-promotion", fixture, "preview", object], queryFn: () => getPromotionPreview(object), enabled: run, staleTime: 0 });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["rule-promotion", fixture] });
  };
  const done = (msg: string) => { toast.show(msg); refresh(); };
  const fail = (e: unknown) => toast.show(errorSentence(e, t("The change could not be saved.")), "error");
  const apply = useMutation({ mutationFn: () => applyPromotion(object), onSuccess: (r) => done(t("{n, plural, one {# rule promoted} other {# rules promoted}}", { n: r.enabled.length })), onError: fail });
  const revert = useMutation({ mutationFn: (ids?: string[]) => revertPromotion(object, ids), onSuccess: (r) => done(t("{n, plural, one {# rule reverted} other {# rules reverted}}", { n: r.reverted.length })), onError: fail });
  const data = q.data;
  const rows = data ? data.rules.filter((r) => (filter === "promoted" ? r.promoted : !r.promoted && r.bucket === filter)) : [];

  return (
    <Panel title={t("{object} rules", { object: moduleText(object) })} meta={t("Preview changes nothing. Apply promotes the ready rules.")} testId="rule-promotion-detail">
      <div className="m2-acts">
        <button type="button" className={`m2-btn${data && data.counts.promote > 0 && allowed ? "" : " m2-next"}`} disabled={q.isFetching} onClick={() => (run ? void q.refetch() : setRun(true))} data-testid="promo-preview">
          {q.isFetching ? t("Working…") : t("Preview")}
        </button>
        {allowed && data ? (
          <>
            <button type="button" className={`m2-btn${data.counts.promote > 0 ? " m2-next" : ""}`} disabled={apply.isPending || data.counts.promote === 0} onClick={() => apply.mutate()} data-testid="promo-apply">
              {t("{n, plural, one {Approve the top candidate: promote # rule} other {Approve the top candidates: promote # rules}}", { n: data.counts.promote })}
            </button>
            <button type="button" className="m2-btn m2-ghost" disabled={revert.isPending || data.promoted === 0} onClick={() => revert.mutate(undefined)} data-testid="promo-revert">
              {t("Revert all promotions")}
            </button>
          </>
        ) : null}
      </div>
      {!allowed ? <Gate>{t("Managing rules needs the manage rules permission.")}</Gate> : null}
      {data && data.counts.promote > 0 ? <p className="m2-why1">{t("These rules failed on few enough records to be safe. Approving switches them on and can be reverted.")}</p> : null}
      {!run ? <EmptyFrame>{t("Press Preview to dry-run the generated rules on the latest extraction.")}</EmptyFrame> : q.isPending ? <Skeleton width="100%" height={200} /> : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{errorSentence(q.error, t("The rules could not be evaluated."))}</ErrorFrame>
      ) : data ? (
        <Evaluated data={data} filter={filter} setFilter={setFilter} rows={rows} allowed={allowed} onAnyway={setAnyway} onRevert={(id) => revert.mutate([id])} />
      ) : null}
      {anyway ? <AnywayForm rule={anyway} object={object} onClose={() => setAnyway(null)} onDone={(m) => { setAnyway(null); done(m); }} /> : null}
    </Panel>
  );
}

function Evaluated({ data, filter, setFilter, rows, allowed, onAnyway, onRevert }: { data: PromotionPreview; filter: PromotionBucket | "promoted"; setFilter: (f: PromotionBucket | "promoted") => void; rows: PromotionRule[]; allowed: boolean; onAnyway: (r: PromotionRule) => void; onRevert: (id: string) => void }) {
  const th = data.thresholds;
  const byId = new Map(data.rules.map((r) => [r.id, r]));
  return (
    <>
      <p data-testid="promo-narrative">
        {t("{ready} ready to promote, {review} need review, {value} wait for a value set, {skipped} skipped.", { ready: int(data.counts.promote), review: int(data.counts.review), value: int(data.counts.needs_value_set), skipped: int(data.counts.skip_unused) })}
        {" "}
        <span className="m2-meta">{t("Promote when at least {pop}% of records fill the field, at most {fail} fail, and at least {n} records are checked.", { pop: th.min_populated_pct, fail: ratePct(th.max_failure_rate), n: int(th.min_records) })}</span>
      </p>
      {data.drift.length ? (
        <div role="alert" data-testid="promo-drift">
          <strong>{t("{n, plural, one {# promoted rule is failing more than when it was promoted} other {# promoted rules are failing more than when they were promoted}}", { n: data.drift.length })}</strong>
          <ul className="m2-cl-changes">
            {data.drift.map((d) => {
              const r = byId.get(d.id);
              return (
                <li key={d.id} data-testid={`drift-${d.id}`}>
                  <Coded code={d.id} text={r?.message} />{" "}
                  <span className="m2-meta">{t("{from} then, {to} now, {failing} of {total} records", { from: ratePct(d.baseline_rate), to: ratePct(d.current_rate), failing: int(d.failing), total: int(d.total) })}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="m2-chips" role="group" aria-label={t("Bucket")}>
        {[...BUCKETS, "promoted" as const].map((b) => (
          <button key={b} type="button" className="m2-chip" aria-pressed={filter === b} onClick={() => setFilter(b)} data-testid={`promo-chip-${b}`}>
            {b === "promoted" ? t("Promoted") : bucketName(b)} <span className="m2-chip-n">{int(b === "promoted" ? data.promoted : data.counts[b])}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 ? <EmptyFrame>{t("No rule is in this bucket.")}</EmptyFrame> : (
        <ScrollFrame label={t("Generated rules table, scrollable")}>
          <table className="m2-tbl m2-cards" data-testid="promo-rules">
            <thead>
              <tr>
                <th scope="col">{t("Rule")}</th>
                <th scope="col">{t("Field")}</th>
                <th scope="col">{t("Check")}</th>
                <th scope="col">{t("Failure rate")}</th>
                <th scope="col">{t("Filled")}</th>
                <th scope="col">{t("Records")}</th>
                <th scope="col">{t("Bucket")}</th>
                <th scope="col"><span className="m2-sr">{t("Action")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`promo-rule-${r.id}`}>
                  <th scope="row" className="m2-card-lead"><Coded code={r.id} text={r.message} /></th>
                  <td data-label={t("Field")}><Coded code={r.field} text={r.field_text} /></td>
                  <td data-label={t("Check")}>{labelText(r.check_class)}</td>
                  <td data-label={t("Failure rate")} className="m2-num">
                    {r.rate == null ? <Dash why={reasonText(r.reason)} /> : <>{ratePct(r.rate)} <span className="m2-meta">{t("{n} failing", { n: int(r.failing) })}</span></>}
                  </td>
                  <td data-label={t("Filled")} className="m2-num">{r.populated_pct == null ? <Dash why={reasonText(r.reason)} /> : `${r.populated_pct}%`}</td>
                  <td data-label={t("Records")} className="m2-num">{r.total ? int(r.total) : <Dash />}</td>
                  <td data-label={t("Bucket")}>
                    {r.promoted ? t("Promoted") : bucketName(r.bucket)} <span className="m2-meta">{reasonText(r.reason)}</span>
                    {r.bucket === "review" && !r.promoted && r.sample_keys.length ? <div className="m2-meta">{t("Sample records")}: {r.sample_keys.join(", ")}</div> : null}
                  </td>
                  <td>
                    {allowed && r.promoted ? <button type="button" className="m2-btn m2-sm m2-ghost" onClick={() => onRevert(r.id)} data-testid={`revert-${r.id}`}>{t("Revert")}</button> : null}
                    {allowed && !r.promoted && r.bucket === "review" ? <button type="button" className="m2-btn m2-sm" onClick={() => onAnyway(r)} data-testid={`anyway-${r.id}`}>{t("Promote anyway")}</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </>
  );
}

/** Enabling a rule that fails above the threshold is a judgement call: it needs a reason, which is audited with the evidence. */
function AnywayForm({ rule, object, onClose, onDone }: { rule: PromotionRule; object: string; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => promoteAnyway(object, [rule.id], reason.trim()),
    onSuccess: () => onDone(t("Rule promoted. The reason is in the audit log.")),
    onError: (e) => toast.show(errorSentence(e, t("The rule could not be promoted.")), "error"),
  });
  const short = reason.trim().length < 5;
  return (
    <div className="m2-confirm" role="group" aria-label={t("Promote anyway")} data-testid="promo-anyway">
      <p>{t("This rule fails {rate} of records. Promoting it raises an issue on each. Say why it is right to promote it.", { rate: rule.rate == null ? "" : ratePct(rule.rate) })} <Coded code={rule.id} text={rule.message} /></p>
      <Field label={t("Reason")} hint={t("At least 5 characters. Kept in the audit log with the evidence.")}>
        {(p) => <textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="promo-anyway-reason" />}
      </Field>
      <div className="m2-acts">
        <button type="button" className="m2-btn m2-next" disabled={short || m.isPending} onClick={() => m.mutate()} data-testid="promo-anyway-confirm">
          {m.isPending ? t("Working…") : t("Promote anyway")}
        </button>
        <button type="button" className="m2-btn m2-ghost" onClick={onClose}>{t("Cancel")}</button>
      </div>
    </div>
  );
}
