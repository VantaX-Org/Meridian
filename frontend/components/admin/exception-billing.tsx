"use client";

/**
 * Admin, Exception billing: what a month of resolved exceptions costs, by
 * billing tier, on top of the base fee. Read only; the first read of a month
 * records it.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, Field, Input, PageHeader, SectionCard, TableSkeleton, Tally } from "@/components/ui-core";
import { getExceptionBilling } from "@/lib/api/exceptions";

const TIERS = [1, 2, 3, 4] as const;
const money = (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thisMonth = () => new Date().toISOString().slice(0, 7);
const HREF = "/admin?tab=exception-billing";

export function ExceptionBillingSurface() {
  const [period, setPeriod] = useState(thisMonth);
  const q = useQuery({ queryKey: ["exceptions.billing", period], queryFn: () => getExceptionBilling(period), enabled: /^\d{4}-\d{2}$/.test(period) });
  const b = q.data;
  const resolved = b ? TIERS.reduce((n, t) => n + b[`tier${t}_count`], 0) : null;
  return (
    <div className="ui-page">
      <PageHeader title="Exception billing" summary="Resolved exceptions by billing tier, on top of the base fee. Read only." />
      <Tally level={4} label="Billing for the month" figures={[
        { label: "Total", value: null, text: b ? money(b.total_amount) : undefined, loading: q.isLoading, verdict: b ? "Base fee plus tiers." : "Pick a month.", href: HREF },
        { label: "Base fee", value: null, text: b ? money(b.base_fee) : undefined, loading: q.isLoading, verdict: "Charged every month.", href: HREF },
        { label: "Resolved exceptions", value: resolved, loading: q.isLoading, verdict: resolved ? "Billed by tier below." : "Nothing resolved this month.", href: HREF },
      ]} />
      <div className="ui-fields"><Field label="Month">
        {({ controlId }) => <Input id={controlId} type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} />}
      </Field></div>
      {q.isLoading ? <TableSkeleton rows={4} label="Reading billing" />
        : q.error ? <Banner tone="danger" title="Billing could not be read">{(q.error as Error).message}</Banner>
        : b ? (
          <SectionCard title="By tier" meta={b.stripe_invoice_id ? `Invoice ${b.stripe_invoice_id}` : undefined} flush>
            <table className="ui-mini-table">
              <thead><tr><th>Tier</th><th className="ui-num">Resolved</th><th className="ui-num">Amount</th></tr></thead>
              <tbody>{TIERS.map((t) => (
                <tr key={t}>
                  <td>Tier {t}</td>
                  <td className="ui-num">{b[`tier${t}_count`]}</td>
                  <td className="ui-num">{money(b[`tier${t}_amount`])}</td>
                </tr>
              ))}</tbody>
            </table>
          </SectionCard>
        ) : null}
    </div>
  );
}
