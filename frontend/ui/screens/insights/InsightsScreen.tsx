"use client";

import { useState } from "react";
import {
  getCauseClusters, getCleansing, getExec, getFindings, getImpact, getOverview, getOwners, getProvenCost, getTrends,
  submitInsightFeedback, type AletheiaFinding,
} from "@/lib/api/v2/insights";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { describeField } from "@/lib/v2/sap-fields";
import { BarList, Button, Card, FieldChip, PageHeader, SeverityPill, StatTile, Tabs, TrendArea, useAletheiaScope, useToast } from "@/ui/kit";
import { InsightsBoard } from "./InsightsBoard";
import { Gate, InsightsNav, Mod, Tbl, day, money, n0, n1, pc, sevLabel, sevOf, useQ } from "./shared";

type TabId = "overview" | "rules" | "causes" | "trends" | "cleansing" | "impact" | "cost" | "owners" | "duplicates" | "exec";

/** Two screens of five views each: what was found, and what it costs and who owns it. */
export type InsightSet = "findings" | "money";
const tabItems = (set: InsightSet): { id: TabId; label: string }[] => set === "findings"
  ? [{ id: "overview", label: t("Overview") }, { id: "rules", label: t("Rules") }, { id: "causes", label: t("Root causes") },
     { id: "duplicates", label: t("Duplicates") }, { id: "trends", label: t("Trends") }]
  : [{ id: "impact", label: t("Impact") }, { id: "cost", label: t("Proven cost") }, { id: "cleansing", label: t("Cleansing") },
     { id: "owners", label: t("Owners") }, { id: "exec", label: t("Executive") }];

const fieldChip = (f: string | null) => (f ? <FieldChip code={f} description={describeField(f) ?? ""} /> : t("n/a"));

function Overview() {
  const q = useQ("overview", getOverview);
  const o = q.data;
  return (
    <Gate q={q} empty={!o || o.version_id === null} emptyHeading={t("No run to read yet")} emptyBody={t("Insights appear after the first measured run.")}>
      {o ? (
        <div className="b8-stack">
          {o.narrative ? <p className="b8-narr">{o.narrative}</p> : null}
          <dl className="mx-tiles">
            <StatTile label={t("Data quality score")} value={n1(o.dqs?.composite)} note={o.dqs?.delta === null || o.dqs?.delta === undefined ? t("First run") : t("{delta} since the last run", { delta: n1(o.dqs.delta) })} bar={o.dqs?.composite ?? 0} barTone="pass" />
            <StatTile label={t("Blocking rules")} value={n0(o.blockers?.count)} note={o.blockers?.previous === null || o.blockers?.previous === undefined ? undefined : t("{n} on the last run", { n: n0(o.blockers.previous) })} />
            <StatTile label={t("Fixable by Aletheia")} value={pc(o.auto_fixable?.pct)} note={t("{n} of {m} failing records", { n: n0(o.auto_fixable?.records), m: n0(o.auto_fixable?.failing_records) })} bar={o.auto_fixable?.pct ?? 0} barTone="data" />
            <StatTile label={t("Value at risk")} value={money(o.value_at_risk?.worst_l1_amount, o.value_at_risk?.currency)} note={o.value_at_risk?.worst_l1 ? t("Worst area {l1}, {n} features blocked", { l1: o.value_at_risk.worst_l1, n: n0(o.value_at_risk.features_blocked) }) : undefined} />
          </dl>
          {o.dqs?.capped && o.dqs.cap_reason ? <p className="mx-muted">{o.dqs.cap_reason}</p> : null}
          <p className="mx-muted">{o.run_label ?? o.version_id}, {day(o.run_at)}</p>
          <Rules />
        </div>
      ) : null}
    </Gate>
  );
}

function Rules({ filter }: { filter?: (f: AletheiaFinding) => boolean }) {
  const q = useQ("findings", () => getFindings());
  const rows = (q.data?.findings ?? []).filter(filter ?? (() => true));
  const cur = q.data?.currency;
  return (
    <Gate q={q} empty={rows.length === 0} emptyHeading={filter ? t("No duplicate work found") : t("No failing rules")} emptyBody={filter ? t("Aletheia found no object with duplicates to merge.") : t("Every measured rule passes on the current run.")}>
      <Tbl label={filter ? t("Duplicate findings") : t("Aletheia findings")} rows={rows} rowKey={(r) => r.id} cols={[
        { key: "sev", label: t("Severity"), render: (r) => <SeverityPill sev={sevOf(r.severity)} label={sevLabel(r.severity)} /> },
        { key: "rule", label: t("Rule"), render: (r) => <><FieldChip code={r.check_id} description={r.name} /> <Mod code={r.module} /></> },
        { key: "field", label: t("Field"), render: (r) => fieldChip(r.field) },
        { key: "aff", label: t("Records"), end: true, render: (r) => `${n0(r.affected)}${r.total ? ` / ${n0(r.total)}` : ""}` },
        { key: "fix", label: t("Auto fix"), end: true, render: (r) => pc(r.auto_fix_pct) },
        { key: "cost", label: t("Cost at risk"), end: true, render: (r) => money(r.money.cost_at_risk, r.money.currency || cur) },
        { key: "why", label: t("Why"), render: (r) => (r.why.origin.top ? t("Mostly from {top}", { top: r.why.origin.top }) : t("n/a")) },
        { key: "go", label: t("Action"), render: (r) => (r.action.kind === "merge" || r.action.kind === "across" ? <Button variant="ghost" href="/mdm/match">{t("Review matches")}</Button> : <Button variant="ghost" href={`/o/${r.module}`}>{t("Open the object")}</Button>) },
      ]} />
    </Gate>
  );
}

function Causes() {
  const q = useQ("causes", getCauseClusters);
  const rows = q.data?.clusters ?? [];
  return (
    <Gate q={q} empty={rows.length === 0} emptyHeading={t("No root causes found")} emptyBody={t("Causes group failing rules that share a field and a likely origin.")}>
      <Tbl label={t("Root cause clusters")} rows={rows} rowKey={(r) => r.key} cols={[
        { key: "sev", label: t("Severity"), render: (r) => <SeverityPill sev={sevOf(r.severity)} label={sevLabel(r.severity)} /> },
        { key: "mod", label: t("Object"), render: (r) => <Mod code={r.module} /> },
        { key: "field", label: t("Field"), render: (r) => fieldChip(r.table && r.field ? `${r.table}.${r.field}` : r.field) },
        { key: "rules", label: t("Rules"), render: (r) => r.rules.map((c) => <FieldChip key={c} code={c} description={r.dimension ?? ""} />) },
        { key: "rec", label: t("Records"), end: true, render: (r) => `${r.records_estimated ? "~" : ""}${n0(r.records)}` },
        { key: "fix", label: t("Auto fix"), end: true, render: (r) => pc(r.auto_fix_pct) },
        { key: "origin", label: t("Origin"), render: (r) => (typeof r.origin === "string" ? r.origin : r.origin?.top ?? t("n/a")) },
      ]} />
    </Gate>
  );
}

function Trends() {
  const q = useQ("trends", getTrends);
  const runs = q.data?.runs ?? [];
  return (
    <Gate q={q} empty={runs.length === 0} emptyHeading={t("No runs to compare")} emptyBody={t("Trends need at least two measured runs.")}>
      <div className="b8-stack">
        <TrendArea label={t("Score by run")} emptyLabel={t("No score history")} points={runs.map((r) => ({ axis: day(r.run_at), title: r.label ?? "", value: r.composite }))} />
        <Tbl label={t("Runs")} rows={runs} rowKey={(r) => r.version_id} cols={[
          { key: "run", label: t("Run"), render: (r) => r.label },
          { key: "at", label: t("Date"), render: (r) => day(r.run_at) },
          { key: "score", label: t("Score"), end: true, render: (r) => n1(r.composite) },
          { key: "chg", label: t("Change"), end: true, render: (r) => n1(r.change) },
          { key: "fail", label: t("Failing rules"), end: true, render: (r) => n0(r.failing_rules) },
          { key: "aff", label: t("Affected records"), end: true, render: (r) => n0(r.affected_records) },
          { key: "fixed", label: t("Rules fixed"), end: true, render: (r) => n0(r.rules_fixed) },
          { key: "new", label: t("New rules failing"), end: true, render: (r) => n0(r.rules_new) },
        ]} />
      </div>
    </Gate>
  );
}

function Cleansing() {
  const q = useQ("cleansing", getCleansing);
  const c = q.data;
  return (
    <Gate q={q} empty={!c || c.steps.length === 0} emptyHeading={t("No cleansing pipeline yet")} emptyBody={t("It fills once failing records have proposed fixes.")}>
      {c ? (
        <div className="b8-grid">
          <Card title={t("From failing to fixed")}><BarList label={t("Cleansing steps")} items={c.steps.map((s) => ({ id: s.key, label: s.label, value: s.records, display: n0(s.records) }))} /></Card>
          <Card title={t("By object")}>
            <Tbl label={t("Cleansing by object")} rows={c.by_module} rowKey={(r) => r.module} cols={[
              { key: "m", label: t("Object"), render: (r) => <Mod code={r.module} /> },
              { key: "f", label: t("Failing"), end: true, render: (r) => n0(r.failing) },
              { key: "p", label: t("Proposed"), end: true, render: (r) => n0(r.proposed) },
              { key: "h", label: t("High confidence"), end: true, render: (r) => n0(r.high) },
            ]} />
          </Card>
          <Card title={t("By rule")}>
            <Tbl label={t("Cleansing by rule")} rows={c.by_rule} rowKey={(r) => r.check_id} cols={[
              { key: "r", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={t("Rule")} /> },
              { key: "p", label: t("Proposed"), end: true, render: (r) => n0(r.proposed) },
              { key: "h", label: t("High confidence"), end: true, render: (r) => n0(r.high) },
              { key: "a", label: t("Applied"), end: true, render: (r) => n0(r.auto) },
            ]} />
          </Card>
        </div>
      ) : null}
    </Gate>
  );
}

function Impact() {
  const q = useQ("impact", getImpact);
  const rows = q.data?.rows ?? [];
  return (
    <Gate q={q} empty={rows.length === 0} emptyHeading={t("No business impact mapped")} emptyBody={t("Impact shows which features a failing rule blocks.")}>
      <Tbl label={t("Feature impact")} rows={rows} rowKey={(r) => `${r.l1}/${r.feature}`} cols={[
        { key: "f", label: t("Feature"), render: (r) => r.feature },
        { key: "l1", label: t("Area"), render: (r) => r.l1 },
        { key: "s", label: t("Status"), render: (r) => r.status },
        { key: "rec", label: t("Records"), end: true, render: (r) => n0(r.record_count) },
        { key: "v", label: t("Value per record"), end: true, render: (r) => money(r.value_per_record) },
        { key: "risk", label: t("Value at risk"), end: true, render: (r) => money(r.value_at_risk) },
        { key: "rules", label: t("Causing rules"), render: (r) => (r.causing_rules ?? []).map(String).map((c) => <FieldChip key={c} code={c} description={t("Rule")} />) },
      ]} />
    </Gate>
  );
}

function Cost() {
  const q = useQ("cost", getProvenCost);
  const p = q.data;
  return (
    <Gate q={q} empty={!p || p.rows.length === 0} emptyHeading={t("No proven cost yet")} emptyBody={t("Proven cost counts only documents that cost money because of bad data.")}>
      {p ? (
        <div className="b8-grid">
          <Card title={t("Proven cost by area")}><BarList label={t("Cost by area")} items={p.cost_by_l1.map((r) => ({ id: r.l1, label: r.l1, value: r.amount, display: money(r.amount, p.currency) }))} /></Card>
          <Card title={t("Value at risk by area")}><BarList label={t("Value at risk by area")} items={p.value_at_risk_by_l1.map((r) => ({ id: r.l1, label: r.l1, value: r.value_at_risk, display: money(r.value_at_risk, p.currency) }))} /></Card>
          <Card title={t("What the cost is made of")}>
            <Tbl label={t("Proven cost")} rows={p.rows} rowKey={(r) => r.metric} cols={[
              { key: "m", label: t("Measure"), render: (r) => r.label },
              { key: "l1", label: t("Area"), render: (r) => r.l1 ?? t("n/a") },
              { key: "d", label: t("Documents"), end: true, render: (r) => n0(r.documents) },
              { key: "a", label: t("Amount"), end: true, render: (r) => money(r.amount, r.currency) },
              { key: "c", label: t("Rules"), render: (r) => r.check_ids.map((c) => <FieldChip key={c} code={c} description={t("Rule")} />) },
            ]} />
          </Card>
        </div>
      ) : null}
    </Gate>
  );
}

function Owners() {
  const q = useQ("owners", getOwners);
  const rows = q.data?.owners ?? [];
  return (
    <Gate q={q} empty={rows.length === 0} emptyHeading={t("No owners assigned")} emptyBody={t("Owners appear once findings are assigned to people.")}>
      <Tbl label={t("Owners")} rows={rows} rowKey={(r) => r.owner} cols={[
        { key: "o", label: t("Owner"), render: (r) => r.owner },
        { key: "s", label: t("Score"), end: true, render: (r) => n1(r.score) },
        { key: "d", label: t("Change"), end: true, render: (r) => n1(r.delta) },
        { key: "open", label: t("Open items"), render: (r) => Object.entries(r.open_by_severity ?? {}).filter(([, n]) => n > 0).map(([s, n]) => <SeverityPill key={s} sev={sevOf(s)} label={`${sevLabel(s)} ${n0(n)}`} />) },
        { key: "fx", label: t("Fixed since baseline"), end: true, render: (r) => n0(r.fixed_since_baseline) },
        { key: "age", label: t("Oldest item, days"), end: true, render: (r) => n0(r.oldest_item_age_days) },
        { key: "dg", label: t("Digest"), render: (r) => r.digest ?? t("n/a") },
        { key: "last", label: t("Last sent"), render: (r) => day(r.last_sent) },
      ]} />
    </Gate>
  );
}

function Exec() {
  const q = useQ("exec", getExec);
  const e = q.data;
  return (
    <Gate q={q} empty={!e || e.version_id === null} emptyHeading={t("No executive read yet")} emptyBody={t("It appears after the first measured run.")}>
      {e ? (
        <div className="b8-stack">
          {e.narrative ? <p className="b8-narr">{e.narrative}</p> : null}
          <dl className="mx-tiles">
            <StatTile label={t("Data quality score")} value={n1(e.composite)} bar={e.composite ?? 0} barTone="pass" />
            <StatTile label={t("Score ceiling")} value={n1(e.cap)} note={e.cap_reason ?? undefined} />
          </dl>
          <Card title={t("What holds the score down")}><BarList label={t("Score waterfall")} items={e.waterfall.map((w) => ({ id: w.x, label: w.l1 ? `${w.l1}, ${w.x}` : w.x, value: Math.abs(w.y), display: n1(w.y) }))} /></Card>
        </div>
      ) : null}
    </Gate>
  );
}

function FeedbackBar({ surface, runId }: { surface: string; runId?: string }) {
  const toast = useToast();
  const [sent, setSent] = useState<string | null>(null);
  const vote = (v: "up" | "down") => {
    submitInsightFeedback({ surface, run_id: runId, vote: v })
      .then(() => { setSent(surface); toast(t("Thanks, your feedback is saved.")); })
      .catch(() => toast(t("The feedback could not be sent.")));
  };
  return (
    <div className="b8-feedback">
      <span>{t("Was this useful?")}</span>
      <Button variant="ghost" onClick={() => vote("up")} disabled={sent === surface}>{t("Yes")}</Button>
      <Button variant="ghost" onClick={() => vote("down")} disabled={sent === surface}>{t("No")}</Button>
    </div>
  );
}

export function InsightsScreen({ set = "findings" }: { set?: InsightSet }) {
  useInterfaceLang();
  const items = tabItems(set);
  const [tab, setTab] = useState<TabId>(items[0].id);
  const label = items.find((i) => i.id === tab)?.label ?? "";
  const ov = useQ("overview", getOverview);
  useAletheiaScope({
    key: `insights/${tab}`,
    label: t("Asking about insights, {tab}", { tab: label }),
    suggestions: [t("What should I fix first?"), t("Why did the score move?"), t("Where is the most money at risk?"), t("Which owner needs help?")],
    context: ov.data?.version_id ? { version_id: ov.data.version_id } : undefined,
  });
  return (
    <div className="b8-page">
      {set === "findings"
        ? <PageHeader title={t("Insights")} context={t("What Aletheia found in your data and where it is getting worse.")} actions={<InsightsNav here="insights" />} />
        : <PageHeader title={t("Cost and owners")} context={t("What bad data costs, what cleaning saved and who owns the fix.")} actions={<InsightsNav here="money" />} />}
      {set === "findings" && <InsightsBoard />}
      <Tabs idBase="b8-ins" label={t("Insight views")} items={items} value={tab} onChange={(id) => setTab(id as TabId)} />
      <div id={`b8-ins-panel-${tab}`} role="tabpanel" aria-labelledby={`b8-ins-tab-${tab}`} className="b8-stack">
        {tab === "overview" ? <Overview /> : null}
        {tab === "rules" ? <Rules /> : null}
        {tab === "causes" ? <Causes /> : null}
        {tab === "trends" ? <Trends /> : null}
        {tab === "cleansing" ? <Cleansing /> : null}
        {tab === "impact" ? <Impact /> : null}
        {tab === "cost" ? <Cost /> : null}
        {tab === "owners" ? <Owners /> : null}
        {tab === "duplicates" ? <Rules filter={(f) => f.action.kind === "merge" || f.action.kind === "across"} /> : null}
        {tab === "exec" ? <Exec /> : null}
        <FeedbackBar key={tab} surface={tab} runId={ov.data?.version_id ?? undefined} />
      </div>
    </div>
  );
}
