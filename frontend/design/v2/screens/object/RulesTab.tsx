"use client";

import { ScrollFrame } from "./ScrollFrame";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { moneyCompactText } from "@/lib/v2/labels";
import { fixtureParam } from "@/lib/api/v2/fixture";
import { acceptAllSuggested, approveLearned, dryRunDraft, mineFixes, publishDraft, rejectLearned, type DraftDryRun, type LearnedProposal, type RuleDraft } from "@/lib/api/v2/object";
import { formatDate } from "@/lib/format";
import { DIMENSIONS, type Receipt, type RuleRow } from "@/lib/api/v2/types";
import { KIND_LABEL } from "@/lib/api/learnedRules";
import { useOpenItem, useRunParam, useV2Session } from "@/lib/v2/hooks";
import { KEYS, gridRegistry, matchKey, type GridTarget } from "@/lib/v2/keys";
import { useNarrow } from "@/lib/v2/narrow";
import { useConfigImpact, useDrafts, useLearned, useWorkGroups } from "@/lib/v2/object-queries";
import { useLandscape, useObjectRules, useReceipt } from "@/lib/v2/queries";
import { PIVOTS, pivotRules, rankRules, type FeatureLink, type Pivot, type PivotGroup } from "@/lib/v2/rules-pivot";
import { findSystem, int, moduleFromSlug, pct1 } from "@/lib/v2/score";
import { SimulateDialog, TopFixesView } from "../step9/Simulation";
import { Explain } from "../../Explain";
import { IconChevron, SeverityMark } from "../../marks";
import { Dash, Dot, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../../parts";
import { t, lc, tn } from "@/lib/v2/i18n";

type View = "all" | "top" | "learned" | "drafts";

const PAGE = 25;
const SEV_WORD: Record<string, string> = { get critical() { return t("Critical"); }, get high() { return t("High"); }, get medium() { return t("Medium"); }, get low() { return t("Low"); }, get info() { return t("Info"); } };
const dimLabel = (d: string | null | undefined): string => DIMENSIONS.find((x) => x.key === d)?.label ?? "";

/** What the table shows for one rule, derived once from the rule and the object's receipt. */
export interface RuleLine {
  rule: RuleRow;
  /** Null until the receipt has been read. */
  over: boolean | null;
  failingPct: number | null;
  coverage: number | null;
  proposed: number;
}

function lineOf(rule: RuleRow, receipt: Receipt | undefined, proposed: number): RuleLine {
  const checked = receipt?.records_checked ?? rule.total_count;
  return {
    rule,
    over: rule.severity !== "critical" ? false : receipt ? receipt.breaches.some((b) => b.check_id === rule.check_id) : null,
    failingPct: checked > 0 ? (rule.affected_count / checked) * 100 : null,
    coverage: receipt?.records_checked ? Math.min(1, rule.total_count / receipt.records_checked) : null,
    proposed,
  };
}

const pct2 = (n: number | null): string => (n == null ? "—" : `${(Math.round(n * 100) / 100).toFixed(2)}%`);

function Sev({ severity }: { severity: RuleRow["severity"] }) {
  return (
    <span className="m2-sev">
      <SeverityMark severity={severity} />
      {SEV_WORD[severity]}
    </span>
  );
}

/* ---- the Rule cell: id, name, why it matters, suggested values ---- */

function SuggestedLine({ line, canApply, accepted, onAccept, busy, viewHref }: { line: RuleLine; canApply: boolean; accepted: boolean; onAccept: (id: string) => void; busy: boolean; viewHref: string }) {
  if (accepted) return <span className="m2-rs m2-meta">{t("Suggested values accepted")}</span>;
  if (line.proposed <= 0) return null;
  return (
    <span className="m2-rs">
      {t("{proposed} suggested values", { proposed: int(line.proposed) })}
      <Dot />
      {canApply ? (
        <button type="button" className="m2-linkbtn" disabled={busy} onClick={() => onAccept(line.rule.check_id)} aria-label={t("Accept all {proposed} suggested values for {check_id}", { proposed: int(line.proposed), check_id: line.rule.check_id })}>
          {t("Accept all")}
        </button>
      ) : (
        <V2Link href={viewHref}>{t("View")}</V2Link>
      )}
    </span>
  );
}

function RuleCell({ line, ...rest }: { line: RuleLine; canApply: boolean; accepted: boolean; onAccept: (id: string) => void; busy: boolean; viewHref: string }) {
  const { hrefFor } = useOpenItem();
  return (
    <div className="m2-rn">
      <span>
        <V2Link href={hrefFor({ kind: "rule", id: line.rule.check_id })} className="m2-mono" onClick={(e) => e.stopPropagation()}>
          {line.rule.check_id}
        </V2Link>{" "}
        {line.rule.name}
      </span>
      {line.rule.why ? <span className="m2-rs m2-meta">{line.rule.why}</span> : null}
      <SuggestedLine line={line} {...rest} />
    </div>
  );
}

/* ---- the ranked table (wide) and list (narrow) ---- */

interface TableProps {
  label: string;
  lines: RuleLine[];
  receipt: Receipt | undefined;
  module: string;
  currency: string | null;
  total: number;
  canApply: boolean;
  accepted: ReadonlySet<string>;
  onAccept: (id: string) => void;
  busy: boolean;
  viewHref: (id: string) => string;
  more: ReactNode;
  openId: string | null;
  onOpen: (id: string) => void;
}

function restOf(lines: RuleLine[], receipt: Receipt | undefined): number | null {
  if (receipt?.value_at_risk == null) return null;
  const seen = lines.reduce((s, l) => s + (l.rule.value_at_risk ?? 0), 0);
  return Math.max(0, receipt.value_at_risk - seen);
}

function RulesTable(p: TableProps) {
  const { lines, receipt, module, currency, total } = p;
  const [active, setActive] = useState(-1);
  const linesRef = useRef(lines);
  const activeRef = useRef(-1);
  useEffect(() => {
    linesRef.current = lines;
    activeRef.current = active;
  });
  const onOpen = p.onOpen;
  const target = useMemo<GridTarget>(
    () => ({
      move: (dir) => {
        const n = linesRef.current.length;
        if (!n) return;
        const prev = activeRef.current;
        const next = prev < 0 ? (dir > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, prev + dir));
        activeRef.current = next;
        setActive(next);
        document.getElementById(`m2-rule-row-${linesRef.current[next].rule.check_id}`)?.scrollIntoView?.({ block: "nearest" });
      },
      open: () => {
        const l = linesRef.current[activeRef.current];
        if (l) onOpen(l.rule.check_id);
      },
      toggle: () => undefined,
    }),
    [onOpen],
  );
  useEffect(() => {
    gridRegistry.set(target);
    return () => gridRegistry.clear(target);
  }, [target]);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("input,button,a,select,textarea")) return;
    for (const def of KEYS) {
      if (def.scope !== "grid" || !def.run) continue;
      for (const spec of def.keys) {
        if (matchKey(spec, e) && def.run({ grid: target }, e.nativeEvent)) {
          e.preventDefault();
          return;
        }
      }
    }
  };
  const first = lines[0]?.rule.check_id;
  const rest = restOf(lines, receipt);
  const moreCount = Math.max(0, total - lines.length);
  const money = (n: number | null) => (n == null ? <Dash /> : int(n));
  return (
    <div className="m2-frame m2-rframe">
      <table className="m2-tbl m2-rtbl" role="grid" aria-label={p.label} aria-rowcount={lines.length + 3} tabIndex={0} onKeyDown={onKeyDown} aria-activedescendant={active >= 0 ? `m2-rule-row-${lines[active]?.rule.check_id}` : undefined}>
        <colgroup>
          <col style={{ width: 272 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 82 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 82 }} />
          <col style={{ width: 82 }} />
          <col style={{ width: 106 }} />
        </colgroup>
        <thead>
          <tr role="row">
            <th scope="col" role="columnheader">{t("Rule")}</th>
            <th scope="col" role="columnheader">{t("Field")}</th>
            <th scope="col" role="columnheader">{t("Dimension")}</th>
            <th scope="col" role="columnheader">{t("Severity")}</th>
            <th scope="col" role="columnheader" className="m2-r">
              {t("Tolerance")}{" "}<Explain metric="tolerance" label={t("Tolerance")} module={module} />
            </th>
            <th scope="col" role="columnheader">
              {t("Over tolerance")}{" "}<Explain metric="tolerance" label={t("Over tolerance")} module={module} />
            </th>
            <th scope="col" role="columnheader" className="m2-r">{t("Failing rows")}</th>
            <th scope="col" role="columnheader" className="m2-r">
              {t("Failing %")}{" "}<Explain metric="failing_pct" label={t("Failing %")} module={module} checkId={first} />
            </th>
            <th scope="col" role="columnheader" className="m2-r">
              {t("Coverage")}{" "}<Explain metric="coverage" label={t("Coverage")} module={module} />
            </th>
            <th scope="col" role="columnheader" className="m2-r">
              {t("Value at risk{value}", { value: currency ? `, ${currency}` : "" })} <Explain metric="value_at_risk" label={t("Value at risk")} module={module} />
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr
              key={l.rule.check_id}
              id={`m2-rule-row-${l.rule.check_id}`}
              role="row"
              aria-rowindex={i + 2}
              data-active={i === active ? "true" : undefined}
              data-open={p.openId === l.rule.check_id ? "true" : undefined}
              className="m2-rrow"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a,button,input,select")) return;
                setActive(i);
                p.onOpen(l.rule.check_id);
              }}
            >
              <td role="gridcell">
                <RuleCell line={l} canApply={p.canApply} accepted={p.accepted.has(l.rule.check_id)} onAccept={p.onAccept} busy={p.busy} viewHref={p.viewHref(l.rule.check_id)} />
              </td>
              <td role="gridcell">
                <div className="m2-rn">
                  <span>{l.rule.field_description ?? <Dash />}</span>
                  {l.rule.field ? <span className="m2-rs m2-mono">{l.rule.field}</span> : null}
                </div>
              </td>
              <td role="gridcell">{dimLabel(l.rule.dimension) || <Dash />}</td>
              <td role="gridcell">
                <Sev severity={l.rule.severity} />
              </td>
              <td role="gridcell" className="m2-r">
                {l.rule.severity === "critical" && receipt ? t("{rows} rows", { rows: int(receipt.tolerance.rows) }) : <Dash why={t("Only critical rules carry a tolerance")} />}
              </td>
              <td role="gridcell">{l.over == null ? <Dash /> : l.over ? <b>{t("Yes")}</b> : t("No")}</td>
              <td role="gridcell" className="m2-r">{int(l.rule.affected_count)}</td>
              <td role="gridcell" className="m2-r">{pct2(l.failingPct)}</td>
              <td role="gridcell" className="m2-r">{pct1(l.coverage)}</td>
              <td role="gridcell" className="m2-r">{money(l.rule.value_at_risk)}</td>
            </tr>
          ))}
          <tr role="row" aria-rowindex={lines.length + 2} className="m2-rfoot">
            <td role="gridcell" colSpan={6} className="m2-meta">
              {moreCount > 0 ? t("and {moreCount} more rules", { moreCount: int(moreCount) }) : t("No further rules")}
              {p.more}
            </td>
            <td role="gridcell" className="m2-r"><Dash why={t("The count for the remaining rules is not summed here")} /></td>
            <td role="gridcell" />
            <td role="gridcell" />
            <td role="gridcell" className="m2-r">{moreCount > 0 ? money(rest) : null}</td>
          </tr>
          <tr role="row" aria-rowindex={lines.length + 3} className="m2-rtotal">
            <td role="gridcell" colSpan={9}>{t("All {total} rules", { total: int(total) })}</td>
            <td role="gridcell" className="m2-r">{money(receipt?.value_at_risk ?? null)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RulesList(p: TableProps) {
  const { hrefFor } = useOpenItem();
  const rest = restOf(p.lines, p.receipt);
  const moreCount = Math.max(0, p.total - p.lines.length);
  return (
    <div className="m2-rlist">
      <div className="m2-rlh">
        <span>{t("Rule")}</span>
        <span>
          {t("Value at risk{value}", { value: p.currency ? `, ${p.currency}` : "" })} <Explain metric="value_at_risk" label={t("Value at risk")} module={p.module} />
        </span>
        <span className="m2-meta">
          {t("Over tolerance")}{" "}<Explain metric="tolerance" label={t("Over tolerance")} module={p.module} />
          <Dot />
          {t("Failing %")}{" "}<Explain metric="failing_pct" label={t("Failing %")} module={p.module} checkId={p.lines[0]?.rule.check_id} />
          <Dot />
          {t("Coverage")}{" "}<Explain metric="coverage" label={t("Coverage")} module={p.module} />
        </span>
      </div>
      <div role="list" aria-label={p.label}>
      {p.lines.map((l) => (
        <div key={l.rule.check_id} role="listitem" className="m2-lrow m2-rl" data-open={p.openId === l.rule.check_id ? "true" : undefined}>
          <span>
            <V2Link href={hrefFor({ kind: "rule", id: l.rule.check_id })} className="m2-mono">{l.rule.check_id}</V2Link> {l.rule.name}
          </span>
          <span className="m2-b">{l.rule.value_at_risk == null ? "—" : int(l.rule.value_at_risk)}</span>
          <span className="m2-c">
            <Sev severity={l.rule.severity} />
            <Dot />
            {l.over == null ? t("tolerance not read") : l.over ? t("over tolerance") : t("within tolerance")}
            <Dot />
            {t("{affected_count} rows ({pct2})", { affected_count: int(l.rule.affected_count), pct2: pct2(l.failingPct) })}
            {l.rule.why ? <><br />{l.rule.why}</> : null}
            {l.proposed > 0 || p.accepted.has(l.rule.check_id) ? <><br /><SuggestedLine line={l} canApply={p.canApply} accepted={p.accepted.has(l.rule.check_id)} onAccept={p.onAccept} busy={p.busy} viewHref={p.viewHref(l.rule.check_id)} /></> : null}
          </span>
        </div>
      ))}
      <div className="m2-lrow m2-rl" role="listitem">
        <span className="m2-meta">{moreCount > 0 ? t("and {moreCount} more rules", { moreCount: int(moreCount) }) : t("No further rules")}{p.more}</span>
        <span className="m2-b">{moreCount > 0 && rest != null ? int(rest) : ""}</span>
      </div>
      </div>
    </div>
  );
}

/* ---- pivots ---- */

/** The first column's heading of each pivot. */
const PIVOT_WORD: Partial<Record<Pivot, () => string>> = { field: () => t("Field"), dimension: () => t("Dimension"), severity: () => t("Severity"), feature: () => t("S/4 feature") };

function PivotTable({ groups, pivot, label }: { groups: PivotGroup[]; pivot: Exclude<Pivot, "rule">; label: string }) {
  const { hrefFor } = useOpenItem();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const word = PIVOT_WORD[pivot]?.() ?? t("Group");
  return (
    <ScrollFrame label={t("Pivot table, scrollable")}>
      <table className="m2-tbl m2-ptbl" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{word.charAt(0).toUpperCase() + word.slice(1)}</th>
            <th scope="col" className="m2-r">{t("Rules")}</th>
            <th scope="col" className="m2-r">{t("Failing rows")}</th>
            <th scope="col" className="m2-r">{t("Value at risk")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const open = openKey === g.key;
            return (
              <Fragment key={g.key}>
                <tr className="m2-pvrow">
                  <th scope="row">
                    <button type="button" className="m2-linkbtn m2-ptoggle" aria-expanded={open} onClick={() => setOpenKey(open ? null : g.key)}>
                      <IconChevron open={open} />
                      <span>{g.mono ? <Mono>{g.label}</Mono> : g.label}</span>
                    </button>
                    {g.sub ? <span className="m2-meta m2-psub">{g.sub}</span> : null}
                  </th>
                  <td className="m2-r">{int(g.rules.length)}</td>
                  <td className="m2-r">{int(g.failing)}</td>
                  <td className="m2-r">{g.value == null ? <Dash /> : int(g.value)}</td>
                </tr>
                {open
                  ? g.rules.slice(0, 12).map((r) => (
                      <tr key={`${g.key}:${r.check_id}`} className="m2-pchild">
                        <th scope="row">
                          <V2Link href={hrefFor({ kind: "rule", id: r.check_id })} className="m2-mono">{r.check_id}</V2Link> {r.name}
                        </th>
                        <td />
                        <td className="m2-r">{int(r.affected_count)}</td>
                        <td className="m2-r">{r.value_at_risk == null ? <Dash /> : int(r.value_at_risk)}</td>
                      </tr>
                    ))
                  : null}
                {open && g.rules.length > 12 ? (
                  <tr className="m2-pchild">
                    <th scope="row" className="m2-meta">{t("and {count} more rules", { count: g.rules.length - 12 })}</th>
                    <td colSpan={3} />
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
</ScrollFrame>
  );
}

/* ---- learned rules ---- */

const learnedKind = (k: LearnedProposal["kind"]): string => (k === "null" ? t("Blank field stewards always fill") : k === "invalid_value" ? t("Value stewards always correct") : KIND_LABEL[k]);

/** Where a proposal came from and what supports it: the fixes behind a mined rule, or the rows of the data. */
function Evidence({ p }: { p: LearnedProposal }) {
  const { hrefFor } = useOpenItem();
  const e = p.evidence;
  if (p.source !== "fixes" || !e) return <span className="m2-meta">{t("From the data: {rows} rows agree", { rows: int(p.support_rows) })}</span>;
  const span = e.first_at && e.last_at ? t("{from} to {to}", { from: formatDate(e.first_at, "date"), to: formatDate(e.last_at, "date") }) : null;
  return (
    <div className="m2-rn" data-testid="learned-evidence">
      <span>{t("From fixes: {count} {n, plural, one {record} other {records}}{span}{who}", { count: int(e.count), n: e.count, span: span ? `, ${span}` : "", who: e.who.length ? t(", by {who}", { who: e.who.join(", ") }) : "" })}</span>
      <span className="m2-rs">
        {e.pattern === "blank" ? tn("Blank, filled with {value}", { value: e.fix_value != null ? <Mono>{e.fix_value}</Mono> : <Dash /> }) : tn("Was {old}, corrected to {value}", { old: <Mono>{e.invalid_value ?? ""}</Mono>, value: e.fix_value != null ? <Mono>{e.fix_value}</Mono> : <Dash /> })}
      </span>
      <span className="m2-rs m2-meta">
        {t("Fixes it came from:")}{" "}
        {e.sample_keys.map((k, i) => (
          <span key={k}>
            {i > 0 ? ", " : ""}
            <V2Link href={hrefFor({ kind: "record", id: `${p.module}:${k}` })} className="m2-mono">
              {k.split("=").slice(1).join("=") || k}
            </V2Link>
          </span>
        ))}
        {e.count > e.sample_keys.length ? ` ${t("and {more} more", { more: int(e.count - e.sample_keys.length) })}` : ""}
      </span>
    </div>
  );
}

function LearnedTable({ module, items, canApprove, canReject, onChanged }: { module: string; items: LearnedProposal[]; canApprove: boolean; canReject: boolean; onChanged: () => void }) {
  const [severity, setSeverity] = useState<Record<string, "critical" | "high" | "medium" | "low">>({});
  const [note, setNote] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: (p: LearnedProposal) => approveLearned(p.id, severity[p.id] ?? "medium"),
    onSuccess: (r) => {
      setNote(t("Approved as {rule_id}. It runs from the next analysis.", { rule_id: r.rule_id }));
      onChanged();
    },
  });
  const reject = useMutation({
    mutationFn: (p: LearnedProposal) => rejectLearned(p.id),
    onSuccess: () => {
      setNote(t("Rejected. The miner will not propose it again."));
      onChanged();
    },
  });
  if (items.length === 0) {
    return (
      <>
        <EmptyFrame>{t("No learned rules are waiting for {replace}. The miner proposes rules from the data after an analysis; a person with approval rights decides.", { replace: module.replace(/_/g, " ") })}</EmptyFrame>
        {note ? <p role="status" className="m2-prov">{note}</p> : null}
      </>
    );
  }
  return (
    <>
      <ScrollFrame label={t("Learned rules, scrollable")}>
        <table className="m2-tbl" aria-label={t("Learned rules waiting for a decision")}>
          <thead>
            <tr>
              <th scope="col">{t("Proposed rule")}</th>
              <th scope="col">{t("Evidence")}</th>
              <th scope="col" className="m2-r">{t("Confidence")}</th>
              <th scope="col" className="m2-r">{t("Rows supporting")}</th>
              <th scope="col" className="m2-r">{t("Would fail")}</th>
              <th scope="col">{t("Decision")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <th scope="row">
                  <div className="m2-rn">
                    <span>{learnedKind(p.kind)}</span>
                    <span className="m2-rs m2-mono">{p.determinant ? t("{field} by {determinant}", { field: p.field, determinant: p.determinant }) : p.field}</span>
                  </div>
                </th>
                <td>
                  <Evidence p={p} />
                </td>
                <td className="m2-r">{`${Math.round(p.confidence * 100)}%`}</td>
                <td className="m2-r">{int(p.support_rows)}</td>
                <td className="m2-r">{int(p.violations)}</td>
                <td>
                  {canApprove || canReject ? (
                    <span className="m2-dec">
                      {canApprove ? (
                        <>
                          <select aria-label={t("Severity for {field}", { field: p.field })} value={severity[p.id] ?? "medium"} onChange={(e) => setSeverity({ ...severity, [p.id]: e.target.value as "critical" | "high" | "medium" | "low" })}>
                            <option value="critical">{t("Critical")}</option>
                            <option value="high">{t("High")}</option>
                            <option value="medium">{t("Medium")}</option>
                            <option value="low">{t("Low")}</option>
                          </select>
                          <button type="button" className="m2-btn m2-sm" disabled={approve.isPending} onClick={() => approve.mutate(p)}>
                            {t("Approve")}
                          </button>
                        </>
                      ) : null}
                      {canReject ? (
                        <button type="button" className="m2-btn m2-sm m2-ghost" disabled={reject.isPending} onClick={() => reject.mutate(p)}>
                          {t("Reject")}
                        </button>
                      ) : null}
                    </span>
                  ) : (
                    <span className="m2-meta">{t("Waiting for an approver")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</ScrollFrame>
      {approve.isError || reject.isError ? <p role="alert" className="m2-prov">{t("That decision could not be saved. It may already have been decided.")}</p> : null}
      {note ? <p role="status" className="m2-prov">{note}</p> : null}
    </>
  );
}

/** "Mine the fixes now": rules from the values stewards keep entering, never enabled without an approver. */
function MineFixes({ onDone }: { onDone: () => void }) {
  const mine = useMutation({ mutationFn: mineFixes, onSuccess: onDone });
  return (
    <p className="m2-prov" style={{ marginTop: 0 }}>
      <button type="button" className="m2-btn m2-sm" disabled={mine.isPending} onClick={() => mine.mutate()}>
        {mine.isPending ? t("Mining…") : t("Mine stewards’ fixes now")}
      </button>{" "}
      {mine.data ? <span role="status">{t("{proposed} new, {refreshed} refreshed, from {edits} fixes; a rule needs {min} records fixed the same way.", { proposed: mine.data.proposed, refreshed: mine.data.refreshed, edits: int(mine.data.edits), min: int(mine.data.min_records) })}</span> : mine.isError ? <span role="alert">{t("The fixes could not be mined.")}</span> : t("A nightly run does this too.")}
    </p>
  );
}

/* ---- drafts ---- */

function DraftsTable({ module, items, onChanged }: { module: string; items: RuleDraft[]; onChanged: () => void }) {
  const [results, setResults] = useState<Record<string, DraftDryRun | "error">>({});
  const [note, setNote] = useState<string | null>(null);
  const dry = useMutation({
    mutationFn: (d: RuleDraft) => dryRunDraft(d),
    onSuccess: (r, d) => setResults((prev) => ({ ...prev, [d.id]: r })),
    onError: (_e, d) => setResults((prev) => ({ ...prev, [d.id]: "error" })),
  });
  const publish = useMutation({
    mutationFn: (d: RuleDraft) => publishDraft(d.id),
    onSuccess: (r) => {
      setNote(t("{name} is published. It runs from the next analysis.", { name: r.name }));
      onChanged();
    },
  });
  if (items.length === 0) {
    return (
      <>
        <EmptyFrame action={<V2Link href={`/rules?view=drafts&module=${encodeURIComponent(module)}`} className="m2-btn">{t("Open rule authoring")}</V2Link>}>{t("No drafts for {replace}. Write one in rule authoring or describe it in plain English there; a dry run shows what it would find before it is published.", { replace: module.replace(/_/g, " ") })}</EmptyFrame>
        {note ? <p role="status" className="m2-prov">{note}</p> : null}
      </>
    );
  }
  return (
    <>
      <ScrollFrame label={t("Rule drafts, scrollable")}>
        <table className="m2-tbl" aria-label={t("Rule drafts")}>
          <thead>
            <tr>
              <th scope="col">{t("Draft")}</th>
              <th scope="col">{t("Field")}</th>
              <th scope="col">{t("Dimension")}</th>
              <th scope="col">{t("Severity")}</th>
              <th scope="col">{t("Dry run")}</th>
              <th scope="col">{t("Publish")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => {
              const r = d.proposed_rule;
              const res = results[d.id];
              return (
                <tr key={d.id}>
                  <th scope="row">
                    <div className="m2-rn">
                      <span>{r.id ? <><Mono>{r.id}</Mono> </> : null}{r.message ?? t("Untitled draft")}</span>
                      {d.rationale ? <span className="m2-rs m2-meta">{d.rationale}</span> : null}
                    </div>
                  </th>
                  <td>{r.field ? <Mono>{String(r.field)}</Mono> : <Dash />}</td>
                  <td>{dimLabel(r.dimension) || <Dash />}</td>
                  <td>{r.severity ? <Sev severity={r.severity as RuleRow["severity"]} /> : <Dash />}</td>
                  <td>
                    <button type="button" className="m2-btn m2-sm" disabled={dry.isPending} onClick={() => dry.mutate(d)} aria-label={t("Dry run {id}", { id: r.id ?? "draft" })}>
                      {t("Dry run")}
                    </button>
                    {res ? (
                      <span className="m2-rs" role="status">
                        {res === "error" ? t("The dry run could not run.") : res.evaluated ? t("{hits} of {population} records would fail", { hits: int(res.hits), population: int(res.population) }) : res.reason}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <button type="button" className="m2-btn m2-sm m2-strong" disabled={publish.isPending} onClick={() => publish.mutate(d)} aria-label={t("Publish {id}", { id: r.id ?? "draft" })}>
                      {t("Publish")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
</ScrollFrame>
      {publish.isError ? <p role="alert" className="m2-prov">{t("The draft could not be published. Run the dry run first and check the expression.")}</p> : null}
      {note ? <p role="status" className="m2-prov">{note}</p> : null}
    </>
  );
}

/* ---- the tab ---- */

/** The Rules tab: the object's rules ranked by value at risk, pivots, and the Learned and Drafts views. */
export function RulesTab({ module: moduleSegment, system: systemSegment }: { system: string; module: string }) {
  const run = useRunParam();
  const apiModule = moduleFromSlug(moduleSegment);
  const { open, openItem } = useOpenItem();
  const { can } = useV2Session();
  const narrow = useNarrow();
  const qc = useQueryClient();
  const rowsParam = Number(fixtureParam("rows") ?? 0);
  const rulesQ = useObjectRules(apiModule, run, Number.isFinite(rowsParam) ? rowsParam : 0);
  const landscape = useLandscape(run).data;
  const label = landscape?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ");
  const systemId = landscape && systemSegment ? (findSystem(landscape.systems, decodeURIComponent(systemSegment))?.id ?? null) : null;
  const [simulating, setSimulating] = useState(false);
  const receiptQ = useReceipt(apiModule, run);
  const receipt = receiptQ.data;
  const groupsQ = useWorkGroups(apiModule, receipt?.run_id, Boolean(receipt));
  const impactQ = useConfigImpact(receipt?.run_id);

  const canDrafts = can("manage_rules");
  const canApprove = can("approve") || can("review_ai_rules");
  const canReject = canApprove || can("manage_rules");
  const learnedQ = useLearned(apiModule, true);
  const draftsQ = useDrafts(apiModule, canDrafts);

  const [pivot, setPivot] = useState<Pivot>("rule");
  const [view, setView] = useState<View>("all");
  const [shown, setShown] = useState(PAGE);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);

  const ranked = useMemo(() => rankRules(rulesQ.data ?? []), [rulesQ.data]);
  const proposed = useMemo(() => new Map((groupsQ.data ?? []).map((g) => [g.check_id, g.proposed])), [groupsQ.data]);
  const lines = useMemo(() => ranked.slice(0, shown).map((r) => lineOf(r, receipt, proposed.get(r.check_id) ?? 0)), [ranked, shown, receipt, proposed]);
  const features = useMemo(() => {
    const map = new Map<string, FeatureLink[]>();
    for (const res of impactQ.data ?? []) {
      if (res.status === "ok") continue;
      for (const f of res.blocking_findings) {
        if (f.module && f.module !== apiModule) continue;
        const list = map.get(f.check_id) ?? [];
        list.push({ feature: res.feature, status: res.status });
        map.set(f.check_id, list);
      }
    }
    return map;
  }, [impactQ.data, apiModule]);
  const groups = useMemo(() => (pivot === "rule" ? [] : pivotRules(ranked, pivot, features)), [ranked, pivot, features]);

  const accept = useMutation({
    mutationFn: (id: string) => acceptAllSuggested(id, receipt?.run_id),
    onSuccess: (r, id) => {
      setAccepted((prev) => new Set(prev).add(id));
      setNote(t("{accepted} suggested values for {id} are in your draft batch {draft_batch_id}. Nothing reaches SAP until an owner approves.", { accepted: int(r.accepted), id, draft_batch_id: r.draft_batch_id }));
      void qc.invalidateQueries({ queryKey: ["v2", "work-groups"] });
    },
    onError: () => setNote(t("The suggested values could not be accepted. Try again in a moment.")),
  });
  const onAccept = useCallback((id: string) => accept.mutate(id), [accept]);
  const onOpen = useCallback((id: string) => openItem({ kind: "rule", id }), [openItem]);
  const refresh = (key: string) => () => void qc.invalidateQueries({ queryKey: ["v2", key] });

  const total = Math.max(receipt?.rules_measured ?? 0, ranked.length);
  const currency = receipt?.currency ?? null;
  const tableLabel = t("Rules for {label}", { label });
  const viewHref = (id: string) => `/work?rule=${encodeURIComponent(id)}&module=${encodeURIComponent(apiModule)}`;
  const learnedN = learnedQ.data?.length;
  const draftsN = draftsQ.data?.length;
  const moreButton = ranked.length > shown ? (
    <>
      <Dot />
      <button type="button" className="m2-linkbtn" onClick={() => setShown((n) => n + PAGE)}>
        {t("Show {min} more", { min: Math.min(PAGE, ranked.length - shown) })}
      </button>
    </>
  ) : null;

  const filters = (
    <div className="m2-rbar">
      <div className="m2-segs" role="group" aria-label={t("Show")}>
        <button type="button" className="m2-seg" aria-pressed={view === "all"} onClick={() => setView("all")}>{t("All rules")}</button>
        <button type="button" className="m2-seg" aria-pressed={view === "top"} onClick={() => setView("top")}>{t("Top fixes")}</button>
        <button type="button" className="m2-seg" aria-pressed={view === "learned"} onClick={() => setView("learned")}>
          {`Learned${learnedN != null ? ` ${learnedN}` : ""}`}
        </button>
        {canDrafts ? (
          <button type="button" className="m2-seg" aria-pressed={view === "drafts"} onClick={() => setView("drafts")}>
            {`Drafts${draftsN != null ? ` ${draftsN}` : ""}`}
          </button>
        ) : null}
      </div>
      {view === "all" ? (
        <button type="button" className="m2-btn m2-sm" onClick={() => setSimulating(true)} data-testid="simulate-rules">
          {t("Simulate fixing…")}
        </button>
      ) : null}
      {simulating ? <SimulateDialog module={apiModule} label={label} systemId={systemId} run={run} onClose={() => setSimulating(false)} /> : null}
      {view === "all" ? (
        <div className="m2-segs" role="group" aria-label={t("Group the rules")}>
          {PIVOTS.map((p) => (
            <button key={p.key} type="button" className="m2-seg" aria-pressed={pivot === p.key} onClick={() => setPivot(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  if (view === "top") {
    return (
      <>
        {filters}
        <TopFixesView module={apiModule} label={label} systemId={systemId} run={run} />
      </>
    );
  }
  if (view === "learned") {
    return (
      <>
        {filters}
        {canDrafts ? <MineFixes onDone={refresh("learned")} /> : null}
        {learnedQ.isPending ? <Skeleton width="60%" height={14} /> : learnedQ.isError ? <ErrorFrame onRetry={() => void learnedQ.refetch()}>{t("The learned rules could not be read.")}</ErrorFrame> : <LearnedTable module={apiModule} items={learnedQ.data} canApprove={canApprove} canReject={canReject} onChanged={refresh("learned")} />}
      </>
    );
  }
  if (view === "drafts" && canDrafts) {
    return (
      <>
        {filters}
        {draftsQ.isPending ? <Skeleton width="60%" height={14} /> : draftsQ.isError ? <ErrorFrame onRetry={() => void draftsQ.refetch()}>{t("The drafts could not be read.")}</ErrorFrame> : <DraftsTable module={apiModule} items={draftsQ.data} onChanged={refresh("drafts")} />}
      </>
    );
  }

  const openId = open?.kind === "rule" ? open.id : null;
  const props: TableProps = { label: tableLabel, lines, receipt, module: apiModule, currency, total, canApply: can("apply"), accepted, onAccept, busy: accept.isPending, viewHref, more: moreButton, openId, onOpen };

  return (
    <>
      {filters}
      {rulesQ.isError ? (
        <ErrorFrame onRetry={() => void rulesQ.refetch()}>{t("The rules could not be read for this object.")}</ErrorFrame>
      ) : rulesQ.isPending ? (
        <div aria-busy="true" data-testid="rules-loading">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ height: 40, display: "flex", alignItems: "center" }}>
              <Skeleton width={`${50 + ((i * 11) % 40)}%`} height={12} />
            </div>
          ))}
        </div>
      ) : ranked.length === 0 ? (
        <EmptyFrame>{t("No rule has failed for {label} in this run. Rules appear here, ranked by value at risk, when an analysis finds records that fail.", { label })}</EmptyFrame>
      ) : pivot !== "rule" ? (
        <>
          <PivotTable groups={groups} pivot={pivot} label={`${tableLabel}, ${lc(PIVOTS.find((p) => p.key === pivot)?.label ?? "")}`} />
          {pivot === "feature" ? <p className="m2-prov">{t("A rule that blocks or degrades several features is counted under each. Features come from the impact model for this run.")}</p> : null}
        </>
      ) : narrow ? (
        <RulesList {...props} />
      ) : (
        <RulesTable {...props} />
      )}
      {note ? <p role="status" className="m2-prov" data-testid="rules-note">{note}</p> : null}
      {view === "all" && ranked.length > 0 ? (
        <p className="m2-prov">
          {t("Ranked by value at risk{value}. Failing % is of {records_checked} records checked.", { value: receipt?.value_at_risk != null ? t("; total {formatMoneyCompact} across {rules_measured} rules measured", { formatMoneyCompact: moneyCompactText(receipt.value_at_risk, currency), rules_measured: int(receipt.rules_measured) }) : "", records_checked: int(receipt?.records_checked ?? ranked[0].total_count) })}
        </p>
      ) : null}
    </>
  );
}
