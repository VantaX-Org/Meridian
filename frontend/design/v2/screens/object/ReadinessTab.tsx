"use client";

import { ScrollFrame } from "./ScrollFrame";
import { useMemo } from "react";
import { formatDate } from "@/lib/format";
import type { CellVerdict, ImpactResult } from "@/lib/api/v2/object";
import type { Receipt, Verdict } from "@/lib/api/v2/types";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { useConfigImpact, useReadiness } from "@/lib/v2/object-queries";
import { useLandscape, useReceipt } from "@/lib/v2/queries";
import { f1, int, moduleFromSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { VerdictMark } from "../../marks";
import { Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../../parts";
import { ObjectMoney } from "../step9/Money";
import { t, tn } from "@/lib/v2/i18n";

const VERDICT: Record<CellVerdict, Verdict> = { go: "go", at_risk: "at-risk", no_go: "no-go" };

/** The rule ids of this object behind one feature, in the order the impact model lists them. */
function rulesOf(result: ImpactResult, module: string): string[] {
  const seen = new Set<string>();
  for (const f of result.blocking_findings) if (!f.module || f.module === module) seen.add(f.check_id);
  return [...seen];
}

/** States what caps the score in words, with the capping rules as links. */
function CapStatement({ receipt }: { receipt: Receipt }) {
  const { hrefFor } = useOpenItem();
  const link = (id: string) => (
    <V2Link key={id} href={hrefFor({ kind: "rule", id })} className="m2-mono">{id}</V2Link>
  );
  const ids = receipt.breaches.map((b) => b.check_id);
  const n = ids.length;
  return (
    <p className="m2-rp" data-testid="cap-statement">
      {!receipt.capped || n === 0
        ? t("No critical rule is holding this score down, so readiness follows the measured score of {measured}.", { measured: f1(receipt.measured) })
        : n === 1
          ? tn("Held at {cap} by {rule}, one critical rule over tolerance. Measured {measured}, shown {score}.", { cap: receipt.cap_level, rule: link(ids[0]), measured: f1(receipt.measured), score: f1(receipt.score) })
          : n === 2
            ? tn("Held at {cap} by {rule} and {rule2}, two critical rules over tolerance. Measured {measured}, shown {score}.", { cap: receipt.cap_level, rule: link(ids[0]), rule2: link(ids[1]), measured: f1(receipt.measured), score: f1(receipt.score) })
            : tn("Held at {cap} by {n} critical rules over tolerance, among them {rule} and {rule2}. Measured {measured}, shown {score}.", { cap: receipt.cap_level, n, rule: link(ids[0]), rule2: link(ids[1]), measured: f1(receipt.measured), score: f1(receipt.score) })}{" "}
      {t("Cap rule: {cap_rule}.", { cap_rule: receipt.cap_rule })}
    </p>
  );
}

function FeatureList({ title, results, module, empty }: { title: string; results: ImpactResult[]; module: string; empty: string }) {
  const { hrefFor } = useOpenItem();
  return (
    <div>
      <h3 className="m2-h3">
        <span>{title}</span>
        <span className="m2-meta">{results.length}</span>
      </h3>
      {results.length === 0 ? (
        <p className="m2-rp m2-meta">{empty}</p>
      ) : (
        <ul className="m2-flist">
          {results.map((r) => (
            <li key={r.feature}>
              <V2Link href={hrefFor({ kind: "feature", id: r.feature })}>{r.feature}</V2Link>
              <span className="m2-meta">
                {rulesOf(r, module).map((id, i) => (
                  <span key={id}>
                    {i > 0 ? ", " : ""}
                    <V2Link href={hrefFor({ kind: "rule", id })} className="m2-mono">{id}</V2Link>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Readiness tab: the object's place in the waves, what caps it, and the S/4 features it blocks or degrades. */
export function ReadinessTab({ module: moduleSegment }: { system: string; module: string }) {
  const run = useRunParam();
  const apiModule = moduleFromSlug(moduleSegment);
  const L = useLandscape(run);
  const label = `${L.data?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ")}`;
  const receiptQ = useReceipt(apiModule, run);
  const readinessQ = useReadiness();
  const impactQ = useConfigImpact(receiptQ.data?.run_id);
  const receipt = receiptQ.data;

  const cells = useMemo(() => (readinessQ.data?.cells ?? []).filter((c) => c.module === apiModule), [readinessQ.data, apiModule]);
  const mine = useMemo(() => (impactQ.data ?? []).filter((r) => r.status !== "ok" && rulesOf(r, apiModule).length > 0), [impactQ.data, apiModule]);
  const blocked = mine.filter((r) => r.status === "blocked");
  const degraded = mine.filter((r) => r.status === "degraded");

  if (receiptQ.isError) return <ErrorFrame onRetry={() => void receiptQ.refetch()}>{t("The readiness of {label} could not be read for this run.", { label })}</ErrorFrame>;
  if (receiptQ.isPending) {
    return (
      <div aria-busy="true" data-testid="readiness-loading">
        <Skeleton width="100%" height={160} />
      </div>
    );
  }

  return (
    <div className="m2-readiness">
      <section aria-label={t("Waves")}>
        <div className="m2-sechead">
          <h2 className="m2-h2">{t("Migration waves")}</h2>
          {readinessQ.data?.threshold != null ? <span className="m2-sub">{t("Wave threshold {threshold}", { threshold: f1(readinessQ.data.threshold) })}</span> : null}
        </div>
        {readinessQ.isPending ? (
          <Skeleton width="60%" height={14} />
        ) : readinessQ.isError ? (
          <ErrorFrame onRetry={() => void readinessQ.refetch()}>{t("The migration waves could not be read.")}</ErrorFrame>
        ) : cells.length === 0 ? (
          <EmptyFrame action={<V2Link href="/?view=waves&open=waves" className="m2-btn">{t("Open migration waves")}</V2Link>}>
            {t("{label} is not in a migration wave yet. A lead adds it to a wave, and its verdict appears here.", { label })}
          </EmptyFrame>
        ) : (
          <ScrollFrame label={t("Waves, scrollable")}>
            <table className="m2-tbl" aria-label={t("Waves that include {label}", { label })}>
              <thead>
                <tr>
                  <th scope="col">{t("Wave")}</th>
                  <th scope="col">{t("Verdict")}</th>
                  <th scope="col" className="m2-r">{t("Blocking gaps")}</th>
                  <th scope="col" className="m2-r">{t("Score")}</th>
                  <th scope="col" className="m2-r">{t("Readiness")}</th>
                  <th scope="col" className="m2-r">{t("Records blocked")}</th>
                </tr>
              </thead>
              <tbody>
                {cells.map((c) => (
                  <tr key={c.wave}>
                    <th scope="row">{c.wave}</th>
                    <td>
                      <span className="m2-v">
                        <VerdictMark verdict={VERDICT[c.verdict]} />
                        {VERDICT_LABEL[VERDICT[c.verdict]]}
                      </span>
                    </td>
                    <td className="m2-r">{int(c.blocker_count)}</td>
                    <td className="m2-r">{c.dqs == null ? <Dash /> : f1(c.dqs)}</td>
                    <td className="m2-r">{c.score == null ? <Dash /> : f1(c.score)}</td>
                    <td className="m2-r">{int(c.records_blocked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
</ScrollFrame>
        )}
        {receipt ? <CapStatement receipt={receipt} /> : null}
      </section>

      <section aria-label={t("S/4HANA features")} className="m2-sec">
        <div className="m2-sechead">
          <h2 className="m2-h2">{t("What the failing rules do in S/4HANA")}</h2>
          {receipt?.run_at ? <span className="m2-sub">{t("Run {run_at}", { run_at: formatDate(receipt.run_at, "datetime") })}</span> : null}
        </div>
        {impactQ.isPending && Boolean(receipt?.run_id) ? (
          <Skeleton width="60%" height={14} />
        ) : impactQ.isError ? (
          <ErrorFrame onRetry={() => void impactQ.refetch()}>{t("The feature impact could not be read for this run.")}</ErrorFrame>
        ) : (
          <>
            <div className="m2-chg">
              <FeatureList title={t("Blocked in S/4HANA")} results={blocked} module={apiModule} empty={t("No S/4 feature is blocked by a rule of this object.")} />
              <FeatureList title={t("Degraded in S/4HANA")} results={degraded} module={apiModule} empty={t("No S/4 feature is degraded by a rule of this object.")} />
            </div>
            <p className="m2-prov">{t("Mapped from the rules that fail by the feature impact rules, for the rules of this object in this run.")}</p>
          </>
        )}
      </section>
      <ObjectMoney module={apiModule} label={label} />
    </div>
  );
}
