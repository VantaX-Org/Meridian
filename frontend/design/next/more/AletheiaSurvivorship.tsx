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
import { Button, Chip, Code, EmptyState, ErrorState, Skeleton, Stepper, type StepItem } from "../kit";
import { AreaTrend, StackedBar } from "../viz";
import { Banner, HBars, Panel } from "./cfg-parts";

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

/** A proved pick the approval policy held back: it is not applied until a steward approves it, so it sits in the queue. */
const held = (p: SurvivorshipPick) => p.verified && !p.applied && p.state === "pending" && p.candidates.length > 0;

type Keys = unknown[][];

function useRefresh(queryKeys: Keys) {
  const qc = useQueryClient();
  return () => { for (const queryKey of queryKeys) void qc.invalidateQueries({ queryKey }); };
}

function Checks({ p }: { p: SurvivorshipPick }) {
  return (
    <ul className="nx-wrap" aria-label={t("Checks the server ran")}>
      {p.checks.map((c) => (
        <li key={c.code}><Code code={c.code} text={CHECK_TEXT[c.code]?.()} /> <Chip tone={c.passed ? "good" : "bad"}>{c.passed ? t("Passed") : t("Failed")}</Chip></li>
      ))}
    </ul>
  );
}

function Decide({ p, queryKeys }: { p: SurvivorshipPick; queryKeys: Keys }) {
  const refresh = useRefresh(queryKeys);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [reason, setReason] = useState<ReasonCode | "">("");
  const send = useMutation({
    mutationFn: (override: boolean) => postSurvivorshipDecision({
      domain: p.domain, sap_object_key: p.sap_object_key, field: p.field, decision: override ? "override" : "accept",
      ...(override ? { source_system: source, ...(reason ? { reason_code: reason } : {}) } : {}),
    }),
    onSuccess: () => { setOpen(false); refresh(); },
  });
  if (p.state !== "pending") {
    const text = p.state === "accepted" ? t("Accepted by a steward")
      : p.state === "rejected" ? t("Rejected by a steward: {reason}", { reason: p.note ?? "" })
        : t("Overridden to {source}", { source: p.decided_source ?? "" });
    return <p className="nx-sub" data-testid={`surv-state-${p.sap_object_key}-${p.field}`}>{text}{p.reason_code && p.reason_code in REASON_TEXT ? <> <Code code={p.reason_code} text={REASON_TEXT[p.reason_code as ReasonCode]()} /></> : null}</p>;
  }
  if (!p.candidates.length) return null;
  const others = p.candidates.filter((c) => !c.picked);
  return (
    <div className="nx-row">
      <Button size={32} variant="secondary" loading={send.isPending} onClick={() => send.mutate(false)}>{t("Accept the pick")}</Button>
      <Button size={32} variant="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{t("Override")}</Button>
      {open ? (
        <fieldset className="nx-field">
          <legend>{t("Use another source")}</legend>
          {others.map((c) => (
            <label key={c.source_system} className="nx-pick">
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
          <Button size={32} variant="secondary" disabled={!source} loading={send.isPending} onClick={() => send.mutate(true)}>{t("Override with this source")}</Button>
        </fieldset>
      ) : null}
      {send.isError ? <span role="alert" className="nx-sub">{failureText(send.error)}</span> : null}
    </div>
  );
}

function PickHead({ p }: { p: SurvivorshipPick }) {
  return (
    <p>{moduleText(p.domain)} <span className="nx-sub">{p.sap_object_key}</span> {t("Model picked {source}", { source: p.recommended_source })}</p>
  );
}

function Pick({ p, queryKeys }: { p: SurvivorshipPick; queryKeys: Keys }) {
  const { can } = useV2Session();
  return (
    <article className="nx-card" aria-label={`${p.sap_object_key} ${p.field}`} data-testid={`surv-pick-${p.sap_object_key}-${p.field}`}>
      <header className="nx-row">
        <h3><Code code={p.field} text={p.field_text} /></h3>
        <Chip tone={p.verified ? "good" : "bad"}>{p.verified ? t("Proved, the pick won") : t("Not proved, the pick did not win")}</Chip>
      </header>
      <PickHead p={p} />
      {p.reasoning ? <p className="nx-sub">{p.reasoning}</p> : null}
      <Checks p={p} />
      {p.verified && can("approve") && !held(p) ? <Decide p={p} queryKeys={queryKeys} /> : null}
    </article>
  );
}

/** One proposed pick: the field, the shape each source showed the model, the checks, the confidence, and the decision. */
function QueueRow({ p, queryKeys, selected, onSelect }: { p: SurvivorshipPick; queryKeys: Keys; selected: boolean; onSelect: (on: boolean) => void }) {
  const refresh = useRefresh(queryKeys);
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const send = useMutation({
    mutationFn: (reject: boolean) => postSurvivorshipDecision({
      domain: p.domain, sap_object_key: p.sap_object_key, field: p.field, decision: reject ? "reject" : "accept", ...(reject ? { note: why.trim() } : {}),
    }),
    onSuccess: refresh,
  });
  const id = `${p.sap_object_key}-${p.field}`;
  return (
    <article className="nx-card" aria-label={`${p.sap_object_key} ${p.field}`} data-testid={`surv-queue-${id}`}>
      <header className="nx-row">
        <h3>
          <label className="nx-pick">
            <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={t("Select {field} on {key}", { field: p.field, key: p.sap_object_key })} />
            <Code code={p.field} text={p.field_text} />
          </label>
        </h3>
        <span className="nx-sub">{p.confidence == null ? t("No confidence") : t("Confidence {pct}", { pct: pct1(p.confidence) })}</span>
      </header>
      <PickHead p={p} />
      {p.reasoning ? <p className="nx-sub">{p.reasoning}</p> : null}
      <ul className="nx-wrap" aria-label={t("What the model saw")}>
        {p.candidates.map((c) => (
          <li key={c.source_system}><Code code={c.source_system} text={shapeText(c)} />{c.picked ? <> <Chip tone="accent">{t("Picked")}</Chip></> : null}</li>
        ))}
      </ul>
      <Checks p={p} />
      <div className="nx-row">
        <Button size={32} variant="secondary" loading={send.isPending && !rejecting} onClick={() => send.mutate(false)}>{t("Approve")}</Button>
        <Button size={32} variant="quiet" aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}>{t("Reject")}</Button>
      </div>
      {rejecting ? (
        <fieldset className="nx-field">
          <legend>{t("Why is this pick rejected")}</legend>
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

/** Proposed picks wait here. Approving applies the pick to the golden record; rejecting keeps the value the rules chose. */
function ApprovalQueue({ picks, queryKeys }: { picks: SurvivorshipPick[]; queryKeys: Keys }) {
  const refresh = useRefresh(queryKeys);
  const { can } = useV2Session();
  const [chosen, setChosen] = useState<string[]>([]);
  const queue = picks.filter(held);
  const idOf = (p: SurvivorshipPick) => `${p.domain}|${p.sap_object_key}|${p.field}`;
  const bulk = useMutation({
    mutationFn: () => postSurvivorshipBulkApprove(queue.filter((p) => chosen.includes(idOf(p))).map(({ domain, sap_object_key, field }) => ({ domain, sap_object_key, field }))),
    onSuccess: () => { setChosen([]); refresh(); },
  });
  const allowed = can("approve");
  return (
    <Panel title={t("Picks waiting for a steward")} meta={t("A proved pick is not applied to the golden record until a steward other than the one who ran it approves it.")} testId="survivorship-queue">
      {queue.length === 0 ? <EmptyState heading={t("No pick is waiting for approval.")} /> : (
        <>
          {allowed ? <p className="nx-note">{t("Approving applies the pick to the golden record. Rejecting keeps the value the rules chose and asks for a reason.")}</p> : null}
          {allowed ? (
            <div className="nx-row">
              <Button size={32} disabled={chosen.length === 0} loading={bulk.isPending} onClick={() => bulk.mutate()}>{t("Approve selected ({n})", { n: int(chosen.length) })}</Button>
              {bulk.data && bulk.data.failed.length ? (
                <span role="alert" className="nx-sub" data-testid="surv-bulk-failed">{t("{n, plural, one {# pick was not approved} other {# picks were not approved}}", { n: bulk.data.failed.length })}: {bulk.data.failed.map((f) => `${f.sap_object_key} ${f.field} ${f.detail}`).join("; ")}</span>
              ) : null}
              {bulk.isError ? <span role="alert" className="nx-sub">{failureText(bulk.error)}</span> : null}
            </div>
          ) : <p className="nx-sub" data-testid="surv-queue-reason">{t("Approving a pick needs the approve permission. You can read the queue.")}</p>}
          <div className="nx-body" aria-label={t("Picks waiting for approval, scrollable")}>
            {queue.map((p) => allowed
              ? <QueueRow key={idOf(p)} p={p} queryKeys={queryKeys} selected={chosen.includes(idOf(p))} onSelect={(on) => setChosen(on ? [...chosen, idOf(p)] : chosen.filter((x) => x !== idOf(p)))} />
              : <Pick key={idOf(p)} p={p} queryKeys={queryKeys} />)}
          </div>
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
      {q.isError ? <ErrorState sentence={t("The approval setting could not be read.")} onRetry={() => void q.refetch()} /> : (
        <>
          <p data-testid="surv-approval-current">
            {t("Current value")}{" "}
            {required === undefined ? "" : <Code code={required ? "required" : "not_required"} text={required ? t("A steward must approve each AI pick") : t("Auto-approve is on: proved AI picks apply at once")} />}
          </p>
          <ul className="nx-wrap">
            <li><Code code="required" text={t("A proved AI pick waits for a steward to accept it before it is applied.")} /></li>
            <li><Code code="not_required" text={t("Opt-in auto-approve: a proved AI pick is applied at once; stewards can still override it later.")} /></li>
          </ul>
          <p className="nx-note">{required === false
            ? t("Turning approval on makes new proved picks wait for a steward. Picks already applied stay applied.")
            : t("Turning approval off applies every new proved pick at once. Stewards can still override it later.")}</p>
          <label className="nx-pick">
            <input type="checkbox" checked={Boolean(required)} disabled={!allowed || q.isPending || save.isPending} onChange={(e) => save.mutate({ required: e.target.checked })} />
            {t("Require steward approval")}
          </label>
          {!allowed ? <p className="nx-sub" data-testid="surv-approval-reason">{t("Changing this needs the manage settings permission. You can read it.")}</p> : null}
          {save.isError ? <p role="alert" className="nx-sub">{failureText(save.error)}</p> : null}
        </>
      )}
    </Panel>
  );
}

function decisionSegs(c: { accepted: number; overridden: number; pending: number }) {
  return [
    { id: "a", label: t("Accepted"), value: c.accepted, tone: "good" as const },
    { id: "o", label: t("Overridden"), value: c.overridden, tone: "bad" as const },
    { id: "p", label: t("Waiting"), value: c.pending, tone: "chart1" as const },
  ];
}

function Accuracy({ a }: { a: SurvivorshipAccuracy }) {
  const points = a.by_week.filter((w) => w.acceptance_rate != null).map((w) => ({ label: formatDate(w.week, "date"), value: Math.round((w.acceptance_rate as number) * 1000) / 10 }));
  return (
    <Panel title={t("How often stewards keep the pick")} meta={t("Accepted and overridden decisions on proved picks. Waiting picks have no decision yet.")} testId="survivorship-accuracy">
      <p data-testid="surv-rates">
        {t("Accepted {a}, overridden {o}, waiting {p}", { a: pct1(a.acceptance_rate), o: pct1(a.override_rate), p: int(a.pending) })}
      </p>
      <h3>{t("Accepted picks, week by week")}</h3>
      <p className="nx-sub">{t("The share of decided picks a steward kept")}</p>
      <div data-testid="surv-trend">
        <AreaTrend points={points.length < 2 ? [] : points} label={t("Accepted picks by week")} height={160} empty={t("Two weeks of decisions are needed to draw a trend.")} />
      </div>
      <ul className="nx-body" data-testid="surv-by-field">
        {a.by_field.map((f) => (
          <li key={`${f.domain}-${f.field}`}>
            <strong><Code code={f.field} text={f.field_text} /></strong>{" "}
            <span className="nx-sub">{pct1(f.acceptance_rate)}</span>
            <StackedBar segs={decisionSegs(f)} label={t("Decisions on {field}", { field: f.field })} />
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
  const title = t("Aletheia verified survivorship");
  if (q.isPending) return <Skeleton lines={8} label={title} />;
  if (q.isError) return <ErrorState sentence={t("The survivorship picks could not be read.")} onRetry={() => void q.refetch()} />;
  const { domains, picks, counts } = q.data;
  const decided = picks.filter((p) => !held(p));
  const verified = domains.reduce((n, d) => n + d.verified, 0);
  const rejected = domains.reduce((n, d) => n + d.rejected, 0);
  const current = counts.proposed > 0 ? 2 : 3;
  const steps: StepItem[] = [t("Model picks a source"), t("Server proves the pick"), t("Steward approves"), t("Applied to the golden record")]
    .map((label, i) => ({ id: String(i), label, state: i < current ? "done" : i === current ? "current" : "future" }));
  return (
    <div className="nx-body" data-testid="aletheia-survivorship">
      <Banner
        title={title}
        why={t("{n, plural, one {# model pick did not pass its proof} other {# model picks did not pass their proof}}", { n: rejected })}
        meta={`${t("When duplicate records disagree, the model picks which source wins for each field and the server proves the pick. Review the picks that wait for a steward below.")} ${t("The model sees only the shape of each source's value, never a value. A pick wins only when the server proves it against the contributing sources.")}`}
        label={title}
        testId="survivorship"
        figs={[
          { label: t("Proved"), value: int(verified), note: t("Picks the server checked against the contributing sources and confirmed.") },
          { label: t("Not proved"), value: int(rejected), note: t("Picks the server could not confirm. They are never applied.") },
          { label: t("Waiting for a steward"), value: int(counts.proposed), note: t("Proved picks that need a person to approve them.") },
        ]}
      />
      <div data-testid="surv-steps"><Stepper steps={steps} label={t("Where a pick is in the process")} /></div>
      <ApprovalQueue picks={picks} queryKeys={queryKeys} />
      <p className="nx-note"><Chip tone="aletheia">{t("Proved")}</Chip> {t("Only picks the server proved against the sources carry this mark.")}</p>
      <Panel title={t("Steward decisions on proved picks")} meta={t("Proposed picks wait for a steward. Auto-applied picks were applied under the opt-in auto-approve.")} testId="survivorship-counts">
        <div data-testid="surv-chart">
          <HBars
            label={t("Decisions by outcome")}
            rows={[
              { key: "proposed", label: t("Proposed, waiting for approval"), value: counts.proposed, text: int(counts.proposed), tone: "warn" },
              { key: "approved", label: t("Approved by a steward"), value: counts.approved, text: int(counts.approved), tone: "good" },
              { key: "rejected", label: t("Rejected by a steward"), value: counts.rejected, text: int(counts.rejected), tone: "bad" },
              { key: "auto", label: t("Applied by auto-approve"), value: counts.auto_applied, text: int(counts.auto_applied), tone: "good" },
            ]}
          />
        </div>
        <ul className="nx-wrap" data-testid="surv-counts">
          <li data-testid="surv-count-proposed"><Code code="proposed" text={t("Proposed, waiting for approval")} /> <strong>{int(counts.proposed)}</strong></li>
          <li data-testid="surv-count-approved"><Code code="approved" text={t("Approved by a steward")} /> <strong>{int(counts.approved)}</strong></li>
          <li data-testid="surv-count-rejected"><Code code="rejected" text={t("Rejected by a steward")} /> <strong>{int(counts.rejected)}</strong></li>
          <li data-testid="surv-count-auto"><Code code="auto_applied" text={t("Applied by auto-approve")} /> <strong>{int(counts.auto_applied)}</strong></li>
        </ul>
      </Panel>
      <Panel title={t("Picks by object")} meta={t("Model picks that were proved and that were not.")} testId="survivorship-domains">
        {domains.length === 0 ? <EmptyState heading={t("The model has not picked a winner yet.")} /> : (
          <ul className="nx-body">
            {domains.map((d) => (
              <li key={d.domain} data-testid={`surv-domain-${d.domain}`}>
                <strong>{moduleText(d.domain)}</strong>
                <StackedBar segs={[{ id: "ok", label: t("Proved"), value: d.verified, tone: "good" }, { id: "no", label: t("Not proved"), value: d.rejected, tone: "bad" }]} label={t("Model picks in {object}", { object: moduleText(d.domain) })} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {acc.isError ? <ErrorState error={acc.error} onRetry={() => void acc.refetch()} /> : acc.data ? <Accuracy a={acc.data} /> : null}
      <Panel title={t("Newest picks")} meta={t("Each pick with the checks the server ran.")} testId="survivorship-picks">
        {decided.length === 0 ? <EmptyState heading={t("The model has not picked a winner yet.")} /> : (
          <div className="nx-body" aria-label={t("Model picks, scrollable")}>
            {decided.map((p) => <Pick key={`${p.sap_object_key}-${p.field}`} p={p} queryKeys={queryKeys} />)}
          </div>
        )}
      </Panel>
      <ApprovalSetting />
    </div>
  );
}
