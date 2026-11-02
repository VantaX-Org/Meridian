"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { createRuleBatch, getFindings, markActed, type AletheiaActed, type AletheiaFinding } from "@/lib/api/v2/insights";
import { draftTunedVersion } from "@/lib/api/v2/pilot";
import { failureText } from "@/lib/v2/errors";
import { t } from "@/lib/v2/i18n";
import { moduleText, moneyCompactText } from "@/lib/v2/labels";
import { DASH, f1, int, pct1 } from "@/lib/v2/score";
import { Sparkline } from "../charts/Sparkline";
import { Dash, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { CcDelta } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

const signed = (n: number | null | undefined, fmt: (v: number) => string = int) => (n == null ? DASH : `${n > 0 ? "+" : ""}${fmt(n)}`);

/**
 * What Aletheia found: the highest-impact failing rules of the current state with their driver, money at risk,
 * confidence and one action; each object's score change since its previous run and the rules that moved it; and the
 * realised result of every finding someone acted on. Every number comes from GET /insights/findings, which is
 * deterministic; a value the backend did not measure shows a dash.
 */
export function AletheiaFound({ module }: { module?: string }) {
  const fixture = useFixture();
  const key = ["aletheia-found", fixture, module ?? ""];
  const q = useQuery({ queryKey: key, queryFn: () => getFindings(module), staleTime: 60_000 });
  if (q.isError) {
    return (
      <Panel title={t("Aletheia found")} testId="aletheia-found">
        <ErrorFrame onRetry={() => void q.refetch()}>{t("What Aletheia found could not be read.")}</ErrorFrame>
      </Panel>
    );
  }
  if (!q.data) {
    return (
      <Panel title={t("Aletheia found")} testId="aletheia-found">
        <Skeleton width={420} height={14} />
      </Panel>
    );
  }
  const { findings, changes, acted } = q.data;
  if (!findings.length && !acted.length) return null;
  const compared = changes.filter((c) => c.previous_version_id);
  return (
    <Panel title={t("Aletheia found")} meta={t("Ranked by score impact, from the latest run of each object")} testId="aletheia-found">
      {findings.length ? (
        <ScrollFrame label={t("Aletheia found")}>
          <table className="m2-tbl m2-cards">
            <caption className="m2-sr">{t("Aletheia found")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Finding")}</th>
                <th scope="col">{t("Failing records")}</th>
                <th scope="col">{t("Last runs")}</th>
                <th scope="col">{t("Money at risk")}</th>
                <th scope="col">{t("Confidence")}</th>
                <th scope="col">{t("Action")}</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => <FindingRow key={f.id} f={f} queryKey={key} />)}
            </tbody>
          </table>
        </ScrollFrame>
      ) : null}
      <div className="m2-cc-split">
        <section aria-label={t("What changed since the last run")} data-testid="aletheia-changed">
          <h3 className="m2-h3">{t("What changed since the last run")}</h3>
          {compared.length ? (
            <>
              <CcDelta
                label={t("Score change per object since its previous run")}
                rows={compared.map((c) => ({ key: c.module, delta: c.delta, text: signed(c.delta, f1), label: moduleText(c.module) }))}
              />
              <ul className="m2-cc-bars" aria-label={t("Rules that moved the score")}>
                {compared.flatMap((c) =>
                  c.movers.map((m) => (
                    <li key={`${c.module}:${m.check_id}`}>
                      <span className="m2-cc-bmsg">
                        <Mono>{m.check_id}</Mono> {m.name}
                      </span>
                      <span className="m2-cc-bmeta">
                        <span>{moduleText(c.module)}</span>
                        <span>{t("{n} failing", { n: signed(m.delta_affected) })}</span>
                      </span>
                    </li>
                  )),
                )}
              </ul>
            </>
          ) : (
            <p className="m2-meta">{t("No object has a previous run to compare with yet.")}</p>
          )}
        </section>
        <section aria-label={t("Proof of value")} data-testid="aletheia-proof">
          <h3 className="m2-h3">{t("Proof of value")}</h3>
          {acted.length ? (
            <ul className="m2-cc-bars">
              {acted.map((a) => <ProofRow key={`${a.module}:${a.check_id}:${a.action}:${a.version_id}`} a={a} />)}
            </ul>
          ) : (
            <p className="m2-meta">{t("Act on a finding and its result shows here after the next run.")}</p>
          )}
        </section>
      </div>
    </Panel>
  );
}

const ACTION_LABEL = { tune: () => t("Draft tuned version"), cleanse: () => t("Draft cleansing batch"), open: () => t("Open rule") };
const ACTION_TEXT = { tune: () => t("Tuned rule version drafted"), cleanse: () => t("Cleansing batch drafted"), open: () => t("Opened") };

function why(f: AletheiaFinding): string | null {
  const parts: string[] = [];
  if (f.delta_affected) parts.push(t("{n} failing records since the previous run", { n: signed(f.delta_affected) }));
  if (f.why.origin.status === "computed" && f.why.origin.share != null) parts.push(t("{p} of the failing values come from one origin", { p: pct1(f.why.origin.share) }));
  return parts.length ? parts.join(". ") : null;
}

function FindingRow({ f, queryKey }: { f: AletheiaFinding; queryKey: unknown[] }) {
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  const act = useMutation({
    mutationFn: async () => {
      if (f.action.kind === "tune") await draftTunedVersion(f.check_id);
      else if (f.action.kind === "cleanse") await createRuleBatch(`${f.check_id} ${f.name}`.slice(0, 200), { module: f.module, check_id: f.check_id });
      return markActed({ module: f.module, check_id: f.check_id, action: f.action.kind });
    },
    onSuccess: () => {
      setDone(true);
      void qc.invalidateQueries({ queryKey });
    },
  });
  const reason = why(f);
  const spark = f.spark.filter((v): v is number => v != null);
  return (
    <tr data-testid="aletheia-finding">
      <th scope="row" className="m2-card-lead">
        <Mono>{f.check_id}</Mono> {f.name}
        <span className="m2-meta">
          {" "}
          {moduleText(f.module)}
          {f.field ? <>, <Mono>{f.field}</Mono></> : null}. {reason ?? null}
        </span>
      </th>
      <td data-label={t("Failing records")} className="m2-num">
        {int(f.affected)} <span className="m2-meta">{signed(f.delta_affected)}</span>
      </td>
      <td data-label={t("Last runs")}>
        {spark.length ? (
          <Sparkline values={f.spark} width={72} height={16} domain={[0, Math.max(...spark, 1)]} label={t("Failing records of {id} over the last runs", { id: f.check_id })} />
        ) : (
          <Dash />
        )}
      </td>
      <td data-label={t("Money at risk")} className="m2-num">
        {f.money.cost_at_risk != null ? moneyCompactText(f.money.cost_at_risk, f.money.currency) : <Dash why={t("No cost model covers this rule")} />}
      </td>
      <td data-label={t("Confidence")} className="m2-num">
        {f.confidence ? (
          <span title={f.confidence.basis === "precision" ? t("Share of reviewed issues stewards confirmed as real") : t("Share of failing values from the dominant origin")}>
            {pct1(f.confidence.value)}
          </span>
        ) : (
          <Dash why={t("Not measured yet")} />
        )}
      </td>
      <td data-label={t("Action")}>
        {f.action.kind === "open" ? (
          <V2Link href={`/r/${encodeURIComponent(f.check_id)}`} className="m2-btn m2-sm">{ACTION_LABEL.open()}</V2Link>
        ) : done ? (
          <span className="m2-meta" role="status">{ACTION_TEXT[f.action.kind]()}</span>
        ) : (
          <button type="button" className="m2-btn m2-sm" disabled={act.isPending} onClick={() => act.mutate()}>
            {ACTION_LABEL[f.action.kind]()}
          </button>
        )}
        {act.isError ? <span role="alert" className="m2-meta"> {failureText(act.error)}</span> : null}
      </td>
    </tr>
  );
}

function ProofRow({ a }: { a: AletheiaActed }) {
  return (
    <li data-testid="aletheia-proof-row">
      <span className="m2-cc-bmsg">
        <Mono>{a.check_id}</Mono> {a.name ?? DASH}
      </span>
      <span className="m2-cc-bmeta">
        <span>{moduleText(a.module)}</span>
        <span>{ACTION_TEXT[a.action]()}</span>
      </span>
      <span className="m2-cc-bmeta">
        {a.waiting ? (
          <span>{t("Waiting for the next run")}</span>
        ) : (
          <>
            <span>{t("Score {d}", { d: signed(a.gain, f1) })}</span>
            <span>{t("{n} fewer failing records", { n: int(a.reduction) })}</span>
          </>
        )}
      </span>
      {(a.proven_cost ?? []).map((p) => (
        <span key={p.metric} className="m2-cc-bmeta">
          <span>
            <Mono>{p.metric}</Mono> {p.label ?? ""}
          </span>
          <span>
            {t("{before} to {after}", {
              before: p.before != null ? moneyCompactText(p.before, a.currency) : DASH,
              after: p.after != null ? moneyCompactText(p.after, a.currency) : DASH,
            })}
          </span>
        </span>
      ))}
    </li>
  );
}
