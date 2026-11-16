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
import { Button, Code, EmptyState, Stepper, useToast, type StepItem } from "../kit";
import { ChartCard } from "../more/ChartCard";
import { QueryView } from "../more/states";
import { AreaTrend, StackedBar, type Seg } from "../viz";
import { Banner, Block, HBars, Mark, status } from "./parts";

/**
 * Aletheia verified survivorship: when no survivorship rule decides a golden-record field, the model picks a source.
 * It sees only the shape of each source's value, never a value. The server proves the pick; a pick that fails never wins.
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

const shapeText = (c: { shape: string; length: number; blank: boolean }) =>
  c.blank ? t("Blank") : t("Shape {shape}, {n} characters", { shape: c.shape, n: int(c.length) });

/** A proved pick the approval policy held back: not applied until a steward approves it. */
const held = (p: SurvivorshipPick) => p.verified && !p.applied && p.state === "pending" && p.candidates.length > 0;
const idOf = (p: SurvivorshipPick) => `${p.domain}|${p.sap_object_key}|${p.field}`;

type Keys = unknown[][];

function useRefresh(keys: Keys) {
  const qc = useQueryClient();
  return () => { for (const queryKey of keys) void qc.invalidateQueries({ queryKey }); };
}

function Checks({ p }: { p: SurvivorshipPick }) {
  return (
    <ul className="nx-ins-list" aria-label={t("Checks the server ran")}>
      {p.checks.map((c) => (
        <li key={c.code}><Code code={c.code} text={CHECK_TEXT[c.code]?.()} /> <span className="nx-sub">{c.passed ? t("Passed") : t("Failed")}</span></li>
      ))}
    </ul>
  );
}

function Decide({ p, keys }: { p: SurvivorshipPick; keys: Keys }) {
  const refresh = useRefresh(keys);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [reason, setReason] = useState<ReasonCode | "">("");
  const send = useMutation({
    mutationFn: (override: boolean) => postSurvivorshipDecision({
      domain: p.domain, sap_object_key: p.sap_object_key, field: p.field, decision: override ? "override" : "accept",
      ...(override ? { source_system: source, ...(reason ? { reason_code: reason } : {}) } : {}),
    }),
    onSuccess: (r) => {
      setOpen(false);
      refresh();
      toast({ tone: "good", text: r.decision === "override" ? t("Overridden to {source}", { source: r.new_source }) : t("Accepted by a steward") });
    },
  });
  if (p.state !== "pending") {
    const text = p.state === "accepted" ? t("Accepted by a steward")
      : p.state === "rejected" ? t("Rejected by a steward: {reason}", { reason: p.note ?? "" })
        : t("Overridden to {source}", { source: p.decided_source ?? "" });
    return (
      <p className="nx-sub" data-testid={`surv-state-${p.sap_object_key}-${p.field}`}>
        {text}{p.reason_code && p.reason_code in REASON_TEXT ? <> <Code code={p.reason_code} text={REASON_TEXT[p.reason_code as ReasonCode]()} /></> : null}
      </p>
    );
  }
  if (!p.candidates.length) return null;
  const others = p.candidates.filter((c) => !c.picked);
  return (
    <div className="nx-ins-actions">
      <Button size={32} loading={send.isPending} onClick={() => send.mutate(false)}>{t("Accept the pick")}</Button>
      <Button size={32} variant="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{t("Override")}</Button>
      {open ? (
        <fieldset className="nx-ins-fieldset">
          <legend className="nx-field">{t("Use another source")}</legend>
          {others.map((c) => (
            <label key={c.source_system} className="nx-ins-radio">
              <input type="radio" name={`src-${p.sap_object_key}-${p.field}`} value={c.source_system} checked={source === c.source_system} onChange={() => setSource(c.source_system)} />
              <Code code={c.source_system} text={shapeText(c)} />
            </label>
          ))}
          <label className="nx-field">
            {t("Reason")}
            <select className="nx-input" value={reason} onChange={(e) => setReason(e.target.value as ReasonCode | "")} aria-label={t("Reason for the override")}>
              <option value="">{t("No reason given")}</option>
              {REASONS.map((r) => <option key={r} value={r}>{`${r}: ${REASON_TEXT[r]()}`}</option>)}
            </select>
          </label>
          <Button size={32} variant="primary" disabled={!source} loading={send.isPending} onClick={() => send.mutate(true)}>{t("Override with this source")}</Button>
        </fieldset>
      ) : null}
      {send.isError ? <p role="alert" className="nx-sub">{failureText(send.error)}</p> : null}
    </div>
  );
}

function PickHead({ p, lead }: { p: SurvivorshipPick; lead?: React.ReactNode }) {
  return (
    <>
      <header className="nx-ins-card-head">
        <h3>{lead}<Code code={p.field} text={p.field_text ?? undefined} /></h3>
        <span className="nx-sub">
          {p.confidence == null ? t("No confidence") : t("Confidence {pct}", { pct: pct1(p.confidence) })}
        </span>
      </header>
      <p>{moduleText(p.domain)} <span className="nx-sub">{p.sap_object_key}</span> {t("Model picked {source}", { source: p.recommended_source })}</p>
      {p.reasoning ? <p className="nx-sub">{p.reasoning}</p> : null}
    </>
  );
}

function Pick({ p, keys }: { p: SurvivorshipPick; keys: Keys }) {
  const { can } = useV2Session();
  return (
    <article className="nx-card nx-ins-card" aria-label={`${p.sap_object_key} ${p.field}`} data-testid={`surv-pick-${p.sap_object_key}-${p.field}`}>
      <PickHead p={p} />
      <p className="nx-sub">{p.verified ? <><Mark /> {t("Proved, the pick won")}</> : t("Not proved, the pick did not win")}</p>
      <Checks p={p} />
      {p.verified && can("approve") && !held(p) ? <Decide p={p} keys={keys} /> : null}
    </article>
  );
}

/** One proposed pick: the shape each source showed the model, the checks, the confidence, and the decision. */
function QueueRow({ p, keys, selected, onSelect }: { p: SurvivorshipPick; keys: Keys; selected: boolean; onSelect: (on: boolean) => void }) {
  const refresh = useRefresh(keys);
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const send = useMutation({
    mutationFn: (reject: boolean) => postSurvivorshipDecision({
      domain: p.domain, sap_object_key: p.sap_object_key, field: p.field, decision: reject ? "reject" : "accept", ...(reject ? { note: why.trim() } : {}),
    }),
    onSuccess: (r) => {
      refresh();
      toast({ tone: r.decision === "reject" ? "neutral" : "good", text: r.decision === "reject" ? t("Rejected by a steward: {reason}", { reason: why.trim() }) : t("Accepted by a steward") });
    },
  });
  return (
    <article className="nx-card nx-ins-card" aria-label={`${p.sap_object_key} ${p.field}`} data-testid={`surv-queue-${p.sap_object_key}-${p.field}`}>
      <PickHead p={p} lead={
        <input type="checkbox" className="nx-check" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={t("Select {field} on {key}", { field: p.field, key: p.sap_object_key })} />
      } />
      <ul className="nx-ins-list" aria-label={t("What the model saw")}>
        {p.candidates.map((c) => (
          <li key={c.source_system}><Code code={c.source_system} text={shapeText(c)} />{c.picked ? <> <span className="nx-sub">{t("Picked")}</span></> : null}</li>
        ))}
      </ul>
      <Checks p={p} />
      <div className="nx-ins-actions">
        <Button size={32} variant="primary" loading={send.isPending && !rejecting} onClick={() => send.mutate(false)}>{t("Approve")}</Button>
        <Button size={32} variant="quiet" aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}>{t("Reject")}</Button>
      </div>
      {rejecting ? (
        <fieldset className="nx-ins-fieldset">
          <legend className="nx-field">{t("Why is this pick rejected")}</legend>
          <label className="nx-field">
            {t("Reason")}
            <input className="nx-input" type="text" value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} aria-label={t("Reason for the rejection")} />
          </label>
          <Button size={32} variant="danger" disabled={!why.trim()} loading={send.isPending} onClick={() => send.mutate(true)}>{t("Reject this pick")}</Button>
        </fieldset>
      ) : null}
      {send.isError ? <p role="alert" className="nx-sub">{failureText(send.error)}</p> : null}
    </article>
  );
}

function ApprovalQueue({ picks, keys }: { picks: SurvivorshipPick[]; keys: Keys }) {
  const refresh = useRefresh(keys);
  const toast = useToast();
  const { can } = useV2Session();
  const [chosen, setChosen] = useState<string[]>([]);
  const queue = picks.filter(held);
  const bulk = useMutation({
    mutationFn: () => postSurvivorshipBulkApprove(queue.filter((p) => chosen.includes(idOf(p))).map(({ domain, sap_object_key, field }) => ({ domain, sap_object_key, field }))),
    onSuccess: (r) => {
      setChosen([]);
      refresh();
      if (r.approved) toast({ tone: "good", text: t("{n, plural, one {# pick approved} other {# picks approved}}", { n: r.approved }) });
    },
  });
  const allowed = can("approve");
  return (
    <Block title={t("Picks waiting for a steward")} meta={t("A proved pick is not applied to the golden record until a steward other than the one who ran it approves it.")} testId="survivorship-queue">
      {queue.length === 0 ? <EmptyState icon="check" heading={t("No pick is waiting for approval.")} /> : (
        <>
          {allowed ? (
            <>
              <p className="nx-sub">{t("Approving applies the pick to the golden record. Rejecting keeps the value the rules chose and asks for a reason.")}</p>
              <div className="nx-ins-actions">
                <Button variant="primary" disabled={chosen.length === 0} loading={bulk.isPending} onClick={() => bulk.mutate()}>{t("Approve selected ({n})", { n: int(chosen.length) })}</Button>
                <Button variant="quiet" onClick={() => setChosen(chosen.length === queue.length ? [] : queue.map(idOf))}>
                  {chosen.length === queue.length ? t("Clear selection") : t("Select all")}
                </Button>
              </div>
              {bulk.data && bulk.data.failed.length ? (
                <p role="alert" className="nx-sub" data-testid="surv-bulk-failed">
                  {t("{n, plural, one {# pick was not approved} other {# picks were not approved}}", { n: bulk.data.failed.length })}: {bulk.data.failed.map((f) => `${f.sap_object_key} ${f.field} ${f.detail}`).join("; ")}
                </p>
              ) : null}
              {bulk.isError ? <p role="alert" className="nx-sub">{failureText(bulk.error)}</p> : null}
            </>
          ) : <p className="nx-sub" data-testid="surv-queue-reason">{t("Approving a pick needs the approve permission. You can read the queue.")}</p>}
          <div className="nx-ins-cards">
            {queue.map((p) => allowed
              ? <QueueRow key={idOf(p)} p={p} keys={keys} selected={chosen.includes(idOf(p))} onSelect={(on) => setChosen(on ? [...chosen, idOf(p)] : chosen.filter((x) => x !== idOf(p)))} />
              : <Pick key={idOf(p)} p={p} keys={keys} />)}
          </div>
        </>
      )}
    </Block>
  );
}

/** The tenant setting survivorship_ai_approval: on by default. Off is an opt-in auto-approve. */
function ApprovalSetting() {
  const fixture = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useV2Session();
  const key = ["survivorship-approval", fixture];
  const q = useQuery({ queryKey: key, queryFn: getApprovalSetting, staleTime: 15_000 });
  const save = useMutation({
    mutationFn: putApprovalSetting,
    onSuccess: (v) => {
      qc.setQueryData(key, v);
      toast({ tone: "good", text: v.required ? t("A steward must approve each AI pick") : t("Auto-approve is on: proved AI picks apply at once") });
    },
  });
  const allowed = can("manage_settings");
  const required = q.data?.required;
  return (
    <Block title={t("Steward approval of AI picks")} meta={t("survivorship_ai_approval: on by default. Turning it off is an opt-in auto-approve.")} testId="survivorship-approval">
      <QueryView loading={q.isPending} error={q.isError ? t("The approval setting could not be read.") : null} onRetry={() => void q.refetch()} empty={false} emptyHeading="" label={t("Steward approval of AI picks")}>
        <p data-testid="surv-approval-current">
          {t("Current value")}{" "}
          {required === undefined ? null : <Code code={required ? "required" : "not_required"} text={required ? t("A steward must approve each AI pick") : t("Auto-approve is on: proved AI picks apply at once")} />}
        </p>
        <ul className="nx-ins-list">
          <li><Code code="required" text={t("A proved AI pick waits for a steward to accept it before it is applied.")} /></li>
          <li><Code code="not_required" text={t("Opt-in auto-approve: a proved AI pick is applied at once; stewards can still override it later.")} /></li>
        </ul>
        <p className="nx-sub">{required === false
          ? t("Turning approval on makes new proved picks wait for a steward. Picks already applied stay applied.")
          : t("Turning approval off applies every new proved pick at once. Stewards can still override it later.")}</p>
        <label className="nx-ins-radio">
          <input type="checkbox" className="nx-check" checked={Boolean(required)} disabled={!allowed || save.isPending} onChange={(e) => save.mutate({ required: e.target.checked })} />
          {t("Require steward approval")}
        </label>
        {!allowed ? <p className="nx-sub" data-testid="surv-approval-reason">{t("Changing this needs the manage settings permission. You can read it.")}</p> : null}
        {save.isError ? <p role="alert" className="nx-sub">{failureText(save.error)}</p> : null}
      </QueryView>
    </Block>
  );
}

const splitSegs = (c: { accepted: number; overridden: number; pending: number }): Seg[] => [
  { id: "a", label: t("Accepted"), value: c.accepted, tone: "good" },
  { id: "o", label: t("Overridden"), value: c.overridden, tone: "bad" },
  { id: "p", label: t("Waiting"), value: c.pending, tone: "chart1" },
];

function Accuracy({ a }: { a: SurvivorshipAccuracy }) {
  const points = a.by_week.filter((w) => w.acceptance_rate != null).map((w) => ({ label: formatDate(w.week, "date"), value: Math.round((w.acceptance_rate as number) * 1000) / 10 }));
  return (
    <Block title={t("How often stewards keep the pick")} meta={t("Accepted and overridden decisions on proved picks. Waiting picks have no decision yet.")} testId="survivorship-accuracy">
      <p data-testid="surv-rates">{t("Accepted {a}, overridden {o}, waiting {p}", { a: pct1(a.acceptance_rate), o: pct1(a.override_rate), p: int(a.pending) })}</p>
      <div className="nx-chartcards">
        <ChartCard
          title={t("Accepted picks, week by week")}
          line={t("The share of decided picks a steward kept")}
          state={points.length < 2 ? "empty" : "ready"}
          emptyLine={t("Two weeks of decisions are needed to draw a trend.")}
          testId="surv-trend"
          figure={pct1(a.acceptance_rate)}
          chart={<AreaTrend points={points} label={t("Accepted picks by week")} height={120} empty={t("Two weeks of decisions are needed to draw a trend.")} />}
        />
        <ChartCard
          title={t("Decisions by object")}
          state={a.by_object.length === 0 ? "empty" : "ready"}
          emptyLine={t("The model has not picked a winner yet.")}
          chart={
            <ul className="nx-ins-list">
              {a.by_object.map((o) => (
                <li key={o.domain}><strong>{moduleText(o.domain)}</strong> <span className="nx-sub">{pct1(o.acceptance_rate)}</span><StackedBar segs={splitSegs(o)} label={t("Decisions on {field}", { field: moduleText(o.domain) })} /></li>
              ))}
            </ul>
          }
        />
      </div>
      <ul className="nx-ins-list" data-testid="surv-by-field">
        {a.by_field.map((f) => (
          <li key={`${f.domain}-${f.field}`}>
            <strong><Code code={f.field} text={f.field_text ?? undefined} /></strong> <span className="nx-sub">{pct1(f.acceptance_rate)}</span>
            <StackedBar segs={splitSegs(f)} label={t("Decisions on {field}", { field: f.field })} />
          </li>
        ))}
      </ul>
    </Block>
  );
}

export function Survivorship() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["survivorship", fixture], queryFn: getSurvivorship, staleTime: 15_000 });
  const acc = useQuery({ queryKey: ["survivorship-accuracy", fixture], queryFn: getSurvivorshipAccuracy, staleTime: 15_000 });
  const keys: Keys = [["survivorship", fixture], ["survivorship-accuracy", fixture]];
  const d = q.data;
  const verified = d ? d.domains.reduce((n, x) => n + x.verified, 0) : 0;
  const rejected = d ? d.domains.reduce((n, x) => n + x.rejected, 0) : 0;
  const current = d && d.counts.proposed > 0 ? 2 : 3;
  const labels = [t("Model picks a source"), t("Server proves the pick"), t("Steward approves"), t("Applied to the golden record")];
  const steps: StepItem[] = labels.map((label, i) => ({ id: String(i), label, state: i < current ? "done" : i === current ? "current" : "future" }));
  return (
    <div className="nx-body" data-testid="ins-survivorship">
      <p className="nx-sub">{t("When duplicate records disagree, the model picks which source wins for each field and the server proves the pick. Review the picks that wait for a steward below.")}</p>
      {q.isError && status(q.error) === 403 ? <p className="nx-sub" role="alert">{t("Your role cannot read the survivorship picks.")}</p> : (
      <QueryView loading={q.isPending} error={q.isError ? t("The survivorship picks could not be read.") : null} onRetry={() => void q.refetch()} empty={false} emptyHeading="" label={t("Aletheia verified survivorship")}>
        {d ? (
          <>
            <Banner
              testId="survivorship"
              eyebrow={t("Aletheia verified survivorship")}
              headline={t("{n, plural, one {# model pick did not pass its proof} other {# model picks did not pass their proof}}", { n: rejected })}
              why={t("The model sees only the shape of each source's value, never a value. A pick wins only when the server proves it against the contributing sources.")}
              figs={[
                { label: t("Proved"), value: verified, note: t("Picks the server checked against the contributing sources and confirmed.") },
                { label: t("Not proved"), value: rejected, note: t("Picks the server could not confirm. They are never applied.") },
                { label: t("Waiting for a steward"), value: d.counts.proposed, note: t("Proved picks that need a person to approve them.") },
              ]}
            />
            <div data-testid="surv-steps"><Stepper steps={steps} label={t("Where a pick is in the process")} /></div>
            <ApprovalQueue picks={d.picks} keys={keys} />
            <p className="nx-sub"><Mark /> {t("Only picks the server proved against the sources carry this mark.")}</p>
            <div className="nx-chartcards">
              <ChartCard
                title={t("Steward decisions on proved picks")}
                line={t("Proposed picks wait for a steward. Auto-applied picks were applied under the opt-in auto-approve.")}
                state="ready"
                emptyLine=""
                testId="survivorship-counts"
                chart={
                  <>
                    <HBars label={t("Decisions by outcome")} testId="surv-chart" bars={[
                      { key: "proposed", label: <span data-testid="surv-count-proposed"><Code code="proposed" text={t("Proposed, waiting for approval")} /></span>, value: d.counts.proposed, text: int(d.counts.proposed), tone: "warn" },
                      { key: "approved", label: <span data-testid="surv-count-approved"><Code code="approved" text={t("Approved by a steward")} /></span>, value: d.counts.approved, text: int(d.counts.approved), tone: "good" },
                      { key: "rejected", label: <span data-testid="surv-count-rejected"><Code code="rejected" text={t("Rejected by a steward")} /></span>, value: d.counts.rejected, text: int(d.counts.rejected), tone: "bad" },
                      { key: "auto", label: <span data-testid="surv-count-auto"><Code code="auto_applied" text={t("Applied by auto-approve")} /></span>, value: d.counts.auto_applied, text: int(d.counts.auto_applied) },
                    ]} />
                  </>
                }
              />
              <ChartCard
                title={t("Picks by object")}
                line={t("Model picks that were proved and that were not.")}
                state={d.domains.length === 0 ? "empty" : "ready"}
                emptyLine={t("The model has not picked a winner yet.")}
                testId="survivorship-domains"
                chart={
                  <ul className="nx-ins-list">
                    {d.domains.map((x) => (
                      <li key={x.domain} data-testid={`surv-domain-${x.domain}`}>
                        <strong>{moduleText(x.domain)}</strong>
                        <StackedBar label={t("Model picks in {object}", { object: moduleText(x.domain) })} segs={[
                          { id: "ok", label: t("Proved"), value: x.verified, tone: "good" },
                          { id: "no", label: t("Not proved"), value: x.rejected, tone: "bad" },
                        ]} />
                      </li>
                    ))}
                  </ul>
                }
              />
            </div>
            {acc.data ? <Accuracy a={acc.data} /> : null}
            <Block title={t("Newest picks")} meta={t("Each pick with the checks the server ran.")} testId="survivorship-picks">
              {d.picks.filter((p) => !held(p)).length === 0 ? <EmptyState heading={t("The model has not picked a winner yet.")} /> : (
                <div className="nx-ins-cards">
                  {d.picks.filter((p) => !held(p)).map((p) => <Pick key={idOf(p)} p={p} keys={keys} />)}
                </div>
              )}
            </Block>
          </>
        ) : null}
      </QueryView>
      )}
      <ApprovalSetting />
    </div>
  );
}
