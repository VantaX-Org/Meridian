"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getApprovalSetting, getSurvivorship, getSurvivorshipAccuracy, postSurvivorshipBulkApprove, postSurvivorshipDecision, putApprovalSetting,
  type ReasonCode, type SurvivorshipAccuracy, type SurvivorshipPick,
} from "@/lib/api/v2/aletheia-survivorship";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int, pct1 } from "@/lib/v2/score";
import { ChartFrame, ChartTable, StackedBar, TrendChart, type StackPart } from "../charts";
import { Coded, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { Lede } from "../RunParts";
import { VerifiedMark } from "./rules-parts";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Aletheia verified survivorship: when no survivorship rule decides a golden-record field, the model is asked to pick
 * a source. It sees only the shape of each source's value, never a value, a preview or a hash. The server then proves
 * the pick (the source exists, its value is not blank, the confidence is valid); a pick that fails does not win.
 */

const CHECK_TEXT: Record<string, () => string> = {
  SOURCE_KNOWN: () => t("The source is one of the contributors"),
  VALUE_PRESENT: () => t("The source's value is not blank"),
  CONFIDENCE_VALID: () => t("The confidence is between 0 and 1"),
};

const REASON_TEXT: Record<ReasonCode, () => string> = {
  wrong_source: () => t("This source is not the right one for the field"),
  stale_value: () => t("The picked value is out of date"),
  incomplete_value: () => t("The picked value is incomplete"),
  format_issue: () => t("The picked value is in the wrong format"),
  other: () => t("Another reason"),
};
const REASONS = Object.keys(REASON_TEXT) as ReasonCode[];

/** A candidate is its source and the shape of its value; the value itself never reaches the screen. */
function shapeText(c: { shape: string; length: number; blank: boolean }): string {
  return c.blank ? t("Blank") : t("Shape {shape}, {n} characters", { shape: c.shape, n: int(c.length) });
}

function Decide({ p, queryKeys }: { p: SurvivorshipPick; queryKeys: unknown[][] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [reason, setReason] = useState<ReasonCode | "">("");
  const send = useMutation({
    mutationFn: (override: boolean) => postSurvivorshipDecision({
      domain: p.domain, sap_object_key: p.sap_object_key, field: p.field, decision: override ? "override" : "accept",
      ...(override ? { source_system: source, ...(reason ? { reason_code: reason } : {}) } : {}),
    }),
    onSuccess: () => {
      setOpen(false);
      for (const queryKey of queryKeys) void qc.invalidateQueries({ queryKey });
    },
  });
  if (p.state !== "pending") {
    const text = p.state === "accepted" ? t("Accepted by a steward")
      : p.state === "rejected" ? t("Rejected by a steward: {reason}", { reason: p.note ?? "" })
        : t("Overridden to {source}", { source: p.decided_source ?? "" });
    return <p className="m2-meta" data-testid={`surv-state-${p.sap_object_key}-${p.field}`}>{text}{p.reason_code && p.reason_code in REASON_TEXT ? <> <Coded code={p.reason_code} text={REASON_TEXT[p.reason_code as ReasonCode]()} /></> : null}</p>;
  }
  if (!p.candidates.length) return null;
  const others = p.candidates.filter((c) => !c.picked);
  return (
    <div>
      <button type="button" className="m2-btn m2-sm" disabled={send.isPending} onClick={() => send.mutate(false)}>{t("Accept the pick")}</button>{" "}
      <button type="button" className="m2-btn m2-sm" disabled={send.isPending} aria-expanded={open} onClick={() => setOpen(!open)}>{t("Override")}</button>
      {open ? (
        <fieldset className="m2-fld">
          <legend>{t("Use another source")}</legend>
          {others.map((c) => (
            <label key={c.source_system} style={{ display: "block" }}>
              <input type="radio" name={`src-${p.sap_object_key}-${p.field}`} value={c.source_system} checked={source === c.source_system} onChange={() => setSource(c.source_system)} />{" "}
              <Coded code={c.source_system} text={shapeText(c)} />
            </label>
          ))}
          <label>
            {t("Reason")}{" "}
            <select value={reason} onChange={(e) => setReason(e.target.value as ReasonCode | "")} aria-label={t("Reason for the override")}>
              <option value="">{t("No reason given")}</option>
              {REASONS.map((r) => <option key={r} value={r}>{`${r}: ${REASON_TEXT[r]()}`}</option>)}
            </select>
          </label>{" "}
          <button type="button" className="m2-btn m2-sm" disabled={!source || send.isPending} onClick={() => send.mutate(true)}>{t("Override with this source")}</button>
        </fieldset>
      ) : null}
      {send.isError ? <span role="alert" className="m2-meta"> {failureText(send.error)}</span> : null}
    </div>
  );
}

function Pick({ p, queryKeys }: { p: SurvivorshipPick; queryKeys: unknown[][] }) {
  const { can } = useV2Session();
  return (
    <article className="m2-ck-panel" aria-label={`${p.sap_object_key} ${p.field}`} data-testid={`surv-pick-${p.sap_object_key}-${p.field}`}>
      <header className="m2-ck-head">
        <h3 className="m2-h2"><Coded code={p.field} text={p.field_text} /></h3>
        <span className="m2-meta">{p.verified ? t("Proved, the pick won") : t("Not proved, the pick did not win")}</span>
      </header>
      <p>{moduleText(p.domain)} <span className="m2-meta">{p.sap_object_key}</span> {t("Model picked {source}", { source: p.recommended_source })}</p>
      {p.reasoning ? <p className="m2-meta">{p.reasoning}</p> : null}
      <ul className="m2-cl-changes">
        {p.checks.map((c) => (
          <li key={c.code}><Coded code={c.code} text={CHECK_TEXT[c.code]?.()} /> <span className="m2-meta">{c.passed ? t("Passed") : t("Failed")}</span></li>
        ))}
      </ul>
      {p.verified && can("approve") && !held(p) ? <Decide p={p} queryKeys={queryKeys} /> : null}
    </article>
  );
}

/** A proved pick the approval policy held back: it is not applied until a steward approves it, so it sits in the queue. */
const held = (p: SurvivorshipPick) => p.verified && !p.applied && p.state === "pending" && p.candidates.length > 0;

/** One proposed pick: the field, the shape each source showed the model, the checks, the confidence, and the decision. */
function QueueRow({ p, queryKeys, selected, onSelect }: { p: SurvivorshipPick; queryKeys: unknown[][]; selected: boolean; onSelect: (on: boolean) => void }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const send = useMutation({
    mutationFn: (reject: boolean) => postSurvivorshipDecision({
      domain: p.domain, sap_object_key: p.sap_object_key, field: p.field, decision: reject ? "reject" : "accept", ...(reject ? { note: why.trim() } : {}),
    }),
    onSuccess: () => { for (const queryKey of queryKeys) void qc.invalidateQueries({ queryKey }); },
  });
  const id = `${p.sap_object_key}-${p.field}`;
  return (
    <article className="m2-ck-panel" aria-label={`${p.sap_object_key} ${p.field}`} data-testid={`surv-queue-${id}`}>
      <header className="m2-ck-head">
        <h3 className="m2-h2">
          <label>
            <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={t("Select {field} on {key}", { field: p.field, key: p.sap_object_key })} />{" "}
            <Coded code={p.field} text={p.field_text} />
          </label>
        </h3>
        <span className="m2-meta">{p.confidence == null ? t("No confidence") : t("Confidence {pct}", { pct: pct1(p.confidence) })}</span>
      </header>
      <p>{moduleText(p.domain)} <span className="m2-meta">{p.sap_object_key}</span> {t("Model picked {source}", { source: p.recommended_source })}</p>
      {p.reasoning ? <p className="m2-meta">{p.reasoning}</p> : null}
      <ul className="m2-cl-changes" aria-label={t("What the model saw")}>
        {p.candidates.map((c) => (
          <li key={c.source_system}><Coded code={c.source_system} text={shapeText(c)} />{c.picked ? <> <span className="m2-meta">{t("Picked")}</span></> : null}</li>
        ))}
      </ul>
      <ul className="m2-cl-changes" aria-label={t("Checks the server ran")}>
        {p.checks.map((c) => (
          <li key={c.code}><Coded code={c.code} text={CHECK_TEXT[c.code]?.()} /> <span className="m2-meta">{c.passed ? t("Passed") : t("Failed")}</span></li>
        ))}
      </ul>
      <button type="button" className="m2-btn m2-sm" disabled={send.isPending} onClick={() => send.mutate(false)}>{t("Approve")}</button>{" "}
      <button type="button" className="m2-btn m2-sm" disabled={send.isPending} aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}>{t("Reject")}</button>
      {rejecting ? (
        <fieldset className="m2-fld">
          <legend>{t("Why is this pick rejected")}</legend>
          <label>
            {t("Reason")}{" "}
            <input type="text" value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} aria-label={t("Reason for the rejection")} />
          </label>{" "}
          <button type="button" className="m2-btn m2-sm" disabled={!why.trim() || send.isPending} onClick={() => send.mutate(true)}>{t("Reject this pick")}</button>
        </fieldset>
      ) : null}
      {send.isError ? <p role="alert" className="m2-meta">{failureText(send.error)}</p> : null}
    </article>
  );
}

/** Proposed picks wait here. Approving applies the pick to the golden record; rejecting keeps the value the rules chose. */
function ApprovalQueue({ picks, queryKeys }: { picks: SurvivorshipPick[]; queryKeys: unknown[][] }) {
  const qc = useQueryClient();
  const { can } = useV2Session();
  const [chosen, setChosen] = useState<string[]>([]);
  const queue = picks.filter(held);
  const idOf = (p: SurvivorshipPick) => `${p.domain}|${p.sap_object_key}|${p.field}`;
  const bulk = useMutation({
    mutationFn: () => postSurvivorshipBulkApprove(queue.filter((p) => chosen.includes(idOf(p))).map(({ domain, sap_object_key, field }) => ({ domain, sap_object_key, field }))),
    onSuccess: () => { setChosen([]); for (const queryKey of queryKeys) void qc.invalidateQueries({ queryKey }); },
  });
  const allowed = can("approve");
  return (
    <Panel title={t("Picks waiting for a steward")} meta={t("A proved pick is not applied to the golden record until a steward other than the one who ran it approves it.")} testId="survivorship-queue">
      {queue.length === 0 ? <EmptyFrame>{t("No pick is waiting for approval.")}</EmptyFrame> : (
        <>
          {allowed ? (
            <p>
              <button type="button" className="m2-btn m2-sm" disabled={chosen.length === 0 || bulk.isPending} onClick={() => bulk.mutate()}>{t("Approve selected ({n})", { n: int(chosen.length) })}</button>
              {bulk.data && bulk.data.failed.length ? (
                <span role="alert" className="m2-meta" data-testid="surv-bulk-failed"> {t("{n, plural, one {# pick was not approved} other {# picks were not approved}}", { n: bulk.data.failed.length })}: {bulk.data.failed.map((f) => `${f.sap_object_key} ${f.field} ${f.detail}`).join("; ")}</span>
              ) : null}
              {bulk.isError ? <span role="alert" className="m2-meta"> {failureText(bulk.error)}</span> : null}
            </p>
          ) : <p className="m2-meta" data-testid="surv-queue-reason">{t("Approving a pick needs the approve permission. You can read the queue.")}</p>}
          <ScrollFrame label={t("Picks waiting for approval, scrollable")}>
            {queue.map((p) => allowed
              ? <QueueRow key={idOf(p)} p={p} queryKeys={queryKeys} selected={chosen.includes(idOf(p))} onSelect={(on) => setChosen(on ? [...chosen, idOf(p)] : chosen.filter((x) => x !== idOf(p)))} />
              : <Pick key={idOf(p)} p={p} queryKeys={queryKeys} />)}
          </ScrollFrame>
        </>
      )}
    </Panel>
  );
}

/** The tenant setting survivorship_ai_approval: on by default, a proved AI pick waits for a steward before it applies. Off is an opt-in auto-approve. */
function ApprovalSetting() {
  const fixture = useFixture();
  const qc = useQueryClient();
  const { can } = useV2Session();
  const key = ["survivorship-approval", fixture];
  const q = useQuery({ queryKey: key, queryFn: getApprovalSetting, staleTime: 15_000 });
  const save = useMutation({ mutationFn: putApprovalSetting, onSuccess: (v) => qc.setQueryData(key, v) });
  const allowed = can("manage_settings");
  const required = q.data?.required;
  return (
    <Panel title={t("Steward approval of AI picks")} meta={t("survivorship_ai_approval: on by default. Turning it off is an opt-in auto-approve.")} testId="survivorship-approval">
      {q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The approval setting could not be read.")}</ErrorFrame> : (
        <>
          <p data-testid="surv-approval-current">
            {t("Current value")}{" "}
            {required === undefined ? "" : <Coded code={required ? "required" : "not_required"} text={required ? t("A steward must approve each AI pick") : t("Auto-approve is on: proved AI picks apply at once")} />}
          </p>
          <ul className="m2-cl-changes">
            <li><Coded code="required" text={t("A proved AI pick waits for a steward to accept it before it is applied.")} /></li>
            <li><Coded code="not_required" text={t("Opt-in auto-approve: a proved AI pick is applied at once; stewards can still override it later.")} /></li>
          </ul>
          <label>
            <input type="checkbox" checked={Boolean(required)} disabled={!allowed || q.isPending || save.isPending} onChange={(e) => save.mutate({ required: e.target.checked })} />{" "}
            {t("Require steward approval")}
          </label>
          {!allowed ? <p className="m2-meta" data-testid="surv-approval-reason">{t("Changing this needs the manage settings permission. You can read it.")}</p> : null}
          {save.isError ? <p role="alert" className="m2-meta">{failureText(save.error)}</p> : null}
        </>
      )}
    </Panel>
  );
}

function Accuracy({ a }: { a: SurvivorshipAccuracy }) {
  const points = a.by_week.map((w) => {
    const label = formatDate(w.week, "date");
    const value = w.acceptance_rate == null ? null : Math.round(w.acceptance_rate * 1000) / 10;
    return { id: w.week, label, title: t("{label}: {rate} accepted", { label, rate: pct1(w.acceptance_rate) }), value };
  });
  const parts = (c: { accepted: number; overridden: number; pending: number }): StackPart[] => [
    { key: "a", label: t("Accepted"), value: c.accepted, colour: "--m2-chart-3", title: t("{n} accepted", { n: int(c.accepted) }) },
    { key: "o", label: t("Overridden"), value: c.overridden, colour: "--m2-sev-crit", title: t("{n} overridden", { n: int(c.overridden) }) },
    { key: "p", label: t("Waiting"), value: c.pending, colour: "--m2-chart-1", title: t("{n} waiting", { n: int(c.pending) }) },
  ];
  return (
    <Panel title={t("How often stewards keep the pick")} meta={t("Accepted and overridden decisions on proved picks. Waiting picks have no decision yet.")} testId="survivorship-accuracy">
      <p data-testid="surv-rates">
        {t("Accepted {a}, overridden {o}, waiting {p}", { a: pct1(a.acceptance_rate), o: pct1(a.override_rate), p: int(a.pending) })}
      </p>
      <ChartFrame
        title={t("Accepted picks, week by week")}
        sub={t("The share of decided picks a steward kept")}
        height={160}
        level={2}
        state={points.length < 2 ? "empty" : "ready"}
        empty={t("Two weeks of decisions are needed to draw a trend.")}
        testId="surv-trend"
        table={<ChartTable caption={t("Accepted picks by week")} head={[t("Week"), t("Accepted")]} rows={points.map((p) => [p.label, pct1(p.value == null ? null : p.value / 100)])} />}
      >
        <TrendChart points={points} domain={[0, 100] as const} ticks={[0, 50, 100]} height={160} label={t("Accepted picks by week")} yLabel={t("percent")} format={(v) => `${v}%`} />
      </ChartFrame>
      <ul className="m2-cl-changes" data-testid="surv-by-field">
        {a.by_field.map((f) => (
          <li key={`${f.domain}-${f.field}`}>
            <strong><Coded code={f.field} text={f.field_text} /></strong>{" "}
            <span className="m2-meta">{pct1(f.acceptance_rate)}</span>
            <StackedBar parts={parts(f)} label={t("Decisions on {field}", { field: f.field })} format={int} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function AletheiaSurvivorship() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["survivorship", fixture], queryFn: getSurvivorship, staleTime: 15_000 });
  const acc = useQuery({ queryKey: ["survivorship-accuracy", fixture], queryFn: getSurvivorshipAccuracy, staleTime: 15_000 });
  const queryKeys = [["survivorship", fixture], ["survivorship-accuracy", fixture]];
  if (q.isPending) return <CcPage title={t("Aletheia verified survivorship")}><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) return <CcPage title={t("Aletheia verified survivorship")}><ErrorFrame onRetry={() => void q.refetch()}>{t("The survivorship picks could not be read.")}</ErrorFrame></CcPage>;
  const { domains, picks, counts } = q.data;
  const decided = picks.filter((p) => !held(p));
  const verified = domains.reduce((n, d) => n + d.verified, 0);
  const rejected = domains.reduce((n, d) => n + d.rejected, 0);
  return (
    <CcPage title={t("Aletheia verified survivorship")}>
      <Lede>{t("When duplicate records disagree, the model picks which source wins for each field and the server proves the pick. Review the picks that wait for a steward below.")}</Lede>
      <CcBanner
        testId="survivorship"
        label={t("Aletheia verified survivorship")}
        eyebrow={t("Aletheia verified survivorship")}
        headline={t("{n, plural, one {# model pick did not pass its proof} other {# model picks did not pass their proof}}", { n: rejected })}
        why={t("The model sees only the shape of each source's value, never a value. A pick wins only when the server proves it against the contributing sources.")}
        figs={[
          { label: t("Proved"), value: int(verified), hint: t("Picks the server checked against the contributing sources and confirmed.") },
          { label: t("Not proved"), value: int(rejected), hint: t("Picks the server could not confirm. They are never applied.") },
          { label: t("Waiting for a steward"), value: int(counts.proposed), hint: t("Proved picks that need a person to approve them.") },
        ]}
      />
      <p className="m2-why1"><VerifiedMark /> {t("Only picks the server proved against the sources carry this mark.")}</p>
      <Panel title={t("Steward decisions on proved picks")} meta={t("Proposed picks wait for a steward. Auto-applied picks were applied under the opt-in auto-approve.")} testId="survivorship-counts">
        <ul className="m2-cl-changes" data-testid="surv-counts">
          <li data-testid="surv-count-proposed"><Coded code="proposed" text={t("Proposed, waiting for approval")} /> <strong>{int(counts.proposed)}</strong></li>
          <li data-testid="surv-count-approved"><Coded code="approved" text={t("Approved by a steward")} /> <strong>{int(counts.approved)}</strong></li>
          <li data-testid="surv-count-rejected"><Coded code="rejected" text={t("Rejected by a steward")} /> <strong>{int(counts.rejected)}</strong></li>
          <li data-testid="surv-count-auto"><Coded code="auto_applied" text={t("Applied by auto-approve")} /> <strong>{int(counts.auto_applied)}</strong></li>
        </ul>
      </Panel>
      <ApprovalQueue picks={picks} queryKeys={queryKeys} />
      <Panel title={t("Picks by object")} meta={t("Model picks that were proved and that were not.")} testId="survivorship-domains">
        {domains.length === 0 ? <EmptyFrame>{t("The model has not picked a winner yet.")}</EmptyFrame> : (
          <ul className="m2-cl-changes">
            {domains.map((d) => {
              const parts: StackPart[] = [
                { key: "ok", label: t("Proved"), value: d.verified, colour: "--m2-chart-3", title: t("{n} proved", { n: int(d.verified) }) },
                { key: "no", label: t("Not proved"), value: d.rejected, colour: "--m2-sev-crit", title: t("{n} not proved", { n: int(d.rejected) }) },
              ];
              return (
                <li key={d.domain} data-testid={`surv-domain-${d.domain}`}>
                  <strong>{moduleText(d.domain)}</strong>
                  <StackedBar parts={parts} label={t("Model picks in {object}", { object: moduleText(d.domain) })} format={int} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <ApprovalSetting />
      {acc.data ? <Accuracy a={acc.data} /> : null}
      <Panel title={t("Newest picks")} meta={t("Each pick with the checks the server ran.")} testId="survivorship-picks">
        {decided.length === 0 ? <EmptyFrame>{t("The model has not picked a winner yet.")}</EmptyFrame> : (
          <ScrollFrame label={t("Model picks, scrollable")}>
            {decided.map((p) => <Pick key={`${p.sap_object_key}-${p.field}`} p={p} queryKeys={queryKeys} />)}
          </ScrollFrame>
        )}
      </Panel>
    </CcPage>
  );
}
