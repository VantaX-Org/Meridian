"use client";

import { useQuery } from "@tanstack/react-query";
import { getCleaningPlan, type CleaningBatch, type CleaningItem, type CleaningPlan, type EngineOffReason, type RuleChange } from "@/lib/api/v2/aletheia-engine";
import { useFixture } from "@/lib/api/v2/fixture";
import { int } from "@/lib/v2/score";
import { t as tr } from "@/lib/v2/i18n";
import { Coded, EmptyFrame, Mono } from "../../parts";
import { EvidencePanel, Mark } from "../AletheiaForesight";
import { ENGINE_OFF } from "../Insights";
import { retry, Section, Table } from "../WorkAnalytics";

/**
 * Aletheia cleaning plan (GET /aletheia/cleaning-plan): why each rule fails, the fix value Meridian computed locally
 * with its confidence, the fix batches grouped by field, what changed since the last run, and each rule's learned
 * normal range of failures. Only counts, rule ids and pattern masks reach the page; never a record value.
 */

const KIND: Record<string, () => string> = {
  auto: () => tr("Suggested value"),
  fill: () => tr("Fill a required field"),
  pick: () => tr("Pick an allowed value"),
  review: () => tr("Review by hand"),
};
const SOURCE: Record<string, () => string> = {
  rule_auto_fix: () => tr("Rule's automatic fix"),
  value_fix_map: () => tr("Rule's value map"),
  fix_draft: () => tr("Drafted fix"),
};
const kind = (k: string) => KIND[k]?.() ?? k;

/** The description part of "MARA.MTART (Material type)", so the code shows with its text beside it. */
function fieldText(field: string, label: string): string | null {
  const head = `${field} (`;
  return label.startsWith(head) && label.endsWith(")") ? label.slice(head.length, -1) : null;
}

function Changes({ p }: { p: CleaningPlan }) {
  const c = p.changes;
  if (!c.available) return <EmptyFrame>{tr("Two runs of this object are needed before Meridian can say what changed.")}</EmptyFrame>;
  const rows: [string, RuleChange[]][] = [
    [tr("Fails for the first time"), c.new], [tr("Now passes"), c.resolved], [tr("More failing records"), c.worse], [tr("Fewer failing records"), c.better],
  ];
  const msg = new Map(p.items.map((i) => [i.rule, i.message]));
  return (
    <>
      <p data-testid="acp-narrative">{c.narrative}</p>
      <Table title={tr("What changed since the last run")} head={[tr("Change"), tr("Rule"), tr("Before"), tr("After")]}>
        {rows.flatMap(([what, list]) => list.map((r) => (
          <tr key={`${what}-${r.rule}`}>
            <th scope="row" className="m2-card-lead">{what}</th>
            <td data-label={tr("Rule")}><Coded code={r.rule} text={msg.get(r.rule)} /></td>
            <td data-label={tr("Before")} className="m2-num">{int(r.before)}</td>
            <td data-label={tr("After")} className="m2-num">{int(r.after)}</td>
          </tr>
        )))}
      </Table>
    </>
  );
}

function Batches({ batches }: { batches: CleaningBatch[] }) {
  if (batches.length === 0) return <EmptyFrame>{tr("No rule fails in this run, so there is nothing to batch.")}</EmptyFrame>;
  return (
    <Table title={tr("Fix batches by field")} head={[tr("Field"), tr("Kind of fix"), tr("Rules"), tr("Records"), tr("What to do"), tr("Evidence")]}>
      {batches.map((b) => (
        <tr key={b.id} data-testid="acp-batch">
          <th scope="row" className="m2-card-lead"><Coded code={b.field} text={fieldText(b.field, b.field_label)} /></th>
          <td data-label={tr("Kind of fix")}>{kind(b.kind)}</td>
          <td data-label={tr("Rules")}>{b.rules.map((r, i) => <span key={r}>{i ? ", " : ""}<Mono>{r}</Mono></span>)}</td>
          <td data-label={tr("Records")} className="m2-num">{int(b.affected)}</td>
          <td data-label={tr("What to do")}>{b.instruction}</td>
          <td data-label={tr("Evidence")} className="m2-meta">{b.evidence}</td>
        </tr>
      ))}
    </Table>
  );
}

function Items({ items }: { items: CleaningItem[] }) {
  return (
    <Table title={tr("Why each rule fails")} head={[tr("Rule"), tr("Field"), tr("Why it is wrong"), tr("Suggested fix"), tr("Confidence"), tr("Evidence")]}>
      {items.map((i) => (
        <tr key={i.rule} data-testid="acp-item">
          <th scope="row" className="m2-card-lead"><Coded code={i.rule} text={i.message} /></th>
          <td data-label={tr("Field")}><Coded code={i.field} text={fieldText(i.field, i.field_label)} /></td>
          <td data-label={tr("Why it is wrong")}>{i.explanation}</td>
          <td data-label={tr("Suggested fix")}>
            {i.suggestion ? <><Mono>{i.suggestion.value}</Mono> <span className="m2-meta">{SOURCE[i.suggestion.source]?.() ?? i.suggestion.source}</span></> : kind(i.kind)}
          </td>
          <td data-label={tr("Confidence")} className="m2-num">
            {i.suggestion ? tr("{n} out of 100", { n: int(i.suggestion.confidence) }) : tr("Not scored")}
          </td>
          <td data-label={tr("Evidence")} className="m2-meta">
            {i.suggestion
              ? tr("{e} Rests on {c} of {b} records.", { e: i.suggestion.evidence, c: int(i.suggestion.covered), b: int(i.suggestion.base) })
              : tr("{a} of {t} records fail.", { a: int(i.affected), t: int(i.total) })}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function Engine({ p }: { p: CleaningPlan }) {
  const e = p.engine;
  return (
    <div data-testid="acp-engine">
      <Mark />
      {!e.available ? (
        <EmptyFrame>{ENGINE_OFF[(e.reason ?? "engine_error") as EngineOffReason]?.() ?? ENGINE_OFF.engine_error()}</EmptyFrame>
      ) : e.ranges.length === 0 ? (
        <EmptyFrame>{tr("Every failing rule sits inside its learned normal range.")}</EmptyFrame>
      ) : (
        <Table title={tr("Normal range of failing records per rule")} head={[tr("Rule"), tr("Normal range"), tr("This run"), tr("Verdict")]}>
          {e.ranges.map((r) => (
            <tr key={r.rule}>
              <th scope="row" className="m2-card-lead"><Mono>{r.rule}</Mono></th>
              <td data-label={tr("Normal range")} className="m2-num">{tr("{low} to {high}", { low: int(r.low ?? 0), high: int(r.high ?? 0) })}</td>
              <td data-label={tr("This run")} className="m2-num">{int(r.latest)}</td>
              <td data-label={tr("Verdict")}>{r.outside ? tr("Outside the normal range") : tr("Inside the normal range")}</td>
            </tr>
          ))}
        </Table>
      )}
      <EvidencePanel ev={e.evidence} testId="acp-engine-evidence" />
    </div>
  );
}

export function AletheiaCleaningPlan({ module, label, versionId }: { module: string; label: string; versionId?: string | null }) {
  const fixture = useFixture();
  const q = useQuery({
    queryKey: ["aletheia", "cleaning-plan", fixture, module, versionId ?? null],
    queryFn: () => getCleaningPlan(module, versionId),
    staleTime: 60_000,
    retry,
  });
  return (
    <Section q={q} title={tr("Cleaning plan")} meta={tr("Why {label} records fail and how to fix them", { label })} testId="acp">
      {(p) => p.items.length === 0 ? <EmptyFrame>{tr("No rule fails for {label} in this run.", { label })}</EmptyFrame> : (
        <>
          <Changes p={p} />
          <Batches batches={p.batches} />
          <Items items={p.items} />
          <Engine p={p} />
        </>
      )}
    </Section>
  );
}
