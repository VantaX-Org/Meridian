"use client";

import "../../step10.css";
import { usePathname, useSearchParams } from "next/navigation";
import { formatDate } from "@/lib/format";
import { DIMENSIONS, type Receipt } from "@/lib/api/v2/types";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { passRateText } from "@/lib/v2/step10";
import { useObjectAsOf } from "@/lib/v2/step10-queries";
import { labelText } from "@/lib/v2/labels";
import { SeverityMark, type SeverityKey } from "../../marks";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../../parts";
import { PolicyMark, Ruler } from "../../Ruler";

const sev = (s: string | null | undefined): SeverityKey => (s === "critical" || s === "high" || s === "medium" || s === "low" ? s : "info");

/** On the receipt: the applied policy classes this run breaches, each with its authority and the failing critical rules. */
export function PolicyBreaches({ receipt }: { receipt: Receipt }) {
  const { hrefFor } = useOpenItem();
  const classes = receipt.policy_breach_classes ?? [];
  if (!classes.length) return null;
  return (
    <section className="m2-s10-policy" aria-label={t("Policy classes breached")} data-testid="receipt-policy">
      <h2 className="m2-h2 m2-sec">
        <PolicyMark mark={{ count: classes.length, title: t("{count} policy {count, plural, one {class} other {classes}} breached: a critical rule evidencing an applied policy pack fails", { count: classes.length }) }} /> {t("Policy classes breached")}
      </h2>
      <ul className="m2-breaches">
        {classes.map((c) => (
          <li key={`${c.pack_id}:${c.class_id}`}>
            <span>
              <V2Link href={hrefFor({ kind: "policypack", id: c.pack_id })}>{c.label}</V2Link>
              <span className="m2-s10-auth">{c.authority}</span>
            </span>
            <span className="m2-meta">
              {c.rules.map((r, n) => (
                <span key={r}>
                  {n > 0 ? ", " : ""}
                  <V2Link href={hrefFor({ kind: "rule", id: r })} className="m2-mono">
                    {r}
                  </V2Link>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * `?as_of=<run>` on the Object canvas: the object as it stood when that run finished (GET /objects/{module}/as-of), its
 * score on the ruler, the cap and the rules of the run it read. Said in a band above it, with the way back to today.
 */
export function AsOfView({ module, label, asOf }: { module: string; label: string; asOf: string }) {
  const q = useObjectAsOf(module, asOf);
  const pathname = usePathname();
  const params = useSearchParams();
  const { hrefFor } = useOpenItem();
  const back = new URLSearchParams(params.toString());
  back.delete("as_of");
  const backHref = back.toString() ? `${pathname}?${back.toString()}` : pathname;
  const a = q.data;
  return (
    <section aria-label={t("As of a past run")} data-testid="object-as-of">
      <div className="m2-asof" role="status" data-testid="as-of-band">
        <span>
          <strong>{a ? t("As it stood at the run of {when}.", { when: formatDate(a.as_of_at, "datetime") }) : t("As it stood at a past run.")}</strong>{" "}
          {a && a.run_id !== a.as_of_run ? t("This object was last measured before it, on {when}.", { when: formatDate(a.run_at, "datetime") }) : null}{" "}
          {t("Nothing here changes today's data.")}
        </span>
        <V2Link href={backHref} className="m2-btn m2-sm">
          {t("Back to today")}
        </V2Link>
      </div>
      {q.isPending ? (
        <Skeleton width={406} height={152} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The object could not be read as of this run. It may not have been measured at or before it.")}</ErrorFrame>
      ) : !a ? (
        <EmptyFrame>{t("No reading of this object at that run.")}</EmptyFrame>
      ) : (
        <>
          <p className="m2-statusline">
            <span>{t("Run {run_at}", { run_at: formatDate(a.run_at, "datetime") })}</span>
            <span>{t("{records_checked} records checked", { records_checked: int(a.records_checked) })}</span>
            <span>{t("{n} failing records", { n: int(a.failing_records) })}</span>
            <span>{t("{rules_measured} rules measured", { rules_measured: int(a.rules.length) })}</span>
          </p>
          <div className="m2-score">
            <Ruler size={240} dims={DIMENSIONS.map((d) => a.dimensions[d.key] ?? null)} measured={a.raw_score} score={a.score} capped={a.capped} capLevel={a.cap_level} breaches={a.breaches} label={label} records={a.records_checked} rules={a.rules.length} coverage={null} selected />
            <div className="m2-sline">
              <p>
                {t("Measured {raw_score}, shown {score}.", { raw_score: f1(a.raw_score), score: f1(a.score) })}{" "}
                {a.capped && a.cap_level != null ? t("Capped at {cap} by {rules}.", { cap: a.cap_level, rules: a.breaches.join(", ") }) : t("No cap at this run.")}
              </p>
            </div>
          </div>
          {a.rules.length ? (
            <div className="m2-frame" tabIndex={0} role="region" aria-label={t("Rules at this run, scrollable")}>
              <table className="m2-tbl" aria-label={t("Rules of {label} at this run", { label })} data-testid="as-of-rules">
                <thead>
                  <tr>
                    <th scope="col">{t("Rule")}</th>
                    <th scope="col">{t("Severity")}</th>
                    <th scope="col" className="m2-r">{t("Failing")}</th>
                    <th scope="col" className="m2-r">{t("Checked")}</th>
                    <th scope="col" className="m2-r">{t("Pass rate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {a.rules.slice(0, 20).map((r) => (
                    <tr key={r.check_id}>
                      <th scope="row">
                        <V2Link href={hrefFor({ kind: "rule", id: r.check_id })}>
                          <Mono>{r.check_id}</Mono>
                        </V2Link>
                      </th>
                      <td>
                        <span className="m2-v">
                          <SeverityMark severity={sev(r.severity)} />
                          {labelText(r.severity)}
                        </span>
                      </td>
                      <td className="m2-r">{int(r.failing)}</td>
                      <td className="m2-r">{int(r.total)}</td>
                      <td className="m2-r">{passRateText(r.pass_rate) ?? <Dash why={t("Not measured")} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="m2-prov">{t("The rules of that run are not listed for this object.")}</p>
          )}
        </>
      )}
    </section>
  );
}
