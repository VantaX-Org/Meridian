"use client";

// Every field of a record, grouped by SAP table, with the fields a check fails highlighted in the severity's
// tint and a link down to the issue on the fix panel.
import { Fragment } from "react";
import { Card, Mono, SeverityDot } from "@/design";
import type { WorkIssue } from "@/lib/api/work";
import { Value, issueAnchor } from "@/components/work/record-panel";
import { formatNumber, plural } from "@/lib/format";

export interface SheetField {
  table: string;
  field: string;
  value: string | null;
  issues: WorkIssue[];
}

type Severity = "critical" | "high" | "medium" | "low";
const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const asSeverity = (s: string): Severity => (SEV_ORDER as string[]).includes(s) ? (s as Severity) : "low";
const TINT: Record<Severity, string> = {
  critical: "[background:var(--m-critical-soft)]",
  high: "[background:var(--m-high-soft)]",
  medium: "[background:var(--m-medium-soft)]",
  low: "[background:var(--m-low-soft)]",
};

const split = (name: string, fallback: string): [string, string] => {
  const i = name.indexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [fallback, name];
};

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const worst = (issues: WorkIssue[]): Severity => {
  const sevs = issues.map((i) => asSeverity(i.severity));
  return SEV_ORDER.find((s) => sevs.includes(s)) ?? "low";
};

/**
 * The record sheet's fields (the object record's row) and the fields the checks read (the work record's values),
 * one entry per table and field, each with the issues that name it. A check on a bare field matches the field in
 * any table; a check on TABLE.FIELD matches that table or the sheet's own table.
 */
export function sheetFields(row: Record<string, unknown>, values: Record<string, string | null>, issues: WorkIssue[],
  table: string): SheetField[] {
  const out = new Map<string, SheetField>();
  const add = (t: string, f: string, v: string | null) => {
    const k = `${t}.${f}`;
    const cur = out.get(k);
    if (!cur) out.set(k, { table: t, field: f, value: v, issues: [] });
    else if (cur.value === null && v !== null) cur.value = v;
  };
  for (const [name, v] of Object.entries(row)) {
    const [t, f] = split(name, table);
    add(t, f, str(v));
  }
  for (const [name, v] of Object.entries(values)) {
    const [t, f] = split(name, table);
    // The sheet already holds the field under its own table: one entry.
    if (t !== table && out.has(`${table}.${f}`) && !out.has(`${t}.${f}`) && !Object.hasOwn(row, name)) {
      const own = out.get(`${table}.${f}`);
      if (own && own.value === null) own.value = v;
      continue;
    }
    add(t, f, v);
  }
  for (const issue of issues) {
    if (!issue.field) continue;
    const [t, f] = issue.field.includes(".") ? split(issue.field, table) : [null, issue.field];
    let hit = false;
    for (const e of out.values()) {
      if (e.field === f && (t === null || e.table === t || e.table === table)) {
        e.issues.push(issue);
        hit = true;
      }
    }
    if (!hit) {
      const tb = t ?? table;
      out.set(`${tb}.${f}`, { table: tb, field: f, value: issue.current_value, issues: [issue] });
    }
  }
  return [...out.values()];
}

function FieldRow({ f }: { f: SheetField }) {
  if (!f.issues.length) {
    return (
      <Fragment>
        <dt><Mono inline>{f.field}</Mono></dt>
        <dd className="min-w-0 break-words"><Value v={f.value} /></dd>
      </Fragment>
    );
  }
  const sev = worst(f.issues);
  return (
    <Fragment>
      <dt className={`flex items-center gap-2 rounded-l-[var(--m-radius-control)] px-2 py-1 ${TINT[sev]}`} data-testid="failing-field">
        <SeverityDot severity={sev} />
        <Mono inline>{f.field}</Mono>
      </dt>
      <dd className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-r-[var(--m-radius-control)] px-2 py-1 ${TINT[sev]}`}>
        <span className="break-words"><Value v={f.value} /></span>
        {f.issues.map((i) => (
          <a key={i.check_id} href={`#${issueAnchor(i.check_id)}`} className="m-text-meta m-ink-accent underline underline-offset-2">
            Jump to issue{f.issues.length > 1 ? ` ${i.check_id}` : ""}
          </a>
        ))}
      </dd>
    </Fragment>
  );
}

const GRID = "grid grid-cols-[minmax(96px,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 m-text-body";

/** Every field of the record, grouped by table; failing fields first and highlighted, blank fields folded away. */
export function FieldSheet({ fields }: { fields: SheetField[] }) {
  if (!fields.length) return null;
  const tables = [...new Set(fields.map((f) => f.table))].sort((a, b) => {
    const fa = fields.some((f) => f.table === a && f.issues.length), fb = fields.some((f) => f.table === b && f.issues.length);
    return fa === fb ? a.localeCompare(b) : fa ? -1 : 1;
  });
  const failing = fields.filter((f) => f.issues.length).length;
  return (
    <Card title="Fields" meta={`${plural(fields.length, "field")}${failing ? `, ${formatNumber(failing)} failing a check` : ""}`}>
      <div className="flex flex-col gap-4" data-testid="field-sheet">
        {tables.map((t) => {
          const rows = fields.filter((f) => f.table === t);
          const bad = rows.filter((f) => f.issues.length).sort((a, b) => SEV_ORDER.indexOf(worst(a.issues)) - SEV_ORDER.indexOf(worst(b.issues)) || a.field.localeCompare(b.field));
          const blank = (f: SheetField) => f.value === null || f.value.trim() === "";
          const filled = rows.filter((f) => !f.issues.length && !blank(f)).sort((a, b) => a.field.localeCompare(b.field));
          const empty = rows.filter((f) => !f.issues.length && blank(f)).sort((a, b) => a.field.localeCompare(b.field));
          return (
            <section key={t} aria-label={`Table ${t}`} className="flex flex-col gap-2">
              <h3 className="m-text-h m-ink"><Mono inline>{t}</Mono> <span className="m-text-meta m-ink-3">{plural(rows.length, "field")}</span></h3>
              {bad.length || filled.length ? (
                <dl className={GRID}>
                  {bad.map((f) => <FieldRow key={f.field} f={f} />)}
                  {filled.map((f) => <FieldRow key={f.field} f={f} />)}
                </dl>
              ) : null}
              {empty.length ? (
                <details>
                  <summary className="cursor-pointer m-text-body m-ink-accent">{plural(empty.length, "blank field")}</summary>
                  <dl className={`mt-2 ${GRID}`}>{empty.map((f) => <FieldRow key={f.field} f={f} />)}</dl>
                </details>
              ) : null}
            </section>
          );
        })}
      </div>
    </Card>
  );
}
