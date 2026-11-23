"use client";

import { useMemo } from "react";
import { isAnalysed } from "@/lib/v2/run-label";
import { formatDate } from "@/lib/format";
import { useConfigImpact } from "@/lib/v2/object-queries";
import { DASH, VERDICT_LABEL, pct1 } from "@/lib/v2/score";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import {
  Badge, Button, Card, ChartSkeleton, DimensionBars, DqsPair, EmptyState, ErrorState, GridSkeleton, HeroSkeleton, KpiStrip, PageHeader, RunLines, ScoreRuler,
  SeverityStrip, Sheet, useAletheia, useAletheiaScope, useStacked, type KpiCell, type Severity,
} from "@/ui/kit";
import { usePaletteContext } from "@/ui/kit/paletteContext";
import { useGridState } from "@/ui/kit/useGridState";
import { ObjectCycle, ObjectTabNav } from "@/ui/screens/object-tabs/TabFrame";
import { useBackAfterClean } from "@/ui/screens/object-tabs/hooks";
import { answerFor, type PromptId } from "./answers";
import { FindingsCard, MonitorStrip, RelatedObjects, ScoreReceipt } from "./ObjectExtras";
import { compactCount, dqsOf, score as fmt, signed, verdictFor } from "./format";
import { ActiveFilters, GRID_KEY, RuleGrid, buildRules, dimLabel, sevLabel, visibleRules } from "./RuleGrid";
import { RulePanel } from "./RulePanel";
import { useObjectData, type ObjectData } from "./useObjectData";
import { useObjectRun } from "./useObjectRun";

const pct = (n: number | null) => (n === null ? t("n/a") : `${Math.round(n)}%`);

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
  const grid = useGridState(GRID_KEY);
  const back = useBackAfterClean();
  const impact = useConfigImpact(o.runId);
  const stacked = useStacked();
  const chat = useAletheia();
  const href = (path: string) => withFixture(path, fx);
  const fixHref = (seg: "proposed" | "manual", rule?: string) => href(d.fixPath(seg, rule));

  const rows = useMemo(() => buildRules(d, back.data), [d, back.data]);
  const shown = useMemo(() => visibleRules(rows, grid), [rows, grid]);
  const hasProposal = d.groups.length > 0;
  const hasBack = !!back.data;
  const open = rows.find((r) => r.check_id === grid.open) ?? null;
  const only = (col: string, v: string) => { grid.clearFilters(); grid.setFilter(col, [v]); };
  const toggle = (col: string, v: string) => { if ((grid.filters[col] ?? []).includes(v) && Object.keys(grid.filters).length === 1) grid.clearFilters(); else only(col, v); };

  const latest = (o.heads.find((h) => isAnalysed(h.status)) ?? o.heads[0])?.id ?? null;
  const onLatest = !latest || !o.runId || o.runId === latest;

  const prompts = promptsFor(d);
  // The one shell chat, scoped to this object. Suggested prompts answer from the object's rule data.
  useAletheiaScope({
    key: `${system}/${module}`,
    label: t("Asking about {object}", { object: o.label }),
    suggestions: prompts.map((p) => p.text),
    context: { module: o.module, ...(o.runId ? { version_id: o.runId } : {}) },
    answer: (prompt) => {
      const id = prompts.find((p) => p.text === prompt)?.id;
      if (!id) return null;
      return answerFor(id, d, fixHref, (rid) => { grid.setOpen(rid); chat.setOpen(false); });
    },
  });
  usePaletteContext(t("This object"), [
    { id: "obj-failing", label: t("Show failing rules"), run: () => only("state", "failing") },
    { id: "obj-critical", label: t("Show critical rules"), run: () => only("severity", "critical") },
    { id: "obj-cap", label: t("Show rules that hold the cap"), run: () => only("cap", "yes") },
    { id: "obj-clear", label: t("Clear rule filters"), run: grid.clearFilters },
    { id: "obj-group-dim", label: t("Group rules by dimension"), run: () => grid.setGroupBy("dim") },
    { id: "obj-group-sev", label: t("Group rules by severity"), run: () => grid.setGroupBy("severity") },
  ]);

  if (d.loading) {
    return (
      <div aria-busy="true">
        <HeroSkeleton label={t("Loading the object")} />
        <div className="mx-board-row"><ChartSkeleton /><ChartSkeleton /><ChartSkeleton /></div>
        <GridSkeleton rows={8} cols={7} label={t("Loading the rules")} />
      </div>
    );
  }
  if (d.error) return <ErrorState heading={t("The object could not be loaded")} retryLabel={t("Try again")} onRetry={d.retry} />;

  const na = t("n/a");
  const rc = d.receipt;
  const measuredNow = rc?.measured ?? d.cell?.raw_score ?? d.now;
  const verdict = verdictFor(d.cell, o.runId, d.now);
  const breaches = rc?.breaches ?? [];
  const capN = breaches.length || d.capIds.length;
  const hidden = d.capped && measuredNow !== null && d.now !== null ? measuredNow - d.now : 0;
  const marks = d.now === null ? [] : [{ id: "object", label: o.label, shown: d.now, measured: d.capped ? measuredNow : null }];
  const oldest = o.heads.length > 1 ? o.heads[o.heads.length - 1] : null;
  const firstScore = oldest ? dqsOf(oldest, o.module) : null;
  const first = oldest && firstScore !== null ? { value: firstScore, label: t("Run {n}: {score}", { n: oldest.run_number ?? "", score: fmt(firstScore) }) } : null;
  const labels = { atRisk: t("At risk"), go: t("Go"), cap70: t("Cap at 70"), cap85: t("Cap at 85"), measured: (n: number) => t("Measured {n}", { n }) };
  const currency = rc?.currency ?? null;
  const checked = d.cell?.records_checked ?? rc?.records_checked ?? null;
  const failingRecords = d.failing.reduce((n, r) => n + r.affected_count, 0);
  const critOver = d.failing.filter((r) => r.severity === "critical").length;
  const withProposal = hasProposal ? rows.filter((r) => r.proposal === "yes").length : null;
  const backRecords = back.data ? (back.data.rules ?? []).filter((x) => rows.some((r) => r.check_id === x.check_id)).reduce((n, x) => n + x.back, 0) : null;
  const sel = (col: string, v: string) => (grid.filters[col] ?? []).includes(v);

  const cells: KpiCell[] = [
    { label: t("Records checked"), value: checked === null ? null : compactCount(checked), note: t("{n} rules measured", { n: d.measured }), onSelect: grid.clearFilters, selected: !Object.keys(grid.filters).length },
    { label: t("Failing records"), value: compactCount(failingRecords), note: t("{n} rules fail", { n: d.failing.length }), onSelect: () => toggle("state", "failing"), selected: sel("state", "failing") },
    { label: t("Critical rules over tolerance"), value: String(critOver), onSelect: () => { grid.clearFilters(); grid.setFilter("severity", ["critical"]); grid.setFilter("state", ["failing"]); }, selected: sel("severity", "critical") && sel("state", "failing") },
    ...(withProposal !== null ? [{ label: t("Rules with a proposal"), value: String(withProposal), onSelect: () => toggle("proposal", "yes"), selected: sel("proposal", "yes") }] : []),
    ...(backRecords !== null ? [{ label: t("Records back after clean"), value: compactCount(backRecords), onSelect: () => toggle("backf", "yes"), selected: sel("backf", "yes") }] : []),
  ];

  const points = [...o.heads].reverse().map((h, i) => ({ n: h.run_number ?? i + 1, axis: formatDate(h.run_at, "date"), shown: dqsOf(h, o.module), measured: h.dqs_summary?.[o.module]?.raw_score ?? null }));
  const withScore = points.filter((p) => p.shown !== null);
  const change = withScore.length > 1 ? (withScore[withScore.length - 1].shown as number) - (withScore[0].shown as number) : null;
  const pairScores = d.pair?.last?.scores;
  const readiness = (impact.data ?? []).filter((x) => x.status !== "ok");
  const blocked = readiness.filter((x) => x.status === "blocked").length;
  const ruleName = new Map(d.all.map((x) => [x.check_id, x.name]));
  const runLabel = o.run ? t("Run {n}, {date}", { n: o.run.run_number ?? "", date: formatDate(o.run.run_at, "datetime") }) : null;
  const filterName = (col: string, v: string) => (col === "severity" ? sevLabel(v) : col === "dim" ? dimLabel(v) : col === "state" ? (v === "failing" ? t("Failing") : t("Passing")) : col === "cap" ? t("Holds the cap") : col === "proposal" ? t("Has a proposal") : col === "backf" ? t("Came back") : v);
  const ruleHref = (id: string) => href(`/r/${encodeURIComponent(id)}`);

  const panel = open ? (
    <RulePanel key={open.check_id} rule={open} siblings={shown.some((x) => x.check_id === open.check_id) ? shown : rows} d={d} side={!stacked} canAct={onLatest} fixHref={fixHref} ruleHref={ruleHref(open.check_id)} onOpen={grid.setOpen} onClose={() => grid.setOpen(null)} />
  ) : null;

  return (
    <>
      <PageHeader
        title={o.label}
        crumbs={[{ label: t("Objects"), href: href("/o") }, { label: o.systemName }, { label: o.label }]}
        stepper={<ObjectCycle system={system} module={module} />}
        meta={[
          o.systemName,
          o.run ? t("Run {n}", { n: o.run.run_number ?? "" }) : null,
          o.run?.run_at ? t("As of {date}", { date: formatDate(o.run.run_at, "datetime") }) : null,
          d.cell ? t("{n} records checked against {m} rules", { n: compactCount(d.cell.records_checked ?? 0), m: d.measured }) : null,
        ]}
        actions={<>
          {runLabel ? <span className="mx-runlabel" data-testid="run-label">{runLabel}</span> : null}
          <Button variant="secondary" onClick={d.download ?? undefined} disabled={!d.download || d.busy} title={d.download ? undefined : t("No run yet")}>{t("Download workbook")}</Button>
          {onLatest ? <Button variant="primary" href={fixHref("proposed")}>{t("Fix records")}</Button> : <span title={t("This is not the current run, so actions are off. Open the current run to act.")} data-testid="old-run"><Button variant="primary" href={o.hrefWith(`/o/${system}/${module}`, { run: latest })}>{t("Open the current run to act")}</Button></span>}
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      {d.downloadError ? <p role="alert" data-testid="download-error">{d.downloadError}</p> : null}
      <ObjectTabNav o={o} system={system} module={module} active="overview" />

      <section className="mx-obj-hero" aria-label={t("Score")} data-testid="score-hero">
        <div className="mx-obj-hero-l">
          {d.now !== null ? (
            <>
              <div className="mx-hero">
                <p className="mx-hero-n">{fmt(d.now)}</p>
                {verdict ? <span className="mx-verdict" data-tone={verdict === "go" ? "go" : verdict === "at-risk" ? "watch" : "stop"}>{VERDICT_LABEL[verdict]}</span> : null}
              </div>
              <p className="mx-hero-s">
                {[
                  measuredNow !== null ? t("Measured {n}.", { n: fmt(measuredNow) }) : "",
                  d.capped && d.capLevel !== null ? t("Held at the {cap} gate by {n} critical rules.", { cap: d.capLevel, n: capN }) : t("No critical rule holds the score down."),
                  rc?.coverage != null ? t("Coverage {pct}.", { pct: pct1(rc.coverage) }) : "",
                  d.delta !== null ? t("{delta} since the last run.", { delta: signed(d.delta) }) : t("First run."),
                ].filter(Boolean).join(" ")}
              </p>
              <div className="mx-obj-ruler">
                <ScoreRuler marks={marks} labels={labels} ariaLabel={t("Score of this object against the gates")} from={stacked ? 50 : 0} showName={false} first={first} zones={{ noGo: t("No-go"), atRisk: t("At risk"), go: t("Go") }} />
                {d.capped && hidden > 0 ? <p className="mx-ruler-line" data-testid="release-line">{t("Fix {n} critical rules to release {pts} points and pass the gate", { n: capN, pts: fmt(hidden) })}</p> : null}
              </div>
              {d.capped && breaches.length ? (
                <div className="mx-capbox" data-testid="cap-list">
                  <p>{t("Holding the cap")}</p>
                  <ul>
                    {breaches.map((b) => (
                      <li key={b.check_id}>
                        <button type="button" className="mx-link" onClick={() => grid.setOpen(b.check_id)}><code className="mx-code">{b.check_id}</code></button> <span>{b.name}</span>{" "}
                        <span className="mx-muted">{b.failing === null ? DASH : t("{n} records", { n: compactCount(b.failing) })}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mx-links">
                    <Button variant="secondary" onClick={() => only("cap", "yes")}>{t("Show these rules")}</Button>
                    {onLatest ? <Button variant="primary" href={fixHref("proposed", d.capIds.join(","))}>{t("Fix the rules that cap the score")}</Button> : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : <p className="mx-muted">{na}</p>}
        </div>
        <div className="mx-obj-hero-r">
          <KpiStrip label={t("Key figures")} cells={cells} />
          <p className="mx-muted">{t("Select a figure to filter the rules below.")}</p>
        </div>
      </section>

      <div className="mx-board-row">
        <Card title={t("Score by run")} action={<Button variant="ghost" href={href(`/o/${system}/${module}/trend`)}>{t("Trend")}</Button>}>
          {points.length > 1 ? (
            <>
              <RunLines points={points} ariaLabel={t("Score by run")} labels={{ shown: t("Shown"), measured: t("Measured"), go: t("Go"), gate: t("Gate 70") }} onSelect={(p) => { const h = [...o.heads].reverse().find((x, i) => (x.run_number ?? i + 1) === p.n); if (h && h.id !== o.runId) window.location.assign(href(o.hrefWith(`/o/${system}/${module}`, { run: h.id }))); }} />
              <p className="mx-muted">
                {[change === null ? "" : change >= 0 ? t("Up {n} points in {m} runs.", { n: fmt(change), m: withScore.length }) : t("Down {n} points in {m} runs.", { n: fmt(-change), m: withScore.length }),
                  hidden > 0 ? t("The cap has hidden the last {n}.", { n: fmt(hidden) }) : ""].filter(Boolean).join(" ")}
              </p>
            </>
          ) : <p>{t("Not enough runs to draw a trend yet.")}</p>}
        </Card>
        <Card title={t("Dimensions")} sub={t("Select one to filter the rules")}>
          <DimensionBars items={d.dims} naLabel={na} selected={Object.entries(grid.filters).find(([c]) => c === "dim")?.[1]?.[0] ?? null} onSelect={(k) => toggle("dim", k)} />
        </Card>
        <Card title={t("Failing records by severity")}>
          <SeverityStrip
            tiles={d.bySev.filter((s) => s.sev !== "info").map((s) => ({ sev: s.sev, label: sevLabel(s.sev), rules: s.rules, records: t("{n} records", { n: compactCount(s.records) }) }))}
            rulesLabel={(n) => t("{n} rules", { n })}
            onSelect={(s) => toggle("severity", s)}
            selected={(grid.filters.severity?.[0] as Severity | undefined) ?? null}
          />
        </Card>
      </div>

      <Card title={t("Every measured rule")} sub={t("{n} of {m} measured rules fail", { n: d.failing.length, m: d.measured })}>
        <ActiveFilters grid={grid} labelFor={filterName} />
        {rows.length ? (
          <div className="mx-obj-grid" data-open={panel && !stacked ? "true" : undefined}>
            <RuleGrid rows={rows} grid={grid} currency={currency} href={href} hasProposal={hasProposal} hasBack={hasBack} />
            {!stacked ? panel : null}
          </div>
        ) : <EmptyState heading={t("No rules measured in this run")} body={t("Open another run to compare.")} />}
        {rows.length && shown.length === 0 ? <EmptyState heading={t("No rule matches these filters")} action={<Button variant="secondary" onClick={grid.clearFilters}>{t("Clear all")}</Button>} /> : null}
      </Card>
      <Sheet open={stacked && panel !== null} onClose={() => grid.setOpen(null)} label={t("Selected rule")} closeLabel={t("Close")}>{panel}</Sheet>

      {readiness.length ? (
        <Card title={t("S/4HANA readiness")} sub={t("{b} blocked, {d} degraded", { b: blocked, d: readiness.length - blocked })}>
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
      <div className="mx-split">
        <div className="mx-col">
          <Card title={t("Score receipt")}><ScoreReceipt receipt={d.receipt} /></Card>
          <MonitorStrip module={o.module} />
        </div>
        <div className="mx-col">
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
          <FindingsCard system={system} module={o.module} latest={onLatest} />
          <RelatedObjects system={system} module={o.module} />
        </div>
      </div>
    </>
  );
}
