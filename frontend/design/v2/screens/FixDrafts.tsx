"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { approveFix, draftFix, getFixCoverage, getFixDrafts, rejectFix, type FixDraft } from "@/lib/api/v2/fix-drafts";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { refreshV2 } from "@/lib/v2/queries";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { StackedBar, type StackPart } from "../charts";
import { Field, Gate } from "../forms";
import { Consequence, FixHead, FlowSteps, MoreDetail, ObjectRunChip } from "../FixParts";
import { Coded, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Aletheia verified fixes: for a rule with no fix, the drafter sees only the aggregated shape of the failing values
 * (masks, lengths, case, edge spaces), drafts steps from the fixed set of fix operations, and the server proves the steps
 * on the extraction. The draft waits as pending. Approve makes the steps the rule's fix; nothing is ever applied by itself.
 */

const OP_TEXT: Record<string, () => string> = {
  strip: () => t("Trim spaces at both ends"),
  collapse_spaces: () => t("Reduce runs of spaces to one"),
  upper: () => t("Change to upper case"),
  lower: () => t("Change to lower case"),
  title: () => t("Change to title case"),
  pad_left: () => t("Pad on the left"),
  strip_leading_zeros: () => t("Remove leading zeros"),
  regex_replace: () => t("Replace by pattern"),
  truncate: () => t("Cut to a width"),
  map: () => t("Map values"),
  set: () => t("Set a fixed value"),
  copy: () => t("Copy from another field"),
  lookup: () => t("Look up in a table"),
  date_format: () => t("Convert the date format"),
  gtin_check_digit: () => t("Add the GTIN check digit"),
};
const opText = (op: string): string | undefined => (OP_TEXT[op] ? OP_TEXT[op]() : undefined);

const CHART = ["--m2-chart-1", "--m2-chart-2", "--m2-chart-3", "--m2-chart-4", "--m2-chart-5"];

export const coveragePct = (withFix: number, rules: number): string => (rules ? `${((withFix / rules) * 100).toFixed(1)}%` : "0.0%");

function Coverage() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["fix-drafts", fixture, "coverage"], queryFn: getFixCoverage, staleTime: 30_000 });
  if (q.isPending) return <Skeleton width="100%" height={160} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The fix coverage could not be read.")}</ErrorFrame>;
  const rows = q.data.modules;
  if (!rows.length) return <EmptyFrame>{t("No object has rules.")}</EmptyFrame>;
  return (
    <ul className="m2-cl-changes" data-testid="fix-coverage">
      {rows.map((m) => {
        const parts: StackPart[] = [
          { key: "with", label: t("With a fix"), value: m.with_fix, colour: "--m2-chart-1", title: t("{n} of {total} rules have a fix, {pct}", { n: int(m.with_fix), total: int(m.rules), pct: coveragePct(m.with_fix, m.rules) }) },
          { key: "without", label: t("Without a fix"), value: m.rules - m.with_fix, colour: "--m2-sev-low", title: t("{n} rules have no fix", { n: int(m.rules - m.with_fix) }) },
        ];
        return (
          <li key={m.module} data-testid={`fix-cov-${m.module}`}>
            <strong><ObjectRunChip module={m.module} /></strong> <span className="m2-meta">{t("{n} of {total} rules, {pct}", { n: int(m.with_fix), total: int(m.rules), pct: coveragePct(m.with_fix, m.rules) })}</span>
            <StackedBar parts={parts} label={t("Rules with a fix in {object}", { object: moduleText(m.module) })} format={int} />
          </li>
        );
      })}
    </ul>
  );
}

function DraftForm({ onDone }: { onDone: (d: FixDraft) => void }) {
  const toast = useToast();
  const [objectInput, setObjectInput] = useState("");
  const [rule, setRule] = useState("");
  const m = useMutation({
    mutationFn: () => draftFix(objectInput.trim(), rule.trim()),
    onSuccess: (d) => (d.status === "none" ? toast.show(t("Nothing in the allowed operations fixes this rule.")) : onDone(d)),
    onError: (e) => toast.show(errorSentence(e, t("The fix could not be drafted.")), "error"),
  });
  return (
    <div className="m2-acts" role="group" aria-label={t("Draft a fix")} data-testid="fix-draft-form">
      <Field label={t("Object")}>{(p) => <input {...p} value={objectInput} onChange={(e) => setObjectInput(e.target.value)} data-testid="fix-module" />}</Field>
      <Field label={t("Rule")}>{(p) => <input {...p} value={rule} onChange={(e) => setRule(e.target.value)} data-testid="fix-rule" />}</Field>
      <button type="button" className="m2-btn" disabled={!objectInput.trim() || !rule.trim() || m.isPending} onClick={() => m.mutate()} data-testid="fix-draft-go">
        {m.isPending ? t("Working…") : t("Draft and verify")}
      </button>
      <Consequence>{t("Drafting only proposes steps and tests them on your extraction. It changes no data.")}</Consequence>
    </div>
  );
}

function Card({ d, allowed, onDecide, busy }: { d: FixDraft; allowed: boolean; onDecide: (id: string, ok: boolean) => void; busy: boolean }) {
  const s = d.shape;
  const v = d.verification;
  // A decision is final (the API has no undo), so it asks once before it is sent.
  const [asking, setAsking] = useState<boolean | null>(null);
  const masks: StackPart[] = s.masks.slice(0, 5).map((x, i) => ({ key: x.mask, label: x.mask, value: x.count, colour: CHART[i % CHART.length], title: t("Shape {mask}: {n} values", { mask: x.mask, n: int(x.count) }) }));
  const proof: StackPart[] = v ? [
    { key: "fixed", label: t("Fixed"), value: v.fixed, colour: "--m2-chart-3", title: t("{n} fixed", { n: int(v.fixed) }) },
    { key: "rejected", label: t("Rejected"), value: v.rejected, colour: "--m2-chart-4", title: t("{n} rejected by the rule after the fix", { n: int(v.rejected) }) },
    { key: "still", label: t("Still failing"), value: v.still_failing, colour: "--m2-sev-crit", title: t("{n} still failing", { n: int(v.still_failing) }) },
  ] : [];
  return (
    <article className="m2-ck-panel" aria-label={d.rule_id} data-testid={`fix-draft-${d.rule_id}`}>
      <header className="m2-ck-head">
        <h3 className="m2-h2"><Coded code={d.rule_id} text={d.rule_text} /></h3>
        <span className="m2-meta" data-testid={`fix-status-${d.rule_id}`}>
          {d.status === "pending" ? t("Pending") : d.status === "approved" ? t("Approved") : d.status === "rejected" ? t("Rejected") : t("No fix found")}
          {" "}{d.source === "llm" ? t("Drafted by the model") : t("Drafted by rule")}
        </span>
      </header>
      <p>{d.module ? <><ObjectRunChip module={d.module} />{" "}</> : null}<Coded code={d.field} text={d.field_text} /> <span className="m2-meta">{t("{n} failing values", { n: int(s.total_failing) })}</span></p>
      <h4 className="m2-h3">{t("Drafted steps")}</h4>
      <ol data-testid={`fix-steps-${d.rule_id}`}>
        {d.steps.map((st, i) => <li key={i}><Coded code={String(st.op)} text={opText(String(st.op))} /></li>)}
      </ol>
      {v ? (
        <>
          <h4 className="m2-h3">{t("Verification on your extraction")}</h4>
          <StackedBar parts={proof} label={t("Verification of the drafted steps")} format={int} testId={`fix-proof-${d.rule_id}`} />
          <p className="m2-meta">{t("{n} passing values changed", { n: int(v.touched_passing + v.broken) })}</p>
        </>
      ) : null}
      <MoreDetail title={t("What the failing values look like")}>
        <h4 className="m2-h3">{t("Aggregated shape")}</h4>
        <StackedBar parts={masks} label={t("Shapes of the failing values")} format={int} />
        <p className="m2-meta">
          {t("{lead} with leading spaces, {trail} with trailing spaces, {inner} with inner spaces", { lead: int(s.leading_ws), trail: int(s.trailing_ws), inner: int(s.inner_ws) })}
          {" "}{Object.entries(s.legend).map(([k, x]) => `${k} ${x}`).join(", ")}
        </p>
      </MoreDetail>
      {d.errors.length ? <p className="m2-meta">{d.errors.join(" ")}</p> : null}
      {allowed && d.status === "pending" ? (
        <>
        <Consequence>{t("Approving makes these steps the rule's fix. Nothing in SAP changes until a cleansing run uses it.")}</Consequence>
        {asking === null ? (
          <div className="m2-acts">
            <button type="button" className="m2-btn m2-strong" disabled={busy} onClick={() => setAsking(true)} data-testid={`fix-approve-${d.rule_id}`}>{t("Approve")}</button>
            <button type="button" className="m2-btn m2-ghost" disabled={busy} onClick={() => setAsking(false)} data-testid={`fix-reject-${d.rule_id}`}>{t("Reject")}</button>
          </div>
        ) : (
          <div className="m2-acts" role="group" aria-label={t("Confirm the decision")} data-testid={`fix-confirm-${d.rule_id}`}>
            <span>{asking ? t("Approve this fix for {rule}? This cannot be undone here.", { rule: d.rule_id }) : t("Reject this fix for {rule}? This cannot be undone here.", { rule: d.rule_id })}</span>
            <button type="button" className="m2-btn m2-strong" disabled={busy} onClick={() => { onDecide(d.rule_id, asking); setAsking(null); }} data-testid={`fix-confirm-yes-${d.rule_id}`}>{asking ? t("Yes, approve") : t("Yes, reject")}</button>
            <button type="button" className="m2-btn m2-ghost" onClick={() => setAsking(null)}>{t("Cancel")}</button>
          </div>
        )}
        </>
      ) : null}
    </article>
  );
}

export function FixDrafts() {
  const fixture = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useV2Session();
  const allowed = can("manage_rules");
  const q = useQuery({ queryKey: ["fix-drafts", fixture, "list"], queryFn: getFixDrafts, staleTime: 15_000 });
  // An approved fix changes what the rule screens and the ledger offer, so every v2 read refetches, not only this list.
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["fix-drafts", fixture] }); void refreshV2(qc); };
  const decide = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => (ok ? approveFix(id) : rejectFix(id)),
    onSuccess: (d) => { toast.show(d.status === "approved" ? t("Fix approved. The steps are now the rule's fix.") : t("Fix rejected.")); refresh(); },
    onError: (e) => toast.show(errorSentence(e, t("The decision could not be saved.")), "error"),
  });
  if (q.isPending) return <CcPage title={t("Aletheia verified fixes")}><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) return <CcPage title={t("Aletheia verified fixes")}><ErrorFrame onRetry={() => void q.refetch()}>{t("The fix drafts could not be read.")}</ErrorFrame></CcPage>;
  const drafts = q.data.drafts;
  const pending = drafts.filter((d) => d.status === "pending").length;
  return (
    <CcPage title={t("Aletheia verified fixes")}>
      <CcBanner
        testId="fix-drafts"
        label={t("Aletheia verified fixes")}
        eyebrow={t("Aletheia verified fixes")}
        headline={t("{n, plural, one {# drafted fix waits for a decision} other {# drafted fixes wait for a decision}}", { n: pending })}
        why={t("The drafter sees only the shape of the failing values, never a value. Each draft is proved on your extraction first, and nothing applies until a steward approves it.")}
        figs={[{ label: t("Pending"), value: int(pending) }, { label: t("Drafts"), value: int(drafts.length) }]}
        action={pending > 0 ? <a className="m2-btn m2-strong" href={`#fix-draft-${drafts.find((d) => d.status === "pending")?.rule_id}`} data-testid="fix-primary">{t("Review the first pending draft")}</a> : undefined}
      />
      <FixHead
        lede={t("This page drafts a fix for a rule that has none. A draft is proved on the latest extraction, then waits for a steward. Read the coverage, review the pending drafts, approve or reject.")}
        means={[
          [t("Pending"), t("A drafted fix that no steward has decided on.")],
          [t("With a fix"), t("Rules that already carry fix steps.")],
          [t("Still failing"), t("Values the rule still rejects after the steps ran in the proof.")],
          [t("Fixed"), t("Values the rule accepts after the steps ran in the proof.")],
        ]}
      />
      <FlowSteps
        label={t("Fix steps")}
        current={pending > 0 ? 3 : 0}
        steps={[
          { label: t("Choose the rule"), hint: t("Enter the object and the rule that fails.") },
          { label: t("Draft the fix"), hint: t("Aletheia proposes steps from the shape of the failing values.") },
          { label: t("See the proof"), hint: t("The steps are tried on your extraction first.") },
          { label: t("Approve or reject"), count: int(pending), hint: t("A steward decides. Approved steps become the rule's fix.") },
        ]}
      />
      <Panel title={t("Drafts")} meta={t("Approve or reject. A rejected draft is kept in the audit log.")} testId="fix-drafts-list">
        {allowed ? <DraftForm onDone={refresh} /> : <Gate>{t("Managing rules needs the manage rules permission.")}</Gate>}
        {drafts.length === 0 ? <EmptyFrame>{t("No fix is drafted yet. Enter an object and a rule above, then choose Draft and verify.")}</EmptyFrame> : (
          <ScrollFrame label={t("Drafted fixes, scrollable")}>
            {drafts.map((d) => <Card key={d.rule_id} d={d} allowed={allowed} busy={decide.isPending} onDecide={(id, ok) => decide.mutate({ id, ok })} />)}
          </ScrollFrame>
        )}
      </Panel>
      <MoreDetail title={t("Fix coverage by object")}>
      <Panel title={t("Fix coverage")} meta={t("Rules with a fix, by object.")} testId="fix-coverage-panel"><Coverage /></Panel>
      </MoreDetail>
    </CcPage>
  );
}
