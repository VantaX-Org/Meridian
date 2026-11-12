"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getMigrationRuns, getReconciliation } from "@/lib/api/v2/migration";
import { formatModuleName } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { pairQuality } from "@/lib/v2/paired-quality";
import { f1 } from "@/lib/v2/score";
import { Coded, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { retry, Section, status, Table } from "./WorkAnalytics";

const ACTUAL_WHY: Record<string, () => string> = {
  no_target_analysis: () => t("The target system has no completed analysis."),
  no_target_findings_for_module: () => t("The target analysis has no findings for this object."),
};
const signed = (n: number) => `${n > 0 ? "+" : ""}${f1(n)}`;

/**
 * Source, projected and actual target quality per object, with the rules that moved the score, from the newest
 * analysed migration run. Where the backend has no actual score or no reasons the cell shows a dash and says why.
 */
export function PairedQuality({ testId = "paired-quality" }: { testId?: string }) {
  const fixture = useFixture();
  const q = useQuery({
    queryKey: ["paired-quality", fixture],
    queryFn: async () => {
      const runs = await getMigrationRuns();
      const run = runs.runs.find((r) => r.status === "analysed" || r.status === "exported");
      if (!run) return null;
      try {
        return { run, rec: await getReconciliation(run.id) };
      } catch (e) {
        if (status(e) === 404) return { run, rec: null };
        throw e;
      }
    },
    staleTime: 60_000,
    retry,
  });
  const title = t("Quality in the source and in the target");
  const meta = t("Per object: the score before the move, the score the load should reach, and the score measured after");
  if (q.isPending) return <Section q={q} title={title} meta={meta} testId={testId}>{() => <Skeleton width="100%" height={120} />}</Section>;
  if (q.isError) return <Section q={q} title={title} meta={meta} testId={testId}>{() => <ErrorFrame onRetry={() => void q.refetch()}>{t("The quality figures could not be read.")}</ErrorFrame>}</Section>;
  if (!q.data) return <Section q={{ ...q, data: null }} title={title} meta={meta} testId={testId}>{() => <EmptyFrame>{t("No migration analysis has finished yet. Start one in Migration to see source and target quality side by side.")}</EmptyFrame>}</Section>;
  const rows = pairQuality(q.data.rec?.scores ?? []);
  return (
    <Section q={q} title={title} meta={meta} testId={testId}>
      {() => rows.length === 0 ? (
        <EmptyFrame>{t("The newest analysis has not been reconciled against the target system, so only the source score exists.")}</EmptyFrame>
      ) : (
        <Table title={title} head={[t("Object"), t("Source"), t("Projected"), t("Actual in target"), t("Why they differ")]}>
          {rows.map((m) => (
            <tr key={m.module}>
              <th scope="row" className="m2-card-lead">{formatModuleName(m.module)}</th>
              <td data-label={t("Source")} className="m2-num">{f1(m.source)}</td>
              <td data-label={t("Projected")} className="m2-num">{f1(m.projected)}</td>
              <td data-label={t("Actual in target")} className="m2-num">
                {m.actual === null ? <span className="m2-meta">{f1(null)} {m.actualReason ? ACTUAL_WHY[m.actualReason]?.() ?? m.actualReason : ""}</span> : f1(m.actual)}
                {m.moved !== null ? <span className="m2-meta"> {t("{n} from the source", { n: signed(m.moved) })}</span> : null}
              </td>
              <td data-label={t("Why they differ")}>
                {m.reasons.length === 0 ? (
                  <span className="m2-meta">{f1(null)} {t("Reasons are not yet calculated")}</span>
                ) : (
                  <ul className="m2-pq-why">
                    {m.reasons.map((r) => <li key={r.check_id}><V2Link href={`/r/${encodeURIComponent(r.check_id)}`}><Coded code={r.check_id} text={r.description} /></V2Link> {signed(r.change)}</li>)}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
