"use client";

/**
 * One-page steering report for an object and run: score and trend, the worst failing rules with their text, open
 * against resolved records, who holds the open ones and what to do next. Print sets it on an A4 page without the app
 * chrome (report.css). Owners and the open and resolved counts come from the record issues of the object (the first
 * 100 listed for owners; the counts cover all).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, Skeleton, StatCard } from "@/design/next/kit";
import { fixtureActive, useFixture } from "@/lib/api/v2/fixture";
import { getIssues, type Issue } from "@/lib/api/v2/issues";
import { useTimeline } from "@/lib/v2/runs-queries";
import { useObjectRules } from "@/lib/v2/queries";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { failingRules, severityLabel } from "./FailingRecords";
import type { ObjectRun } from "../object/useObjectRun";
import "./report.css";

export const TOP_RULES = 5;

/** Fixture mode has no issue store: synthetic counts and holders so the page shows every section. */
const OWNER = ["u1", "u2"];
const fixtureIssues = (): Awaited<ReturnType<typeof getIssues>> => ({
  total: 6,
  counts: { open: 4, resolved: 2 },
  items: [
    { status: "open", assignee_email: OWNER[0], assigned_to: null },
    { status: "open", assignee_email: OWNER[0], assigned_to: null },
    { status: "open", assignee_email: null, assigned_to: null },
    { status: "open", assignee_email: OWNER[1], assigned_to: null },
    { status: "resolved", assignee_email: OWNER[1], assigned_to: null },
    { status: "resolved", assignee_email: null, assigned_to: null },
  ] as Issue[],
});

/** Open issues grouped by holder, biggest first; no holder is "Unassigned". */
export function ownersOf(items: Issue[]): { owner: string; open: number }[] {
  const m = new Map<string, number>();
  for (const i of items) {
    if (i.status === "resolved" || i.status === "accepted") continue;
    const k = i.assignee_email ?? i.assigned_to ?? "";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([owner, open]) => ({ owner: owner || t("Unassigned"), open })).sort((a, b) => b.open - a.open);
}

export function SteeringReport({ o }: { o: ObjectRun }) {
  const fx = useFixture();
  const rulesQ = useObjectRules(o.module, o.runId);
  const tl = useTimeline(o.systemId, 12, o.module);
  const issuesQ = useQuery({ queryKey: ["next", "report-issues", fx, o.module], queryFn: () => (fixtureActive() ? fixtureIssues() : getIssues({ module: o.module, limit: 100 })), staleTime: 30_000 });
  const rules = useMemo(() => failingRules(rulesQ.data ?? []), [rulesQ.data]);
  const top = rules.slice(0, TOP_RULES);
  const runs = tl.data?.runs ?? [];
  const at = runs.findIndex((r) => r.id === o.runId);
  const cur = at >= 0 ? runs[at] : runs[runs.length - 1];
  const prev = at > 0 ? runs[at - 1] : undefined;
  const score = cur?.objects[o.module]?.score ?? null;
  const before = prev?.objects[o.module]?.score ?? null;
  const delta = score !== null && before !== null ? score - before : null;
  const scores = runs.map((r) => r.objects[o.module]?.score).filter((s): s is number => typeof s === "number");
  const counts = issuesQ.data?.counts ?? {};
  const resolved = (counts.resolved ?? 0) + (counts.accepted ?? 0);
  const open = Object.entries(counts).reduce((n, [k, v]) => (k === "resolved" || k === "accepted" ? n : n + (v ?? 0)), 0);
  const owners = ownersOf(issuesQ.data?.items ?? []);
  const loading = rulesQ.isLoading || tl.isLoading || issuesQ.isLoading;

  return (
    <section className="nx-card nx-report nx-report-print" aria-label={t("Steering report")} data-testid="steering-report">
      <header className="nx-report-head">
        <div>
          <h3 className="nx-cycle-h">{t("Steering report")}</h3>
          <p className="nx-muted">{o.label}{o.run ? ` / ${t("Run {n}", { n: o.run.run_number ?? "" })}` : ""}</p>
        </div>
        <span className="nx-report-noprint"><Button icon="download" variant="secondary" onClick={() => window.print()}>{t("Print report")}</Button></span>
      </header>
      {loading ? <Skeleton /> : (
        <>
          <div className="nx-report-stats">
            <StatCard label={t("Score")} value={score === null ? 0 : Math.round(score)} delta={delta === null ? undefined : { value: Math.round(delta * 10) / 10, tone: delta > 0 ? "good" : delta < 0 ? "bad" : "neutral", against: t("since previous run") }} spark={scores.length > 1 ? scores : undefined} sparkLabel={t("Score over the last {n} runs: {list}", { n: scores.length, list: scores.map((s) => Math.round(s)).join(", ") })} />
            <StatCard label={t("Open records")} value={open} />
            <StatCard label={t("Resolved records")} value={resolved} />
          </div>
          <h4 className="nx-report-h">{t("Top failing rules")}</h4>
          {top.length === 0 ? <p className="nx-muted">{t("This run has no failing records for the object.")}</p> : (
            <ol className="nx-report-rules">
              {top.map((r) => (
                <li key={r.check_id}>
                  <p><span className="nx-mono">{r.check_id}</span> {r.name} <Chip tone={r.severity === "critical" || r.severity === "high" ? "bad" : r.severity === "medium" ? "warn" : "neutral"}>{severityLabel(r.severity)}</Chip> <span className="nx-num">{t("{n} failing", { n: formatInt(r.affected_count) })}</span></p>
                  {r.why ? <p className="nx-muted">{r.why}</p> : null}
                </li>
              ))}
            </ol>
          )}
          <h4 className="nx-report-h">{t("Owners of open records")}</h4>
          {owners.length === 0 ? <p className="nx-muted">{t("No open records are held by anyone.")}</p> : (
            <ul className="nx-report-owners">{owners.map((w) => <li key={w.owner}>{w.owner} <span className="nx-num">{formatInt(w.open)}</span></li>)}</ul>
          )}
          <h4 className="nx-report-h">{t("Next actions")}</h4>
          <ol className="nx-report-next">
            {top.slice(0, 3).map((r) => <li key={r.check_id}>{t("Fix {n} records failing {rule}: {name}", { n: formatInt(r.affected_count), rule: r.check_id, name: r.name })}</li>)}
            {owners.some((w) => w.owner === t("Unassigned")) ? <li>{t("Assign the open records that have no owner.")}</li> : null}
            {top.length === 0 && owners.length === 0 ? <li>{t("Nothing to do. Keep the monitoring on.")}</li> : null}
          </ol>
        </>
      )}
    </section>
  );
}
