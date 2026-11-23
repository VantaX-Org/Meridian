"use client";

import { isAnalysed } from "@/lib/v2/run-label";
import { useState } from "react";
import { formatDate } from "@/lib/format";
import { useConfigImpact } from "@/lib/v2/object-queries";
import { useReceipt } from "@/lib/v2/queries";
import { DASH, VERDICT_LABEL, f1, int, pct1 } from "@/lib/v2/score";
import { useFixture } from "@/lib/api/v2/fixture";
import { withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { describeField } from "@/lib/v2/sap-fields";
import type { RuleRow } from "@/lib/api/v2/types";
import {
  Badge, Button, Card, Chip, DataTable, DetailPanel, DqsPair, EmptyState, ErrorState, MasterList, PageHeader, ScoreRuler,
  SeverityPill, SeverityStrip, Sheet, Skeleton, StatTile, FieldChip, useAletheia, useAletheiaScope, useStacked, type Severity,
} from "@/ui/kit";
import { ObjectTabNav, objectPath } from "@/ui/screens/object-tabs/TabFrame";
import { RunLines, ToneBars } from "./Board";
import { answerFor, type PromptId } from "./answers";
import { AllRulesCard, FindingsCard, MonitorStrip, OldRunGate, RelatedObjects, ScoreReceipt } from "./ObjectExtras";
import { compactCount, dqsOf, score as fmt, signed, verdictFor } from "./format";
import { useObjectData, type ObjectData } from "./useObjectData";
import { useObjectRun } from "./useObjectRun";

const sevLabel = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));
const fieldText = (r: RuleRow): string => r.field_description ?? (r.field ? describeField(r.field) ?? "" : "");
const pct = (n: number | null) => (n === null ? t("n/a") : `${Math.round(n)}%`);

const FILTERS = ["critical", "high", "medium", "low"] as const;

const promptsFor = (d: ObjectData): { id: PromptId; text: string }[] => [
  { id: "cap", text: d.capped && d.capLevel !== null ? t("Why is the score stuck at {cap}?", { cap: d.capLevel }) : t("Why is the score not higher?") },
  { id: "fix", text: t("What should I clean first?") },
  { id: "worst", text: t("Which rule hurts this object most?") },
  { id: "target", text: t("How does the target compare?") },
];

export function ObjectScreen({ system, module }: { system: string; module: string }) {
  useInterfaceLang();
  const fx = useFixture();
  const o = useObjectRun(system, module);
  const d = useObjectData(o);
  const [pick, setPick] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [sheet, setSheet] = useState(false);
  const [sev, setSev] = useState<string | null>(null);
  const prev = useReceipt(o.module, o.previous?.id ?? null, !!o.previous?.id);
  const impact = useConfigImpact(o.runId);
  const stacked = useStacked();
  const chat = useAletheia();
  const href = (path: string) => withFixture(path, fx);
  const fixHref = (seg: "proposed" | "manual", rule?: string) => href(d.fixPath(seg, rule));

  const prompts = promptsFor(d);
  // The one shell chat, scoped to this object. The suggested prompts answer from the object's rule data;
  // a typed question streams from /assistant/ask/stream scoped to this module and run (aggregates only).
  useAletheiaScope({
    key: `${system}/${module}`,
    label: t("Asking about {object}", { object: o.label }),
    suggestions: prompts.map((p) => p.text),
    context: { module: o.module, ...(o.runId ? { version_id: o.runId } : {}) },
    answer: (prompt) => {
      const id = prompts.find((p) => p.text === prompt)?.id;
      if (!id) return null;
      return answerFor(id, d, fixHref, (rid) => { setPick(rid); setTab("why"); setSheet(true); chat.setOpen(false); });
    },
  });

  if (d.loading) return <Skeleton lines={8} label={t("Loading the object")} />;
  if (d.error) return <ErrorState heading={t("The object could not be loaded")} retryLabel={t("Try again")} onRetry={d.retry} />;

  const r = d.failing.find((x) => x.check_id === pick) ?? d.failing[0] ?? null;
  const g = r ? d.groups.find((x) => x.check_id === r.check_id) : undefined;
  const max = Math.max(1, ...d.failing.map((x) => x.affected_count));

  const rows = d.failing.slice(0, 10).map((x) => ({
    id: x.check_id,
    severity: x.severity as Severity,
    severityLabel: sevLabel(x.severity),
    code: x.check_id,
    text: x.name,
    field: x.field ? { code: x.field, description: fieldText(x) } : undefined,
    countLabel: t("{n} records", { n: compactCount(x.affected_count) }),
    ratio: x.affected_count / max,
  }));

  const na = t("n/a");
  const labels = { atRisk: t("At risk"), go: t("Go"), cap70: t("Cap at 70"), cap85: t("Cap at 85"), measured: (n: number) => t("Measured {n}", { n }) };
  const rc = d.receipt;
  const measuredNow = rc?.measured ?? d.cell?.raw_score ?? d.now;
  const marks = d.now === null ? [] : [{ id: "object", label: o.label, shown: d.now, measured: d.capped ? measuredNow : null }];
  const oldest = o.heads.length > 1 ? o.heads[o.heads.length - 1] : null;
  const firstScore = oldest ? dqsOf(oldest, o.module) : null;
  const first = oldest && firstScore !== null ? { value: firstScore, label: t("Run {n}: {score}", { n: oldest.run_number ?? "", score: fmt(firstScore) }) } : null;
  const pairScores = d.pair?.last?.scores;
  const proposed = g ? Math.min(g.proposed, g.open) : 0;
  const latest = (o.heads.find((h) => isAnalysed(h.status)) ?? o.heads[0])?.id ?? null;
  const onLatest = !latest || !o.runId || o.runId === latest;
  const verdict = verdictFor(d.cell, o.runId, d.now);
  const breaches = rc?.breaches ?? [];
  const hidden = d.capped && measuredNow !== null && d.now !== null ? measuredNow - d.now : 0;
  const prevDims = new Map((prev.data?.dimensions ?? []).map((x) => [x.key, x.score]));
  const bars = d.dims.map((x) => ({ ...x, delta: x.value !== null && prevDims.get(x.key) != null ? x.value - (prevDims.get(x.key) as number) : null }));
  const points = [...o.heads].reverse().map((h, i) => ({ n: h.run_number ?? i + 1, axis: formatDate(h.run_at, "date"), shown: dqsOf(h, o.module), measured: h.dqs_summary?.[o.module]?.raw_score ?? null }));
  const withScore = points.filter((p) => p.shown !== null);
  const change = withScore.length > 1 ? (withScore[withScore.length - 1].shown as number) - (withScore[0].shown as number) : null;
  const currency = rc?.currency ?? null;
  const rulesHref = href(o.hrefWith(objectPath(system, module, "rules")));
  const shownFail = d.failing.filter((x) => (sev ? x.severity === sev : true)).sort((a, b) => b.affected_count - a.affected_count).slice(0, 10);
  const checked = d.cell?.records_checked ?? rc?.records_checked ?? null;
  const ruleName = new Map(d.failing.map((x) => [x.check_id, x.name]));
  const readiness = (impact.data ?? []).filter((x) => x.status !== "ok");
  const blocked = readiness.filter((x) => x.status === "blocked").length;
  const degraded = readiness.length - blocked;
  const runLabel = o.run ? t("Run {n}, {date}", { n: o.run.run_number ?? "", date: formatDate(o.run.run_at, "datetime") }) : null;

  const detail = r ? (
            <DetailPanel
              idBase="mx-rule"
              label={t("Selected rule")}
              tabsLabel={t("Rule detail")}
              header={<><SeverityPill sev={r.severity} label={sevLabel(r.severity)} /> <h2 className="mx-card-t"><code className="mx-code">{r.check_id}</code> {r.name}</h2></>}
              tabs={[{ id: "overview", label: t("Overview") }, { id: "fix", label: t("Fix"), badge: g ? compactCount(g.open) : undefined }, { id: "why", label: t("Why") }]}
              value={tab}
              onChange={setTab}
            >
              {tab === "overview" ? (
                <dl className="mx-tiles">
                  <StatTile label={t("Records failing")} value={compactCount(r.affected_count)} note={t("of {n} checked", { n: compactCount(r.total_count) })} />
                  <StatTile label={t("Pass rate")} value={pct(r.pass_rate)} bar={r.pass_rate ?? 0} barTone="pass" />
                  {r.field ? <StatTile label={t("Field")} value={<FieldChip code={r.field} description={fieldText(r)} />} /> : null}
                </dl>
              ) : null}
              {tab === "fix" ? (
                g ? (
                  <>
                    <dl className="mx-tiles">
                      <StatTile label={t("Fix proposed")} value={compactCount(proposed)} bar={g.open ? (100 * proposed) / g.open : 0} barTone="pass" />
                      <StatTile label={t("Needs a person")} value={compactCount(g.open - proposed)} bar={g.open ? (100 * (g.open - proposed)) / g.open : 0} barTone="data" />
                    </dl>
                    <OldRunGate runId={o.runId} latest={latest}>
                      <div className="mx-links">
                        <Button variant="primary" href={fixHref("proposed", r.check_id)}>{t("Review fixes")}</Button>
                        <Button variant="secondary" href={fixHref("manual", r.check_id)}>{t("Assign records")}</Button>
                      </div>
                    </OldRunGate>
                  </>
                ) : <p>{t("No work is open for this rule yet.")}</p>
              ) : null}
              {tab === "why" ? (
                <>
                  <p>{r.why || t("The rule sheet shows what it checks and which records fail.")}</p>
                  <div className="mx-links"><Button variant="primary" href={href(`/r/${encodeURIComponent(r.check_id)}`)}>{t("Open the rule")}</Button></div>
                </>
              ) : null}
            </DetailPanel>
  ) : null;

  return (
    <>
      <nav className="mx-crumb" aria-label={t("Breadcrumb")}>
        <span>{o.systemName}</span><span aria-hidden="true">/</span><span aria-current="page">{o.label}</span>
      </nav>
      <PageHeader
        title={o.label}
        context={<>
          {[t("{system}, run {n}", { system: o.systemName, n: o.run?.run_number ?? "" }), d.cell ? t("{n} records checked against {m} rules", { n: compactCount(d.cell.records_checked ?? 0), m: d.measured }) : ""].filter(Boolean).join(", ")}
        </>}
        actions={<>
          {runLabel ? <span className="mx-runlabel" data-testid="run-label">{runLabel}</span> : null}
          <Button variant="secondary" onClick={d.download ?? undefined} disabled={!d.download || d.busy} title={d.download ? undefined : t("No run yet")}>{t("Download workbook")}</Button>
          {onLatest ? <Button variant="primary" href={fixHref("proposed")}>{t("Fix records")}</Button> : <span title={t("This is not the current run, so actions are off. Open the current run to act.")} data-testid="old-run"><Button variant="primary" href={o.hrefWith(`/o/${system}/${module}`, { run: latest })}>{t("Open the current run to act")}</Button></span>}
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      {d.downloadError ? <p role="alert" data-testid="download-error">{d.downloadError}</p> : null}
      <ObjectTabNav o={o} system={system} module={module} active="overview" />
      <section className="mx-hero" aria-label={t("Score")} data-testid="score-hero">
        {d.now !== null ? (
          <>
            <p className="mx-hero-n">{fmt(d.now)}</p>
            {verdict ? <span className="mx-verdict" data-tone={verdict === "go" ? "go" : verdict === "at-risk" ? "watch" : "stop"}>{VERDICT_LABEL[verdict]}</span> : null}
            <p className="mx-hero-s">
              {[
                measuredNow !== null ? t("Measured {n}.", { n: fmt(measuredNow) }) : "",
                d.capped && d.capLevel !== null ? t("Held at the {cap} gate by {n} critical rules.", { cap: d.capLevel, n: breaches.length || d.capIds.length }) : t("No critical rule holds the score down."),
                rc?.coverage != null ? t("Coverage {pct}.", { pct: pct1(rc.coverage) }) : "",
                d.delta !== null ? t("{delta} since the last run.", { delta: signed(d.delta) }) : t("First run."),
              ].filter(Boolean).join(" ")}
            </p>
          </>
        ) : <p className="mx-muted">{na}</p>}
      </section>
      <section className="mx-obj-ruler" aria-label={t("Score")}>
        {d.now !== null ? (
          <>
            <ScoreRuler marks={marks} labels={labels} ariaLabel={t("Score of this object against the gates")} from={stacked ? 50 : 0} showName={false} first={first}
              zones={{ noGo: t("No-go"), atRisk: t("At risk"), go: t("Go") }} />
            {d.capped && hidden > 0 ? <p className="mx-ruler-line" data-testid="release-line">{t("Fix {n} critical rules to release {pts} points and pass the gate", { n: breaches.length || d.capIds.length, pts: fmt(hidden) })}</p> : null}
          </>
        ) : null}
      </section>
      <div className="mx-board-row">
        <Card title={t("Six dimensions")} sub={t("Line marks the 85 go level")}>
          <ToneBars items={bars} naLabel={na} lineLabel={t("Six dimensions")} />
        </Card>
        <Card title={t("Holding the cap")}>
          {breaches.length ? (
            <ul className="mx-capl" data-testid="cap-list">
              {breaches.map((b) => (
                <li key={b.check_id}><code className="mx-code">{b.check_id}</code> <span>{b.name}</span> <span className="mx-muted">{b.failing === null ? DASH : t("{n} records", { n: int(b.failing) })}</span></li>
              ))}
            </ul>
          ) : <p>{d.capped ? DASH : t("No critical rule holds the score down.")}</p>}
        </Card>
        <Card title={t("Score by run")} action={<Button variant="ghost" href={href(`/o/${system}/${module}/trend`)}>{t("Trend")}</Button>}>
          {points.length > 1 ? (
            <>
              <RunLines points={points} ariaLabel={t("Score by run")} labels={{ shown: t("Shown"), measured: t("Measured"), go: t("Go"), gate: t("Gate 70") }} />
              <p className="mx-muted">
                {[change === null ? "" : change >= 0 ? t("Up {n} points in {m} runs.", { n: fmt(change), m: withScore.length }) : t("Down {n} points in {m} runs.", { n: fmt(-change), m: withScore.length }),
                  hidden > 0 ? t("The cap has hidden the last {n}.", { n: fmt(hidden) }) : ""].filter(Boolean).join(" ")}
              </p>
            </>
          ) : <p>{t("Not enough runs to draw a trend yet.")}</p>}
        </Card>
      </div>
      {readiness.length ? (
        <Card title={t("S/4HANA readiness")} sub={t("{b} blocked, {d} degraded", { b: blocked, d: degraded })}>
          <ul className="mx-s4" data-testid="s4-readiness">
            {readiness.map((x) => (
              <li key={x.feature}>
                <span className="mx-s4-f">{x.feature}</span> <Badge tone={x.status === "blocked" ? "bad" : undefined}>{x.status === "blocked" ? t("Blocked") : t("Degraded")}</Badge>
                <span className="mx-s4-r">
                  {x.blocking_findings.map((b) => <span key={b.check_id}><code className="mx-code">{b.check_id}</code> {ruleName.get(b.check_id) ?? ""}</span>)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card title={t("Worst rules, by records affected")} action={<Button variant="ghost" href={rulesHref}>{t("All {n} rules", { n: d.measured })}</Button>}>
        <div className="mx-links" role="group" aria-label={t("Severity")}>
          {FILTERS.map((k) => <Chip key={k} selected={sev === k} onClick={() => setSev(sev === k ? null : k)} count={d.failing.filter((x) => x.severity === k).length}>{sevLabel(k)}</Chip>)}
        </div>
        <DataTable
          label={t("Worst rules, by records affected")}
          rowKey={(x) => x.check_id}
          rows={shownFail}
          height={320}
          columns={[
            { key: "rule", label: t("Rule"), render: (x) => <a href={href(`/r/${encodeURIComponent(x.check_id)}`)}><code className="mx-code">{x.check_id}</code></a> },
            { key: "name", label: t("What it checks"), render: (x) => x.name },
            { key: "field", label: t("Field"), render: (x) => (x.field ? <FieldChip code={x.field} description={fieldText(x)} /> : DASH) },
            { key: "affected", label: checked !== null ? t("Records affected of {n}", { n: int(checked) }) : t("Records affected"), align: "end", render: (x) => int(x.affected_count), sort: (x) => x.affected_count },
            { key: "pass", label: t("Pass"), align: "end", render: (x) => (x.pass_rate === null ? DASH : `${f1(x.pass_rate)}%`), sort: (x) => x.pass_rate ?? 0 },
            { key: "risk", label: currency ? t("{cur} at risk", { cur: currency }) : t("Value at risk"), align: "end", render: (x) => (x.value_at_risk === null ? DASH : int(x.value_at_risk)), sort: (x) => x.value_at_risk ?? 0 },
          ]}
        />
      </Card>
      <AllRulesCard rules={d.all} href={href} />
      <div className="mx-split">
        <div className="mx-col">
          <Card title={t("Score receipt")}>
            <ScoreReceipt receipt={d.receipt} />
          </Card>
          <MonitorStrip module={o.module} />
          <Card title={t("Failing rules by severity")}>
            <SeverityStrip tiles={d.bySev.filter((s) => s.sev !== "info").map((s) => ({ sev: s.sev, label: sevLabel(s.sev), rules: s.rules, records: t("{n} records", { n: compactCount(s.records) }) }))} rulesLabel={(n) => t("{n} rules", { n })} />
          </Card>
          <Card title={t("Source and target")}>
            {pairScores && d.pair ? (
              <>
                <p>{t("{source} to {target}", { source: d.pair.source.name, target: d.pair.target.name })}</p>
                <DqsPair naLabel={na} rows={[
                  { key: "source", label: t("Source DQS"), value: pairScores.source },
                  { key: "projected", label: t("Projected target DQS"), value: pairScores.projected, note: pairScores.projected_reason ?? undefined },
                  { key: "actual", label: t("Actual target DQS"), value: pairScores.actual, note: pairScores.actual_reason ?? undefined },
                ]} reasons={pairScores.reasons.slice(0, 3).map((x) => ({ label: `${x.check_id} ${x.description ?? ""}`.trim(), value: t("{a} to {b}", { a: pct(x.source_pass_rate), b: pct(x.target_pass_rate) }) }))} />
              </>
            ) : <p>{t("No target system is paired with this object yet.")}</p>}
          </Card>
        </div>
        <div className="mx-col">
          <Card title={t("Failing rules")} sub={t("{n} of {m} measured rules fail", { n: d.failing.length, m: d.measured })}>
            {rows.length ? <MasterList rows={rows} selectedId={!stacked || sheet ? r?.check_id ?? null : null} onSelect={(id) => { setPick(id); setSheet(true); }} label={t("Failing rules")} /> : <EmptyState heading={t("No rule fails in this run")} />}
          </Card>
          {!stacked ? detail : null}
          <FindingsCard system={system} module={o.module} latest={onLatest} />
          <RelatedObjects system={system} module={o.module} />
        </div>
      </div>
      <Sheet open={stacked && sheet && r !== null} onClose={() => setSheet(false)} label={t("Selected rule")} closeLabel={t("Close")}>{detail}</Sheet>
    </>
  );
}
