"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSurvivorship, getSurvivorshipAccuracy, postSurvivorshipDecision,
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
    const text = p.state === "accepted" ? t("Accepted by a steward") : t("Overridden to {source}", { source: p.decided_source ?? "" });
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
      {p.verified && can("approve") ? <Decide p={p} queryKeys={queryKeys} /> : null}
    </article>
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
  const { domains, picks } = q.data;
  const verified = domains.reduce((n, d) => n + d.verified, 0);
  const rejected = domains.reduce((n, d) => n + d.rejected, 0);
  return (
    <CcPage title={t("Aletheia verified survivorship")}>
      <CcBanner
        testId="survivorship"
        label={t("Aletheia verified survivorship")}
        eyebrow={t("Aletheia verified survivorship")}
        headline={t("{n, plural, one {# model pick did not pass its proof} other {# model picks did not pass their proof}}", { n: rejected })}
        why={t("The model sees only the shape of each source's value, never a value. A pick wins only when the server proves it against the contributing sources.")}
        figs={[{ label: t("Proved"), value: int(verified) }, { label: t("Not proved"), value: int(rejected) }]}
      />
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
      {acc.data ? <Accuracy a={acc.data} /> : null}
      <Panel title={t("Newest picks")} meta={t("Each pick with the checks the server ran.")} testId="survivorship-picks">
        {picks.length === 0 ? <EmptyFrame>{t("The model has not picked a winner yet.")}</EmptyFrame> : (
          <ScrollFrame label={t("Model picks, scrollable")}>
            {picks.map((p) => <Pick key={`${p.sap_object_key}-${p.field}`} p={p} queryKeys={queryKeys} />)}
          </ScrollFrame>
        )}
      </Panel>
    </CcPage>
  );
}
