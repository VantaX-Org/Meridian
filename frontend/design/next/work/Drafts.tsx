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
import { Button, Chip, Code, Confirm, StatCard, Stepper, useToast } from "../kit";
import { StackedBar, type Seg } from "../viz";
import { QueryView } from "../more/states";
import "./drafts.css";

/**
 * Aletheia verified fixes, native. For a rule with no fix the drafter sees only the aggregated shape of the failing
 * values, drafts steps from the fixed set of fix operations, and the server proves them on the extraction. A draft
 * waits as pending; Approve makes the steps the rule's fix. Nothing is applied by itself.
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
const opText = (op: string): string | undefined => OP_TEXT[op]?.();
const MASK_TONES: Seg["tone"][] = ["chart1", "chart2", "chart3", "warn", "mute"];
const STATUS: Record<FixDraft["status"], { tone: "warn" | "good" | "bad" | "neutral"; text: () => string }> = {
  pending: { tone: "warn", text: () => t("Pending") },
  approved: { tone: "good", text: () => t("Approved") },
  rejected: { tone: "bad", text: () => t("Rejected") },
  none: { tone: "neutral", text: () => t("No fix found") },
};

export const coveragePct = (withFix: number, rules: number): string => (rules ? `${((withFix / rules) * 100).toFixed(1)}%` : "0.0%");

function Coverage() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["fix-drafts", fixture, "coverage"], queryFn: getFixCoverage, staleTime: 30_000 });
  const rows = q.data?.modules ?? [];
  return (
    <section className="nx-dr-sheet" aria-label={t("Fix coverage")} data-testid="fix-coverage-panel">
      <h2 className="nx-dr-h">{t("Fix coverage by object")}</h2>
      <p className="nx-dr-meta">{t("Rules with a fix, by object.")}</p>
      <QueryView loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} empty={rows.length === 0} emptyHeading={t("No object has rules.")} label={t("Fix coverage")}>
        <ul className="nx-dr-cov" data-testid="fix-coverage">
          {rows.map((m) => (
            <li key={m.module} data-testid={`fix-cov-${m.module}`}>
              <span className="nx-dr-covhead">
                <strong>{moduleText(m.module)}</strong>
                <span className="nx-dr-meta">{t("{n} of {total} rules, {pct}", { n: int(m.with_fix), total: int(m.rules), pct: coveragePct(m.with_fix, m.rules) })}</span>
              </span>
              <StackedBar
                label={t("Rules with a fix in {object}", { object: moduleText(m.module) })}
                segs={[
                  { id: "with", label: t("With a fix"), value: m.with_fix, tone: "chart1" },
                  { id: "without", label: t("Without a fix"), value: m.rules - m.with_fix, tone: "mute" },
                ]}
              />
            </li>
          ))}
        </ul>
      </QueryView>
    </section>
  );
}

function DraftForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [objectInput, setObjectInput] = useState("");
  const [rule, setRule] = useState("");
  const m = useMutation({
    mutationFn: () => draftFix(objectInput.trim(), rule.trim()),
    onSuccess: (d) => (d.status === "none" ? toast({ text: t("Nothing in the allowed operations fixes this rule.") }) : onDone()),
    onError: (e) => toast({ text: errorSentence(e, t("The fix could not be drafted.")), tone: "bad" }),
  });
  const blocked = !objectInput.trim() || !rule.trim() ? t("Enter the object and the rule that fails.") : undefined;
  return (
    <div className="nx-dr-form" role="group" aria-label={t("Draft a fix")} data-testid="fix-draft-form">
      <label className="nx-field">{t("Object")}
        <input className="nx-input" value={objectInput} onChange={(e) => setObjectInput(e.target.value)} data-testid="fix-module" />
      </label>
      <label className="nx-field">{t("Rule")}
        <input className="nx-input" value={rule} onChange={(e) => setRule(e.target.value)} data-testid="fix-rule" />
      </label>
      <Button variant="primary" loading={m.isPending} loadingLabel={t("Working…")} disabled={!!blocked} reason={blocked} onClick={() => m.mutate()} data-testid="fix-draft-go">
        {t("Draft and verify")}
      </Button>
      <p className="nx-dr-meta">{t("Drafting only proposes steps and tests them on your extraction. It changes no data.")}</p>
    </div>
  );
}

function Card({ d, allowed, busy, onDecide }: { d: FixDraft; allowed: boolean; busy: boolean; onDecide: (id: string, ok: boolean) => void }) {
  const s = d.shape;
  const v = d.verification;
  // A decision is final (the API has no undo), so it asks once before it is sent.
  const [asking, setAsking] = useState<boolean | null>(null);
  const st = STATUS[d.status];
  return (
    <article className="nx-dr-card" id={`fix-draft-${d.rule_id}`} aria-label={d.rule_id} data-testid={`fix-draft-${d.rule_id}`}>
      <header className="nx-dr-cardhead">
        <h3 className="nx-dr-h3"><Code code={d.rule_id} text={d.rule_text} /></h3>
        <span className="nx-dr-tags" data-testid={`fix-status-${d.rule_id}`}>
          <Chip tone={st.tone}>{st.text()}</Chip>
          <Chip tone={d.source === "llm" ? "aletheia" : "neutral"}>{d.source === "llm" ? t("Drafted by the model") : t("Drafted by rule")}</Chip>
        </span>
      </header>
      <p className="nx-dr-line">
        {d.module ? <Chip tone="accent">{moduleText(d.module)}</Chip> : null}
        <Code code={d.field} text={d.field_text} />
        <span className="nx-dr-meta">{t("{n} failing values", { n: int(s.total_failing) })}</span>
      </p>
      <h4 className="nx-dr-h4">{t("Drafted steps")}</h4>
      <ol className="nx-dr-steps" data-testid={`fix-steps-${d.rule_id}`}>
        {d.steps.map((x, i) => <li key={i}><Code code={String(x.op)} text={opText(String(x.op))} /></li>)}
      </ol>
      {v ? (
        <div className="nx-dr-proof" data-testid={`fix-proof-${d.rule_id}`}>
          <h4 className="nx-dr-h4">{t("Verification on your extraction")}</h4>
          <StackedBar
            label={t("Verification of the drafted steps")}
            segs={[
              { id: "fixed", label: t("Fixed"), value: v.fixed, tone: "good" },
              { id: "rejected", label: t("Rejected"), value: v.rejected, tone: "warn" },
              { id: "still", label: t("Still failing"), value: v.still_failing, tone: "bad" },
            ]}
          />
          <p className="nx-dr-legend">
            <span>{t("{n} fixed", { n: int(v.fixed) })}</span>
            <span>{t("{n} rejected by the rule after the fix", { n: int(v.rejected) })}</span>
            <span>{t("{n} still failing", { n: int(v.still_failing) })}</span>
            <span>{t("{n} passing values changed", { n: int(v.touched_passing + v.broken) })}</span>
          </p>
        </div>
      ) : null}
      <details className="nx-dr-more">
        <summary>{t("What the failing values look like")}</summary>
        <h4 className="nx-dr-h4">{t("Aggregated shape")}</h4>
        <StackedBar
          label={t("Shapes of the failing values")}
          segs={s.masks.slice(0, 5).map((x, i) => ({ id: x.mask, label: t("Shape {mask}: {n} values", { mask: x.mask, n: int(x.count) }), value: x.count, tone: MASK_TONES[i % MASK_TONES.length] }))}
        />
        <p className="nx-dr-legend">{s.masks.slice(0, 5).map((x) => <span key={x.mask}>{t("Shape {mask}: {n} values", { mask: x.mask, n: int(x.count) })}</span>)}</p>
        <p className="nx-dr-meta">
          {t("{lead} with leading spaces, {trail} with trailing spaces, {inner} with inner spaces", { lead: int(s.leading_ws), trail: int(s.trailing_ws), inner: int(s.inner_ws) })}
          {" "}{Object.entries(s.legend).map(([k, x]) => `${k} ${x}`).join(", ")}
        </p>
      </details>
      {d.errors.length ? <p className="nx-dr-meta">{d.errors.join(" ")}</p> : null}
      {allowed && d.status === "pending" ? (
        <div className="nx-dr-acts">
          <p className="nx-dr-meta">{t("Approving makes these steps the rule's fix. Nothing in SAP changes until a cleansing run uses it.")}</p>
          <Button variant="primary" disabled={busy} onClick={() => setAsking(true)} data-testid={`fix-approve-${d.rule_id}`}>{t("Approve")}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setAsking(false)} data-testid={`fix-reject-${d.rule_id}`}>{t("Reject")}</Button>
        </div>
      ) : null}
      <Confirm
        open={asking !== null}
        title={t("Confirm the decision")}
        consequence={asking ? t("Approve this fix for {rule}? This cannot be undone here.", { rule: d.rule_id }) : t("Reject this fix for {rule}? This cannot be undone here.", { rule: d.rule_id })}
        confirmLabel={asking ? t("Yes, approve") : t("Yes, reject")}
        danger={asking === false}
        onConfirm={() => { if (asking !== null) onDecide(d.rule_id, asking); setAsking(null); }}
        onCancel={() => setAsking(null)}
      />
    </article>
  );
}

export function WorkDrafts() {
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
    onSuccess: (d) => { toast({ text: d.status === "approved" ? t("Fix approved. The steps are now the rule's fix.") : t("Fix rejected."), tone: "good" }); refresh(); },
    onError: (e) => toast({ text: errorSentence(e, t("The decision could not be saved.")), tone: "bad" }),
  });
  const drafts = q.data?.drafts ?? [];
  const pending = drafts.filter((d) => d.status === "pending");
  const decided = (k: FixDraft["status"]) => drafts.filter((d) => d.status === k).length;
  return (
    <div className="nx-dr" data-testid="fix-drafts">
      <header className="nx-dr-hero">
        <p className="nx-dr-eyebrow">{t("Aletheia verified fixes")}</p>
        <h1 className="nx-dr-title">{t("{n, plural, one {# drafted fix waits for a decision} other {# drafted fixes wait for a decision}}", { n: pending.length })}</h1>
        <p className="nx-dr-lede">{t("The drafter sees only the shape of the failing values, never a value. Each draft is proved on your extraction first, and nothing applies until a steward approves it.")}</p>
        {pending.length ? <a className="nx-btn nx-btn-primary" href={`#fix-draft-${pending[0].rule_id}`} data-testid="fix-primary">{t("Review the first pending draft")}</a> : null}
      </header>
      <div className="nx-dr-stats">
        <StatCard label={t("Pending")} value={pending.length} />
        <StatCard label={t("Drafts")} value={drafts.length} />
        <StatCard label={t("Approved")} value={decided("approved")} />
        <StatCard label={t("Rejected")} value={decided("rejected")} />
      </div>
      <Stepper
        label={t("Fix steps")}
        steps={[
          { id: "rule", label: t("Choose the rule"), state: pending.length ? "done" : "current", detail: t("Enter the object and the rule that fails.") },
          { id: "draft", label: t("Draft the fix"), state: pending.length ? "done" : "future", detail: t("Aletheia proposes steps from the shape of the failing values.") },
          { id: "proof", label: t("See the proof"), state: pending.length ? "done" : "future", detail: t("The steps are tried on your extraction first.") },
          { id: "decide", label: t("Approve or reject"), state: pending.length ? "current" : "future", detail: t("A steward decides. Approved steps become the rule's fix.") },
        ]}
      />
      <p className="nx-dr-lede">{t("This page drafts a fix for a rule that has none. A draft is proved on the latest extraction, then waits for a steward. Read the coverage, review the pending drafts, approve or reject.")}</p>
      <section className="nx-dr-sheet" aria-label={t("Drafts")} data-testid="fix-drafts-list">
        <h2 className="nx-dr-h">{t("Drafts")}</h2>
        <p className="nx-dr-meta">{t("Approve or reject. A rejected draft is kept in the audit log.")}</p>
        {allowed ? <DraftForm onDone={refresh} /> : <p className="nx-dr-gate" data-testid="fix-gate">{t("Managing rules needs the manage rules permission.")}</p>}
        <QueryView loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} empty={drafts.length === 0} emptyHeading={t("Drafts")} emptyText={t("No fix is drafted yet. Enter an object and a rule above, then choose Draft and verify.")} label={t("Aletheia verified fixes")}>
          <div className="nx-dr-list" aria-label={t("Drafted fixes, scrollable")}>
            {drafts.map((d) => <Card key={d.rule_id} d={d} allowed={allowed} busy={decide.isPending} onDecide={(id, ok) => decide.mutate({ id, ok })} />)}
          </div>
        </QueryView>
      </section>
      <Coverage />
    </div>
  );
}
