"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyPromotion, getPromotionModules, getPromotionPreview, promoteAnyway, revertPromotion, type PromotionBucket, type PromotionPreview, type PromotionRule } from "@/lib/api/v2/rule-promotion";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { Button, Stepper, type StepItem } from "@/design/next/kit";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { Grid, type GridColumn } from "./Grid";
import { Block, Fld, Note, useCan } from "./kit";
import { Coded, Dash, EmptyFrame, ErrorFrame, Skeleton } from "./parts";
import { useToast } from "./Toast";

/**
 * Aletheia rule promotion: the switched-off rules generated from the SAP data dictionary are dry-run on the tenant's
 * latest extraction and sorted by evidence. Promote means populated enough with a failure rate inside the threshold;
 * review means populated but failing above it; skipped means the field is unused; needs a value set means the live
 * configuration has no list to judge against, so it is never switched on automatically. Evidence holds counts, rates
 * and record keys, never a field value.
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

type Mod = { module: string; generated: number; promoted: number; summary?: Record<PromotionBucket, number> | null };

export function RulePromotion() {
  const fixture = useFixture();
  const modules = useQuery({ queryKey: ["rule-promotion", fixture, "modules"], queryFn: getPromotionModules, staleTime: 30_000 });
  const [picked, setPicked] = useState<string | null>(null);
  if (modules.isPending) return <CcPage title={t("Aletheia rule promotion")}><Skeleton /></CcPage>;
  if (modules.isError) {
    return (
      <CcPage title={t("Aletheia rule promotion")}>
        <ErrorFrame onRetry={() => void modules.refetch()}>{t("The generated rules could not be read.")}</ErrorFrame>
      </CcPage>
    );
  }
  const list = modules.data.modules as Mod[];
  const object = picked ?? list[0]?.module ?? null;
  const total = list.reduce((n, m) => n + m.generated, 0);
  const promoted = list.reduce((n, m) => n + m.promoted, 0);
  const columns: GridColumn<Mod>[] = [
    { id: "module", header: t("Object"), width: 200, locked: true, cell: (m) => <span data-testid={`promo-module-${m.module}`}>{moduleText(m.module)}</span> },
    { id: "generated", header: t("Generated"), width: 100, numeric: true, cell: (m) => int(m.generated) },
    { id: "promoted", header: t("Promoted"), width: 100, numeric: true, cell: (m) => int(m.promoted) },
    ...BUCKETS.map((b): GridColumn<Mod> => ({ id: b, header: bucketName(b), width: 120, numeric: true, cell: (m) => (m.summary ? int(m.summary[b]) : <Dash why={t("Not evaluated yet. Press Preview.")} />) })),
    { id: "open", header: t("Open"), width: 90, cell: (m) => <Button size={32} variant={m.module === object ? "primary" : "secondary"} aria-pressed={m.module === object} onClick={() => setPicked(m.module)} data-testid={`promo-open-${m.module}`}>{t("Open")}</Button> },
  ];
  return (
    <CcPage title={t("Aletheia rule promotion")}>
      <p className="nx-reason">{t("Aletheia generated these rules from the SAP data dictionary. Pick an object, preview what each rule does on your data, then approve the ones that hold.")}</p>
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
      <Block title={t("Objects")} hint={t("Bucket counts from the last evaluation.")}>
        <div data-testid="rule-promotion-modules">
          <Grid id="rule-promotion-modules" ariaLabel={t("Objects")} columns={columns} rows={list} rowId={(m) => m.module} onOpen={(m) => setPicked(m.module)} emptyFrame={<EmptyFrame>{t("No object has generated rules.")}</EmptyFrame>} />
        </div>
      </Block>
      {object ? <ObjectPanel key={object} object={object} /> : null}
    </CcPage>
  );
}

function ObjectPanel({ object }: { object: string }) {
  const fixture = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const allowed = useCan()("manage_rules");
  const [run, setRun] = useState(false);
  const [filter, setFilter] = useState<PromotionBucket | "promoted">("promote");
  const [anyway, setAnyway] = useState<PromotionRule | null>(null);
  const q = useQuery({ queryKey: ["rule-promotion", fixture, "preview", object], queryFn: () => getPromotionPreview(object), enabled: run, staleTime: 0 });
  const done = (msg: string) => { toast.show(msg); void qc.invalidateQueries({ queryKey: ["rule-promotion", fixture] }); };
  const fail = (e: unknown) => toast.show(errorSentence(e, t("The change could not be saved.")), "error");
  const apply = useMutation({ mutationFn: () => applyPromotion(object), onSuccess: (r) => done(t("{n, plural, one {# rule promoted} other {# rules promoted}}", { n: r.enabled.length })), onError: fail });
  const revert = useMutation({ mutationFn: (ids?: string[]) => revertPromotion(object, ids), onSuccess: (r) => done(t("{n, plural, one {# rule reverted} other {# rules reverted}}", { n: r.reverted.length })), onError: fail });
  const data = q.data;
  const rows = data ? data.rules.filter((r) => (filter === "promoted" ? r.promoted : !r.promoted && r.bucket === filter)) : [];
  const current = !data ? 1 : data.counts.promote > 0 ? 2 : 3;
  const stepLabels = [t("Pick an object"), t("Preview on your data"), t("Approve the ready rules"), t("Watch for drift")];
  const steps: StepItem[] = stepLabels.map((label, i) => ({ id: String(i), label, state: i < current ? "done" : i === current ? "current" : "future" }));

  return (
    <Block title={t("{object} rules", { object: moduleText(object) })} hint={t("Preview changes nothing. Apply promotes the ready rules.")}>
      <div data-testid="rule-promotion-detail">
        <div data-testid="promo-steps"><Stepper steps={steps} label={t("Promotion steps")} /></div>
        <div className="nx-adm-acts">
          <Button variant={data && data.counts.promote > 0 && allowed ? "secondary" : "primary"} loading={q.isFetching} disabled={q.isFetching} onClick={() => (run ? void q.refetch() : setRun(true))} data-testid="promo-preview">
            {t("Preview")}
          </Button>
          {allowed && data ? (
            <>
              <Button variant={data.counts.promote > 0 ? "primary" : "secondary"} loading={apply.isPending} disabled={data.counts.promote === 0} onClick={() => apply.mutate()} data-testid="promo-apply">
                {t("{n, plural, one {Approve the top candidate: promote # rule} other {Approve the top candidates: promote # rules}}", { n: data.counts.promote })}
              </Button>
              <Button variant="quiet" loading={revert.isPending} disabled={data.promoted === 0} onClick={() => revert.mutate(undefined)} data-testid="promo-revert">
                {t("Revert all promotions")}
              </Button>
            </>
          ) : null}
        </div>
        {!allowed ? <div data-testid="promo-gate"><Note tone="warn">{t("Managing rules needs the manage rules permission.")}</Note></div> : null}
        {data && data.counts.promote > 0 ? <div data-testid="consequence"><Note>{t("Approving switches on {n, plural, one {# rule} other {# rules}} for {object}. From the next run each raises an issue on every record it fails. Revert switches them off again.", { n: data.counts.promote, object: moduleText(object) })}</Note></div> : null}
        {!run ? <EmptyFrame>{t("Press Preview to dry-run the generated rules on the latest extraction.")}</EmptyFrame> : q.isPending ? <Skeleton /> : q.isError ? (
          <ErrorFrame onRetry={() => void q.refetch()}>{errorSentence(q.error, t("The rules could not be evaluated."))}</ErrorFrame>
        ) : data ? (
          <Evaluated data={data} filter={filter} setFilter={setFilter} rows={rows} allowed={allowed} onAnyway={setAnyway} onRevert={(id) => revert.mutate([id])} />
        ) : null}
        {anyway ? <AnywayForm rule={anyway} object={object} onClose={() => setAnyway(null)} onDone={(m) => { setAnyway(null); done(m); }} /> : null}
      </div>
    </Block>
  );
}

function Evaluated({ data, filter, setFilter, rows, allowed, onAnyway, onRevert }: { data: PromotionPreview; filter: PromotionBucket | "promoted"; setFilter: (f: PromotionBucket | "promoted") => void; rows: PromotionRule[]; allowed: boolean; onAnyway: (r: PromotionRule) => void; onRevert: (id: string) => void }) {
  const th = data.thresholds;
  const byId = new Map(data.rules.map((r) => [r.id, r]));
  const columns: GridColumn<PromotionRule>[] = [
    { id: "rule", header: t("Rule"), width: 260, locked: true, cell: (r) => <span data-testid={`promo-rule-${r.id}`}><Coded code={r.id} text={r.message} /></span> },
    { id: "field", header: t("Field"), width: 200, cell: (r) => <Coded code={r.field} text={r.field_text} /> },
    { id: "check", header: t("Check"), width: 140, cell: (r) => labelText(r.check_class) },
    { id: "rate", header: t("Failure rate"), width: 140, numeric: true, cell: (r) => (r.rate == null ? <Dash why={reasonText(r.reason)} /> : <>{ratePct(r.rate)} <span className="nx-reason">{t("{n} failing", { n: int(r.failing) })}</span></>) },
    { id: "filled", header: t("Filled"), width: 90, numeric: true, cell: (r) => (r.populated_pct == null ? <Dash why={reasonText(r.reason)} /> : `${r.populated_pct}%`) },
    { id: "records", header: t("Records"), width: 100, numeric: true, cell: (r) => (r.total ? int(r.total) : <Dash />) },
    {
      id: "bucket", header: t("Bucket"), width: 220, cell: (r) => (
        <>
          {r.promoted ? t("Promoted") : bucketName(r.bucket)} <span className="nx-reason">{reasonText(r.reason)}</span>
          {r.bucket === "review" && !r.promoted && r.sample_keys.length ? <div className="nx-reason">{t("Sample records")}: {r.sample_keys.join(", ")}</div> : null}
        </>
      ),
    },
    {
      id: "action", header: t("Action"), width: 160, cell: (r) => (
        <>
          {allowed && r.promoted ? <Button size={32} variant="quiet" onClick={() => onRevert(r.id)} data-testid={`revert-${r.id}`}>{t("Revert")}</Button> : null}
          {allowed && !r.promoted && r.bucket === "review" ? <Button size={32} variant="secondary" onClick={() => onAnyway(r)} data-testid={`anyway-${r.id}`}>{t("Promote anyway")}</Button> : null}
        </>
      ),
    },
  ];
  return (
    <>
      <p data-testid="promo-narrative">
        {t("{ready} ready to promote, {review} need review, {value} wait for a value set, {skipped} skipped.", { ready: int(data.counts.promote), review: int(data.counts.review), value: int(data.counts.needs_value_set), skipped: int(data.counts.skip_unused) })}
        {" "}
        <span className="nx-reason">{t("Promote when at least {pop}% of records fill the field, at most {fail} fail, and at least {n} records are checked.", { pop: th.min_populated_pct, fail: ratePct(th.max_failure_rate), n: int(th.min_records) })}</span>
      </p>
      {data.drift.length ? (
        <div role="alert" data-testid="promo-drift">
          <Note tone="bad">{t("{n, plural, one {# promoted rule is failing more than when it was promoted} other {# promoted rules are failing more than when they were promoted}}", { n: data.drift.length })}</Note>
          <ul className="nx-adm-hlist">
            {data.drift.map((d) => (
              <li key={d.id} data-testid={`drift-${d.id}`}>
                <Coded code={d.id} text={byId.get(d.id)?.message} />{" "}
                <span className="nx-reason">{t("{from} then, {to} now, {failing} of {total} records", { from: ratePct(d.baseline_rate), to: ratePct(d.current_rate), failing: int(d.failing), total: int(d.total) })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <CcHBars
        label={t("Rules by outcome of the preview")}
        testId="promo-buckets"
        rows={BUCKETS.map((b) => ({ key: b, label: bucketName(b), value: data.counts[b], text: int(data.counts[b]), tone: b === "promote" ? "pass" : b === "review" ? "warn" : "data" }))}
      />
      <div className="nx-adm-acts" role="group" aria-label={t("Bucket")}>
        {[...BUCKETS, "promoted" as const].map((b) => (
          <Button key={b} size={32} variant={filter === b ? "primary" : "secondary"} aria-pressed={filter === b} onClick={() => setFilter(b)} data-testid={`promo-chip-${b}`}>
            {`${b === "promoted" ? t("Promoted") : bucketName(b)} ${int(b === "promoted" ? data.promoted : data.counts[b])}`}
          </Button>
        ))}
      </div>
      <div data-testid="promo-rules">
        <Grid id="rule-promotion-rules" ariaLabel={t("Rules")} columns={columns} rows={rows} rowId={(r) => r.id} emptyFrame={<EmptyFrame>{t("No rule is in this bucket.")}</EmptyFrame>} />
      </div>
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
    <section className="nx-card nx-adm-blk" role="group" aria-label={t("Promote anyway")} data-testid="promo-anyway">
      <p>{t("This rule fails {rate} of records. Promoting it raises an issue on each. Say why it is right to promote it.", { rate: rule.rate == null ? "" : ratePct(rule.rate) })} <Coded code={rule.id} text={rule.message} /></p>
      <Fld label={t("Reason")} hint={t("At least 5 characters. Kept in the audit log with the evidence.")}>
        <textarea className="nx-input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="promo-anyway-reason" />
      </Fld>
      <div className="nx-adm-acts">
        <Button variant="primary" loading={m.isPending} disabled={short} onClick={() => m.mutate()} data-testid="promo-anyway-confirm">{t("Promote anyway")}</Button>
        <Button variant="quiet" onClick={onClose}>{t("Cancel")}</Button>
      </div>
    </section>
  );
}
