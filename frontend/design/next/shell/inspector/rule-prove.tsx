"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import { downloadReconciliationWorkbook, noteProved, type Reconcile, type ReconcileCondition, type SelectionLine } from "@/lib/api/v2/object";
import { useV2Session } from "@/lib/v2/hooks";
import { useRuleReconcile } from "@/lib/v2/object-queries";
import { int } from "@/lib/v2/score";
import { describeTable } from "@/lib/v2/sap-fields";
import { t } from "@/lib/v2/i18n";
import { Mono } from "@/design/v2/parts";
import { Button, Code, ErrorState, Skeleton } from "../../kit";
import { Fact, Facts } from "./frame";
import { Dash, Note, Sec } from "./work-common";
import type { RuleView } from "./rule";

/** Prove in SAP: the SE16 selection, the counts and five failing keys of the rule in the run of one object. */

const OPTION_WORD: Record<string, () => string> = {
  initial: () => t("Initial value"),
  not_initial: () => t("Not initial"),
  in: () => t("One of (multiple selection)"),
  not_in: () => t("None of (multiple selection, exclude)"),
  EQ: () => t("Equal to"),
  NE: () => t("Not equal to"),
  GT: () => t("Greater than"),
  LT: () => t("Less than"),
  GE: () => t("Greater than or equal to"),
  LE: () => t("Less than or equal to"),
  CP: () => t("Pattern"),
};

const EXCLUDED_WORD: Record<string, () => string> = {
  deleted: () => t("flagged for deletion"),
  one_time_account: () => t("one-time accounts"),
  hidden_by_field_status: () => t("hidden by the field status"),
  customer_equipment: () => t("customer equipment"),
};

const str = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));
const ids = (fields: string[]): string => fields.join(", ");

/** One condition SE16 cannot express, in the reader's language; the rule-specific logic keeps its English words. */
export function conditionText(c: ReconcileCondition): string {
  const p = c.params;
  const f = ids(c.fields);
  switch (c.kind) {
    case "pattern": return t("{field} does not match the pattern {pattern}", { field: f, pattern: str(p.pattern) });
    case "not_in_check_table": return p.table ? t("{field} has no entry in check table {table}: list {table} in SE16 and compare", { field: f, table: str(p.table) }) : t("{field} has no entry in its check table", { field: f });
    case "chars_not_in": return t("A character of {field} is not an allowed value", { field: f });
    case "format": return t("{field} is not a valid {format}", { field: f, format: str(p.format) });
    case "checksum": return t("{field} fails the {format} check digit", { field: f, format: str(p.format) });
    case "duplicate": return t("Two or more records share the same {fields}; in SE16N, output only these fields with the number of entries", { fields: f });
    case "missing_in_target": return t("{fields} has no record in {table}", { fields: f, table: str(p.table) });
    case "present_in_target": return t("{fields} has a record in {table}", { fields: f, table: str(p.table) });
    case "expression_true": return t("Records where {expression} holds", { expression: str(p.expression) });
    case "expression_false": return t("Records where {expression} does not hold", { expression: str(p.expression) });
    case "join": return t("Join {from} to {to}: SE16 reads one table at a time, so use SE16H or SQVI", { from: str(p.from_table), to: str(p.to_table) });
    case "status_exclusion": return t("Leave out records whose status in {table} marks them {label}", { table: str(p.table), label: str(p.label) });
    case "not_a_date": return t("A value of {field} that is not a date also fails", { field: f });
    case "time_of_day": return t("On the cut-off day itself, records fail when their time is before {cutoff}", { cutoff: str(p.cutoff) });
    case "older_than_hours": return t("{field} is more than {hours} hours before the run's as-of time", { field: f, hours: str(p.hours) });
    case "relative_date": return t("{field} is measured against the run's as-of date", { field: f });
    case "group_combination": return t("The combination {fields} is one of the groups of the field status", { fields: f });
    default: return t("Rule logic: {words}", { words: c.words });
  }
}

function SelectionRows({ lines, part }: { lines: SelectionLine[]; part: string }) {
  return (
    <>
      {lines.map((l, i) => (
        <tr key={`${part}:${i}`}>
          <td>{part}</td>
          <td><Mono>{`${l.table}-${l.field}`}</Mono></td>
          <td>{OPTION_WORD[l.operator]?.() ?? l.operator}</td>
          <td>{l.values.length === 0 ? <Dash why={t("No value: the option says it")} /> : l.values.map((v, j) => <span key={j}>{j > 0 ? ", " : ""}{v === "" ? t("(initial)") : <Mono>{v}</Mono>}</span>)}</td>
        </tr>
      ))}
    </>
  );
}

function ProvePack({ p }: { p: Reconcile }) {
  const lines = p.population_selection.length + p.failing_selection.length;
  const excluded = Object.entries(p.excluded);
  return (
    <>
      <p>
        {p.system === "cloud"
          ? t("{table} is read from a cloud system, so SE16 does not apply. Use the same selection in the source's own reporting.", { table: p.grain.table ?? "" })
          : p.se16
            ? t("One {transaction} selection on {table} gives the failing count.", { transaction: p.transaction ?? "SE16N", table: p.grain.table ?? "" })
            : t("{transaction} gives the closest selection; the conditions below say what SE16 alone cannot express.", { transaction: p.transaction ?? "SE16H" })}
      </p>
      <Facts>
        <Fact label={t("Run")}>{p.run_at ? formatDate(p.run_at, "date") : <Mono>{p.run_id}</Mono>}</Fact>
        <Fact label={t("Record grain")}>
          {p.grain.table ? (
            <>
              <Code code={p.grain.table} text={describeTable(p.grain.table) ?? undefined} />
              {p.grain.key_fields.length ? <span className="nx-ib-meta"> {t("one record per {keys}", { keys: p.grain.key_fields.join(", ") })}</span> : null}
            </>
          ) : <Dash />}
        </Fact>
        <Fact label={t("Tables")}>{p.tables.length ? <Mono>{p.tables.join(", ")}</Mono> : <Dash />}</Fact>
        <Fact label={t("Population")}>{t("{population} records checked", { population: int(p.population) })}</Fact>
        <Fact label={t("Failing")}>{t("{failing} records", { failing: int(p.failing) })}</Fact>
        {excluded.map(([k, n]) => (
          <Fact key={k} label={t("Left out")}>{t("{n} {why}", { n: int(n), why: EXCLUDED_WORD[k]?.() ?? k.replace(/_/g, " ") })}</Fact>
        ))}
      </Facts>
      {lines > 0 ? (
        <div className="nx-wk-scroll">
          <table className="nx-wk-table" aria-label={t("SE16 selection")}>
            <thead>
              <tr>
                <th scope="col">{t("For")}</th>
                <th scope="col">{t("Field")}</th>
                <th scope="col">{t("Option")}</th>
                <th scope="col">{t("Values")}</th>
              </tr>
            </thead>
            <tbody>
              <SelectionRows lines={p.population_selection} part={t("Population")} />
              <SelectionRows lines={p.failing_selection} part={t("Failing")} />
            </tbody>
          </table>
        </div>
      ) : (
        <p className="nx-ib-meta">{t("No selection: the rule judges every record of the table.")}</p>
      )}
      {p.conditions.length > 0 ? (
        <>
          <p><b>{t("What SE16 cannot express")}</b></p>
          <ul className="nx-ib-list" data-testid="prove-conditions">
            {p.conditions.map((c, i) => (
              <li key={`${c.kind}:${i}`}>{conditionText(c)}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p><b>{t("Five failing records")}</b></p>
      {p.sample_keys.length === 0 ? (
        <p className="nx-ib-meta">{t("No failing record key is stored for this run.")}</p>
      ) : (
        <ul className="nx-ib-list" data-testid="prove-keys">
          {p.sample_keys.map((k) => (
            <li key={k.raw} className="nx-ib-row">
              <Mono>{k.display}</Mono>
              <span className="nx-ib-meta">{t("stored as {raw}", { raw: k.raw })}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function RuleProve({ view }: { view: RuleView }) {
  const { can } = useV2Session();
  const objects = view.scope.objects;
  const [pick, setPick] = useState(0);
  const obj = objects[Math.min(pick, Math.max(0, objects.length - 1))];
  const q = useRuleReconcile(view.id, obj?.run_id);
  useEffect(() => {
    if (obj?.run_id) noteProved(obj.run_id, view.id);
  }, [obj?.run_id, view.id]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const download = () => {
    if (!obj) return;
    setBusy(true);
    setMsg(null);
    downloadReconciliationWorkbook(obj.run_id, 10)
      .then((name) => setMsg(t("Saved {name}.", { name })))
      .catch((e: unknown) => setMsg(e instanceof Error && e.message ? e.message : t("The workbook could not be built.")))
      .finally(() => setBusy(false));
  };
  return (
    <Sec title={t("Prove in SAP")}>
      {!obj ? (
        <p className="nx-ib-meta">{t("No run has measured this rule yet.")}</p>
      ) : (
        <div data-testid="rule-prove">
          {objects.length > 1 ? (
            <div className="nx-wk-form">
              <label>
                {t("Object and run")}
                <select value={pick} onChange={(e) => setPick(Number(e.target.value))}>
                  {objects.map((o, i) => (
                    <option key={`${o.system_id}:${o.module}`} value={i}>
                      {t("{label} on {system}", { label: o.label, system: o.system_name ?? o.system_id })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {q.isPending ? (
            <Skeleton lines={3} />
          ) : q.isError ? (
            <ErrorState sentence={q.error instanceof Error && q.error.message ? q.error.message : t("The reconciliation could not be read for this run.")} onRetry={() => void q.refetch()} />
          ) : (
            <ProvePack p={q.data} />
          )}
          {can("export") ? (
            <div className="nx-ib-acts">
              <Button size={32} variant="secondary" onClick={download} loading={busy} disabled={busy}>
                {t("Download the reconciliation workbook")}
              </Button>
            </div>
          ) : null}
          <Note>{t("The workbook leads with the rules you opened here, then the ten rules with the most failing records in this run, with empty SE16 count and match columns for your team.")}</Note>
          {msg ? <p role="status" className="nx-ib-meta">{msg}</p> : null}
        </div>
      )}
    </Sec>
  );
}
