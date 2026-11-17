"use client";

import { useState } from "react";
import { useFixture } from "@/lib/api/v2/fixture";
import { withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { describeField } from "@/lib/v2/sap-fields";
import type { RuleRow } from "@/lib/api/v2/types";
import {
  Button, Card, DetailPanel, DimensionBars, DqsPair, EmptyState, ErrorState, MasterList, PageHeader, ScoreRing,
  SeverityPill, SeverityStrip, Sheet, Skeleton, StatTile, TrendArea, FieldChip, useAletheia, useAletheiaScope, useStacked, type Severity,
} from "@/ui/kit";
import { answerFor, type PromptId } from "./answers";
import { compactCount, signed } from "./format";
import { useObjectData, type ObjectData } from "./useObjectData";
import { useObjectRun } from "./useObjectRun";

const sevLabel = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));
const fieldText = (r: RuleRow): string => r.field_description ?? (r.field ? describeField(r.field) ?? "" : "");
const pct = (n: number | null) => (n === null ? t("n/a") : `${Math.round(n)}%`);

function CapLine({ d }: { d: ObjectData }) {
  if (!d.capped) return <>{d.capIds.length === 0 ? t("No critical rule is failing, so nothing holds this score down.") : t("A critical rule is failing, but the score is already below the level it would be held at.")}</>;
  return <>{t("Held at {cap} because critical rules fail: {rules}.", { cap: d.capLevel ?? 70, rules: d.capIds.slice(0, 3).join(", ") })}</>;
}

const PROMPTS: { id: PromptId; text: () => string }[] = [
  { id: "worst", text: () => t("Which rule hurts this object most?") },
  { id: "cap", text: () => t("Why is the score held down?") },
  { id: "fix", text: () => t("What can I fix first?") },
  { id: "target", text: () => t("How does the target compare?") },
];

export function ObjectScreen({ system, module }: { system: string; module: string }) {
  useInterfaceLang();
  const fx = useFixture();
  const o = useObjectRun(system, module);
  const d = useObjectData(o);
  const [pick, setPick] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [sheet, setSheet] = useState(false);
  const stacked = useStacked();
  const chat = useAletheia();
  const href = (path: string) => withFixture(path, fx);
  const fixHref = (seg: "proposed" | "manual", rule?: string) => href(d.fixPath(seg, rule));

  // The one shell chat, scoped to this object. The suggested prompts answer from the object's rule data;
  // a typed question streams from /assistant/ask/stream scoped to this module and run (aggregates only).
  useAletheiaScope({
    key: `${system}/${module}`,
    label: t("Asking about {object}", { object: o.label }),
    suggestions: PROMPTS.map((p) => p.text()),
    context: { module: o.module, ...(o.runId ? { version_id: o.runId } : {}) },
    answer: (prompt) => {
      const id = PROMPTS.find((p) => p.text() === prompt)?.id;
      if (!id) return null;
      return answerFor(id, d, fixHref, (rid) => { setPick(rid); setTab("why"); setSheet(true); chat.setOpen(false); });
    },
  });

  if (d.loading) return <Skeleton lines={8} label={t("Loading the object")} />;
  if (d.error) return <ErrorState heading={t("The object could not be loaded")} />;

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
  const pairScores = d.pair?.last?.scores;
  const proposed = g ? Math.min(g.proposed, g.open) : 0;

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
                    <div className="mx-links">
                      <Button variant="primary" href={fixHref("proposed", r.check_id)}>{t("Review fixes")}</Button>
                      <Button variant="secondary" href={fixHref("manual", r.check_id)}>{t("Assign records")}</Button>
                    </div>
                  </>
                ) : <p>{t("No work is open for this rule yet.")}</p>
              ) : null}
              {tab === "why" ? (
                <>
                  <p>{r.why || t("The rule sheet shows what it checks and which records fail.")}</p>
                  <div className="mx-links"><Button variant="primary" href={href(`/more/rules?rule=${encodeURIComponent(r.check_id)}`)}>{t("Open the rule")}</Button></div>
                </>
              ) : null}
            </DetailPanel>
  ) : null;

  return (
    <>
      <PageHeader
        title={o.label}
        context={<>
          {[t("{system}, run {n}", { system: o.systemName, n: o.run?.run_number ?? "" }), d.cell ? t("{n} records checked against {m} rules", { n: compactCount(d.cell.records_checked ?? 0), m: d.measured }) : ""].filter(Boolean).join(", ")}
        </>}
        actions={<>
          <Button variant="primary" href={fixHref("proposed")}>{t("Fix records")}</Button>
          <Button variant="secondary" onClick={d.download ?? undefined} disabled={!d.download || d.busy} title={d.download ? undefined : t("No run yet")}>{t("Download workbook")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      <div className="mx-split">
        <div className="mx-col">
          <Card title={t("Score")}>
            <div className="mx-scoreblock">
              <ScoreRing value={d.now} label={t("Data quality score")} naLabel={na} />
              <div>
                <p>{d.delta === null ? t("First run") : t("{delta} since the last run", { delta: signed(d.delta) })}</p>
                <p className="mx-cap"><CapLine d={d} /></p>
              </div>
            </div>
            <DimensionBars items={d.dims} naLabel={na} />
          </Card>
          <Card title={t("Score over runs")} action={<Button variant="ghost" href={href(`/o/${system}/${module}/trend`)}>{t("Trend")}</Button>}>
            <TrendArea points={d.trend} label={t("Score over runs")} emptyLabel={t("Not enough runs to draw a trend yet.")} />
          </Card>
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
        </div>
      </div>
      <Sheet open={stacked && sheet && r !== null} onClose={() => setSheet(false)} label={t("Selected rule")} closeLabel={t("Close")}>{detail}</Sheet>
    </>
  );
}
