"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAnomalies, getDuplicates, getMiningOverview, getPatterns, getRelationships, runMining, LIMITS, type AnomalyItem, type DuplicatePair, type MiningPattern, type RelationshipItem } from "@/lib/api/v2/mining";
import { getVersionsPage } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";
import { Button, Code, DataTable, StatTile, Tabs, useToast } from "@/ui/kit";
import { Async, Empty, Head, num, Sev, useRead, useScreenScope, when } from "./shared";

const more = (n: number, limit: number) => (n >= limit ? `${num(n)}+` : num(n));

export function MiningScreen() {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("duplicates");
  const sum = useRead(["mining", "summary"], getMiningOverview);
  const dup = useRead(["mining", "dup"], getDuplicates);
  const ano = useRead(["mining", "ano"], getAnomalies);
  const rel = useRead(["mining", "rel"], getRelationships);
  const pat = useRead(["mining", "pat"], getPatterns);
  useScreenScope("mining", t("Data mining"), [
    { prompt: t("What did mining find?"), answer: () => ({ text: `${sum.data?.total_patterns ?? 0} ${t("patterns")}, ${sum.data?.new_anomalies ?? 0} ${t("new anomalies")}` }) },
  ]);
  const run = async () => {
    try {
      const v = (await getVersionsPage({ limit: 1 })).versions[0];
      if (!v) { toast(t("There is no run to mine"), "bad"); return; }
      await runMining(v.id, v.metadata?.modules ?? []);
      toast(t("Mining started"), "good");
      await qc.invalidateQueries({ queryKey: ["b7b"] });
    } catch { toast(t("Mining could not be started"), "bad"); }
  };
  const d = dup.data ?? []; const a = ano.data ?? []; const r = rel.data ?? []; const p = pat.data?.patterns ?? [];
  return (
    <>
      <Head title={t("Data mining")} actions={<Button variant="primary" onClick={() => void run()}>{t("Mine the latest run")}</Button>} />
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
        ]} />
      {tab === "duplicates" ? <Async q={dup}>{() => d.length ? (
        <DataTable<DuplicatePair> label={t("Duplicates")} rows={d} rowKey={(x) => x.id} height={420}
          columns={[
            { key: "a", label: t("Record A"), sort: (x) => x.record_a, render: (x) => x.record_a },
            { key: "b", label: t("Record B"), sort: (x) => x.record_b, render: (x) => x.record_b },
            { key: "m", label: t("Object"), render: (x) => <Code code={x.module_id} /> },
            { key: "f", label: t("Matched fields"), render: (x) => (x.matched_fields ?? []).map((f) => <Code key={f} code={f} description={x.field_texts?.[f]} />) },
            { key: "s", label: t("Match"), align: "end", sort: (x) => x.match_score, render: (x) => `${Math.round(x.match_score * 100)}%` },
          ]} />
      ) : <Empty heading={t("No duplicates found")} />}</Async> : null}
      {tab === "anomalies" ? <Async q={ano}>{() => a.length ? (
        <DataTable<AnomalyItem> label={t("Anomalies")} rows={a} rowKey={(x) => x.id} height={420}
          columns={[
            { key: "f", label: t("Field"), sort: (x) => x.field_name, render: (x) => <Code code={x.field_name} description={x.field_description ?? undefined} /> },
            { key: "k", label: t("Record"), render: (x) => x.record_key ?? t("n/a") },
            { key: "v", label: t("Value"), align: "end", render: (x) => num(x.field_value) },
            { key: "z", label: t("Usual range"), render: (x) => `${num(x.lower_bound)} ${t("to")} ${num(x.upper_bound)}` },
            { key: "sv", label: t("Severity"), sort: (x) => x.severity, render: (x) => <Sev s={x.severity} /> },
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
            { key: "m", label: t("Object"), render: (x) => <Code code={x.module} /> },
            { key: "ty", label: t("Kind"), render: (x) => (x.pattern_type === "anomaly" ? t("Anomaly") : t("Duplicate")) },
            { key: "o", label: t("Seen"), align: "end", sort: (x) => x.occurrences, render: (x) => num(x.occurrences) },
            { key: "l", label: t("Last seen"), render: (x) => when(x.last_seen) },
            { key: "sv", label: t("Severity"), render: (x) => <Sev s={x.severity} /> },
          ]} />
      ) : <Empty heading={t("No patterns yet")} />}</Async> : null}
    </>
  );
}
