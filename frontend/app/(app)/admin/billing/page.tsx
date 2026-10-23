"use client";

/**
 * Admin, Exception billing: what a month of resolved exceptions costs, by
 * billing tier, on top of the base fee. Read only; the first read of a month
 * records it.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Field, Input, ReportPage, Stat } from "@/design";
import { getExceptionBilling } from "@/lib/api/exceptions";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import type { ExceptionBilling } from "@/types/api";

const TIERS = [1, 2, 3, 4] as const;
type Tier = (typeof TIERS)[number];
const money = (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thisMonth = () => new Date().toISOString().slice(0, 7);

interface TierRow { tier: Tier; count: number; amount: number }

export default function ExceptionBillingPage() {
  const [period, setPeriod] = useState(thisMonth);
  const q = useQuery({
    queryKey: queryKeys.exceptionBilling(period),
    queryFn: () => getExceptionBilling(period),
    enabled: /^\d{4}-\d{2}$/.test(period),
  });
  const b = q.data;
  const tierCount = (bb: ExceptionBilling, t: Tier) => bb[`tier${t}_count` as keyof ExceptionBilling] as number;
  const tierAmount = (bb: ExceptionBilling, t: Tier) => bb[`tier${t}_amount` as keyof ExceptionBilling] as number;
  const rows: TierRow[] = b ? TIERS.map((t) => ({ tier: t, count: tierCount(b, t), amount: tierAmount(b, t) })) : [];

  const columns: ColumnDef<TierRow>[] = [
    { id: "tier", header: "Tier", cell: ({ row }) => `Tier ${row.original.tier}` },
    { id: "count", header: "Resolved", cell: ({ row }) => row.original.count },
    { id: "amount", header: "Amount", cell: ({ row }) => money(row.original.amount) },
  ];

  let state: "loading" | "empty" | "error" | undefined;
  if (q.isLoading) state = "loading";
  else if (isListFailure(q)) state = "error";
  else if (!b) state = "empty";

  return (
    <ReportPage
      title="Exception billing"
      meta="Resolved exceptions by billing tier, on top of the base fee. Read only."
      narrative={null}
      charts={
        <div className="flex flex-col gap-4">
          <div className="flex gap-6">
            <Stat label="Total" value={b ? money(b.total_amount) : q.isLoading ? "–" : "Pick a month"} />
            <Stat label="Base fee" value={b ? money(b.base_fee) : q.isLoading ? "–" : "—"} />
          </div>
          <div className="[max-width:200px]">
            <Field label="Month">
              <Input type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
          </div>
        </div>
      }
      tables={
        b ? (
          <div className="flex flex-col gap-2">
            {b.stripe_invoice_id ? <span className="m-text-meta m-ink-3">Invoice {b.stripe_invoice_id}</span> : null}
            <DataTable columns={columns} data={rows} getRowId={(r) => String(r.tier)} />
          </div>
        ) : null
      }
      state={state}
      emptyProps={{ title: "No billable exceptions this period", detail: "Try an earlier month, or check back after the next billing run.", action: <Button variant="secondary" onClick={() => setPeriod(thisMonth())}>Back to this month</Button> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
    />
  );
}
