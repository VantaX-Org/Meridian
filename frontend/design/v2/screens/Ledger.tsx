"use client";

import { useMemo } from "react";
import type { WorkRow } from "@/lib/api/v2/types";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { STATUS_LABEL, recordItemId } from "@/lib/v2/work";
import { useWorkRows } from "@/lib/v2/work-queries";
import { Money } from "../Money";
import { SeverityMark, type SeverityKey } from "../marks";
import { Coded, Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import type { LedgerProps } from "./object/LedgerSlot";
import { CurrentValue, KeyText } from "./work-parts";

/**
 * The scoped ledger: the failing records of one object or one rule, ranked by value at risk, read only. Each row shows
 * the record, the rule with its message, the field with its description, the current and the suggested value, the value
 * at risk as a bar against the largest in view, and the decision. The decisions themselves are made on Work, the one
 * action of this frame.
 */
export function Ledger({ module, system, filters }: LedgerProps) {
  const q = useWorkRows({ module, system, ...filters }, "value");
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total ?? null;
  const max = Math.max(1, ...rows.map((r) => r.value_at_risk ?? 0));
  const { hrefFor } = useOpenItem();
  const qs = new URLSearchParams();
  if (module) qs.set("module", module);
  if (system) qs.set("system", system);
  for (const [k, v] of Object.entries(filters ?? {})) if (v) qs.set(k, v);
  const workHref = `/work${qs.size ? `?${qs}` : ""}`;

  if (q.isPending) {
    return (
      <div aria-busy="true" data-testid="ledger-loading">
        <Skeleton width="100%" height={200} />
      </div>
    );
  }
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The failing records could not be read.")}</ErrorFrame>;
  if (!rows.length) {
    return (
      <EmptyFrame action={<V2Link href={workHref} className="m2-btn">{t("Open Work")}</V2Link>}>
        {t("No failing records are listed here yet. Rows appear when an analysis finds rules with a fixable or suggested value.")}
      </EmptyFrame>
    );
  }
  return (
    <section className="m2-ledger" data-testid="ledger" aria-label={t("Failing records")}>
      <div className="m2-ledger-h">
        <span>
          {total == null ? int(rows.length) : t("{n} records", { n: int(total) })}
          {q.data?.pages[0]?.total_capped ? "+" : ""}
          {total != null && rows.length < total ? <span className="m2-meta"> {t("showing {n}", { n: int(rows.length) })}</span> : null}
        </span>
        <V2Link href={workHref} className="m2-btn m2-next">{t("Decide in Work")}</V2Link>
      </div>
      <div className="m2-ledger-scroll">
        <table className="m2-tbl">
          <thead>
            <tr>
              <th scope="col">{t("Record")}</th>
              <th scope="col">{t("Rule")}</th>
              <th scope="col">{t("Field")}</th>
              <th scope="col">{t("Current value")}</th>
              <th scope="col">{t("Suggested value")}</th>
              <th scope="col" className="m2-r">{t("Value at risk")}</th>
              <th scope="col">{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={recordItemId(r)} r={r} max={max} href={hrefFor({ kind: "record", id: recordItemId(r) })} />
            ))}
          </tbody>
        </table>
      </div>
      {q.hasNextPage ? (
        <button type="button" className="m2-btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {t("Show more")}
        </button>
      ) : null}
    </section>
  );
}

function Row({ r, max, href }: { r: WorkRow; max: number; href: string }) {
  const risk = r.value_at_risk;
  return (
    <tr>
      <th scope="row">
        <SeverityMark severity={r.severity as SeverityKey} />{" "}
        <V2Link href={href} className="m2-rowlink"><KeyText value={r.record_key} /></V2Link>
        {r.name ? <span className="m2-meta"> {r.name}</span> : null}
      </th>
      <td>{r.checks[0] ? <Coded code={r.checks[0]} text={r.top_message} /> : <Dash />}</td>
      <td>{r.top_field ? <Coded code={r.top_field} text={r.field_description} /> : <Dash />}</td>
      <td><CurrentValue value={r.current_value} label={r.current_label} /></td>
      <td>{r.suggested_value ? <Coded code={r.suggested_value} text={r.suggested_label} first /> : <Dash why={t("The rule does not suggest a value")} />}</td>
      <td className="m2-r">
        {risk == null ? <Dash /> : (
          <span className="m2-ledger-risk">
            <span className="m2-cc-track" aria-hidden="true"><span style={{ width: `${(risk / max) * 100}%` }} data-tone={r.severity === "critical" ? "crit" : r.severity === "high" ? "warn" : undefined} /></span>
            <Money amount={risk} />
          </span>
        )}
      </td>
      <td>{STATUS_LABEL[r.status] ?? r.status}</td>
    </tr>
  );
}
