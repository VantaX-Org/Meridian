"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWork } from "@/lib/api/v2/work";
import { useWorkActions } from "@/lib/v2/work-actions";
import { moneyCompactText } from "@/lib/v2/labels";
import { approveLearned, dryRunDraft, mineFixes, publishDraft, rejectLearned, type DraftDryRun, type LearnedProposal, type RuleDraft } from "@/lib/api/v2/object";
import { formatDate, formatMoney } from "@/lib/format";
import { DIMENSIONS, type Receipt as ReceiptData, type RuleRow } from "@/lib/api/v2/types";
import { KIND_LABEL } from "@/lib/api/learnedRules";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { useConfigImpact, useDrafts, useLearned, useWorkGroups } from "@/lib/v2/object-queries";
import { useObjectRules, useReceipt } from "@/lib/v2/queries";
import { PIVOTS, pivotRules, rankRules, type FeatureLink, type Pivot, type PivotGroup } from "@/lib/v2/rules-pivot";
import { int, pct1 } from "@/lib/v2/score";
import { describeField } from "@/lib/v2/sap-fields";
import { t, lc, tn } from "@/lib/v2/i18n";
import { Button, Code, DataTable, EmptyState, ErrorState, SegmentedControl, Skeleton, type Column } from "@/design/next/kit";
import { ExportTable } from "@/design/next/more/ExportTable";
import { Dash, ItemLink, RuleLink, SevChip } from "./tabs-g-parts";
import { DictionaryReview } from "./DictionaryReview";
import { Receipt } from "./Receipt";
import { SimulateDialog, TopFixesView } from "./Simulate";
import type { ObjectRun } from "../useObjectRun";
import "./tabs-f.css";

type View = "all" | "top" | "learned" | "drafts";
type Sev = "critical" | "high" | "medium" | "low";
type SampleRows = Parameters<ReturnType<typeof useWorkActions>["acceptRule"]>[3];

const PAGE = 25;
const dimLabel = (d: string | null | undefined): string => DIMENSIONS.find((x) => x.key === d)?.label ?? "";
const pct2 = (n: number | null): string => (n == null ? "—" : `${(Math.round(n * 100) / 100).toFixed(2)}%`);

/** What the table shows for one rule, derived once from the rule and the object's receipt. */
interface RuleLine {
  rule: RuleRow;
  /** Null until the receipt has been read. */
  over: boolean | null;
  failingPct: number | null;
  coverage: number | null;
  proposed: number;
}

function lineOf(rule: RuleRow, receipt: ReceiptData | undefined, proposed: number): RuleLine {
  const checked = receipt?.records_checked ?? rule.total_count;
  const over = rule.severity !== "critical" ? false : receipt ? receipt.breaches.some((b) => b.check_id === rule.check_id) : null;
  return {
    rule,
    over,
    failingPct: checked > 0 ? (rule.affected_count / checked) * 100 : null,
    coverage: receipt?.records_checked ? Math.min(1, rule.total_count / receipt.records_checked) : null,
    proposed,
  };
}

function restOf(lines: RuleLine[], receipt: ReceiptData | undefined): number | null {
  if (receipt?.value_at_risk == null) return null;
  return Math.max(0, receipt.value_at_risk - lines.reduce((s, l) => s + (l.rule.value_at_risk ?? 0), 0));
}

const money = (n: number | null | undefined, currency: string | null) => (n == null ? <Dash /> : <span className="nx-num">{formatMoney(n, currency)}</span>);

/* ---- rules table ---- */

function SuggestedLine({ line, canApply, accepted, onAccept, busy, viewHref }: { line: RuleLine; canApply: boolean; accepted: boolean; onAccept: (id: string) => void; busy: boolean; viewHref: string }) {
  if (accepted) return <span className="nx-tf-sub">{t("Suggested values accepted")}</span>;
  if (line.proposed <= 0) return null;
  const id = line.rule.check_id;
  return (
    <span className="nx-tf-dec">
      <span className="nx-tf-sub">{t("{proposed} suggested values", { proposed: int(line.proposed) })}</span>
      {canApply ? (
        <Button variant="quiet" size={32} disabled={busy} aria-label={t("Accept all {proposed} suggested values for {check_id}", { proposed: int(line.proposed), check_id: id })} onClick={() => onAccept(id)}>
          {t("Accept all")}
        </Button>
      ) : (
        <Link href={viewHref} className="nx-link">{t("View")}</Link>
      )}
    </span>
  );
}

function RulesTable({ label, lines, ranked, receipt, module, currency, total, canApply, accepted, onAccept, busy, viewHref, shown, onMore, onOpen }: {
  label: string; lines: RuleLine[]; ranked: number; receipt: ReceiptData | undefined; module: string; currency: string | null; total: number; canApply: boolean;
  accepted: ReadonlySet<string>; onAccept: (id: string) => void; busy: boolean; viewHref: (id: string) => string; shown: number; onMore: () => void; onOpen: (id: string) => void;
}) {
  const moreCount = total - lines.length;
  const rest = restOf(lines, receipt);
  const columns: Column<RuleLine>[] = [
    {
      id: "rule",
      label: t("Rule"),
      cell: (l) => (
        <span className="nx-tf-pair">
          <RuleLink id={l.rule.check_id} name={l.rule.name} />
          {l.rule.why ? <small>{l.rule.why}</small> : null}
          <SuggestedLine line={l} canApply={canApply} accepted={accepted.has(l.rule.check_id)} onAccept={onAccept} busy={busy} viewHref={viewHref(l.rule.check_id)} />
        </span>
      ),
    },
    {
      id: "field",
      label: t("Field"),
      cell: (l) => (l.rule.field ? <Code code={l.rule.field} text={l.rule.field_description ?? describeField(l.rule.field) ?? undefined} /> : <Dash />),
    },
    { id: "dimension", label: t("Dimension"), cell: (l) => dimLabel(l.rule.dimension) || <Dash /> },
    { id: "severity", label: t("Severity"), cell: (l) => <SevChip severity={l.rule.severity} /> },
    {
      id: "tolerance",
      label: t("Tolerance"),
      align: "end",
      cell: (l) => (l.rule.severity === "critical" && receipt ? t("{rows} rows", { rows: int(receipt.tolerance.rows) }) : <Dash why={t("Only critical rules carry a tolerance")} />),
    },
    { id: "over", label: t("Over tolerance"), cell: (l) => (l.over == null ? <Dash /> : l.over ? <strong>{t("Yes")}</strong> : t("No")) },
    { id: "failing", label: t("Failing rows"), align: "end", cell: (l) => <span className="nx-num">{int(l.rule.affected_count)}</span>, compare: (a, b) => a.rule.affected_count - b.rule.affected_count },
    { id: "pct", label: t("Failing %"), align: "end", cell: (l) => <span className="nx-num">{pct2(l.failingPct)}</span> },
    { id: "coverage", label: t("Coverage"), align: "end", cell: (l) => <span className="nx-num">{l.coverage == null ? "—" : pct1(l.coverage * 100)}</span> },
    {
      id: "value",
      label: t("Value at risk{value}", { value: currency ? `, ${currency}` : "" }),
      align: "end",
      cell: (l) => money(l.rule.value_at_risk, currency),
      compare: (a, b) => (a.rule.value_at_risk ?? 0) - (b.rule.value_at_risk ?? 0),
    },
  ];
  return (
    <>
      <ExportTable>
        <DataTable<RuleLine>
          rows={lines}
          columns={columns}
          rowKey={(l) => l.rule.check_id}
          rowLabel={(l) => `${l.rule.check_id} ${l.rule.name ?? ""}`.trim()}
          caption={label}
          total={total}
          onOpenRow={(l) => onOpen(l.rule.check_id)}
        />
      </ExportTable>
      <p className="nx-tf-tools nx-tf-sub">
        {moreCount > 0 ? (
          <Link href={`/rules?object=${encodeURIComponent(module)}`} className="nx-link" data-testid="more-rules">
            {t("and {moreCount} more rules", { moreCount: int(moreCount) })}
          </Link>
        ) : (
          <span>{t("No further rules")}</span>
        )}
        {ranked > shown ? (
          <Button variant="quiet" size={32} onClick={onMore}>{t("Show {min} more", { min: Math.min(PAGE, ranked - shown) })}</Button>
        ) : null}
        {moreCount > 0 ? money(rest, currency) : null}
        <span>{t("All {total} rules", { total: int(total) })}</span>
        {money(receipt?.value_at_risk ?? null, currency)}
      </p>
    </>
  );
}

const PIVOT_WORD: Partial<Record<Pivot, () => string>> = { field: () => t("Field"), dimension: () => t("Dimension"), severity: () => t("Severity"), feature: () => t("S/4 feature") };

/** One row per group; the rules behind a group open under it. */
function PivotTable({ groups, pivot, label, currency }: { groups: PivotGroup[]; pivot: Exclude<Pivot, "rule">; label: string; currency: string | null }) {
  const word = PIVOT_WORD[pivot]?.() ?? t("Group");
  const columns: Column<PivotGroup>[] = [
    {
      id: "group",
      label: word.charAt(0).toUpperCase() + word.slice(1),
      cell: (g) => (
        <details className="nx-tf-disclose">
          <summary>{g.mono ? <Code code={g.key} text={g.label} /> : g.label}{g.sub ? <span className="nx-tf-sub"> {g.sub}</span> : null}</summary>
          <ul className="nx-tf-list">
            {g.rules.slice(0, 12).map((r) => (
              <li key={r.check_id}>
                <RuleLink id={r.check_id} name={r.name} />
                <span className="nx-num">{int(r.affected_count)}</span>
                {money(r.value_at_risk, currency)}
              </li>
            ))}
            {g.rules.length > 12 ? <li>{t("and {count} more rules", { count: int(g.rules.length - 12) })}</li> : null}
          </ul>
        </details>
      ),
    },
    { id: "rules", label: t("Rules"), align: "end", cell: (g) => <span className="nx-num">{int(g.rules.length)}</span>, compare: (a, b) => a.rules.length - b.rules.length },
    { id: "failing", label: t("Failing rows"), align: "end", cell: (g) => <span className="nx-num">{int(g.failing)}</span>, compare: (a, b) => a.failing - b.failing },
    { id: "value", label: t("Value at risk"), align: "end", cell: (g) => money(g.value, currency), compare: (a, b) => (a.value ?? 0) - (b.value ?? 0) },
  ];
  return (
    <ExportTable>
      <DataTable<PivotGroup> rows={groups} columns={columns} rowKey={(g) => g.key} rowLabel={(g) => g.label} caption={label} />
    </ExportTable>
  );
}

/* ---- learned rules ---- */

const learnedKind = (k: LearnedProposal["kind"]): string => (k === "null" ? t("Blank field stewards always fill") : k === "invalid_value" ? t("Value stewards always correct") : KIND_LABEL[k]);

/** Where a proposal came from and what supports it: the fixes behind a mined rule, or the rows of the data. */
function Evidence({ p }: { p: LearnedProposal }) {
  const e = p.evidence;
  if (p.source !== "fixes" || !e) return <span className="nx-tf-sub">{t("From the data: {rows} rows agree", { rows: int(p.support_rows) })}</span>;
  const span = e.first_at && e.last_at ? t("{from} to {to}", { from: formatDate(e.first_at, "date"), to: formatDate(e.last_at, "date") }) : null;
  const val = (v: string | null | undefined) => (v != null ? <span className="nx-mono">{v}</span> : <Dash />);
  return (
    <span className="nx-tf-pair" data-testid="learned-evidence">
      <span>{t("From fixes: {count} {n, plural, one {record} other {records}}{span}{who}", { count: int(e.count), n: e.count, span: span ? `, ${span}` : "", who: e.who.length ? t(", by {who}", { who: e.who.join(", ") }) : "" })}</span>
      <span>
        {e.pattern === "blank" ? tn("Blank, filled with {value}", { value: val(e.fix_value) }) : tn("Was {old}, corrected to {value}", { old: <span className="nx-mono">{e.invalid_value ?? ""}</span>, value: val(e.fix_value) })}
      </span>
      <small>
        {t("Fixes it came from:")}{" "}
        {e.sample_keys.map((k, i) => (
          <span key={k}>
            {i > 0 ? ", " : ""}
            <ItemLink kind="record" id={`${p.module}:${k}`} className="nx-mono">{k.split("=").slice(1).join("=") || k}</ItemLink>
          </span>
        ))}
        {e.count > e.sample_keys.length ? ` ${t("and {more} more", { more: int(e.count - e.sample_keys.length) })}` : ""}
      </small>
    </span>
  );
}

function LearnedTable({ module, items, canApprove, canReject, onChanged }: { module: string; items: LearnedProposal[]; canApprove: boolean; canReject: boolean; onChanged: () => void }) {
  const [severity, setSeverity] = useState<Record<string, Sev>>({});
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
  const busy = approve.isPending || reject.isPending;
  const columns: Column<LearnedProposal>[] = [
    {
      id: "rule",
      label: t("Proposed rule"),
      cell: (p) => (
        <span className="nx-tf-pair">
          <span>{learnedKind(p.kind)}</span>
          <small>{p.determinant ? t("{field} by {determinant}", { field: p.field, determinant: p.determinant }) : p.field}</small>
        </span>
      ),
    },
    { id: "evidence", label: t("Evidence"), cell: (p) => <Evidence p={p} /> },
    { id: "confidence", label: t("Confidence"), align: "end", cell: (p) => <span className="nx-num">{`${Math.round(p.confidence * 100)}%`}</span>, compare: (a, b) => a.confidence - b.confidence },
    { id: "support", label: t("Rows supporting"), align: "end", cell: (p) => <span className="nx-num">{int(p.support_rows)}</span> },
    { id: "violations", label: t("Would fail"), align: "end", cell: (p) => <span className="nx-num">{int(p.violations)}</span> },
    {
      id: "decision",
      label: t("Decision"),
      cell: (p) =>
        canApprove || canReject ? (
          <span className="nx-tf-form">
            {canApprove ? (
              <>
                <select aria-label={t("Severity for {field}", { field: p.field })} value={severity[p.id] ?? "medium"} onChange={(e) => setSeverity((s) => ({ ...s, [p.id]: e.target.value as Sev }))}>
                  <option value="critical">{t("Critical")}</option>
                  <option value="high">{t("High")}</option>
                  <option value="medium">{t("Medium")}</option>
                  <option value="low">{t("Low")}</option>
                </select>
                <Button variant="primary" size={32} disabled={busy} onClick={() => approve.mutate(p)}>{t("Approve")}</Button>
              </>
            ) : null}
            {canReject ? <Button variant="secondary" size={32} disabled={busy} onClick={() => reject.mutate(p)}>{t("Reject")}</Button> : null}
          </span>
        ) : (
          <span className="nx-tf-sub">{t("Waiting for an approver")}</span>
        ),
    },
  ];
  return (
    <>
      <ExportTable>
        <DataTable<LearnedProposal>
          rows={items}
          columns={columns}
          rowKey={(p) => p.id}
          rowLabel={(p) => `${learnedKind(p.kind)} ${p.field}`}
          caption={t("Learned rules waiting for a decision")}
          empty={{ heading: t("Nothing to decide"), text: t("No learned rules are waiting for {replace}. The miner proposes rules from the data after an analysis; a person with approval rights decides.", { replace: module.replace(/_/g, " ") }) }}
        />
      </ExportTable>
      {note ? <p role="status" className="nx-tf-sub">{note}</p> : null}
      {approve.isError || reject.isError ? <p role="alert">{t("That decision could not be saved. It may already have been decided.")}</p> : null}
    </>
  );
}

function MineFixes({ onDone }: { onDone: () => void }) {
  const mine = useMutation({ mutationFn: mineFixes, onSuccess: onDone });
  return (
    <p className="nx-tf-tools">
      <Button variant="secondary" size={32} loading={mine.isPending} loadingLabel={t("Mining…")} onClick={() => mine.mutate()}>
        {t("Mine stewards’ fixes now")}
      </Button>
      <span className="nx-tf-sub" role="status">
        {mine.data
          ? t("{proposed} new, {refreshed} refreshed, from {edits} fixes; a rule needs {min} records fixed the same way.", { proposed: int(mine.data.proposed), refreshed: int(mine.data.refreshed), edits: int(mine.data.edits), min: int(mine.data.min_records) })
          : mine.isError
            ? t("The fixes could not be mined.")
            : t("A nightly run does this too.")}
      </span>
    </p>
  );
}

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
      <EmptyState
        heading={t("No drafts")}
        action={<Link href={`/rules?view=drafts&module=${encodeURIComponent(module)}`} className="nx-link">{t("Open rule authoring")}</Link>}
      >
        {t("No drafts for {replace}. Write one in rule authoring or describe it in plain English there; a dry run shows what it would find before it is published.", { replace: module.replace(/_/g, " ") })}
      </EmptyState>
    );
  }
  const columns: Column<RuleDraft>[] = [
    {
      id: "draft",
      label: t("Draft"),
      cell: (d) => (
        <span className="nx-tf-pair">
          <span className="nx-mono">{d.proposed_rule.id}</span>
          <span>{d.proposed_rule.message ?? t("Untitled draft")}</span>
          {d.rationale ? <small>{d.rationale}</small> : null}
        </span>
      ),
    },
    { id: "field", label: t("Field"), cell: (d) => (d.proposed_rule.field ? <Code code={d.proposed_rule.field} text={describeField(d.proposed_rule.field) ?? undefined} /> : <Dash />) },
    { id: "dimension", label: t("Dimension"), cell: (d) => dimLabel(d.proposed_rule.dimension) || <Dash /> },
    { id: "severity", label: t("Severity"), cell: (d) => <SevChip severity={d.proposed_rule.severity} /> },
    {
      id: "dry",
      label: t("Dry run"),
      cell: (d) => {
        const res = results[d.id];
        return (
          <span className="nx-tf-dec">
            <Button variant="secondary" size={32} loading={dry.isPending && dry.variables?.id === d.id} aria-label={t("Dry run {id}", { id: d.proposed_rule.id ?? d.id })} onClick={() => dry.mutate(d)}>
              {t("Dry run")}
            </Button>
            {res ? (
              <span role="status" className="nx-tf-sub">
                {res === "error" ? t("The dry run could not run.") : !res.evaluated ? res.reason : t("{hits} of {population} records would fail", { hits: int(res.hits), population: int(res.population) })}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "publish",
      label: t("Publish"),
      cell: (d) => (
        <Button variant="primary" size={32} loading={publish.isPending && publish.variables?.id === d.id} aria-label={t("Publish {id}", { id: d.proposed_rule.id ?? d.id })} onClick={() => publish.mutate(d)}>
          {t("Publish")}
        </Button>
      ),
    },
  ];
  return (
    <>
      <ExportTable>
        <DataTable<RuleDraft> rows={items} columns={columns} rowKey={(d) => d.id} rowLabel={(d) => d.proposed_rule.message ?? d.id} caption={t("Rule drafts")} />
      </ExportTable>
      {note ? <p role="status" className="nx-tf-sub">{note}</p> : null}
      {publish.isError ? <p role="alert">{t("The draft could not be published. Run the dry run first and check the expression.")}</p> : null}
    </>
  );
}

/* ---- accepting suggested values ---- */

function AcceptPreview({ check, module, run, count, busy, onConfirm, onCancel }: { check: string; module: string; run: string | undefined; count: number; busy: boolean; onConfirm: (check: string, rows: SampleRows) => void; onCancel: () => void }) {
  const q = useQuery({ queryKey: ["v2", "accept-preview", module, check, run], queryFn: () => getWork({ module, check_id: check, proposed: true, version_id: run, limit: 5 }) });
  const rows = q.data?.items ?? [];
  const val = (v: string | null | undefined, text: string | null | undefined) => (v ? <Code code={v} text={text ?? undefined} /> : <Dash />);
  return (
    <section className="nx-tf-card" role="region" aria-label={t("Accept the suggested values for {check}", { check })} data-testid="accept-preview">
      <p>{t("Accept {n} suggested values for {check}? They go into your fix batch; nothing reaches SAP until an owner approves. You can undo this.", { n: int(count), check })}</p>
      {q.isPending ? <Skeleton lines={2} /> : rows.length ? (
        <ul className="nx-tf-list">
          {rows.map((r) => (
            <li key={r.record_key}>
              <span className="nx-mono">{r.record_key}</span>{": "}
              {val(r.current_value, r.current_label)}
              {" "}{t("to")}{" "}
              {val(r.suggested_value, r.suggested_label)}
            </li>
          ))}
          {count > rows.length ? <li>{t("and {n} more", { n: int(count - rows.length) })}</li> : null}
        </ul>
      ) : null}
      <div className="nx-tf-tools">
        <Button variant="primary" size={32} disabled={busy} onClick={() => onConfirm(check, rows)}>{t("Accept {n} suggested values", { n: int(count) })}</Button>
        <Button variant="secondary" size={32} disabled={busy} onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </section>
  );
}

/* ---- the tab ---- */

/** The Rules tab: the receipt, the object's rules ranked by value at risk, pivots, and the Top fixes, Learned and Drafts views. */
export function RulesTab({ o }: { o: ObjectRun }) {
  const run = o.runId;
  const mod = o.module;
  const { openItem, hrefFor } = useOpenItem();
  const { can } = useV2Session();
  const qc = useQueryClient();
  const rulesQ = useObjectRules(mod, run, 0);
  const receiptQ = useReceipt(mod, run);
  const receipt = receiptQ.data;
  const groupsQ = useWorkGroups(mod, receipt?.run_id, Boolean(receipt));
  const impactQ = useConfigImpact(receipt?.run_id);

  const canDrafts = can("manage_rules");
  const canApprove = can("approve") || can("review_ai_rules");
  const canReject = canApprove || can("manage_rules");
  const learnedQ = useLearned(mod, true);
  const draftsQ = useDrafts(mod, canDrafts);

  const [simulating, setSimulating] = useState(false);
  const [pivot, setPivot] = useState<Pivot>("rule");
  const [view, setView] = useUrlParam<View>("view", "all", ["all", "top", "learned", "drafts"]);
  const [shown, setShown] = useState(PAGE);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [batch, setBatch] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const ranked = useMemo(() => rankRules(rulesQ.data ?? []), [rulesQ.data]);
  const proposed = useMemo(() => new Map((groupsQ.data ?? []).map((g) => [g.check_id, g.proposed])), [groupsQ.data]);
  const lines = useMemo(() => ranked.slice(0, shown).map((r) => lineOf(r, receipt, proposed.get(r.check_id) ?? 0)), [ranked, shown, receipt, proposed]);
  const features = useMemo(() => {
    const map = new Map<string, FeatureLink[]>();
    for (const res of impactQ.data ?? []) {
      if (res.status === "ok") continue;
      for (const f of res.blocking_findings) {
        if (f.module && f.module !== mod) continue;
        const list = map.get(f.check_id) ?? [];
        list.push({ feature: res.feature, status: res.status });
        map.set(f.check_id, list);
      }
    }
    return map;
  }, [impactQ.data, mod]);
  const groups = useMemo(() => (pivot === "rule" ? [] : pivotRules(ranked, pivot, features)), [ranked, pivot, features]);

  const actions = useWorkActions();
  const onAccept = (id: string) => {
    setNote(null);
    setPending(id);
  };
  const confirmAccept = async (id: string, sample: SampleRows) => {
    setAccepting(true);
    const r = await actions.acceptRule(id, proposed.get(id) ?? 0, receipt?.run_id, sample);
    setAccepting(false);
    setPending(null);
    if (!r) return setNote(t("The suggested values could not be accepted. Try again in a moment."));
    setAccepted((prev) => new Set(prev).add(id));
    setNote(t("{accepted} suggested values for {id} are in your fix batch. Nothing reaches SAP until an owner approves.", { accepted: int(r.accepted ?? proposed.get(id) ?? 0), id }));
    setBatch(r.draft_batch_id);
  };
  const refresh = (key: string) => () => void qc.invalidateQueries({ queryKey: ["v2", key] });

  const total = Math.max(receipt?.rules_measured ?? 0, ranked.length);
  const currency = receipt?.currency ?? null;
  const tableLabel = t("Rules for {label}", { label: o.label });
  const viewHref = (id: string) => `/work?rule=${encodeURIComponent(id)}&module=${encodeURIComponent(mod)}`;
  const learnedN = learnedQ.data?.length;
  const draftsN = draftsQ.data?.length;

  const viewItems: { value: View; label: string }[] = [
    { value: "all", label: t("All rules") },
    { value: "top", label: t("Top fixes") },
    { value: "learned", label: learnedN != null ? t("Learned {count}", { count: learnedN }) : t("Learned") },
    ...(canDrafts ? [{ value: "drafts" as const, label: draftsN != null ? t("Drafts {count}", { count: draftsN }) : t("Drafts") }] : []),
  ];

  const filters = (
    <div className="nx-tf-tools">
      <SegmentedControl<View> label={t("Show")} value={view} onChange={setView} items={viewItems} />
      {view === "all" ? (
        <>
          <Button variant="secondary" size={32} onClick={() => setSimulating(true)} data-testid="simulate-rules">{t("Simulate fixing…")}</Button>
          <SegmentedControl<Pivot> label={t("Group the rules")} value={pivot} onChange={setPivot} items={PIVOTS.map((p) => ({ value: p.key, label: p.label }))} />
        </>
      ) : null}
      {simulating ? <SimulateDialog module={mod} label={o.label} systemId={o.systemId} run={run} onClose={() => setSimulating(false)} /> : null}
    </div>
  );

  let body;
  if (view === "top") {
    body = <TopFixesView module={mod} label={o.label} systemId={o.systemId} run={run} />;
  } else if (view === "learned") {
    body = (
      <>
        {canDrafts ? <MineFixes onDone={refresh("learned")} /> : null}
        {learnedQ.isPending ? (
          <Skeleton lines={3} />
        ) : learnedQ.isError ? (
          <ErrorState sentence={t("The learned rules could not be read.")} onRetry={() => void learnedQ.refetch()} />
        ) : (
          <LearnedTable module={mod} items={learnedQ.data} canApprove={canApprove} canReject={canReject} onChanged={refresh("learned")} />
        )}
        <DictionaryReview module={mod} />
      </>
    );
  } else if (view === "drafts" && canDrafts) {
    body = draftsQ.isPending ? (
      <Skeleton lines={3} />
    ) : draftsQ.isError ? (
      <ErrorState sentence={t("The drafts could not be read.")} onRetry={() => void draftsQ.refetch()} />
    ) : (
      <DraftsTable module={mod} items={draftsQ.data} onChanged={refresh("drafts")} />
    );
  } else if (rulesQ.isError) {
    body = <ErrorState sentence={t("The rules could not be read for this object.")} onRetry={() => void rulesQ.refetch()} />;
  } else if (rulesQ.isPending) {
    body = (
      <div data-testid="rules-loading">
        <Skeleton lines={5} label={tableLabel} />
      </div>
    );
  } else if (ranked.length === 0) {
    body = (
      <EmptyState heading={t("No failing rules")}>
        {t("No rule has failed for {label} in this run. Rules appear here, ranked by value at risk, when an analysis finds records that fail.", { label: o.label })}
      </EmptyState>
    );
  } else {
    body = (
      <>
        {pivot !== "rule" ? (
          <>
            <PivotTable groups={groups} pivot={pivot} label={`${tableLabel}, ${lc(PIVOTS.find((p) => p.key === pivot)?.label ?? "")}`} currency={currency} />
            {pivot === "feature" ? <p className="nx-tf-sub">{t("A rule that blocks or degrades several features is counted under each. Features come from the impact model for this run.")}</p> : null}
          </>
        ) : (
          <RulesTable
            label={tableLabel}
            lines={lines}
            ranked={ranked.length}
            receipt={receipt}
            module={mod}
            currency={currency}
            total={total}
            canApply={can("apply")}
            accepted={accepted}
            onAccept={onAccept}
            busy={accepting}
            viewHref={viewHref}
            shown={shown}
            onMore={() => setShown((n) => n + PAGE)}
            onOpen={(id) => openItem({ kind: "rule", id })}
          />
        )}
        {pending ? (
          <AcceptPreview check={pending} module={mod} run={receipt?.run_id} count={proposed.get(pending) ?? 0} busy={accepting} onConfirm={(c, rows) => void confirmAccept(c, rows)} onCancel={() => setPending(null)} />
        ) : null}
        {note ? (
          <p role="status" className="nx-tf-sub" data-testid="rules-note">
            {note}
            {batch ? (
              <>
                {" "}
                <Link href={hrefFor({ kind: "batch", id: batch })} className="nx-link">{t("Open the fix batch")}</Link>
              </>
            ) : null}
          </p>
        ) : null}
        <p className="nx-tf-sub">
          {t("Ranked by value at risk{value}. Failing % is of {records_checked} records checked.", {
            value: receipt?.value_at_risk != null ? t("; total {formatMoneyCompact} across {rules_measured} rules measured", { formatMoneyCompact: moneyCompactText(receipt.value_at_risk, currency), rules_measured: int(receipt.rules_measured) }) : "",
            records_checked: int(receipt?.records_checked ?? ranked[0].total_count),
          })}
        </p>
      </>
    );
  }

  return (
    <div className="nx-tf" data-testid="rules-tab">
      {receipt ? <Receipt receipt={receipt} open={false} /> : null}
      {filters}
      {body}
    </div>
  );
}
