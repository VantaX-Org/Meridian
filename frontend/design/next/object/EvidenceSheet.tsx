"use client";

/** The object page's sheets: Aletheia's evidence, how the score is made, one rule, one record. */
import { useSearchParams } from "next/navigation";
import { Sheet, ErrorState, Skeleton, EmptyState } from "@/design/next/kit";
import { LegacyScope } from "@/design/next/shell/LegacyMount";
import { Coded, Mono, V2Link } from "@/design/v2/parts";
import { RuleInspectorBody } from "@/design/v2/inspector/rule";
import { RecordInspector, parseRecordId } from "@/design/v2/screens/RecordInspector";
import { useLandscape, useReceipt } from "@/lib/v2/queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { confidenceWord, useFindings } from "./evidence";
import { useRun } from "@/lib/api/next/runs";
import { score, statusOf } from "./model";

interface SheetProps { id: string; close: () => void; under: boolean }

export function EvidenceSheet({ id, close, under }: SheetProps) {
  const q = useFindings(id);
  const list = q.data?.findings ?? [];
  return (
    <Sheet open onClose={close} title={t("Aletheia evidence")} size="medium" under={under}>
      <div data-testid="evidence-sheet">
        {q.isLoading ? <Skeleton lines={4} label={t("Loading the evidence")} /> : null}
        {q.isError ? <ErrorState sentence={t("The evidence could not be loaded.")} error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.data && list.length === 0 ? <EmptyState heading={t("Aletheia has no evidence for this yet")}>{t("No finding has been recorded for this object.")}</EmptyState> : null}
        <ol className="nx-evid">
          {list.map((f) => {
            const conf = confidenceWord(f.confidence);
            return (
              <li key={f.id}>
                <Coded code={f.check_id} text={f.name} />
                {f.field ? <div className="nx-muted"><Coded code={f.field} text={describeField(f.field)} first /></div> : null}
                <div className="nx-num">{t("{n} records", { n: int(f.affected) })}{conf ? ` , ${t("confidence {c}", { c: conf })}` : ""}</div>
                {f.why.origin.top ? <div className="nx-muted">{t("Origin: {top}", { top: f.why.origin.top })}</div> : null}
              </li>
            );
          })}
        </ol>
        <p className="nx-muted">{t("Aletheia reads aggregates of the run. The same figures are in the rules table.")}</p>
      </div>
    </Sheet>
  );
}

/** "How this is scored": the receipt of the shown run, its formula, its dimensions and the rules that cap it. */
/** One run: when, its number, its state, and the page it also has. */
export function RunSheet({ id, close, under }: SheetProps) {
  const q = useRun(id);
  const h = q.data;
  return (
    <Sheet open onClose={close} title={h ? t("Run {n}", { n: h.run_number ?? "" }) : t("Run")} meta={<Mono>{id}</Mono>} size="medium" under={under} secondary={<V2Link className="nx-btn nx-btn-secondary" href={`/run/${encodeURIComponent(id)}`}>{t("Open as page")}</V2Link>}>
      <div data-testid="run-sheet">
        {q.isLoading ? <Skeleton lines={3} label={t("Loading the run")} /> : null}
        {q.isError ? <ErrorState sentence={t("The run could not be loaded.")} error={q.error} onRetry={() => void q.refetch()} /> : null}
        {h ? (
          <dl className="nx-paired-row">
            <div><dt>{t("Started")}</dt><dd className="nx-num">{new Date(h.run_at).toLocaleString()}</dd></div>
            <div><dt>{t("State")}</dt><dd>{statusOf(h) === "failed" ? t("Failed") : statusOf(h) === "done" ? t("Complete") : t("Running")}</dd></div>
          </dl>
        ) : null}
      </div>
    </Sheet>
  );
}

export function ScoreSheet({ id, close, under }: SheetProps) {
  const run = useSearchParams().get("run");
  const q = useReceipt(id, run);
  const r = q.data;
  return (
    <Sheet open onClose={close} title={t("How this is scored")} size="medium" under={under}>
      <div data-testid="score-sheet">
        {q.isLoading ? <Skeleton lines={5} label={t("Loading the score")} /> : null}
        {q.isError ? <ErrorState sentence={t("The score could not be explained.")} error={q.error} onRetry={() => void q.refetch()} /> : null}
        {r ? (
          <>
            <p>{r.formula}</p>
            <table className="nx-table">
              <caption className="nx-sr">{t("Dimensions of the score")}</caption>
              <thead><tr><th scope="col">{t("Dimension")}</th><th scope="col" className="nx-r">{t("Weight")}</th><th scope="col" className="nx-r">{t("Score")}</th></tr></thead>
              <tbody>
                {r.dimensions.map((d) => (
                  <tr key={d.key}>
                    <td><Mono>{d.key}</Mono> {d.label}</td>
                    <td className="nx-r nx-num">{score(d.weight * 100)}%</td>
                    <td className="nx-r nx-num">{d.score === null ? "—" : score(d.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.capped && r.cap_level !== null ? <p>{t("Capped at {cap} by {n} critical rules. {rule}", { cap: score(r.cap_level), n: r.breaches.length, rule: r.cap_rule })}</p> : null}
            {r.breaches.length ? (
              <ul>
                {r.breaches.map((b) => <li key={b.check_id}><Coded code={b.check_id} text={b.name} /> <span className="nx-num">{b.failing === null ? "" : t("{n} records", { n: int(b.failing) })}</span></li>)}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

export function RuleSheet({ id, close, under }: SheetProps) {
  const landscape = useLandscape(null).data;
  return (
    <Sheet open onClose={close} title={t("Rule")} meta={<Mono>{id}</Mono>} size="large" under={under} secondary={<V2Link className="nx-btn nx-btn-secondary" href={`/r/${encodeURIComponent(id)}`}>{t("Open as page")}</V2Link>}>
      <LegacyScope><RuleInspectorBody id={id} landscape={landscape} /></LegacyScope>
    </Sheet>
  );
}

export function RecordSheet({ id, close }: SheetProps) {
  const { module, key } = parseRecordId(id);
  void module; void key;
  return <LegacyScope><RecordInspector id={id} onClose={close} /></LegacyScope>;
}
