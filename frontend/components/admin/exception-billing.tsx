"use client";

/**
 * Admin → Exception billing: what a month of resolved exceptions costs, by
 * billing tier, on top of the base fee. Read only; the first read of a month
 * records it.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, Field, Input, KpiRail, Stack, Stat, Text } from "@/components/aurora";
import { getExceptionBilling } from "@/lib/api/exceptions";

const TIERS = [1, 2, 3, 4] as const;
const money = (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function ExceptionBillingSurface() {
  const [period, setPeriod] = useState(thisMonth);
  const q = useQuery({ queryKey: ["exceptions.billing", period], queryFn: () => getExceptionBilling(period), enabled: /^\d{4}-\d{2}$/.test(period) });
  const b = q.data;
  return (
    <Stack gap={5} className="aurora-page">
      <Field label="Month">
        {({ controlId }) => <Input id={controlId} type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} />}
      </Field>
      {q.isLoading ? <Text tone="muted">Reading billing.</Text>
        : q.error ? <Banner tone="danger" title="Billing could not be read">{(q.error as Error).message}</Banner>
        : b ? (
          <>
            <KpiRail>
              <Stat label="Total" value={money(b.total_amount)} />
              <Stat label="Base fee" value={money(b.base_fee)} />
              <Stat label="Resolved exceptions" value={TIERS.reduce((n, t) => n + b[`tier${t}_count`], 0)} />
            </KpiRail>
            <table className="aurora-exec__table">
              <thead><tr><th>Tier</th><th>Resolved</th><th>Amount</th></tr></thead>
              <tbody>{TIERS.map((t) => (
                <tr key={t}>
                  <td>Tier {t}</td>
                  <td className="aurora-number">{b[`tier${t}_count`]}</td>
                  <td className="aurora-number">{money(b[`tier${t}_amount`])}</td>
                </tr>
              ))}</tbody>
            </table>
            {b.stripe_invoice_id ? <Text variant="text-small" tone="muted">Invoice {b.stripe_invoice_id}</Text> : null}
          </>
        ) : null}
    </Stack>
  );
}
