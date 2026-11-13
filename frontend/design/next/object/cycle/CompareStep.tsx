"use client";

/**
 * Compare: two runs side by side (the run and the one it was cleaned from, by default). The score change, the
 * dimensions, and the failing records split into new, resolved, regressed and persisting, each paged on the server.
 */
import { useMemo, useState } from "react";
import { Button, DataTable, EmptyState, SegmentedControl, type Column } from "@/design/next/kit";
import { V2Link } from "@/design/v2/parts";
import { DimensionBars } from "@/design/v2/screens/object/Banner";
import { downloadCleaningWorkbook, useCompareSets, useCompareSummary, type Change, type CompareRecord } from "@/lib/api/next/runs";
import type { RuleRow } from "@/lib/api/v2/types";
import { useUrlParam } from "@/lib/v2/hooks";
import { useObjectRules } from "@/lib/v2/queries";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { dqsOf, reasonText, score, signed, valuesText } from "../model";
import { PairedScores } from "../PairedScores";
import { DeltaBar, Hero } from "./Meter";
import type { ObjectRun } from "../useObjectRun";

const SEGS: readonly Change[] = ["new", "resolved", "regressed", "persisting"];
const PAGE = 50;
const SEV: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low"), info: () => t("Info") };
const SEG_LABEL: Record<Change, () => string> = { new: () => t("New"), resolved: () => t("Resolved"), regressed: () => t("Regressed"), persisting: () => t("Persisting") };

export function CompareStep({ o, cycle, onNextCycle }: { o: ObjectRun; cycle: number | null; onNextCycle: () => void }) {
  const [beforeP, setBefore] = useUrlParam<string>("before", "");
  const [afterP, setAfter] = useUrlParam<string>("after", "");
  const [seg, setSeg] = useUrlParam<Change>("seg", "new", SEGS);
  const [offset, setOffset] = useState(0);
  const before = beforeP || o.previous?.id || "";
  const after = afterP || o.runId || "";
  const head = (id: string) => o.heads.find((h) => h.id === id) ?? (o.run?.id === id ? o.run : o.previous?.id === id ? o.previous : null);
  const a = head(before);
  const b = head(after);
  const summary = useCompareSummary(before, after);
  const sets = useCompareSets(before && after && before !== after ? { v1: before, v2: after, change: seg, module: o.module, limit: PAGE, offset } : null);
  const rulesB = useObjectRules(o.module, after || null);
  const rulesA = useObjectRules(o.module, before || null);
  const rules = useMemo(() => {
    const m = new Map<string, RuleRow>();
    for (const r of [...(rulesA.data ?? []), ...(rulesB.data ?? [])]) m.set(r.check_id, r);
    return m;
  }, [rulesA.data, rulesB.data]);

  if (o.heads.length < 2 && !o.runs.isLoading) {
    return (
      <EmptyState heading={t("Nothing to compare yet")} action={<Button variant="primary" onClick={onNextCycle}>{t("Download the cleaning workbook")}</Button>}>
        {t("This is the first run of {object}. Clean it and upload the workbook; the cleaned run is compared with this one.", { object: o.label })}
      </EmptyState>
    );
  }

  const dA = dqsOf(a, o.module);
  const dB = dqsOf(b, o.module);
  const totals = summary.data?.totals;
  const cell = o.landscape.data?.cells.find((c) => c.system_id === o.systemId && c.module === o.module && c.run_id === after);
  const nextNumber = (cycle ?? 0) + 1;
  const pick = (value: string, set: (v: string) => void, label: string, id: string) => (
    <label className="nx-field-label" htmlFor={id}>
      {label}
      <select id={id} className="nx-field" value={value} onChange={(e) => { set(e.target.value); setOffset(0); }}>
        {!head(value) && value ? <option value={value}>{t("Run {n}", { n: value })}</option> : null}
        {o.heads.slice(0, 200).map((h) => (
          <option key={h.id} value={h.id}>{t("Run {n}", { n: h.run_number ?? "" })}{h.parent_version_id ? ` (${t("Cleaned")})` : ""}</option>
        ))}
      </select>
    </label>
  );

  const columns: Column<CompareRecord>[] = [
    { id: "sev", label: t("Severity"), cell: (r) => { const s = rules.get(r.check_id)?.severity; return s ? SEV[s]?.() ?? s : "—"; } },
    { id: "rule", label: t("Rule"), cell: (r) => <span><span className="nx-mono">{r.check_id}</span> {rules.get(r.check_id)?.name ?? ""}</span>, compare: (x, y) => x.check_id.localeCompare(y.check_id) },
    { id: "field", label: t("Field"), cell: (r) => { const ru = rules.get(r.check_id); return ru?.field ? <span><span className="nx-mono">{ru.field}</span> {ru.field_description ?? ""}</span> : "—"; } },
    { id: "key", label: t("Record key"), cell: (r) => <span className="nx-mono">{r.record_key}</span>, compare: (x, y) => x.record_key.localeCompare(y.record_key) },
    { id: "before", label: t("Value before"), cell: (r) => valuesText(r.values_before) },
    { id: "after", label: t("Value after"), cell: (r) => valuesText(r.values_after) },
    { id: "reason", label: t("Reason"), cell: (r) => reasonText(r.reason) },
  ];
  const page = sets.data;
  const shownTotal = page?.total ?? totals?.[seg] ?? 0;

  return (
    <div className="nx-stack" data-testid="compare-step">
      <div className="nx-compare-pick">
        {pick(before, (v) => setBefore(v), t("Before"), "nx-cmp-before")}
        <Button variant="quiet" size={32} aria-label={t("Swap before and after")} onClick={() => { setBefore(after); setAfter(before); setOffset(0); }}>{t("Swap")}</Button>
        {pick(after, (v) => setAfter(v), t("After"), "nx-cmp-after")}
      </div>
      {before === after ? <p className="nx-note">{t("Choose two different runs.")}</p> : null}
      <p className="nx-compare-delta nx-num" data-testid="compare-delta">
        {dA !== null && dB !== null
          ? t("DQS {a} to {b} ({delta})", { a: score(dA), b: score(dB), delta: signed(dB - dA) })
          : t("One of the runs has no score for this object.")}
      </p>
      <div className="nx-heroes" data-testid="compare-heroes">
        <Hero label={t("Before: run {n}", { n: a?.run_number ?? "" })} value={dA} />
        <Hero label={t("After: run {n}", { n: b?.run_number ?? "" })} value={dB} delta={dA !== null && dB !== null ? dB - dA : null} />
      </div>
      <DeltaBar before={dA} after={dB} />
      {totals ? (
        <p className="nx-receipt nx-num" data-testid="compare-receipt">
          {t("{new} new, {resolved} resolved, {regressed} regressed, {persisting} still failing", { new: int(totals.new), resolved: int(totals.resolved), regressed: int(totals.regressed), persisting: int(totals.persisting) })}
        </p>
      ) : null}
      {cell ? <DimensionBars cell={cell} /> : null}
      <PairedScores o={o} />
      <SegmentedControl
        items={SEGS.map((s) => ({ value: s, label: totals ? `${SEG_LABEL[s]()} ${int(totals[s])}` : SEG_LABEL[s]() }))}
        value={seg}
        onChange={(v) => { setSeg(v); setOffset(0); }}
        label={t("Which records")}
      />
      <DataTable
        rows={page?.records ?? []}
        columns={columns}
        rowKey={(r) => `${r.check_id}|${r.record_key}`}
        rowLabel={(r) => t("Record {key}, rule {rule}", { key: r.record_key, rule: r.check_id })}
        caption={t("{seg} failing records between run {a} and run {b}", { seg: SEG_LABEL[seg](), a: a?.run_number ?? "", b: b?.run_number ?? "" })}
        total={shownTotal}
        loading={sets.isLoading}
        error={sets.error ? { sentence: t("The records could not be compared."), onRetry: () => void sets.refetch() } : undefined}
        empty={{ heading: t("No records in this group"), text: t("Pick another group above.") }}
      />
      <div className="nx-pager">
        <Button variant="secondary" size={32} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("Previous")}</Button>
        <span className="nx-num nx-muted">{shownTotal ? t("{from} to {to} of {total}", { from: int(offset + 1), to: int(Math.min(offset + PAGE, shownTotal)), total: int(shownTotal) }) : null}</span>
        <Button variant="secondary" size={32} disabled={!page || page.next_offset === null} onClick={() => page?.next_offset != null && setOffset(page.next_offset)}>{t("Next")}</Button>
      </div>
      <div className="nx-actions">
        {totals && totals.new > 0 ? (
          <Button variant="secondary" icon="download" onClick={() => void downloadCleaningWorkbook(after, o.module)}>
            {t("Download workbook for the {n} new issues", { n: int(totals.new) })}
          </Button>
        ) : null}
        <Button variant="primary" onClick={onNextCycle}>{t("Start cycle {n}", { n: nextNumber })}</Button>
        <V2Link className="nx-btn nx-btn-secondary" href="/migration/load-plan">{t("Prepare load files")}</V2Link>
      </div>
    </div>
  );
}
