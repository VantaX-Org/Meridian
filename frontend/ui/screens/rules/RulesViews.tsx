"use client";

import "./rules.css";
import { useState } from "react";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { formatModuleName } from "@/lib/format";
import { describeField } from "@/lib/v2/sap-fields";
import { approveLearned, rejectLearned, type RuleDraft } from "@/lib/api/v2/object";
import { deleteDraft, dryRunDraftBody, publishDraftById } from "@/lib/api/v2/rulelib";
import { approveProposedRule, rejectProposedRule } from "@/lib/api/v2/match-rules";
import { approveFix, rejectFix } from "@/lib/api/v2/fix-drafts";
import { applyPolicyPack, unapplyPolicyPack } from "@/lib/api/v2/step10";
import { Button, Card, Chip, DataTable, EmptyState, ErrorState, FieldChip, SeverityPill, Skeleton, StatTile, YamlView, type Column } from "@/ui/kit";
import type { Severity } from "@/ui/kit/SeverityStrip";
import { compactCount, pct, sevLabel } from "./format";
import { useAccuracy, useAct, useAllDrafts, useCoverage, useFixCoverage, useFixDrafts, useLearnedAll, usePacks, useProposed, useScenarios } from "./queries";

const mod = (m: string) => formatModuleName(m);
const sev = (s: string | null | undefined) => <SeverityPill sev={(s ?? "info") as Severity} label={sevLabel(s)} />;
const field = (f: string) => <FieldChip code={f} description={describeField(f) ?? undefined} />;

function Load({ q, children }: { q: { isLoading: boolean; isError: boolean; refetch: () => unknown }; children: React.ReactNode }) {
  if (q.isLoading) return <Skeleton lines={5} label={t("Loading")} />;
  if (q.isError) return <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  return <>{children}</>;
}

/** Rules generated or proposed for review: dry run, publish, delete. */
export function DraftsView() {
  const fx = useFixture();
  const q = useAllDrafts();
  const [shown, setShown] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});
  const dry = useAct(async (d: RuleDraft) => {
    const r = await dryRunDraftBody({ module: d.domain.replace(/^dq_rule:/, ""), rule_yaml: JSON.stringify(d.proposed_rule) });
    setResult((x) => ({ ...x, [d.id]: r.evaluated ? t("{n} of {m} records fail", { n: compactCount(r.hits), m: compactCount(r.population) }) : r.reason }));
  }, () => t("Dry run done"));
  const pub = useAct((id: string) => publishDraftById(id), () => t("Rule published"));
  const del = useAct((id: string) => deleteDraft(id), () => t("Draft deleted"));
  const rows = q.data ?? [];
  const cols: Column<RuleDraft>[] = [
    { key: "rule", label: t("Rule"), render: (d) => <FieldChip code={d.proposed_rule.id ?? d.id} description={d.proposed_rule.message ?? undefined} /> },
    { key: "mod", label: t("Object"), render: (d) => mod(d.domain.replace(/^dq_rule:/, "")), sort: (d) => d.domain },
    { key: "field", label: t("Field"), render: (d) => (d.proposed_rule.field ? field(d.proposed_rule.field) : "") },
    { key: "sev", label: t("Severity"), render: (d) => sev(d.proposed_rule.severity) },
    { key: "res", label: t("Dry run"), render: (d) => result[d.id] ?? "" },
    { key: "act", label: t("Actions"), render: (d) => (
      <span className="mx-rules-row">
        <Button variant="ghost" onClick={() => setShown(shown === d.id ? null : d.id)}>{t("Show rule")}</Button>
        <Button variant="ghost" disabled={dry.isPending} onClick={() => dry.mutate(d)}>{t("Try it on the data")}</Button>
        <Button variant="secondary" disabled={pub.isPending} onClick={() => pub.mutate(d.id)}>{t("Publish")}</Button>
        <Button variant="ghost" disabled={del.isPending} onClick={() => del.mutate(d.id)}>{t("Delete")}</Button>
      </span>
    ) },
  ];
  const open = rows.find((d) => d.id === shown);
  return (
    <Load q={q}>
      {rows.length ? (
        <>
          <DataTable columns={cols} rows={rows} rowKey={(d) => d.id} label={t("Draft rules")} />
          {open ? <Card title={open.proposed_rule.id ?? open.id} sub={open.rationale ?? undefined}><YamlView label={t("Rule definition")} text={JSON.stringify(open.proposed_rule, null, 2)} /></Card> : null}
        </>
      ) : <EmptyState heading={t("No draft rules")} body={t("Write a rule or let Aletheia propose one; it waits here for review.")} action={<Button variant="primary" href={withFixture("/rules/dry-run", fx)}>{t("Write a rule")}</Button>} />}
    </Load>
  );
}

/** Rules mined from the data and from stewards' fixes, plus rules the matching engine proposes. */
export function LearnedView({ modules }: { modules: string[] }) {
  const results = useLearnedAll(modules);
  const prop = useProposed();
  const ok = useAct((a: { id: string; s: "high" | "medium" }) => approveLearned(a.id, a.s), () => t("Learned rule approved"));
  const no = useAct((id: string) => rejectLearned(id), () => t("Learned rule rejected"));
  const pOk = useAct((id: string) => approveProposedRule(id), () => t("Proposed rule approved"));
  const pNo = useAct((id: string) => rejectProposedRule(id, t("Not useful")), () => t("Proposed rule rejected"));
  const rows = results.flatMap((r) => r.data ?? []).filter((p) => p.status === "pending");
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "field", label: t("Field"), render: (p) => field(p.field) },
    { key: "mod", label: t("Object"), render: (p) => mod(p.module), sort: (p) => p.module },
    { key: "kind", label: t("Kind"), render: (p) => p.kind.replace(/_/g, " ") },
    { key: "src", label: t("Learned from"), render: (p) => (p.source === "fixes" ? t("Stewards' fixes") : t("The data")) },
    { key: "conf", label: t("Confidence"), render: (p) => pct(p.confidence), sort: (p) => p.confidence, align: "end" },
    { key: "sup", label: t("Rows backing it"), render: (p) => compactCount(p.support_rows), sort: (p) => p.support_rows, align: "end" },
    { key: "vio", label: t("Rows breaking it"), render: (p) => compactCount(p.violations), sort: (p) => p.violations, align: "end" },
    { key: "act", label: t("Actions"), render: (p) => (
      <span className="mx-rules-row">
        <Button variant="secondary" disabled={ok.isPending} onClick={() => ok.mutate({ id: p.id, s: "medium" })}>{t("Approve as a rule")}</Button>
        <Button variant="ghost" disabled={no.isPending} onClick={() => no.mutate(p.id)}>{t("Reject")}</Button>
      </span>
    ) },
  ];
  const prules = prop.data?.rules ?? [];
  return (
    <div className="mx-col">
      <Card title={t("Learned from the data and from fixes")} sub={t("{n} waiting for review", { n: rows.length })}>
        {results.some((r) => r.isLoading) ? <Skeleton lines={4} label={t("Loading")} /> : rows.length
          ? <DataTable columns={cols} rows={rows} rowKey={(p) => p.id} label={t("Learned rules")} />
          : <EmptyState heading={t("Nothing learned yet")} body={t("Rules the engine mines from clean data and from stewards' fixes appear here.")} />}
      </Card>
      <Card title={t("Proposed by Aletheia")} sub={t("{n} waiting for review", { n: prules.length })}>
        <Load q={prop}>
          {prules.length ? (
            <DataTable
              columns={[
                { key: "field", label: t("Field"), render: (r: (typeof prules)[number]) => (r.proposed_rule.field ? field(r.proposed_rule.field) : r.id) },
                { key: "dom", label: t("Object"), render: (r) => mod(r.domain.replace(/^dq_rule:|^match:/, "")) },
                { key: "why", label: t("Why"), render: (r) => r.rationale },
                { key: "n", label: t("Corrections backing it"), render: (r) => compactCount(r.supporting_correction_count), align: "end" },
                { key: "act", label: t("Actions"), render: (r) => (
                  <span className="mx-rules-row">
                    <Button variant="secondary" disabled={pOk.isPending} onClick={() => pOk.mutate(r.id)}>{t("Approve")}</Button>
                    <Button variant="ghost" disabled={pNo.isPending} onClick={() => pNo.mutate(r.id)}>{t("Reject")}</Button>
                  </span>
                ) },
              ]}
              rows={prules}
              rowKey={(r) => r.id}
              label={t("Proposed rules")}
            />
          ) : <EmptyState heading={t("No proposals")} body={t("Aletheia proposes rules from the corrections stewards make.")} />}
        </Load>
      </Card>
    </div>
  );
}

const SCENARIOS = ["new_implementation", "system_conversion", "selective_transition", "carve_out"] as const;
const scenarioName = (s: string) => (s === "new_implementation" ? t("New implementation") : s === "system_conversion" ? t("System conversion") : s === "selective_transition" ? t("Selective transition") : t("Carve-out"));

/** Rule coverage per object, how right the rules are against injected errors, and what each migration path needs. */
export function CoverageView({ modules }: { modules: string[] }) {
  const cov = useCoverage(modules);
  const acc = useAccuracy();
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]>("new_implementation");
  const sc = useScenarios(scenario);
  const covRows = cov.flatMap((c) => (c.data ? [c.data] : []));
  const accRows = acc.data?.rules ?? [];
  const scenarioInfo = sc.data?.scenarios.find((s) => s.id === scenario);
  const scRules = sc.data?.rules ?? [];
  return (
    <div className="mx-col">
      <Card title={t("Coverage by object")} sub={t("Rules per object and how many have never run")}>
        {cov.some((c) => c.isLoading) && !covRows.length ? <Skeleton lines={5} label={t("Loading")} /> : (
          <DataTable
            columns={[
              { key: "m", label: t("Object"), render: (c: (typeof covRows)[number]) => mod(c.module), sort: (c) => c.module },
              { key: "r", label: t("Rules"), render: (c) => compactCount(c.totals.rules), sort: (c) => c.totals.rules, align: "end" },
              { key: "n", label: t("Never run"), render: (c) => compactCount(c.totals.never_run), sort: (c) => c.totals.never_run, align: "end" },
              { key: "v", label: t("Views"), render: (c) => compactCount(c.totals.views), sort: (c) => c.totals.views, align: "end" },
              { key: "t", label: t("Tables"), render: (c) => compactCount(c.totals.tables), sort: (c) => c.totals.tables, align: "end" },
              { key: "d", label: t("By dimension"), render: (c) => Object.entries(c.object.by_dimension).map(([k, v]) => `${k} ${String(v)}`).join(", ") },
            ]}
            rows={covRows}
            rowKey={(c) => c.module}
            label={t("Coverage by object")}
          />
        )}
      </Card>
      <Card title={t("Accuracy against injected errors")} sub={acc.data?.method}>
        <Load q={acc}>
          {accRows.length ? (
            <DataTable
              columns={[
                { key: "r", label: t("Rule"), render: (r: (typeof accRows)[number]) => <FieldChip code={r.rule_id} description={r.check_class} /> },
                { key: "m", label: t("Object"), render: (r) => (r.module ? mod(r.module) : t("n/a")), sort: (r) => r.module ?? "" },
                { key: "p", label: t("Precision"), render: (r) => pct(r.precision), sort: (r) => r.precision, align: "end" },
                { key: "c", label: t("Recall"), render: (r) => pct(r.recall), sort: (r) => r.recall, align: "end" },
                { key: "f", label: t("F1"), render: (r) => pct(r.f1), sort: (r) => r.f1, align: "end" },
                { key: "i", label: t("Errors injected"), render: (r) => compactCount(r.injected), align: "end" },
              ]}
              rows={accRows}
              rowKey={(r) => r.rule_id}
              label={t("Rule accuracy")}
            />
          ) : <EmptyState heading={t("No accuracy run yet")} body={t("Accuracy appears after a benchmark run injects known errors.")} />}
        </Load>
      </Card>
      <Card title={t("What each migration path needs")} sub={scenarioInfo?.description}>
        <div className="mx-rules-row" role="group" aria-label={t("Migration path")}>
          {SCENARIOS.map((s) => <Chip key={s} selected={s === scenario} onClick={() => setScenario(s)}>{scenarioName(s)}</Chip>)}
        </div>
        <Load q={sc}>
          {scenarioInfo ? (
            <dl className="mx-tiles">
              <StatTile label={t("Required")} value={String(scenarioInfo.counts.required)} />
              <StatTile label={t("Recommended")} value={String(scenarioInfo.counts.recommended)} />
              <StatTile label={t("Not applicable")} value={String(scenarioInfo.counts.not_applicable)} />
              <StatTile label={t("Blocking")} value={String(scenarioInfo.blocking)} />
            </dl>
          ) : null}
          {scRules.length ? (
            <DataTable
              columns={[
                { key: "r", label: t("Rule"), render: (r: (typeof scRules)[number]) => <FieldChip code={r.id} description={r.message ?? undefined} /> },
                { key: "m", label: t("Object"), render: (r) => mod(r.module), sort: (r) => r.module },
                { key: "f", label: t("Field"), render: (r) => (r.field ? field(r.field) : t("n/a")) },
                { key: "a", label: t("S/4HANA area"), render: (r) => r.s4_area },
                { key: "i", label: t("Impact"), render: (r) => r.impact_note },
              ]}
              rows={scRules}
              rowKey={(r) => r.id}
              label={t("Rules needed by this path")}
            />
          ) : null}
        </Load>
      </Card>
    </div>
  );
}

/** Regulatory and policy packs: apply one and its rules measure against the authority. */
export function PacksView() {
  const q = usePacks();
  const on = useAct((id: string) => applyPolicyPack(id), () => t("Pack applied"));
  const off = useAct((id: string) => unapplyPolicyPack(id), () => t("Pack removed"));
  const packs = q.data?.packs ?? [];
  return (
    <Load q={q}>
      {packs.length ? (
        <div className="mx-col">
          {packs.map((p) => (
            <Card
              key={p.id}
              title={p.name}
              sub={p.authority}
              action={p.applied
                ? <Button variant="ghost" disabled={off.isPending} onClick={() => off.mutate(p.id)}>{t("Remove the pack")}</Button>
                : <Button variant="secondary" disabled={on.isPending} onClick={() => on.mutate(p.id)}>{t("Apply the pack")}</Button>}
            >
              <p className="mx-muted">{p.description}</p>
              <dl className="mx-tiles">
                <StatTile label={t("Fields classified")} value={compactCount(p.coverage.fields_classified)} />
                <StatTile label={t("Rules measured")} value={`${compactCount(p.coverage.rules_measured)} / ${compactCount(p.coverage.rules_evidencing)}`} />
                <StatTile label={t("Failing records")} value={compactCount(p.coverage.failing_records)} />
                <StatTile label={t("Classes breached")} value={compactCount(p.coverage.classes_breached)} />
              </dl>
            </Card>
          ))}
        </div>
      ) : <EmptyState heading={t("No policy packs")} body={t("Add a policy pack to group rules for a team.")} />}
    </Load>
  );
}

/** Fix recipes Aletheia drafted for rules; a person approves or rejects each. */
export function FixDraftsView({ fixture }: { fixture: boolean }) {
  const q = useFixDrafts();
  const cov = useFixCoverage().data?.modules ?? [];
  const ok = useAct((id: string) => approveFix(id), () => t("Fix approved"));
  const no = useAct((id: string) => rejectFix(id), () => t("Fix rejected"));
  const rows = q.data?.drafts ?? [];
  return (
    <div className="mx-col">
      <dl className="mx-tiles">
        {cov.map((c) => <StatTile key={c.module} label={mod(c.module)} value={`${c.with_fix} / ${c.rules}`} note={t("rules with a drafted fix")} bar={c.rules ? c.with_fix / c.rules : 0} />)}
      </dl>
      <Load q={q}>
        {rows.length ? (
          <DataTable
            columns={[
              { key: "r", label: t("Rule"), render: (d: (typeof rows)[number]) => <FieldChip code={d.rule_id} description={d.rule_text ?? undefined} />, sort: (d) => d.rule_id },
              { key: "f", label: t("Field"), render: (d) => field(d.field) },
              { key: "m", label: t("Object"), render: (d) => (d.module ? mod(d.module) : "") },
              { key: "s", label: t("Status"), render: (d) => (d.status === "approved" ? t("Approved") : d.status === "rejected" ? t("Rejected") : t("Waiting")), sort: (d) => d.status },
              { key: "c", label: t("Confidence"), render: (d) => d.confidence ?? "" },
              { key: "a", label: t("Actions"), render: (d) => (
                <span className="mx-rules-row">
                  <Button variant="ghost" href={withFixture(`/r/${encodeURIComponent(d.rule_id)}`, fixture)}>{t("Open the rule")}</Button>
                  <Button variant="secondary" disabled={d.status === "approved" || ok.isPending} onClick={() => ok.mutate(d.rule_id)}>{t("Approve")}</Button>
                  <Button variant="ghost" disabled={d.status === "rejected" || no.isPending} onClick={() => no.mutate(d.rule_id)}>{t("Reject")}</Button>
                </span>
              ) },
            ]}
            rows={rows}
            rowKey={(d) => d.rule_id}
            label={t("Fix drafts")}
          />
        ) : <EmptyState heading={t("No fix drafts")} body={t("Open a rule and draft a fix from its Fix tab.")} />}
      </Load>
    </div>
  );
}
