"use client";

import "./rules.css";
import { useMemo, useState } from "react";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { money } from "@/lib/v2/format";
import { describeField } from "@/lib/v2/sap-fields";
import { useConfigImpact, useRuleFailuresBy, useRuleHistory, useStewards, useWorkGroups } from "@/lib/v2/object-queries";
import { useObjectRules, useReceipt } from "@/lib/v2/queries";
import { RECORDS_PAGE, useFailingRecords, type FailingRecord } from "@/lib/api/next/failing";
import { acceptAllInGroup, decide, downloadFixSheet } from "@/lib/api/work";
import type { RuleRun, RuleScope } from "@/lib/api/v2/object";
import { BarList, Button, Card, DataTable, EmptyState, FieldChip, Select, Skeleton, StatTile, YamlView, type Column } from "@/ui/kit";
import { compactCount, pct, sevLabel } from "./format";
import { useAct, useRuleReads } from "./queries";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (d: number) => `${d > 0 ? "+" : d < 0 ? "-" : ""}${compactCount(Math.abs(d))}`;
const asPct = (n: number | null | undefined) => (n === null || n === undefined ? null : n <= 1 ? n * 100 : n);

/** One pace sentence from the stored runs only: the average change per run and, when falling, the runs to clear. */
export function paceLine(runs: RuleRun[]): string | null {
  const c = [...runs].reverse();
  if (c.length < 3) return null;
  const first = c[0].affected_count;
  const last = c[c.length - 1].affected_count;
  const per = (last - first) / (c.length - 1);
  if (per < 0 && last > 0) return t("Falling by about {n} records per run; at this pace it clears in {r} more runs.", { n: compactCount(Math.round(-per)), r: Math.ceil(last / -per) });
  if (per < 0) return t("Falling by about {n} records per run and now at zero.", { n: compactCount(Math.round(-per)) });
  if (per > 0) return t("Rising by about {n} records per run; it does not clear at this pace.", { n: compactCount(Math.round(per)) });
  return t("Flat across the last {n} runs.", { n: c.length });
}

/** Failing records per run as columns, oldest to newest. Real SVG, no data beyond the stored history. */
function RunColumns({ runs }: { runs: RuleRun[] }) {
  const c = [...runs].reverse();
  const W = 480;
  const H = 150;
  const top = 18;
  const base = H - 22;
  const max = Math.max(1, ...c.map((r) => r.affected_count));
  const step = W / c.length;
  const bw = Math.min(40, step * 0.6);
  return (
    <svg className="mx-rule-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Failing records in each of the last {n} runs", { n: c.length })}>
      <line className="mx-rl-gate" x1={0} x2={W} y1={base} y2={base} />
      {c.map((r, i) => {
        const h = Math.max(1, (r.affected_count / max) * (base - top));
        const x = i * step + (step - bw) / 2;
        return (
          <g key={r.version_id}>
            <rect className="mx-rule-col" data-latest={i === c.length - 1 ? "" : undefined} x={x} y={base - h} width={bw} height={h} rx={3}>
              <title>{`${r.run_at.slice(0, 10)}: ${r.affected_count}`}</title>
            </rect>
            <text className="mx-rule-tx" x={x + bw / 2} y={base - h - 5} textAnchor="middle">{compactCount(r.affected_count)}</text>
            <text className="mx-rule-tx" x={x + bw / 2} y={H - 6} textAnchor="middle">{r.run_at.slice(5, 10)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Params that are lists of plain values: the valid values of a domain check. */
const listParams = (p: Record<string, unknown>): [string, string[]][] =>
  Object.entries(p).filter((e): e is [string, (string | number)[]] => Array.isArray(e[1]) && e[1].length > 0 && e[1].every((v) => typeof v === "string" || typeof v === "number")).map(([k, v]) => [k, v.map(String)]);

export function RuleBoard({ id, scope }: { id: string; scope: RuleScope }) {
  const fx = useFixture();
  const d = scope.definition;
  const hist = useRuleHistory(id).data ?? [];
  const run = hist[0]?.version_id ?? scope.objects[0]?.run_id ?? null;
  const module = scope.module ?? scope.objects[0]?.module ?? "";
  const rules = useObjectRules(module, run).data ?? [];
  const row = rules.find((r) => r.check_id === id);
  const receipt = useReceipt(module, run, Boolean(module && run)).data;
  const groups = useWorkGroups(module, run, Boolean(module)).data ?? [];
  const impact = useConfigImpact(run).data ?? [];
  const by = useRuleFailuresBy(id).data;
  const reads = useRuleReads(id).data;

  const latest = hist[0];
  const prev = hist[1];
  const failing = latest?.affected_count ?? scope.failing_records;
  const total = latest?.total_count ?? row?.total_count ?? null;
  const rate = asPct(latest?.pass_rate ?? row?.pass_rate);
  const group = groups.find((g) => g.check_id === id);
  const names = useMemo(() => new Map(rules.map((r) => [r.check_id, r.name])), [rules]);

  const vars = rules.filter((r) => r.value_at_risk !== null && r.value_at_risk !== undefined).sort((a, b) => (b.value_at_risk ?? 0) - (a.value_at_risk ?? 0));
  const rank = vars.findIndex((r) => r.check_id === id) + 1;
  const var_ = row?.value_at_risk ?? null;
  const cur = receipt?.currency ?? null;

  const blocks = impact.filter((r) => r.status !== "ok" && r.blocking_findings.some((f) => f.check_id === id));
  const pace = paceLine(hist);
  const field = d.field;
  const fieldText = field ? (describeField(field) ?? row?.field_description ?? "") : "";
  const valid = listParams(d.params);
  const dimension = row?.dimension ?? d.dimension;
  const owner = reads?.owners.map((o) => o.owner_name ?? o.steward_name).find(Boolean);

  return (
    <div className="mx-rule-stack">
      <dl className="mx-tiles" aria-label={t("Rule in this run")}>
        <StatTile
          label={t("Records failing in this run")}
          value={compactCount(failing)}
          note={[prev ? t("{delta} vs the previous run", { delta: signed(failing - prev.affected_count) }) : "", total !== null ? t("of {n} records", { n: compactCount(total) }) : ""].filter(Boolean).join(", ")}
        />
        <StatTile
          label={t("Pass rate")}
          value={pct(latest?.pass_rate ?? row?.pass_rate)}
          note={total !== null ? t("{n} records pass", { n: compactCount(Math.max(0, total - failing)) }) : undefined}
          bar={rate ?? undefined}
          barTone="pass"
        />
        <StatTile
          label={t("Value at risk")}
          value={var_ === null ? t("n/a") : cur ? money(var_, cur) : compactCount(var_)}
          note={rank && vars.length > 1 ? t("Rank {r} of {n} rules by value at risk", { r: rank, n: vars.length }) : undefined}
        />
        <StatTile
          label={t("Proposed fixes ready for auto-cleanse")}
          value={group ? compactCount(group.proposed) : t("n/a")}
          note={group ? t("of {n} open records", { n: compactCount(group.open) }) : undefined}
        />
        <StatTile label={t("S/4HANA features blocked until it passes")} value={blocks.length} />
      </dl>

      <div className="mx-rule-pair">
        <Card title={t("What the rule checks")}>
          <div className="mx-rules-form">
            <p>{d.message ?? id}</p>
            <div className="mx-rules-row">
              {field ? <FieldChip code={field} description={fieldText} /> : <span className="mx-muted">{t("No field: the rule reads the whole record")}</span>}
              {d.table ? <span className="mx-muted">{t("Check table {table}", { table: d.table })}</span> : null}
            </div>
            <YamlView label={t("Rule expression")} text={d.expression || JSON.stringify(d.params, null, 2)} />
            {valid.map(([k, vs]) => (
              <div key={k} className="mx-rules-form">
                <span className="mx-muted">{t("Valid values in {key}", { key: k })}</span>
                <div className="mx-rules-row">{vs.slice(0, 24).map((v) => <code key={v} className="mx-code">{v}</code>)}{vs.length > 24 ? <span className="mx-muted">{t("and {n} more", { n: vs.length - 24 })}</span> : null}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t("Failing records by run")} sub={pace ?? undefined}>
          {hist.length ? <RunColumns runs={hist} /> : <EmptyState heading={t("This rule has not run yet")} />}
        </Card>
      </div>

      <Card title={t("Where it fails")}>
        {by?.groups.length ? (
          <div className="mx-rule-pair">
            {by.groups.slice(0, 2).map((g) => {
              const sum = g.values.reduce((a, v) => a + v.records, 0) || 1;
              return (
                <div key={g.field} className="mx-rules-form">
                  <h3 className="mx-card-t">{t("By {field}", { field: g.field })}</h3>
                  <DataTable
                    label={t("Failures by {field}", { field: g.field })}
                    rowKey={(v) => v.value}
                    rows={g.values}
                    height={240}
                    columns={[
                      { key: "value", label: t("Value found"), render: (v) => <code className="mx-code">{v.value}</code> },
                      { key: "records", label: t("Records"), align: "end", sort: (v) => v.records, render: (v) => compactCount(v.records) },
                      { key: "share", label: t("Share"), align: "end", render: (v) => `${Math.round((v.records / sum) * 100)}%` },
                    ]}
                  />
                </div>
              );
            })}
            {by.groups.slice(2).map((g) => (
              <BarList key={g.field} label={t("By {field}", { field: g.field })} items={g.values.slice(0, 6).map((v) => ({ id: v.value, label: `${g.field} ${v.value}`, value: v.records, display: compactCount(v.records) }))} />
            ))}
          </div>
        ) : <EmptyState heading={t("No split of the failures is available.")} />}
      </Card>

      {blocks.length ? (
        <Card title={t("What it blocks in S/4HANA")}>
          <ul className="mx-rules-list" aria-label={t("Blocked S/4HANA features")}>
            {blocks.map((b) => {
              const others = b.blocking_findings.filter((f) => f.check_id !== id);
              return (
                <li key={`${b.system}/${b.feature}`} className="mx-rules-item">
                  <span><strong>{b.feature}</strong> <span className="mx-muted">{b.status === "blocked" ? t("Blocked") : t("Degraded")}</span></span>
                  {b.opportunity_cost_summary ? <span className="mx-muted">{b.opportunity_cost_summary}</span> : null}
                  {others.length ? (
                    <span className="mx-rules-row">
                      <span className="mx-muted">{t("Also held by")}</span>
                      {others.map((o) => <a key={o.check_id} className="mx-code" href={withFixture(`/r/${encodeURIComponent(o.check_id)}`, fx)} title={names.get(o.check_id) ?? o.check_id}>{o.check_id}</a>)}
                    </span>
                  ) : <span className="mx-muted">{t("No other rule holds it")}</span>}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <p className="mx-muted mx-rule-foot">
        {[owner ? t("Owner {owner}", { owner }) : "", dimension ? t("Dimension {dimension}", { dimension: cap(dimension) }) : "", t("Severity {severity}", { severity: sevLabel(d.severity) })].filter(Boolean).join(", ")}
      </p>

      <FailingRecordsTable id={id} run={run} module={module} />
    </div>
  );
}

function FailingRecordsTable({ id, run, module }: { id: string; run: string | null; module: string }) {
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [steward, setSteward] = useState("");
  const q = useFailingRecords(run, id, offset);
  const stewards = useStewards(true).data ?? [];
  const items = q.data?.items ?? [];
  const n = q.data?.total ?? 0;
  const chosen = items.filter((r) => sel.has(r.record_key));
  const fixable = chosen.filter((r) => r.expected_value !== null);
  const toggle = (k: string) => setSel((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });
  const all = items.length > 0 && items.every((r) => sel.has(r.record_key));

  const apply = useAct(() => decide(fixable.map((r) => ({ module, record_key: r.record_key, check_id: id, action: "accept" as const })), run ?? undefined), () => t("Fixes applied"));
  const applyAll = useAct(() => acceptAllInGroup(id, run ?? undefined), () => t("Every proposed fix applied"));
  const sheet = useAct(() => downloadFixSheet({ version_id: run ?? undefined, module, check_id: id }), () => t("Workbook downloaded"));
  const assign = useAct(() => decide(chosen.map((r) => ({ module, record_key: r.record_key, check_id: id, action: "assign" as const, assignee: steward })), run ?? undefined), () => t("Records assigned"));

  const cols: Column<FailingRecord>[] = [
    { key: "pick", label: t("Select"), render: (r) => <input type="checkbox" checked={sel.has(r.record_key)} onChange={() => toggle(r.record_key)} aria-label={t("Select record {key}", { key: r.record_key })} /> },
    { key: "record_key", label: t("Record"), render: (r) => <code className="mx-code">{r.record_key}</code> },
    { key: "field", label: t("Field"), render: (r) => (r.field ? <FieldChip code={r.field} description={describeField(r.field) ?? r.field_text?.split(" / ")[1] ?? ""} /> : <span className="mx-muted">{t("n/a")}</span>) },
    { key: "current_value", label: t("Value found"), render: (r) => String(r.current_value ?? "") },
    { key: "expected_value", label: t("Proposed fix"), render: (r) => (r.expected_value === null ? <span className="mx-muted">{t("No fix proposed")}</span> : String(r.expected_value)) },
  ];

  return (
    <Card title={t("Failing records")} sub={run ? undefined : t("This rule has not run yet")}>
      <div id="mx-rule-records" className="mx-rules-form">
        {!run ? <EmptyState heading={t("This rule has not run yet")} /> : q.isLoading ? <Skeleton lines={5} label={t("Loading the records")} /> : (
          <>
            <div className="mx-rules-row" role="toolbar" aria-label={t("Bulk actions")}>
              <label className="mx-rules-row"><input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(items.map((r) => r.record_key)))} /> {t("Select this page")}</label>
              <span className="mx-muted">{t("{n} selected", { n: chosen.length })}</span>
              <Button variant="primary" disabled={!fixable.length || apply.isPending} onClick={() => apply.mutate(undefined)}>{t("Apply {n} fixes", { n: fixable.length })}</Button>
              <Button variant="secondary" disabled={applyAll.isPending} onClick={() => applyAll.mutate(undefined)}>{t("Apply all")}</Button>
              <Button variant="secondary" disabled={sheet.isPending} onClick={() => sheet.mutate(undefined)}>{t("Add to workbook")}</Button>
              <Select aria-label={t("Assign to")} value={steward} onChange={(e) => setSteward(e.target.value)} options={[{ value: "", label: t("Choose a steward") }, ...stewards.map((s) => ({ value: s.id, label: s.name ?? s.email }))]} />
              <Button variant="secondary" disabled={!chosen.length || !steward || assign.isPending} onClick={() => assign.mutate(undefined)}>{t("Assign")}</Button>
            </div>
            <DataTable columns={cols} rows={items} rowKey={(r) => r.record_key} label={t("Failing records")} height={320} />
            <div className="mx-rules-row">
              <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - RECORDS_PAGE))}>{t("Previous")}</Button>
              <span className="mx-muted">{t("{a} to {b} of {n}", { a: n ? offset + 1 : 0, b: Math.min(n, offset + RECORDS_PAGE), n })}</span>
              <Button variant="ghost" disabled={offset + RECORDS_PAGE >= n} onClick={() => setOffset(offset + RECORDS_PAGE)}>{t("Next")}</Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
