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
import { SeverityMark, VerdictMark, type SeverityKey } from "../../marks";
import { Ruler } from "../../Ruler";
import { dimsOf } from "../../shell/MapPane";
import { objectHref } from "@/lib/v2/people";
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

/** Every object in this object's waves, each as a ruler, with its verdict and open blocking gaps. */
function ByObject({ module, waves }: { module: string; waves: Set<string> }) {
  const run = useRunParam();
  const landscape = useLandscape(run).data;
  const cells = useReadiness().data?.cells.filter((c) => waves.has(c.wave)) ?? [];
  const rows = [...new Map(cells.map((c) => [c.module, c])).values()].sort((a, b) => b.blocker_count - a.blocker_count);
  if (rows.length < 2 || !landscape) return null;
  return (
    <section aria-label={t("Readiness by object")} className="m2-sec" data-testid="readiness-by-object">
      <h2 className="m2-h2">{t("Readiness by object")}</h2>
      <table className="m2-tbl">
        <thead>
          <tr>
            <th scope="col">{t("Object")}</th>
            <th scope="col">{t("Score")}</th>
            <th scope="col">{t("Verdict")}</th>
            <th scope="col" className="m2-r">{t("Blocking gaps")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const cell = landscape.cells.find((x) => x.module === c.module);
            const label = landscape.objects.find((o) => o.module === c.module)?.label ?? c.module.replace(/_/g, " ");
            return (
              <tr key={c.module} aria-current={c.module === module ? "true" : undefined}>
                <th scope="row"><V2Link href={objectHref(landscape, c.module)}>{label}</V2Link></th>
                <td>
                  {cell ? (
                    <Ruler size={48} dims={dimsOf(cell)} measured={cell.raw_score} score={cell.score} capped={cell.capped} capLevel={cell.cap_level} breaches={cell.breaches} label={label} records={cell.records_checked} rules={cell.rules_measured} coverage={cell.coverage} />
                  ) : <Dash />}
                </td>
                <td>
                  <span className="m2-v"><VerdictMark verdict={VERDICT[c.verdict]} />{VERDICT_LABEL[VERDICT[c.verdict]]}</span>
                </td>
                <td className="m2-r">{int(c.blocker_count)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** The rules of this object behind blocked or degraded features, worst first, with the features each one holds back. */
function Blockers({ results, module }: { results: ImpactResult[]; module: string }) {
  const { hrefFor } = useOpenItem();
  const by = new Map<string, { count: number; severity?: string; features: string[] }>();
  for (const r of results) {
    for (const f of r.blocking_findings) {
      if (f.module && f.module !== module) continue;
      const e = by.get(f.check_id) ?? { count: f.affected_count ?? 0, severity: f.severity, features: [] };
      e.features.push(r.feature);
      by.set(f.check_id, e);
    }
  }
  const rows = [...by.entries()].sort((a, b) => b[1].count - a[1].count);
  if (!rows.length) return null;
  return (
    <div data-testid="readiness-blockers">
      <h3 className="m2-h3"><span>{t("Blockers")}</span><span className="m2-meta">{rows.length}</span></h3>
      <table className="m2-tbl">
        <thead>
          <tr>
            <th scope="col">{t("Rule")}</th>
            <th scope="col">{t("Features")}</th>
            <th scope="col" className="m2-r">{t("Failing rows")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, e]) => (
            <tr key={id}>
              <th scope="row">
                {e.severity ? <><SeverityMark severity={e.severity as SeverityKey} />{" "}</> : null}
                <V2Link href={hrefFor({ kind: "rule", id })} className="m2-mono">{id}</V2Link>
              </th>
              <td>{e.features.join(", ")}</td>
              <td className="m2-r">{int(e.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  // One threshold word (F16): the gate's minimum score the object's waves hold it to, when they agree.
  const thresholds = [...new Set(cells.map((c) => c.threshold ?? readinessQ.data?.threshold ?? null))];
  const gateMin = thresholds.length === 1 ? thresholds[0] : null;
  // A run without a readiness score for this object leaves readiness and records blocked unmeasured (F19).
  const scored = cells.some((c) => c.score != null);
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
          {gateMin != null ? <span className="m2-sub">{t("Gate: min score {score}", { score: f1(gateMin) })}</span> : null}
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
                  {scored ? <th scope="col" className="m2-r">{t("Readiness")}</th> : null}
                  {scored ? <th scope="col" className="m2-r">{t("Records blocked")}</th> : null}
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
                    {scored ? <td className="m2-r">{c.score == null ? <Dash why={t("No readiness score in this wave's run")} /> : f1(c.score)}</td> : null}
                    {scored ? <td className="m2-r">{c.score == null ? <Dash why={t("No readiness score in this wave's run")} /> : int(c.records_blocked)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
</ScrollFrame>
        )}
        {cells.length > 0 && !scored ? (
          <p className="m2-prov" data-testid="readiness-unscored">
            {t("Readiness and records blocked are not shown: no migration run has a readiness score for {label} yet. The verdict comes from its blocking gaps and its score.", { label })}
          </p>
        ) : null}
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
            <Blockers results={mine} module={apiModule} />
            <p className="m2-prov">{t("Mapped from the rules that fail by the feature impact rules, for the rules of this object in this run.")}</p>
          </>
        )}
      </section>
      <ByObject module={apiModule} waves={new Set(cells.map((c) => c.wave))} />
      <ObjectMoney module={apiModule} label={label} />
    </div>
  );
}
