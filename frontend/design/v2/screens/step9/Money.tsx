"use client";

import "../../step9.css";
import { formatDate, formatMoney } from "@/lib/format";
import type { Money, MoneyFeature } from "@/lib/api/v2/step9";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useMoney } from "@/lib/v2/step9-queries";
import { int } from "@/lib/v2/score";
import { Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../../parts";

/** An amount in the response's currency; a dash when the tenant has no cost model or the feature has no price. */
export function Amount({ value, currency }: { value: number | null | undefined; currency: string | null }) {
  if (value == null) return <Dash why={t("No price for this in the cost model")} />;
  return <>{formatMoney(value, currency)}</>;
}

/** "Since first blocked": the date and how long, or a dash for a degraded feature, which is never blocked. */
function Since({ f }: { f: MoneyFeature }) {
  if (!f.first_blocked_at) return <Dash why={f.status === "degraded" ? t("Degraded, not blocked") : t("Not blocked")} />;
  return <>{t("{date}, {months, plural, one {# month} other {# months}}", { date: formatDate(f.first_blocked_at, "date"), months: f.months_blocked })}</>;
}

/** The money sentence above a table: what it costs a month and since first blocked, or why there is no figure. */
function MoneyLine({ m }: { m: Money }) {
  if (!m.cost_model) return <p className="m2-prov" data-testid="money-line">{t("No cost model is set for this tenant, so features are listed without a price. An administrator sets one in Settings.")}</p>;
  return (
    <p className="m2-finding m2-s9-money" data-testid="money-line">
      {t("{monthly} a month in opportunity cost from {blocked} blocked {blocked, plural, one {feature} other {features}}; {since} since each was first blocked.", { monthly: formatMoney(m.totals.opportunity_cost_per_month ?? 0, m.currency), blocked: m.totals.features_blocked, since: formatMoney(m.totals.cumulative_cost ?? 0, m.currency) })}
    </p>
  );
}

/** The Readiness tab's money: opportunity cost per month and since first blocked, per S/4 feature of this object. */
export function ObjectMoney({ module, label }: { module: string; label: string }) {
  const q = useMoney("object", module);
  const { hrefFor } = useOpenItem();
  return (
    <section aria-label={t("Impact in money")} className="m2-sec" data-testid="object-money">
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Impact in money")}</h2>
        {q.data ? <span className="m2-sub">{q.data.currency ? t("As of {date}, in {currency}", { date: formatDate(q.data.as_of, "date"), currency: q.data.currency }) : t("As of {date}", { date: formatDate(q.data.as_of, "date") })}</span> : null}
      </div>
      {q.isPending ? (
        <Skeleton width="60%" height={14} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The impact in money could not be read.")}</ErrorFrame>
      ) : q.data.features.length === 0 ? (
        <EmptyFrame>{t("No S/4 feature is blocked or degraded by {label} on its latest run, so nothing costs money here. A feature appears when the impact model maps a failing rule of this object to it.", { label })}</EmptyFrame>
      ) : (
        <>
          <MoneyLine m={q.data} />
          <div className="m2-frame" tabIndex={0} role="region" aria-label={t("Features and their cost, scrollable")}>
            <table className="m2-tbl" aria-label={t("What {label} costs in S/4 features", { label })}>
              <thead>
                <tr>
                  <th scope="col">{t("Feature")}</th>
                  <th scope="col">{t("State")}</th>
                  <th scope="col">{t("Blocking rules")}</th>
                  <th scope="col" className="m2-r">{t("Records")}</th>
                  <th scope="col" className="m2-r">{t("Per month")}</th>
                  <th scope="col">{t("Blocked since")}</th>
                  <th scope="col" className="m2-r">{t("Since first blocked")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.features.map((f) => (
                  <tr key={`${f.system_id}:${f.feature}`}>
                    <th scope="row">
                      <V2Link href={hrefFor({ kind: "feature", id: f.feature })}>{f.feature}</V2Link>
                    </th>
                    <td>{f.status === "blocked" ? t("Blocked") : t("Degraded")}</td>
                    <td>
                      {f.blocking_rules.map((id, i) => (
                        <span key={id}>
                          {i > 0 ? ", " : ""}
                          <V2Link href={hrefFor({ kind: "rule", id })} className="m2-mono">
                            {id}
                          </V2Link>
                        </span>
                      ))}
                    </td>
                    <td className="m2-r">{int(f.records)}</td>
                    <td className="m2-r">
                      <Amount value={f.opportunity_cost_per_month} currency={q.data.currency} />
                    </td>
                    <td>
                      <Since f={f} />
                    </td>
                    <td className="m2-r">
                      <Amount value={f.cumulative_cost} currency={q.data.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m2-prov">{t("Records blocked times the tenant's value per record and month, from the impact model of each run since the feature was first blocked. A degraded feature has no cost since it still runs.")}</p>
        </>
      )}
    </section>
  );
}

/** The Waves view: the waves ranked by the value per month that fixing them would unblock, in the response's currency. */
export function WavesByValue() {
  const q = useMoney("landscape", null);
  const { hrefFor } = useOpenItem();
  return (
    <div className="m2-s9-block" data-testid="waves-by-value">
      <div className="m2-sechead">
        <h3 className="m2-h2">{t("Waves by value")}</h3>
        {q.data ? <span className="m2-sub">{q.data.cost_model ? t("Opportunity cost a wave would unblock a month, in {currency}", { currency: q.data.currency ?? t("the tenant currency") }) : t("No cost model: ranked by features unblocked")}</span> : null}
      </div>
      {q.isPending ? (
        <Skeleton width="60%" height={14} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The value of the waves could not be read.")}</ErrorFrame>
      ) : q.data.ranking.waves.length === 0 ? (
        <EmptyFrame
          action={
            <V2Link href={hrefFor({ kind: "waves", id: "" })} className="m2-btn">
              {t("Plan the waves")}
            </V2Link>
          }
        >
          {t("No wave exists yet. Add one and assign objects to it, and each wave is ranked here by what fixing it unblocks.")}
        </EmptyFrame>
      ) : (
        <ol className="m2-s9-rank">
          {q.data.ranking.waves.map((w, i) => (
            <li key={w.id}>
              <span className="m2-meta">{i + 1}</span>
              <span>
                <b>{w.name}</b> <span className="m2-meta">{w.features.length ? t("unblocks {features}", { features: w.features.join(", ") }) : t("unblocks no blocked feature")}</span>
              </span>
              <span className="m2-r">
                {q.data.cost_model ? <Amount value={w.value_unblocked_per_month} currency={q.data.currency} /> : <Dash why={t("No cost model")} />}
                {q.data.cost_model ? <span className="m2-meta"> {t("a month")}</span> : null}
              </span>
              <V2Link href={hrefFor({ kind: "certificate", id: w.id })} aria-label={t("Readiness certificate of {name}", { name: w.name })}>
                {t("Certificate")}
              </V2Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
