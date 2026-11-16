"use client";

/** The decision layer of the object overview: the post-clean monitor, what Aletheia found, the one next step, and the
 *  rules failing most. Every figure is read from the API; a missing one shows a dash with its reason. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DataTable, ErrorState, NxLink, ProgressBar, SeverityMark, Skeleton, Sparkline, type Column, type SeverityKey } from "@/design/next/kit";
import { getObjectMonitor, type Freshness, type ObjectMonitor } from "@/lib/api/v2/run-ops";
import { createRuleBatch, markActed, type AletheiaActed, type AletheiaActionKind, type AletheiaFinding } from "@/lib/api/v2/insights";
import { draftTunedVersion } from "@/lib/api/v2/pilot";
import { putOwner } from "@/lib/api/v2/mdm";
import type { RuleRow } from "@/lib/api/v2/types";
import { useFixture } from "@/lib/api/v2/fixture";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { describeCron } from "@/lib/v2/cron";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText, moneyCompactText } from "@/lib/v2/labels";
import { useRuleHistory } from "@/lib/v2/object-queries";
import { objectHref } from "@/lib/v2/people";
import { useLandscape, useObjectRules } from "@/lib/v2/queries";
import { rankRules } from "@/lib/v2/rules-pivot";
import { useObjectRun as useRunSpine } from "@/lib/v2/scope";
import { DASH, int, moduleSlug, pct1 } from "@/lib/v2/score";
import { signed1 } from "@/lib/v2/step9";
import { formatDate } from "@/lib/format";
import { useFindings } from "./evidence";
import { duration } from "./model";
import { DimensionBars } from "./ScoreParts";
import { Dash } from "./tabs/tabs-g-parts";
import type { ObjectRun } from "./useObjectRun";
import "./tabs/tabs-g.css";

function is404(e: unknown): boolean {
  const x = e as { response?: { status?: number }; status?: number } | null;
  return (x?.response?.status ?? x?.status) === 404;
}

// ── Monitor ────────────────────────────────────────────────────────────────

export function useObjectMonitor(module: string) {
  const fx = useFixture();
  return useQuery({ queryKey: ["nx", "object-monitor", fx, module], queryFn: () => getObjectMonitor(module), retry: false, staleTime: 30_000, enabled: !!module });
}

const FRESH_WORD: Record<Freshness, () => string> = {
  fresh: () => t("Fresh"), due: () => t("Due"), stale: () => t("Stale"), failed: () => t("Last run failed"), paused: () => t("Paused"), manual: () => t("Run by hand"),
};
const TRIGGER_WORD: Record<string, () => string> = { scheduled: () => t("Scheduled"), manual: () => t("By hand"), recheck: () => t("Recheck"), upload: () => t("Upload") };

function cadenceText(c: ObjectMonitor["cadence"]): string | null {
  const every = c.cron ? describeCron(c.cron) : c.interval_seconds ? t("Every {n}", { n: duration(c.interval_seconds) }) : null;
  if (!every) return null;
  return c.active === false ? t("{cadence}, paused", { cadence: every }) : every;
}

function baselineText(b: ObjectMonitor["baseline"]): string | null {
  if (!b.kind || !b.run_at) return null;
  return t("{kind} of {when}", { kind: b.kind === "pinned" ? t("Pinned run") : t("Previous run"), when: formatDate(b.run_at, "datetime") });
}

/** Cadence, freshness, trigger, baseline and drift since the baseline. Nothing when no run has measured the object. */
export function MonitorStrip({ module }: { module: string }) {
  const q = useObjectMonitor(module);
  const { hrefFor } = useOpenItem();
  if (q.isPending) return <Skeleton lines={2} label={t("Reading the object monitor")} />;
  if (q.isError) return is404(q.error) ? null : <ErrorState sentence={t("The object monitor could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  const m = q.data;
  const cadence = cadenceText(m.cadence);
  const baseline = baselineText(m.baseline);
  const d = m.drift;
  const moreNew = d.newly_failing_rule_count - Math.min(3, d.newly_failing_rules.length);
  const moreRec = d.recovered_rule_count - Math.min(3, d.recovered_rules.length);
  const rule = (id: string) => <NxLink href={hrefFor({ kind: "rule", id })} className="nx-link nx-mono">{id}</NxLink>;
  return (
    <section className="nx-tg-sec" aria-label={t("Monitoring")} data-testid="object-monitor">
      <h3 className="nx-rn-h3">{t("Monitoring")} <span className="nx-muted">{FRESH_WORD[m.freshness]()}</span></h3>
      <dl className="nx-tg-split">
        <div><dt className="nx-muted">{t("Cadence")}</dt><dd>{cadence ?? <Dash why={t("This object has no schedule")} />}</dd></div>
        <div><dt className="nx-muted">{t("Last run")}</dt><dd>{m.last_run_at ? formatDate(m.last_run_at, "datetime") : <Dash why={t("No run yet")} />}</dd></div>
        <div><dt className="nx-muted">{t("Started by")}</dt><dd>{m.trigger ? (TRIGGER_WORD[m.trigger]?.() ?? m.trigger) : <Dash why={t("Not recorded")} />}{m.requested_by_label ? ` (${m.requested_by_label})` : ""}</dd></div>
        <div><dt className="nx-muted">{t("Baseline")}</dt><dd>{baseline ?? <Dash why={t("No baseline yet")} />}</dd></div>
        <div><dt className="nx-muted">{t("Newly failing")}</dt><dd className="nx-num">{baseline ? int(d.new_failing) : <Dash why={t("No baseline yet")} />}</dd></div>
        <div><dt className="nx-muted">{t("Recovered")}</dt><dd className="nx-num">{baseline ? int(d.recovered) : <Dash why={t("No baseline yet")} />}</dd></div>
      </dl>
      {baseline ? (
        d.newly_failing_rules.length === 0 && d.recovered_rules.length === 0 ? (
          <p className="nx-muted">{t("No rule changed since the baseline")}</p>
        ) : (
          <ul className="nx-tg-list" data-testid="object-monitor-drift">
            {d.newly_failing_rules.slice(0, 3).map((r) => <li key={r.check_id}>{rule(r.check_id)} {t("{n} records now failing", { n: int(r.new) })}</li>)}
            {moreNew > 0 ? <li className="nx-muted">{t("and {n} more", { n: moreNew })}</li> : null}
            {d.recovered_rules.slice(0, 3).map((r) => <li key={r.check_id}>{rule(r.check_id)} {t("recovered")}</li>)}
            {moreRec > 0 ? <li className="nx-muted">{t("and {n} more", { n: moreRec })}</li> : null}
          </ul>
        )
      ) : null}
    </section>
  );
}

// ── Aletheia found ─────────────────────────────────────────────────────────

const ACTION_LABEL: Record<AletheiaActionKind, () => string> = {
  across: () => t("Review across systems"), tune: () => t("Draft tuned version"), cleanse: () => t("Draft cleansing batch"), open: () => t("Open rule"), merge: () => t("Review duplicates"), assign: () => t("Assign owner"),
};
const ACTION_TEXT: Record<AletheiaActionKind, () => string> = {
  across: () => t("Cross-system duplicates reviewed"), tune: () => t("Tuned rule version drafted"), cleanse: () => t("Cleansing batch drafted"), open: () => t("Opened"), merge: () => t("Duplicates reviewed"), assign: () => t("Owner assigned"),
};
const ACTION_NEEDS: Partial<Record<AletheiaActionKind, string>> = { tune: "manage_rules", cleanse: "apply" };
const ACTION_LOCKED: Partial<Record<AletheiaActionKind, () => string>> = {
  tune: () => t("Drafting a tuned version needs the manage rules permission, which your role does not hold."),
  cleanse: () => t("Drafting a cleansing batch needs the apply permission, which your role does not hold."),
};

function why(f: AletheiaFinding): string | null {
  const parts: string[] = [];
  if (f.delta_affected) parts.push(t("{n} failing records since the previous run", { n: signed1(f.delta_affected).replace(".0", "") }));
  if (f.why.origin.top && f.why.origin.share != null) parts.push(t("{p} of the failing values come from one origin", { p: pct1(f.why.origin.share) }));
  return parts.length ? parts.join(". ") : null;
}

function useActed(module: string) {
  const qc = useQueryClient();
  const fx = useFixture();
  return () => void qc.invalidateQueries({ queryKey: ["aletheia-found", fx, module] });
}

function ActionCell({ f, module }: { f: AletheiaFinding; module: string }) {
  const session = useV2Session();
  const landscape = useLandscape(null);
  const refresh = useActed(module);
  const [done, setDone] = useState(false);
  const kind = f.action.kind;
  const need = ACTION_NEEDS[kind];
  const locked = !!need && (!session.can(need) || session.shared || !!session.viewAs);
  const act = useMutation({
    mutationFn: async () => {
      if (kind === "tune") await draftTunedVersion(f.check_id);
      if (kind === "cleanse") await createRuleBatch(`${f.check_id} ${f.name}`.slice(0, 200), { module: f.module, check_id: f.check_id });
      return markActed({ module: f.module, check_id: f.check_id, action: kind });
    },
    onSuccess: () => { setDone(true); refresh(); },
  });
  if (kind === "assign") return <AssignAction f={f} module={module} />;
  if (kind === "open") return <NxLink href={`/r/${encodeURIComponent(f.check_id)}`} className="nx-btn nx-btn-secondary">{ACTION_LABEL.open()}</NxLink>;
  if (kind === "merge" || kind === "across") {
    const href = `${objectHref(landscape.data, f.module)}/golden${kind === "across" ? "#across-systems" : ""}`;
    return (
      <span>
        <NxLink href={href} className="nx-btn nx-btn-secondary" onClick={() => void markActed({ module: f.module, check_id: f.check_id, action: kind }).then(refresh, () => undefined)}>{ACTION_LABEL[kind]()}</NxLink>
        {kind === "merge" && f.action.pairs != null ? <span className="nx-muted"> {t("Pairs waiting for review: {n}", { n: int(f.action.pairs) })}</span> : null}
      </span>
    );
  }
  if (done) return <span className="nx-muted" role="status">{ACTION_TEXT[kind]()}</span>;
  if (locked) return <span className="nx-muted" data-testid="aletheia-action-locked">{ACTION_LOCKED[kind]?.()}</span>;
  return (
    <span>
      <Button variant="secondary" size={32} loading={act.isPending} onClick={() => act.mutate()}>{ACTION_LABEL[kind]()}</Button>
      {act.isError ? <span role="alert" className="nx-muted"> {failureText(act.error)}</span> : null}
    </span>
  );
}

function AssignAction({ f, module }: { f: AletheiaFinding; module: string }) {
  const session = useV2Session();
  const allowed = session.can("assign") && !session.shared && !session.viewAs;
  const people = useAssignable(allowed);
  const refresh = useActed(module);
  const [who, setWho] = useState("");
  const [done, setDone] = useState(false);
  const act = useMutation({
    mutationFn: async () => {
      await putOwner("rule", f.check_id, who);
      return markActed({ module: f.module, check_id: f.check_id, action: "assign" });
    },
    onSuccess: () => { setDone(true); refresh(); },
  });
  if (done) return <span className="nx-muted" role="status">{ACTION_TEXT.assign()}</span>;
  if (!allowed) return <span className="nx-muted">{t("No owner. Someone with the assign permission can set one.")}</span>;
  return (
    <span>
      <select className="nx-input" value={who} onChange={(e) => setWho(e.target.value)} aria-label={t("Owner of {id}", { id: f.check_id })}>
        <option value="">{t("Choose")}</option>
        {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>{" "}
      <Button variant="secondary" size={32} disabled={!who} loading={act.isPending} onClick={() => act.mutate()}>{ACTION_LABEL.assign()}</Button>
      {act.isError ? <span role="alert" className="nx-muted"> {failureText(act.error)}</span> : null}
    </span>
  );
}

function ProofRow({ a }: { a: AletheiaActed }) {
  const { hrefFor } = useOpenItem();
  return (
    <li data-testid="aletheia-proof-row">
      <span>{a.action === "across" ? t("Duplicates across systems") : <><NxLink href={hrefFor({ kind: "rule", id: a.check_id })} className="nx-link nx-mono">{a.check_id}</NxLink> {a.name ?? DASH}</>}</span>
      {" "}<span className="nx-muted">{ACTION_TEXT[a.action]()}</span>{" "}
      {a.waiting ? (
        <span className="nx-muted">{t("Waiting for the next run")}</span>
      ) : (
        <span>{t("Score {d}", { d: signed1(a.gain) })}, {t("{n} fewer failing records", { n: int(a.reduction) })}</span>
      )}
      {(a.proven_cost ?? []).map((p) => (
        <div key={p.metric} className="nx-muted">
          <span className="nx-mono">{p.metric}</span> {p.label ?? ""}{" "}
          {t("{before} to {after}", { before: p.before != null ? moneyCompactText(p.before, a.currency) : DASH, after: p.after != null ? moneyCompactText(p.after, a.currency) : DASH })}
        </div>
      ))}
    </li>
  );
}

/** What Aletheia found on this object: ranked findings with one action each, what changed since the last run, and the
 *  proof of value of findings someone acted on. */
export function AletheiaFoundPanel({ module }: { module: string }) {
  const q = useFindings(module);
  const { hrefFor } = useOpenItem();
  if (q.isPending) return <Skeleton lines={4} label={t("Reading what Aletheia found")} />;
  if (q.isError) return <ErrorState sentence={t("What Aletheia found could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  const { findings, changes, acted, currency } = q.data;
  if (findings.length === 0 && acted.length === 0) return null;
  const cols: Column<AletheiaFinding>[] = [
    {
      id: "finding", label: t("Finding"),
      cell: (f) => f.action.kind === "across" ? (
        <span data-testid="aletheia-across">
          {t("{n} {n2, plural, one {pair} other {pairs}} of {label} records exist in more than one connected system as separate records", { n: int(f.action.pairs ?? f.affected), n2: f.action.pairs ?? f.affected, label: moduleText(f.module) })}
          {(f.action.systems ?? []).map((s) => <div key={`${s.a}-${s.b}`} className="nx-muted">{t("{a} and {b}: {n}", { a: s.a, b: s.b, n: int(s.pairs) })}</div>)}
        </span>
      ) : (
        <span>
          <NxLink href={hrefFor({ kind: "rule", id: f.check_id })} className="nx-link nx-mono">{f.check_id}</NxLink> {f.name}
          {why(f) ? <div className="nx-muted">{why(f)}</div> : null}
        </span>
      ),
    },
    { id: "affected", label: t("Failing records"), align: "end", cell: (f) => <span className="nx-num">{int(f.affected)}</span> },
    {
      id: "spark", label: t("Last runs"),
      cell: (f) => {
        const pts = f.spark.filter((v): v is number => v != null);
        return pts.length >= 2 ? <Sparkline points={pts} label={t("Failing records over the last {n} runs", { n: pts.length })} /> : <Dash why={t("Not enough runs yet")} />;
      },
    },
    { id: "money", label: t("Money at risk"), align: "end", cell: (f) => f.money.cost_at_risk != null ? <span className="nx-num">{moneyCompactText(f.money.cost_at_risk, f.money.currency || currency)}</span> : <Dash why={t("No cost model covers this rule")} /> },
    {
      id: "confidence", label: t("Confidence"), align: "end",
      cell: (f) => f.confidence ? (
        <span className="nx-num" title={f.confidence.basis === "precision" ? t("Share of reviewed issues stewards confirmed as real") : t("Share of failing values from the dominant origin")}>{pct1(f.confidence.value)}</span>
      ) : <Dash why={t("Not measured yet")} />,
    },
    { id: "action", label: t("Action"), cell: (f) => <ActionCell f={f} module={module} /> },
  ];
  const own = changes.filter((c) => c.previous_version_id);
  return (
    <section className="nx-tg-sec nx-aletheia" aria-label={t("Aletheia found")} data-testid="aletheia-found">
      <h3 className="nx-rn-h3">{t("Aletheia found")}</h3>
      <p className="nx-muted">{t("Ranked by score impact, from the latest run of each object")}</p>
      {findings.length ? <DataTable<AletheiaFinding> rows={findings} columns={cols} rowKey={(f) => f.id} rowLabel={(f) => f.check_id} caption={t("Aletheia found")} /> : null}
      <h4 className="nx-sec-h">{t("What changed since the last run")}</h4>
      {own.length === 0 ? (
        <p className="nx-muted">{t("No object has a previous run to compare with yet.")}</p>
      ) : (
        <ul className="nx-tg-list" data-testid="aletheia-changes">
          {own.map((c) => (
            <li key={c.module}>
              {moduleText(c.module)} <span className="nx-num">{signed1(c.delta)}</span>
              {c.movers.map((m) => <div key={m.check_id} className="nx-muted"><span className="nx-mono">{m.check_id}</span> {m.name} {t("{n} failing", { n: signed1(m.delta_affected).replace(".0", "") })}</div>)}
            </li>
          ))}
        </ul>
      )}
      <h4 className="nx-sec-h">{t("Proof of value")}</h4>
      {acted.length === 0 ? (
        <p className="nx-muted">{t("Act on a finding and its result shows here after the next run.")}</p>
      ) : (
        <ul className="nx-tg-list">{acted.map((a) => <ProofRow key={`${a.module}-${a.check_id}-${a.action}`} a={a} />)}</ul>
      )}
    </section>
  );
}

// ── Primary action ─────────────────────────────────────────────────────────

/** The one next step: the failing records when any wait for a fix, the rules otherwise, and the object's issues. */
export function PrimaryAction({ o }: { o: ObjectRun }) {
  const cell = o.landscape.data?.cells.find((c) => c.system_id === o.systemId && c.module === o.module);
  if (!cell) return null;
  const work = cell.open_work ?? 0;
  return (
    <section className="nx-tg-sec" aria-label={t("Next step")} data-testid="object-primary-action">
      <p>{work > 0 ? t("{n} records fail at least one rule, so fixing them is what moves this score.", { n: int(work) }) : t("No record is waiting for a fix. The rules show what was measured and how.")}</p>
      <div className="nx-tg-head">
        <NxLink href={o.hrefWith(work > 0 ? "records" : "rules")} className="nx-btn nx-btn-primary" data-testid="object-primary">{work > 0 ? t("Open the failing records") : t("Open the rules")}</NxLink>
        <NxLink href={`/issues?module=${moduleSlug(o.module)}`} className="nx-btn nx-btn-secondary" data-testid="object-issues">{t("Open the issues")}</NxLink>
      </div>
    </section>
  );
}

// ── Top failing ────────────────────────────────────────────────────────────

function Trend({ id, affected, max }: { id: string; affected: number; max: number }) {
  const h = useRuleHistory(id);
  const pts = (h.data ?? []).slice(-12).map((r) => r.affected_count);
  return (
    <span>
      {pts.length >= 2 ? <Sparkline points={pts} label={t("Failing rows over the last {n} runs", { n: pts.length })} /> : null}{" "}
      <ProgressBar value={max ? affected / max : 0} label={t("{n} failing", { n: int(affected) })} text={t("{n} failing", { n: int(affected) })} />
    </span>
  );
}

/** The five rules with the most at stake in this run, each with its trend over the last runs. */
export function TopFailing({ o }: { o: ObjectRun }) {
  const q = useObjectRules(o.module, o.runId);
  if (q.isPending) return <Skeleton lines={3} label={t("Reading the top failing rules")} />;
  if (q.isError) return <ErrorState sentence={t("The rules of this run could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  const top = rankRules(q.data.filter((r) => r.affected_count > 0)).slice(0, 5);
  if (top.length === 0) return null;
  const max = Math.max(...top.map((r) => r.affected_count));
  const cols: Column<RuleRow>[] = [
    {
      id: "rule", label: t("Rule"),
      cell: (r) => (
        <span>
          <SeverityMark severity={r.severity as SeverityKey} /> <NxLink href={`/r/${encodeURIComponent(r.check_id)}`} className="nx-link nx-mono">{r.check_id}</NxLink> {r.name}
          {r.field ? <div className="nx-muted"><span className="nx-mono">{r.field}</span>{r.field_description ? ` ${r.field_description}` : ""}</div> : null}
        </span>
      ),
    },
    { id: "trend", label: t("Trend"), cell: (r) => <Trend id={r.check_id} affected={r.affected_count} max={max} /> },
  ];
  return (
    <section className="nx-tg-sec" aria-label={t("Top failing rules")} data-testid="top-failing">
      <h3 className="nx-rn-h3">{t("Top failing rules")}</h3>
      <DataTable<RuleRow> rows={top} columns={cols} rowKey={(r) => r.check_id} rowLabel={(r) => r.check_id} caption={t("Top failing rules")} />
    </section>
  );
}

// ── The layer ──────────────────────────────────────────────────────────────

/** The layer above the overview in the v2 order: monitor, Aletheia, next step (latest run only), dimensions and top rules. */
export function DecisionLayer({ o }: { o: ObjectRun }) {
  const spine = useRunSpine(o.systemId, o.module);
  const cell = o.landscape.data?.cells.find((c) => c.system_id === o.systemId && c.module === o.module);
  return (
    <>
      <MonitorStrip module={o.module} />
      <AletheiaFoundPanel module={o.module} />
      {spine.isLatest ? <PrimaryAction o={o} /> : null}
      <div className="nx-tg-split">
        {cell ? <DimensionBars cell={cell} /> : null}
        <TopFailing o={o} />
      </div>
    </>
  );
}
