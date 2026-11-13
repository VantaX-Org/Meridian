"use client";

/**
 * Failing records as two tables. The first lists the object's failing rules (rule id and text, severity, failing
 * count); choosing a rule (click, or Enter on a row) fills the second with that rule's records: record key, the field
 * with its text, the value it holds and the value the rule expects. Both tables page and use the kit table's keyboard
 * rows. The records come from the run in the address, 25 to a page.
 */
import { useMemo, useState } from "react";
import { Button, Chip, DataTable, type ChipTone, type Column } from "@/design/next/kit";
import { RECORDS_PAGE, useFailingRecords, type FailingRecord } from "@/lib/api/next/failing";
import type { RuleRow } from "@/lib/api/v2/types";
import { useUrlParam } from "@/lib/v2/hooks";
import { useObjectRules } from "@/lib/v2/queries";
import { errorSentence } from "@/lib/api/v2/client";
import { t } from "@/lib/v2/i18n";
import { formatInt } from "@/lib/format";
import type { ObjectRun } from "../object/useObjectRun";
import "./report.css";

export const RULES_PAGE = 10;
const SEVERITY_RANK: Record<RuleRow["severity"], number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const TONE: Record<RuleRow["severity"], ChipTone> = { critical: "bad", high: "bad", medium: "warn", low: "neutral", info: "neutral" };

export const severityLabel = (s: RuleRow["severity"]): string =>
  ({ critical: t("Critical"), high: t("High"), medium: t("Medium"), low: t("Low"), info: t("Info") })[s];

/** The rules that fail in the run, worst first: severity, then the count of failing records. */
export function failingRules(rules: RuleRow[]): RuleRow[] {
  return rules.filter((r) => r.affected_count > 0).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.affected_count - a.affected_count || a.check_id.localeCompare(b.check_id));
}

const show = (v: FailingRecord["current_value"]): string => (v === null || v === "" ? "—" : String(v));

export function FailingRecords({ o }: { o: ObjectRun }) {
  const rulesQ = useObjectRules(o.module, o.runId);
  const all = useMemo(() => failingRules(rulesQ.data ?? []), [rulesQ.data]);
  const [rulePage, setRulePage] = useState(0);
  const [picked, setPicked] = useUrlParam<string>("rule", "");
  const [offset, setOffset] = useState(0);
  const rule = all.find((r) => r.check_id === picked) ?? null;
  const recs = useFailingRecords(o.runId, rule?.check_id ?? null, offset);
  const rulePageRows = all.slice(rulePage * RULES_PAGE, (rulePage + 1) * RULES_PAGE);

  const ruleCols: Column<RuleRow>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => <span><span className="nx-mono">{r.check_id}</span> {r.name}</span>, compare: (a, b) => a.check_id.localeCompare(b.check_id) },
    { id: "field", label: t("Field"), cell: (r) => (r.field ? <span><span className="nx-mono">{r.field}</span> {r.field_description ?? ""}</span> : "—") },
    { id: "severity", label: t("Severity"), cell: (r) => <Chip tone={TONE[r.severity]}>{severityLabel(r.severity)}</Chip>, compare: (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] },
    { id: "count", label: t("Failing records"), align: "end", cell: (r) => <span className="nx-num">{formatInt(r.affected_count)}</span>, compare: (a, b) => a.affected_count - b.affected_count },
  ];
  const recCols: Column<FailingRecord>[] = [
    { id: "key", label: t("Record key"), cell: (r) => <span className="nx-mono">{r.record_key}</span> },
    { id: "field", label: t("Field"), cell: (r) => (r.field_text ? <span className="nx-mono">{r.field_text}</span> : "—") },
    { id: "current", label: t("Current value"), cell: (r) => <span className="nx-mono">{show(r.current_value)}</span> },
    { id: "expected", label: t("Expected value"), cell: (r) => (r.expected_value === null ? <span className="nx-muted">{t("No fix proposed")}</span> : <span className="nx-mono">{show(r.expected_value)}</span>) },
  ];

  const total = recs.data?.total ?? 0;
  return (
    <div className="nx-failing" data-testid="failing-records">
      <section aria-label={t("Failing rules")} className="nx-card nx-failing-sheet">
        <h3 className="nx-cycle-h">{t("Failing rules")}</h3>
        <p className="nx-muted">{t("Choose a rule to see its failing records.")}</p>
        <DataTable<RuleRow>
          caption={t("Failing rules")}
          rows={rulePageRows}
          total={all.length}
          columns={ruleCols}
          rowKey={(r) => r.check_id}
          rowLabel={(r) => `${r.check_id} ${r.name}`}
          onOpenRow={(r) => { setPicked(r.check_id); setOffset(0); }}
          loading={rulesQ.isLoading}
          error={rulesQ.isError ? { sentence: errorSentence(rulesQ.error, t("The rules could not be read.")), onRetry: () => void rulesQ.refetch() } : undefined}
          empty={{ heading: t("No failing rules"), text: t("This run has no failing records for the object.") }}
        />
        <Pager label={t("Rules page")} from={rulePage * RULES_PAGE} size={RULES_PAGE} total={all.length} onPage={(p) => setRulePage(p)} />
      </section>
      <section aria-label={t("Failing records")} className="nx-card nx-failing-sheet" data-testid="failing-records-table">
        <h3 className="nx-cycle-h">{rule ? t("Records failing {rule}", { rule: rule.check_id }) : t("Failing records")}</h3>
        {rule ? <p className="nx-muted">{rule.name}</p> : null}
        {!rule ? <p className="nx-muted">{t("No rule chosen yet.")}</p> : (
          <>
            <DataTable<FailingRecord>
              caption={t("Records failing {rule}", { rule: rule.check_id })}
              rows={recs.data?.items ?? []}
              total={total}
              columns={recCols}
              rowKey={(r) => `${r.record_key}:${r.field ?? ""}`}
              rowLabel={(r) => r.record_key}
              loading={recs.isLoading}
              error={recs.isError ? { sentence: errorSentence(recs.error, t("The records could not be read.")), onRetry: () => void recs.refetch() } : undefined}
              empty={{ heading: t("No records"), text: t("The rule has no failing records in this run.") }}
            />
            <Pager label={t("Records page")} from={offset} size={RECORDS_PAGE} total={total} onPage={(p) => setOffset(p * RECORDS_PAGE)} />
          </>
        )}
      </section>
    </div>
  );
}

/** Previous and next with the range in words ("1 to 25 of 137"). */
export function Pager({ label, from, size, total, onPage }: { label: string; from: number; size: number; total: number; onPage: (page: number) => void }) {
  if (total <= size) return null;
  const page = Math.floor(from / size);
  const last = Math.ceil(total / size) - 1;
  return (
    <nav className="nx-pager" aria-label={label}>
      <Button size={32} variant="secondary" icon="chevron-left" disabled={page <= 0} onClick={() => onPage(page - 1)}>{t("Previous")}</Button>
      <span className="nx-num" aria-live="polite">{t("{a} to {b} of {n}", { a: formatInt(from + 1), b: formatInt(Math.min(from + size, total)), n: formatInt(total) })}</span>
      <Button size={32} variant="secondary" icon="chevron-right" disabled={page >= last} onClick={() => onPage(page + 1)}>{t("Next")}</Button>
    </nav>
  );
}
