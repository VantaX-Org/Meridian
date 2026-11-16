"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { shortDate } from "./format";
import { getAgreement, noLaterRun, type AgreementStatus } from "@/lib/api/v2/roundtrip";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { ScoreRing, StackedBar } from "../viz";
import { Chip, EmptyState, ErrorState, Skeleton } from "../kit";
import "./runs.css";

const TONE: Record<AgreementStatus, "good" | "warn" | "bad"> = { matched: "good", different: "bad", missing: "warn" };
const word = (s: AgreementStatus) => (s === "matched" ? t("matched") : s === "different" ? t("still different") : t("missing"));

/** How far a later run agrees with an uploaded clean file: did each correction reach the source system. */
export function AgreementBody({ versionId, run }: { versionId: string; run?: string }) {
  const q = useQuery({ queryKey: ["next", "agreement", versionId, run ?? null], queryFn: () => getAgreement(versionId, run), retry: false });

  if (q.isLoading) return <Skeleton lines={8} label={t("Loading the agreement")} />;
  if (q.isError) {
    return noLaterRun(q.error)
      ? <EmptyState icon="alert" heading={t("No later run yet")}>{t("Load the cleaned values into the source system, then run a new extraction. The comparison appears here.")}</EmptyState>
      : <ErrorState error={q.error} fallback={t("The agreement could not be loaded.")} onRetry={() => void q.refetch()} />;
  }
  const a = q.data;
  if (!a) return null;
  const segs = (m: number, d: number, x: number) => [
    { id: "matched", label: t("matched"), value: m, tone: "good" as const },
    { id: "different", label: t("still different"), value: d, tone: "bad" as const },
    { id: "missing", label: t("missing"), value: x, tone: "warn" as const },
  ];

  return (
    <div className="nx-rn-detail" data-testid="agreement">
      <header className="nx-rn-hero">
        <div>
          <h2 className="nx-rn-h2">{t("Clean file against the later run")}</h2>
          <p className="nx-rn-sub">{t("Run of {date}", { date: shortDate(a.run_at) })} <Link className="nx-rn-link" href={`/next/run/${a.run_id}`}>{t("Open the run")}</Link></p>
        </div>
        <ScoreRing value={a.score} size={132} label={a.score == null ? t("No cleaned values to compare") : t("{n} percent of cleaned values reached the source", { n: a.score.toFixed(1) })} />
      </header>

      {a.total === 0 ? <p className="nx-rn-note">{t("The clean file changed no values, so there is nothing to compare.")}</p> : (
        <>
          <section className="nx-rn-viz" aria-label={t("Agreement")}>
            <p className="nx-rn-chips">
              <Chip tone="good" count={a.matched}>{t("matched")}</Chip>
              <Chip tone="bad" count={a.different}>{t("still different")}</Chip>
              <Chip tone="warn" count={a.missing}>{t("missing")}</Chip>
            </p>
            <StackedBar segs={segs(a.matched, a.different, a.missing)} label={t("{m} matched, {d} still different, {x} missing", { m: a.matched, d: a.different, x: a.missing })} />
          </section>

          <section aria-label={t("Agreement by field")}>
            <h3 className="nx-rn-h3">{t("By field")}</h3>
            <ul className="nx-rn-rules">
              {a.fields.map((f) => (
                <li key={`${f.table}.${f.field}`}>
                  <span className="nx-rn-trunc" title={`${f.table}.${f.field} ${f.description}`}><code>{f.field}</code> {f.description || t("No description")}</span>
                  <StackedBar segs={segs(f.matched, f.different, f.missing)} label={t("{field}: {m} matched, {d} still different, {x} missing", { field: f.field, m: f.matched, d: f.different, x: f.missing })} />
                </li>
              ))}
            </ul>
          </section>

          <section aria-label={t("Cleaned values")}>
            <h3 className="nx-rn-h3">{t("Cleaned values")}</h3>
            <table className="nx-rn-table">
              <caption className="nx-rn-sr">{t("Each cleaned value and the value the later run holds")}</caption>
              <thead><tr><th scope="col">{t("Record")}</th><th scope="col">{t("Field")}</th><th scope="col">{t("Status")}</th><th scope="col">{t("Cleaned value")}</th><th scope="col">{t("Value now")}</th></tr></thead>
              <tbody>
                {a.rows.map((r) => (
                  <tr key={`${r.table}|${r.key}|${r.field}`}>
                    <th scope="row"><span className="nx-rn-trunc" title={`${r.table} ${r.key}`}>{r.key}</span></th>
                    <td><code>{r.field}</code> <span className="nx-rn-sub">{r.description || t("No description")}</span></td>
                    <td><Chip tone={TONE[r.status]}>{word(r.status)}</Chip></td>
                    <td>{r.cleaned || <span className="nx-rn-sub">{t("empty")}</span>}</td>
                    <td>{r.current == null ? <span className="nx-rn-sub">{t("record not found")}</span> : r.current || <span className="nx-rn-sub">{t("empty")}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {a.rows_total > a.rows.length ? <p className="nx-rn-note">{t("Showing {n} of {m} values, the differences first.", { n: formatInt(a.rows.length), m: formatInt(a.rows_total) })}</p> : null}
          </section>
        </>
      )}
    </div>
  );
}

export function Agreement({ versionId, run }: { versionId: string; run?: string }) {
  return (
    <main className="nx-rn-page">
      <p><Link className="nx-rn-link" href={`/next/run/${versionId}`}>{t("Back to the run")}</Link></p>
      <AgreementBody versionId={versionId} run={run} />
    </main>
  );
}
