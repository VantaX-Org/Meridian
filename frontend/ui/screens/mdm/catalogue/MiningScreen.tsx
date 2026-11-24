"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { approveAnomalyRule, proposeAnomalyRule, type AnomalyRuleProposal } from "@/lib/api/v2/anomaly-rules";
import { getAnomalies, getDuplicates, getMiningOverview, getPatterns, getRelationships, runMining, LIMITS, type AnomalyItem, type DuplicatePair, type MiningPattern, type RelationshipItem } from "@/lib/api/v2/mining";
import { getVersionsPage } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { AletheiaMark, Button, Code, CodeView, DataTable, Sheet, StatTile, TabPanel, Tabs, useToast } from "@/ui/kit";
import { MiningByObject, MiningSteps } from "./MiningRun";
import { Async, Empty, Head, num, Sev, useRead, useScreenScope, when } from "./shared";
import { displayKey } from "@/lib/v2/work";

const more = (n: number, limit: number) => (n >= limit ? `${num(n)}+` : num(n));

const KIND: Record<AnomalyRuleProposal["grounding"]["kind"], () => string> = {
  outlier: () => t("Values outside the usual range"),
  null_spike: () => t("A jump in blank values"),
  unexpected_code: () => t("A code not seen before"),
};
const LEVEL: Record<"high" | "medium" | "low", () => string> = { high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };

/** Propose a rule from one anomaly, show its dry run and grounding, and approve it as a draft. */
function ProposeSheet({ anomaly, onClose }: { anomaly: AnomalyItem | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const id = anomaly?.id ?? "";
  const q = useRead(["mining", "propose", id], () => proposeAnomalyRule(id), !!anomaly);
  const approve = useMutation({
    mutationFn: (p: AnomalyRuleProposal) => approveAnomalyRule(p.grounding.module, p.rule_yaml ?? "",
      t("Proposed by Aletheia from an anomaly on {field}", { field: p.grounding.field })),
    onSuccess: () => { toast(t("Saved as a draft rule. Review it in the rule workbench."), "good"); void qc.invalidateQueries(); onClose(); },
    onError: () => toast(t("The draft could not be saved"), "bad"),
  });
  return (
    <Sheet open={!!anomaly} onClose={onClose} label={t("Propose a rule")} closeLabel={t("Close")}>
      <h2 className="mx-card-t">{t("Propose a rule")} <AletheiaMark /></h2>
      <Async q={q} lines={4}>
        {(p) => {
          const g = p.grounding;
          return (
            <div className="mx-col" data-testid="anomaly-proposal">
              <p><Code code={g.field} description={g.field_description ?? undefined} /> {KIND[g.kind]()}</p>
              {p.rule_yaml ? <CodeView label={t("Proposed rule")} text={p.rule_yaml} /> : null}
              {p.errors.length ? <ul>{p.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
              <dl className="mx-evidence">
                <dt>{t("Dry run")}</dt>
                <dd>{p.dry_run.evaluated
                  ? t("{hits} of {pop} records would fail, a pass rate of {rate}%", { hits: num(p.dry_run.hits), pop: num(p.dry_run.population), rate: num(p.dry_run.pass_rate) })
                  : t("Not run: {reason}", { reason: p.dry_run.reason ?? t("n/a") })}</dd>
                <dt>{t("Statistic")}</dt>
                <dd>{`${g.statistic.method ?? t("n/a")}, ${t("deviation")} ${num(g.statistic.z_score)}, ${t("usual range")} ${num(g.statistic.lower)} ${t("to")} ${num(g.statistic.upper)}`}</dd>
                <dt>{t("Anomalies on this field")}</dt>
                <dd>{num(g.anomaly_count)}</dd>
                <dt>{t("Drafted by")}</dt>
                <dd>{p.source === "template" ? t("A rule template") : t("The AI, from the field, the statistic and counts only")}</dd>
                {g.ai_sent.length ? <><dt>{t("Sent to the AI")}</dt><dd>{g.ai_sent.join("; ")}</dd></> : null}
                <dt>{t("Confidence")}</dt>
                <dd>{p.confidence ? LEVEL[p.confidence.level]() : t("n/a")}</dd>
              </dl>
              <div className="mx-head-actions">
                <Button variant="primary" tone="aletheia" disabled={!p.valid || !p.rule_yaml || approve.isPending} onClick={() => approve.mutate(p)}>{t("Approve as a draft")}</Button>
                <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
              </div>
            </div>
          );
        }}
      </Async>
    </Sheet>
  );
}

export function MiningScreen() {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("duplicates");
  const [proposing, setProposing] = useState<AnomalyItem | null>(null);
  const sum = useRead(["mining", "summary"], getMiningOverview);
  const dup = useRead(["mining", "dup"], getDuplicates);
  const ano = useRead(["mining", "ano"], getAnomalies);
  const rel = useRead(["mining", "rel"], getRelationships);
  const pat = useRead(["mining", "pat"], getPatterns);
  useScreenScope("mining", t("Data mining"), [
    { prompt: t("What did mining find?"), answer: () => ({ text: `${sum.data?.total_patterns ?? 0} ${t("patterns")}, ${sum.data?.new_anomalies ?? 0} ${t("new anomalies")}` }) },
  ]);
  const run = useMutation({
    mutationFn: async () => {
      const v = (await getVersionsPage({ limit: 1 })).versions[0];
      if (!v) return false;
      await runMining(v.id, v.metadata?.modules ?? []);
      return true;
    },
    onSuccess: (started) => {
      if (!started) { toast(t("There is no run to mine"), "bad"); return; }
      toast(t("Mining started"), "good");
      void qc.invalidateQueries({ queryKey: ["b7b"] });
    },
    onError: () => toast(t("Mining could not be started"), "bad"),
  });
  const d = dup.data ?? []; const a = ano.data ?? []; const r = rel.data ?? []; const p = pat.data?.patterns ?? [];
  return (
    <>
      <Head title={t("Data mining")} actions={<Button variant="primary" disabled={run.isPending} onClick={() => run.mutate()}>{t("Mine the latest run")}</Button>} />
      <Async q={sum} lines={2}>
        {(s) => (
          <dl className="mx-tiles">
            <StatTile label={t("Patterns")} value={num(s.total_patterns)} note={`${s.window_days} ${t("days")}`} />
            <StatTile label={t("New anomalies")} value={num(s.new_anomalies)} />
            <StatTile label={t("Stable patterns")} value={num(s.stable_patterns)} />
            <StatTile label={t("Objects mined")} value={`${s.coverage_pct}%`} note={`${num(s.runs_total)} ${t("runs")}`} />
          </dl>
        )}
      </Async>
      <Tabs idBase="mining" label={t("Mining results")} value={tab} onChange={setTab}
        items={[
          { id: "duplicates", label: t("Duplicates"), badge: more(d.length, LIMITS.duplicates) },
          { id: "anomalies", label: t("Anomalies"), badge: more(a.length, LIMITS.anomalies) },
          { id: "relationships", label: t("Relationships"), badge: more(r.length, LIMITS.relationships) },
          { id: "patterns", label: t("Patterns"), badge: num(p.length) },
          { id: "by-object", label: t("By object") },
          { id: "steps", label: t("Process steps") },
        ]} />
      <TabPanel idBase="mining" value={tab} className="mx-col">
      {tab === "by-object" ? <MiningByObject /> : null}
      {tab === "steps" ? <MiningSteps /> : null}
      {tab === "duplicates" ? <Async q={dup}>{() => d.length ? (
        <DataTable<DuplicatePair> label={t("Duplicates")} rows={d} rowKey={(x) => x.id} height={420}
          columns={[
            { key: "a", label: t("Record A"), sort: (x) => x.record_a, render: (x) => x.record_a },
            { key: "b", label: t("Record B"), sort: (x) => x.record_b, render: (x) => x.record_b },
            { key: "m", label: t("Object"), render: (x) => <Code code={x.module_id} description={moduleText(x.module_id)} /> },
            { key: "f", label: t("Matched fields"), render: (x) => (x.matched_fields ?? []).map((f) => <Code key={f} code={f} description={x.field_texts?.[f]} />) },
            { key: "s", label: t("Match"), align: "end", sort: (x) => x.match_score, render: (x) => `${Math.round(x.match_score * 100)}%` },
          ]} />
      ) : <Empty heading={t("No duplicates found")} />}</Async> : null}
      {tab === "anomalies" ? <Async q={ano}>{() => a.length ? (
        <DataTable<AnomalyItem> label={t("Anomalies")} rows={a} rowKey={(x) => x.id} height={420}
          columns={[
            { key: "f", label: t("Field"), sort: (x) => x.field_name, render: (x) => <Code code={x.field_name} description={x.field_description ?? undefined} /> },
            { key: "k", label: t("Record"), render: (x) => (x.record_key ? displayKey(x.record_key) : t("n/a")) },
            { key: "v", label: t("Value"), align: "end", render: (x) => num(x.field_value) },
            { key: "z", label: t("Usual range"), render: (x) => `${num(x.lower_bound)} ${t("to")} ${num(x.upper_bound)}` },
            { key: "sv", label: t("Severity"), sort: (x) => x.severity, render: (x) => <Sev s={x.severity} /> },
            { key: "p", label: t("Rule"), render: (x) => <Button variant="ghost" tone="aletheia" onClick={() => setProposing(x)}>{t("Propose a rule")}</Button> },
          ]} />
      ) : <Empty heading={t("No anomalies found")} />}</Async> : null}
      {tab === "relationships" ? <Async q={rel}>{() => r.length ? (
        <DataTable<RelationshipItem> label={t("Relationships")} rows={r} rowKey={(x) => x.id} height={420}
          columns={[
            { key: "a", label: t("Field A"), render: (x) => <Code code={x.field_a} description={x.field_a_description ?? undefined} /> },
            { key: "b", label: t("Field B"), render: (x) => <Code code={x.field_b} description={x.field_b_description ?? undefined} /> },
            { key: "t", label: t("Type"), render: (x) => x.relationship_type },
            { key: "s", label: t("Strength"), align: "end", sort: (x) => x.strength_score, render: (x) => x.strength_score.toFixed(2) },
          ]} />
      ) : <Empty heading={t("No relationships found")} />}</Async> : null}
      {tab === "patterns" ? <Async q={pat}>{() => p.length ? (
        <DataTable<MiningPattern> label={t("Patterns")} rows={p} rowKey={(x) => x.id} height={420}
          columns={[
            { key: "n", label: t("Pattern"), sort: (x) => x.name, render: (x) => <Code code={x.name} description={x.field_description ?? undefined} /> },
            { key: "m", label: t("Object"), render: (x) => <Code code={x.module} description={moduleText(x.module)} /> },
            { key: "ty", label: t("Kind"), render: (x) => (x.pattern_type === "anomaly" ? t("Anomaly") : t("Duplicate")) },
            { key: "o", label: t("Seen"), align: "end", sort: (x) => x.occurrences, render: (x) => num(x.occurrences) },
            { key: "l", label: t("Last seen"), render: (x) => when(x.last_seen) },
            { key: "sv", label: t("Severity"), render: (x) => <Sev s={x.severity} /> },
          ]} />
      ) : <Empty heading={t("No patterns yet")} />}</Async> : null}
      </TabPanel>
      <ProposeSheet anomaly={proposing} onClose={() => setProposing(null)} />
    </>
  );
}
